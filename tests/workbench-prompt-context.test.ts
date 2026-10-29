import test from "node:test";
import assert from "node:assert/strict";
import { promptPackets } from "../packages/workbench/prompt-context";
import { emptyData } from "./workbench-fixtures";
import { VERSION, type Packet } from "../packages/workbench/contracts";
import { prepareModelPrompt } from "../packages/workbench/prompt-budget";

test("model context removes exact duplicate hardware evidence and transport ancestry while preserving versions, excerpts, feedback and BOM lines", () => {
  const item: any = {
    id: "record-v1",
    kind: "hardware-record",
    label: "Part",
    properties: { revision: "v1", parameters: [{ value: "unknown" }] },
    references: [],
  };
  const make = (id: string, items: any[]): Packet => ({
    id,
    version: VERSION,
    invocationId: id,
    inputs: ["ancestry"],
    summary: "Preserved summary",
    evidence: "proposal",
    data: { ...emptyData(), structure: items },
  });
  const input = [
    make("a", [item]),
    make("b", [structuredClone(item)]),
    make("c", [
      {
        ...item,
        properties: {
          ...item.properties,
          documentExcerpts: ["New source excerpt"],
        },
      },
    ]),
    make("d", [{ ...item, id: "record-v2", properties: { revision: "v2" } }]),
    make("e", [
      { ...item, id: "bom", kind: "hardware-option" },
      { ...item, id: "feedback", kind: "user-feedback" },
      { ...item, id: "dispatch", kind: "coordination-decision" },
    ]),
  ];
  const original = JSON.stringify(input);
  const view = promptPackets(input);
  assert.equal(
    view
      .flatMap((p) => p.data.structure)
      .filter((i) => i.kind === "hardware-record").length,
    3,
  );
  assert(view[2].data.structure[0].properties.documentExcerpts);
  assert.equal(view[3].data.structure[0].id, "record-v2");
  assert.deepEqual(
    view[4].data.structure.map((i) => i.id),
    ["bom", "feedback"],
  );
  assert.equal(view[0].summary, "Preserved summary");
  assert(!("inputs" in view[0]));
  assert.equal(
    JSON.stringify(input),
    original,
    "Stored evidence must not be rewritten",
  );
});

test("manager uses the latest validated baseline while retaining constraints, review advice, source versions and newer deltas", () => {
  const item = (id: string, kind: string, properties: any = {}) => ({
    id,
    kind,
    label: id,
    properties,
    references: [],
  });
  const make = (id: string, items: any[]): Packet => ({
    id,
    version: VERSION,
    invocationId: id,
    inputs: [],
    summary: id,
    evidence: "proposal",
    data: { ...emptyData(), structure: items },
  });
  const input = [
    make("old", [
      item("old-part", "hardware-option"),
      item("user", "user-feedback", { instruction: "Keep silent input" }),
      item("review", "review-finding", { finding: "Unverified" }),
      item("source", "hardware-record", {
        source: "curated",
        recordId: "part",
        revision: "v1",
        parameters: ["Long source text"],
      }),
    ]),
    make("baseline", [item("bom", "bom-baseline", { rows: ["current"] })]),
    make("new", [item("new-part", "hardware-option")]),
  ];
  const manager = promptPackets(input, "coordinator");
  assert.deepEqual(
    manager[0].data.structure.map((i) => i.id),
    ["user", "review", "source"],
  );
  assert.equal(
    manager[0].data.structure[0].properties.instruction,
    "Keep silent input",
  );
  assert.equal(manager[0].data.structure[2].properties.revision, "v1");
  assert(!("parameters" in manager[0].data.structure[2].properties));
  assert.equal(manager[1].data.structure[0].id, "bom");
  assert.equal(manager[2].data.structure[0].id, "new-part");
  assert(
    !promptPackets(input, "embedded")[0].data.structure.some(
      (i) => i.id === "old-part",
    ),
  );
  assert.deepEqual(input[0].data.structure[3].properties.parameters, [
    "Long source text",
  ]);
});

test("specialist baseline context retains referenced old parts and adapts large source records without deleting constraints", () => {
  const make = (id: string, items: any[]): Packet => ({
    version: VERSION,
    id,
    invocationId: id,
    inputs: [],
    summary: id,
    evidence: "proposal",
    data: { ...emptyData(), structure: items },
  });
  const item = (
    id: string,
    kind: string,
    properties: any,
    references: string[] = [],
  ) => ({ id, kind, label: id, properties, references });
  const old = make("old", [
    item("kept", "hardware-option", { partNumber: "real" }, ["source"]),
    item("obsolete", "hardware-option", { comment: "old unrelated option" }),
    item("source", "hardware-record", {
      source: "curated",
      recordId: "real",
      revision: "r",
      parameters: [{ value: "x".repeat(1800) }],
      notes: ["x".repeat(4000)],
    }),
    item("requirement", "requirement", { text: "Keep USB-C and infrared" }),
  ]);
  const baseline = make("current", [
    item("bom", "bom-baseline", { rows: [{ itemId: "kept" }] }, ["kept"]),
  ]);
  const before = JSON.stringify([old, baseline]);
  const view = JSON.parse(
    prepareModelPrompt(
      "embedded",
      {
        instruction: "read baseline",
        packets: [old, baseline],
        state: { invocations: [] },
      },
      3000,
    ),
  );
  const items = view.packets.flatMap((p: any) => p.data.structure);
  assert(items.some((i: any) => i.id === "kept"));
  assert(!items.some((i: any) => i.id === "obsolete"));
  assert.equal(
    items.find((i: any) => i.id === "source").properties.revision,
    "r",
  );
  assert.equal(
    items.find((i: any) => i.id === "requirement").properties.text,
    "Keep USB-C and infrared",
  );
  assert.equal(JSON.stringify([old, baseline]), before);
});

test("coordinator image evidence is deduplicated and indexed without changing saved artifacts", () => {
  const image = {
    id: "image:real",
    kind: "generated-image",
    label: "Front",
    properties: {
      id: "real",
      imageSet: "appearance",
      view: "front",
      sha256: "a".repeat(64),
      imageUrl: "/workbench-api/images/real",
      prompt: "x".repeat(14000),
      generationMethod: "image_model",
      engineeringVerified: false,
    },
    references: ["request"],
  };
  const make = (id: string): Packet => ({
    version: VERSION,
    id,
    invocationId: id,
    inputs: [],
    summary: "generated",
    evidence: "proposal",
    data: { ...emptyData(), structure: [image] },
  });
  const input = [make("node"), make("image-generation")];
  const before = JSON.stringify(input);
  const view = promptPackets(input, "coordinator");
  const items = view.flatMap((p) => p.data.structure);
  assert.equal(items.length, 1);
  assert.equal(items[0].properties.sha256, image.properties.sha256);
  assert.deepEqual(items[0].references, ["request"]);
  assert(!("prompt" in items[0].properties));
  assert.equal(JSON.stringify(input), before);
});

test("coordinator follows the latest structural snapshot and indexes firmware while preserving user requirements", () => {
  const make = (id: string, items: any[]): Packet => ({
    version: VERSION,
    id,
    invocationId: id,
    inputs: [],
    summary: id,
    evidence: "proposal",
    data: { ...emptyData(), structure: items },
  });
  const part = (id: string) => ({
    id,
    kind: "component-instance",
    label: id,
    properties: { geometryRef: { assetId: "real" }, positionMm: [0, 0, 10] },
    references: [],
  });
  const requirement = {
    id: "user",
    kind: "requirement",
    label: "request",
    properties: { sourceCode: "q".repeat(2500) },
    references: [],
  };
  const firmware = {
    id: "firmware",
    kind: "firmware-proposal",
    label: "code",
    properties: { code: "x".repeat(9000), compiled: false },
    references: [],
  };
  const packets = [
    make("old", [part("old-part"), requirement]),
    make("new", [part("new-part"), firmware]),
  ];
  const before = JSON.stringify(packets);
  const view = promptPackets(packets, "coordinator").flatMap(
    (p) => p.data.structure,
  );
  assert(!view.some((i) => i.id === "old-part"));
  assert(view.some((i) => i.id === "new-part"));
  assert.equal(
    view.find((i) => i.id === "user")!.properties.sourceCode,
    requirement.properties.sourceCode,
  );
  assert(
    String(view.find((i) => i.id === "firmware")!.properties.code).length < 500,
  );
  assert.equal(
    view.find((i) => i.id === "firmware")!.properties.compiled,
    false,
  );
  assert.equal(JSON.stringify(packets), before);
  assert.equal(
    promptPackets(packets, "software")[1].data.structure[1].properties.code,
    firmware.properties.code,
  );
});

test("budget indexing omits empty old transport without losing user requirements or engineering items", () => {
  const make = (
    id: string,
    structure: any[] = [],
    summary = "old transport",
  ): Packet => ({
    version: VERSION,
    id,
    invocationId: id,
    inputs: [],
    summary,
    evidence: "proposal",
    data: { ...emptyData(), structure },
  });
  const user = make("user", [
    {
      id: "constraint",
      kind: "user-feedback",
      label: "constraint",
      properties: {
        instruction:
          "Keep the real silhouette and do not replace it with a box",
      },
      references: [],
    },
  ]);
  const transport = Array.from({ length: 40 }, (_, i) =>
    make(`old-${i}`, [], "superseded summary ".repeat(60)),
  );
  const current = make("current", [
    {
      id: "body",
      kind: "enclosure-instance",
      label: "real body",
      properties: { appearanceRef: { modelId: "actual", revision: "version" } },
      references: [],
    },
  ]);
  const view = promptPackets(
    [user, ...transport, current],
    "coordinator",
    true,
  );
  assert(view.length < 12);
  assert(view.some((p) => p.data.structure.some((i) => i.id === "constraint")));
  assert(view.some((p) => p.data.structure.some((i) => i.id === "body")));
});

test("large project catalog keeps complete user feedback and retrievable engineering results within budget", () => {
  const feedback =
    "Keep the real contour and the authorised assumptions. ".repeat(12);
  const make = (id: string, structure: any[]): Packet => ({
    version: VERSION,
    id,
    invocationId: id,
    inputs: [],
    summary: id,
    evidence: "proposal",
    data: { ...emptyData(), structure },
  });
  const packets = [
    make("user", [
      {
        id: "feedback",
        kind: "user-feedback",
        label: "user",
        properties: { instruction: feedback },
        references: [],
      },
    ]),
    ...Array.from({ length: 20 }, (_, n) =>
      make("review-" + n, [
        {
          id: "finding-" + n,
          kind: "review-finding",
          label: "risk " + n,
          properties: {
            severity: "risk",
            finding: "complete engineering evidence ".repeat(60),
            suggestion: "Investigate the precise source",
          },
          references: [],
        },
      ]),
    ),
  ];
  const input = {
    instruction: "Continue the current project",
    packets,
    state: { invocations: [] },
  };
  const output = prepareModelPrompt("coordinator", input, 11000);
  assert(output.length < 11000);
  const view = JSON.parse(output);
  assert.equal(
    view.packets[0].data.structure[0].properties.instruction,
    feedback,
  );
  assert(view.state.itemIdsSource);
  assert.equal(
    view.packets.at(-1).data.structure[0].properties.fullResult.itemId,
    "finding-19",
  );
  assert.equal(
    packets.at(-1)!.data.structure[0].properties.finding,
    "complete engineering evidence ".repeat(60),
  );
});

test("coordinator sees the latest view in each geometric or concept group while specialists retain consumed history", () => {
  const make = (id: string, method: string): Packet => ({
    version: VERSION,
    id,
    invocationId: id,
    inputs: [],
    summary: id,
    evidence: "proposal",
    data: {
      ...emptyData(),
      structure: [
        {
          id,
          kind: "generated-image",
          label: id,
          properties: {
            imageSet: "appearance",
            view: "front",
            generationMethod: method,
          },
          references: [],
        },
      ],
    },
  });
  const packets = [
    make("old-cad", "appearance_geometry"),
    make("concept", "image_model"),
    make("new-cad", "appearance_geometry"),
  ];
  const ids = (role: "coordinator" | "mechanical") =>
    promptPackets(packets, role, true).flatMap((p) =>
      p.data.structure.map((i) => i.id),
    );
  assert.deepEqual(ids("coordinator"), ["concept", "new-cad"]);
  assert.deepEqual(ids("mechanical"), ["old-cad", "concept", "new-cad"]);
  assert.equal(packets[0].data.structure.length, 1);
});

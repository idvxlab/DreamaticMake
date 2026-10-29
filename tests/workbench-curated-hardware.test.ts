import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hardwareFixture } from "./workbench-hardware-fixtures";
import { curatedRecords } from "../packages/workbench/curated-hardware";

const fixture = {
  version: "dreamatic.hardware-curated/1",
  records: [
    {
      recordId: "sensor",
      title: "PMW fixture sensor",
      summary: "Source claim",
      url: "https://example.com/sensor",
      capturedAt: "2026-10-27T08:00:00.000Z",
      parameters: [
        {
          name: "Supply",
          value: "unknown",
          sourceUrl: "https://example.com/sensor",
        },
      ],
      sourceText: "No geometry registered",
      notes: ["Variant still needs confirmation"],
    },
  ],
};

test("curated references preserve unknowns and content revisions, never gain geometry or physical verification", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dreamatic-curated-"));
  const lib = await hardwareFixture(dir);
  try {
    await mkdir(lib.cache, { recursive: true });
    const file = join(lib.cache, "curated.json");
    await writeFile(file, JSON.stringify(fixture));
    assert.equal((await lib.search("PMW", "curated")).total, 1);
    const before = await lib.get("curated", "sensor");
    assert.equal(
      before.parameters[0] && (before.parameters[0] as any).value,
      "unknown",
    );
    assert.equal(before.physicalVerified, false);
    assert.equal(before.geometryVerified, false);
    assert.equal(before.assets.length, 0);
    await assert.rejects(() => lib.asset("curated", "sensor", "invented"));
    await writeFile(
      file,
      JSON.stringify({
        ...fixture,
        records: [{ ...fixture.records[0], notes: ["Updated source"] }],
      }),
    );
    await lib.refresh();
    assert.notEqual(
      (await lib.get("curated", "sensor")).revision,
      before.revision,
    );
    await writeFile(
      file,
      JSON.stringify({
        ...fixture,
        records: [...fixture.records, ...fixture.records],
      }),
    );
    await lib.refresh();
    assert.equal((await lib.search("PMW", "curated")).total, 0);
    assert.equal(
      (await lib.status()).sources.find((s) => s.source === "curated")?.state,
      "error",
    );
    await assert.rejects(() => lib.get("curated", "sensor"));
  } finally {
    lib.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("curated import rejects executable URLs and attempts to inject verification flags", () => {
  assert.throws(() =>
    curatedRecords({
      ...fixture,
      records: [{ ...fixture.records[0], url: "file:///etc/passwd" }],
    }),
  );
  assert.throws(() =>
    curatedRecords({
      ...fixture,
      records: [{ ...fixture.records[0], physicalVerified: true }],
    }),
  );
});

test("versioned BOM rejects zero quantities, selected procurement placeholders and selected parts without sources", async () => {
  const { validateHardwareReferences, hardwarePacket } = await import(
    "../packages/workbench/hardware-evidence"
  );
  const { emptyData } = await import("./workbench-fixtures");
  const dir = await mkdtemp(join(tmpdir(), "dreamatic-bom-"));
  const lib = await hardwareFixture(dir);
  try {
    const placeholder = await lib.get("requirements", "variant");
    const ref = {
      source: placeholder.source,
      recordId: placeholder.recordId,
      revision: placeholder.revision,
    };
    const packet: any = { ...hardwarePacket(placeholder), data: emptyData() };
    const properties: any = {
      bomVersion: "dreamatic.bom/1",
      function: "sensor",
      manufacturer: "TBD",
      partNumber: "TBD",
      quantity: 1,
      unit: "pcs",
      scope: "product",
      selectionStatus: "missing",
      interfaces: ["GPIO"],
      unverified: ["Model unknown"],
      hardwareRefs: [],
    };
    packet.data.structure = [
      {
        id: "line",
        kind: "hardware-option",
        label: "Sensor",
        properties,
        references: [],
      },
    ];
    validateHardwareReferences(packet, [hardwarePacket(placeholder)]);
    properties.quantity = 0;
    assert.throws(() =>
      validateHardwareReferences(packet, [hardwarePacket(placeholder)]),
    );
    properties.quantity = 1;
    properties.selectionStatus = "selected";
    assert.throws(
      () => validateHardwareReferences(packet, [hardwarePacket(placeholder)]),
      /selected/,
    );
    properties.hardwareRefs = [ref];
    assert.throws(
      () => validateHardwareReferences(packet, [hardwarePacket(placeholder)]),
      /采购需求/,
    );
    properties.selectionStatus = "candidate";
    validateHardwareReferences(packet, [hardwarePacket(placeholder)]);
  } finally {
    lib.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("BOM baseline must reference actual expert lines without changing their quantities or selected variants", async () => {
  const { hardwarePacket, validateHardwareReferences } = await import(
    "../packages/workbench/hardware-evidence"
  );
  const record = curatedRecords(fixture)[0];
  const source = hardwarePacket(record);
  const ref = {
    source: record.source,
    recordId: record.recordId,
    revision: record.revision,
  };
  const line: any = {
    id: "button-line",
    kind: "hardware-option",
    label: "Button",
    references: [record.itemId],
    properties: {
      bomVersion: "dreamatic.bom/1",
      function: "input",
      manufacturer: "Fixture",
      partNumber: "BUTTON-2P",
      quantity: 4,
      unit: "pcs",
      scope: "mouse",
      selectionStatus: "selected",
      interfaces: "2 pins",
      unverified: ["Not tested"],
      hardwareRefs: [ref],
    },
  };
  const packet: any = {
    ...hardwarePacket(record),
    data: {
      structure: [line],
      motion: [],
      circuit_energy: [],
      flow: [],
      logic: [],
    },
  };
  const row = {
    itemId: line.id,
    name: "Four buttons",
    partNumber: "BUTTON-2P",
    quantity: 4,
    unit: "pcs",
    selectionStatus: "selected",
  };
  const manifest: any = {
    id: "baseline",
    kind: "bom-baseline",
    label: "BOM",
    references: [],
    properties: {
      contractVersion: "dreamatic.bom/1",
      scope: "prototype",
      rows: [row],
      excluded: [],
      procedures: [],
      openChecks: ["Assembly pending"],
    },
  };
  const output: any = {
    ...hardwarePacket(record),
    data: {
      structure: [manifest],
      motion: [],
      circuit_energy: [],
      flow: [],
      logic: [],
    },
  };
  validateHardwareReferences(output, [source, packet]);
  assert(manifest.references.includes(line.id));
  row.quantity = 8;
  assert.throws(
    () => validateHardwareReferences(output, [source, packet]),
    /quantity/,
  );
  row.quantity = 4;
  row.itemId = "invented";
  assert.throws(
    () => validateHardwareReferences(output, [source, packet]),
    /没有实际硬件选型/,
  );
  row.itemId = line.id;
  manifest.properties.rows = [row, row];
  assert.throws(
    () => validateHardwareReferences(output, [source, packet]),
    /重复/,
  );
});

test("BOM requirements in the instruction reject summary-only results even when the invocation title omits BOM", async () => {
  const { Workbench } = await import("../packages/workbench/runtime");
  const { fixtureCaller, emptyData } = await import("./workbench-fixtures");
  const dir = await mkdtemp(join(tmpdir(), "dreamatic-bom-output-"));
  let checked = 0;
  const w = new Workbench(
    async (role, input) => {
      const value: any = await fixtureCaller(role, input);
      if (role === "coordinator" && value.decision?.action === "dispatch") {
        for (const task of value.decision.tasks)
          if (task.role === "embedded") {
            task.title = "补齐物料";
            task.instruction += " 输出BOM hardware-option";
          }
      }
      if (role === "embedded") {
        assert.throws(
          () =>
            input.validateOutput?.({
              summary: "claims 19 lines",
              data: emptyData(),
            }),
          /硬件选型必须输出逐件/,
        );
        checked++;
        return {
          summary: "Explicit missing component",
          data: {
            ...emptyData(),
            structure: [
              {
                id: `bom-${checked}`,
                kind: "hardware-option",
                label: "Missing part",
                references: [],
                properties: {
                  bomVersion: "dreamatic.bom/1",
                  function: "fixture",
                  manufacturer: "TBD",
                  partNumber: "TBD",
                  quantity: 1,
                  unit: "pcs",
                  scope: "product",
                  selectionStatus: "missing",
                  required: false,
                  interfaces: "unknown",
                  unverified: ["Model missing"],
                  hardwareRefs: [],
                },
              },
            ],
          },
        };
      }
      return value;
    },
    dir,
    { visualContract: "legacy" },
  );
  try {
    await w.start("fixture");
    await w.answer(
      Object.fromEntries(w.project!.questions.map((q) => [q.id, q.options[0]])),
    );
    assert.equal(checked, 2);
    assert.equal(w.project!.phase, "complete");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

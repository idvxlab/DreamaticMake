import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  appearanceDesignSchema,
  type AppearanceModel,
} from "../packages/workbench/appearance-contracts";
import {
  AppearanceStore,
  appearancePacket,
} from "../packages/workbench/appearance";
import { validateAppearanceOutput } from "../packages/workbench/appearance-tools";
import { stageGaps } from "../packages/workbench/stage-gaps";
import { imagePreviewItems } from "../packages/workbench/image-preview";
import {
  VERSION,
  type Packet,
  type Invocation,
  type Task,
} from "../packages/workbench/contracts";
import { Workbench } from "../packages/workbench/runtime";
import { makeServer } from "../apps/workbench/server";
import { ImageStore } from "../packages/workbench/images";
const empty = () => ({
  structure: [],
  motion: [],
  circuit_energy: [],
  flow: [],
  logic: [],
});
const packet = (structure: any[] = []): Packet => ({
  version: VERSION,
  id: randomUUID(),
  invocationId: "test",
  inputs: [],
  summary: "test",
  evidence: "proposal",
  data: { ...empty(), structure },
});
const item = (
  kind: string,
  properties: Record<string, unknown>,
  id = kind,
) => ({ id, kind, label: kind, properties, references: [] });
const design = {
  version: "dreamatic.appearance/1",
  units: "mm",
  geometryFrame: "xyz-mm-center-z-up/1",
  label: "curved product",
  axis: "y",
  wallThicknessMm: 2,
  sections: [
    {
      offsetMm: -30,
      centerMm: [0, 50],
      shape: "rounded_rectangle",
      sizeMm: [60, 100],
      radiusMm: 10,
    },
    {
      offsetMm: 30,
      centerMm: [0, 50],
      shape: "rounded_rectangle",
      sizeMm: [55, 96],
      radiusMm: 8,
    },
  ],
  features: [],
  assumptions: ["not physically verified"],
};
function model(): AppearanceModel {
  return {
    version: "dreamatic.appearance/1",
    reference: { modelId: randomUUID(), revision: "a".repeat(64) },
    itemId: "appearance:fixture",
    sourceItemId: "design",
    label: "fixture",
    design: appearanceDesignSchema.parse(design),
    dimensionsMm: [60, 60, 100],
    positionMm: [0, 0, 50],
    bodyBounds: { minMm: [-30, -30, 0], maxMm: [30, 30, 100] },
    sceneBounds: { minMm: [-30, -30, 0], maxMm: [30, 30, 100] },
    assets: [],
    meshUrl: "/workbench-api/appearance/fixture/shell.stl",
    stepUrl: "/workbench-api/appearance/fixture/appearance.step",
    interiorStepUrl: "/workbench-api/appearance/fixture/interior.step",
    geometryDigest: "b".repeat(64),
    checks: { valid: true },
    physicalVerified: false,
    assemblyVerified: false,
  };
}

test("appearance design rejects invalid lofts and impossible hollow sections", () => {
  assert(appearanceDesignSchema.safeParse(design).success);
  assert(
    !appearanceDesignSchema.safeParse({
      ...design,
      sections: [design.sections[1], design.sections[0]],
    }).success,
  );
  assert(
    !appearanceDesignSchema.safeParse({
      ...design,
      wallThicknessMm: 6,
      sections: design.sections.map((s) => ({ ...s, radiusMm: 3 })),
    }).success,
  );
  assert(
    !appearanceDesignSchema.safeParse({ ...design, python: "arbitrary code" })
      .success,
  );
});

test("structure binds the executed exterior and cannot replace it with a box, drift dimensions or forge CAD", () => {
  const m = model(),
    evidence = appearancePacket(m);
  const p = packet([
    item("enclosure-instance", { appearanceItemId: m.itemId }),
  ]);
  validateAppearanceOutput(p, [evidence], true);
  assert.deepEqual(p.data.structure[0].properties.appearanceRef, m.reference);
  assert.deepEqual(p.data.structure[0].properties.dimensionsMm, m.dimensionsMm);
  assert.equal(p.data.structure[0].properties.meshUrl, m.meshUrl);
  assert.throws(
    () =>
      validateAppearanceOutput(
        packet([
          item("enclosure-instance", {
            appearanceItemId: m.itemId,
            dimensionsMm: [99, 99, 99],
          }),
        ]),
        [evidence],
        true,
      ),
    /不可改写/,
  );
  assert.throws(
    () =>
      validateAppearanceOutput(
        packet([
          item("enclosure-instance", {
            appearanceItemId: m.itemId,
            appearanceRef: { ...m.reference, revision: "c".repeat(64) },
          }),
        ]),
        [evidence],
        true,
      ),
    /版本/,
  );
  assert.throws(
    () =>
      validateAppearanceOutput(packet([item("appearance-model", {})]), [
        evidence,
      ]),
    /执行器/,
  );
  assert.throws(
    () =>
      validateAppearanceOutput(
        packet([item("enclosure-proposal", { dimensionsMm: [60, 60, 100] })]),
        [evidence],
        true,
      ),
    /box|长方体/,
  );
  assert.throws(
    () =>
      validateAppearanceOutput(
        packet([item("enclosure-instance", { appearanceItemId: "invented" })]),
        [evidence],
        true,
      ),
    /真实CAD/,
  );
});

test("formal structure waits for four views of one executed shape; independent image-model views cannot satisfy it", () => {
  const m = model();
  const proof = appearancePacket(m);
  const embedded: Invocation = {
    id: "hardware",
    role: "embedded",
    title: "hardware",
    status: "done",
    inputs: [],
    packet: packet(),
  };
  const designer: Invocation = {
    id: "designer",
    role: "designer",
    title: "appearance",
    status: "done",
    inputs: [],
    packet: packet(),
    appearanceEvidence: [proof],
    imageEvidence: ["front", "top", "side", "perspective"].map((view) =>
      packet([
        item(
          "generated-image",
          {
            view,
            imageSet: "appearance",
            generationMethod: "image_model",
            appearanceRef: m.reference,
            geometryDigest: m.geometryDigest,
          },
          view,
        ),
      ]),
    ),
  };
  const task: Task = {
    key: "structure",
    role: "mechanical",
    title: "layout",
    instruction: "layout",
    dependsOn: ["hardware", "designer"],
  };
  assert(
    stageGaps(task, [embedded, designer], true).some((g) =>
      g.includes("四视图"),
    ),
  );
  designer.imageEvidence!.forEach(
    (p) =>
      (p.data.structure[0].properties.generationMethod = "appearance_geometry"),
  );
  assert.deepEqual(stageGaps(task, [embedded, designer], true), []);
  designer.imageEvidence![0].data.structure[0].properties.appearanceRef = {
    ...m.reference,
    revision: "c".repeat(64),
  };
  assert(
    stageGaps(task, [embedded, designer], true).some((g) =>
      g.includes("四视图"),
    ),
  );
});

test("appearance preview keeps concept references separate from geometric views", () => {
  const p = packet([
    item(
      "generated-image",
      {
        imageSet: "appearance",
        view: "front",
        generationMethod: "appearance_geometry",
      },
      "cad",
    ),
    item(
      "generated-image",
      {
        imageSet: "appearance",
        view: "front",
        generationMethod: "image_model",
      },
      "concept",
    ),
  ]);
  const node: Invocation = {
    id: "n",
    role: "designer",
    title: "views",
    status: "done",
    inputs: [],
    packet: p,
  };
  assert.deepEqual(
    imagePreviewItems(node).items.map((i) => i.id),
    ["cad", "concept"],
  );
});

test("appearance downloads require authentication, exact revision and file hashes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dreamatic-appearance-route-"));
  const images = new ImageStore(join(dir, "images"));
  const store = new AppearanceStore(join(dir, "appearance"), images);
  const m = model();
  const bytes = Buffer.from("fixture CAD bytes"),
    sha = createHash("sha256").update(bytes).digest("hex");
  m.assets = [{ id: "shell.stl", sha256: sha, bytes: bytes.length, url: "" }];
  const folder = join(store.directory, m.reference.modelId);
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, "model.json"), JSON.stringify(m));
  await writeFile(join(folder, "shell.stl"), bytes);
  const { server } = makeServer(
    new Workbench(undefined, join(dir, "project")),
    "fixture-token",
    undefined,
    undefined,
    undefined,
    images,
    store,
  );
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const address = server.address();
  assert(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const url = `${base}/workbench-api/appearance/${m.reference.modelId}/shell.stl?revision=${m.reference.revision}&sha256=${sha}`;
    assert.equal((await fetch(url)).status, 401);
    const login = await fetch(base + "/workbench-api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Workbench": "1" },
      body: JSON.stringify({ token: "fixture-token" }),
    });
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    const response = await fetch(url, { headers: { Cookie: cookie } });
    assert.equal(response.status, 200);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
    assert.notEqual(
      (
        await fetch(url.replace(m.reference.revision, "d".repeat(64)), {
          headers: { Cookie: cookie },
        })
      ).status,
      200,
    );
    await writeFile(join(folder, "shell.stl"), "tampered");
    await assert.rejects(
      () => store.asset(m.reference.modelId, "shell.stl", m.reference.revision),
      /SHA-256/,
    );
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    await rm(dir, { recursive: true, force: true });
  }
});

test("failed geometry execution preserves the actual tool failure for the manager", async () => {
  const { validateVisualExecution } = await import(
    "../packages/workbench/execution-evidence"
  );
  const node: Invocation = {
    id: "failed",
    role: "designer",
    title: "build",
    status: "running",
    inputs: [],
    toolActivity: [
      {
        tool: "build_appearance_geometry",
        success: false,
        error:
          "外形特征usb-c-port未命中外壳：face=back，centerMm=[-41.9,13.7]，请修正[X,Z]",
      },
    ],
  };
  assert.throws(
    () =>
      validateVisualExecution(
        node,
        packet(),
        [],
        "调用build_appearance_geometry生成外观图",
      ),
    /usb-c-port未命中外壳/,
  );
});

test("a one-component change cannot masquerade as the complete retained layout", async () => {
  const { layoutCoverageGaps } = await import(
    "../packages/workbench/layout-coverage"
  );
  const m = model();
  const body = item(
    "enclosure-instance",
    { appearanceRef: m.reference },
    "body",
  );
  const parts = Array.from({ length: 4 }, (_, n) =>
    item(
      "component-instance",
      {
        geometryRef: {
          source: "arduino",
          recordId: "part-" + n,
          assetId: "mesh",
        },
      },
      "part-" + n + "-v9",
    ),
  );
  const reserve = item(
    "reserved-volume",
    { dimensionsMm: [30, 16, 30] },
    "oled-v9",
  );
  const base = packet([body, ...parts, reserve]);
  base.invocationId = "baseline";
  const partial = packet([body, { ...parts[0], id: "part-0-v10" }]);
  partial.invocationId = "partial";
  assert.equal(layoutCoverageGaps(partial, [base]).length, 4);
  const complete = packet([
    body,
    ...parts.map((p) => ({ ...p, id: p.id.replace("v9", "v10") })),
    { ...reserve, id: "oled-v10" },
  ]);
  assert.deepEqual(layoutCoverageGaps(complete, [base]), []);
  const { renderLayoutViews } = await import(
    "../packages/workbench/layout-tools"
  );
  await assert.rejects(
    () =>
      renderLayoutViews([base, partial], partial.invocationId, async () => {}),
    /完整结构快照/,
  );
});

import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  AssemblyStore,
  assemblyPacket,
  validateAssemblyOutput,
} from "../packages/workbench/assembly";
import { assemblyAgentTools } from "../packages/workbench/assembly-agent-tools";
import { ASSEMBLY_VERSION } from "../packages/workbench/assembly-contracts";
import { VERSION, type Packet } from "../packages/workbench/contracts";
import { validateAppearanceOutput } from "../packages/workbench/appearance-tools";
import { Workbench } from "../packages/workbench/runtime";
import { makeServer } from "../apps/workbench/server";
const sha = (v: string) => createHash("sha256").update(v).digest("hex");
const packet = (structure: any[], invocationId = "layout"): Packet => ({
  version: VERSION,
  id: randomUUID(),
  invocationId,
  inputs: [],
  summary: "fixture",
  evidence: "proposal",
  data: { structure, motion: [], circuit_energy: [], flow: [], logic: [] },
});
const item = (
  id: string,
  kind: string,
  properties: any,
  references: string[] = [],
) => ({ id, kind, label: id, properties, references });
async function fixture(passed = true) {
  const dir = await mkdtemp(join(tmpdir(), "assembly-integration-"));
  const appearanceRef = { modelId: randomUUID(), revision: "a".repeat(64) };
  const geometryRef = {
    source: "arduino",
    recordId: "fixture",
    assetId: "part.step",
    revision: "b".repeat(64),
    sha256: sha("part"),
  };
  const model: any = {
    reference: appearanceRef,
    itemId: "appearance:fixture",
    dimensionsMm: [60, 50, 30],
    positionMm: [0, 0, 0],
    bodyBounds: { minMm: [-30, -25, -15], maxMm: [30, 25, 15] },
  };
  const geometry: any = {
    reference: geometryRef,
    sha256: geometryRef.sha256,
    minMm: [-2, -2, -1],
    maxMm: [2, 2, 1],
  };
  const appearances: any = {
    read: async () => model,
    asset: async (
      _id: string,
      name: string,
      _revision: string,
      digest: string,
    ) => {
      assert.equal(digest, sha(name));
      return { file: join(dir, name) };
    },
  };
  const library: any = {
    inspect: async () => geometry,
    asset: async () => ({
      file: join(dir, "part.step"),
      sha256: geometryRef.sha256,
    }),
  };
  let executions = 0;
  const execute: any = async (
    design: any,
    _assets: any,
    ids: string[],
    directory: string,
  ) => {
    executions++;
    assert.deepEqual(ids, ["board"]);
    const assets = [
      "base-assembly.step",
      "base.step",
      "base.stl",
      "lid-assembly.step",
      "lid.step",
      "lid.stl",
    ];
    for (const name of assets)
      await writeFile(join(directory, name), "fixture " + name);
    const report = {
      geometryChecksPassed: passed,
      assets: assets.map((id) => ({ id })),
      gaps: passed ? ["实物未验证"] : ["wire keepout occupied"],
      design,
    };
    await writeFile(join(directory, "report.json"), JSON.stringify(report));
    return report;
  };
  const store = new AssemblyStore(dir, appearances, library, execute);
  const design: any = {
    version: ASSEMBLY_VERSION,
    units: "mm",
    geometryFrame: "xyz-mm-center-z-up/1",
    appearanceRef,
    shellSha256: sha("shell.step"),
    outerSha256: sha("outer.step"),
    instances: [
      {
        id: "board",
        geometryRef,
        translationMm: [0, 0, 0],
        rotationDeg: [0, 0, 0],
      },
    ],
    split: { axis: "z", atMm: 5, gapMm: 0.4 },
    mounts: [],
    keepouts: [],
    print: {
      bedMm: [100, 100, 100],
      material: "PLA assumption",
      clearanceAssumption: "Unmeasured",
    },
    assemblyOrder: ["Install board", "Close lid"],
  };
  const packets = [
    packet(
      [item(model.itemId, "appearance-model", { ...model, appearanceRef })],
      "appearance",
    ),
    packet([
      item("body", "enclosure-instance", { appearanceRef }),
      item("board", "component-instance", {
        geometryRef,
        positionMm: [0, 0, 0],
        rotationDeg: [0, 0, 0],
      }),
    ]),
    packet(
      [item("design", "assembly-design", design, ["board", model.itemId])],
      "design",
    ),
  ];
  return {
    dir,
    store,
    packets,
    design,
    geometry,
    executions: () => executions,
  };
}
test("assembly binds complete source layout, revision and exact pose before worker execution", async () => {
  const f = await fixture();
  try {
    for (const mutate of [
      (p: Packet[]) => {
        (p[2].data.structure[0].properties.instances as any[]).pop();
      },
      (p: Packet[]) => {
        p[2].data.structure[0].references = [];
      },
      (p: Packet[]) => {
        (
          p[2].data.structure[0].properties.instances as any[]
        )[0].translationMm = [1, 0, 0];
      },
      (p: Packet[]) => {
        (
          p[2].data.structure[0].properties.instances as any[]
        )[0].geometryRef.revision = "c".repeat(64);
      },
      (p: Packet[]) => {
        p[1].data.structure.push(item("unknown", "reserved-volume", {}));
      },
    ]) {
      const copy = structuredClone(f.packets);
      mutate(copy);
      await assert.rejects(f.store.build(copy, "design"));
    }
    const stale = structuredClone(f.packets);
    const newer = structuredClone(stale[1]);
    newer.invocationId = "newer-layout";
    newer.id = randomUUID();
    newer.data.structure[1].id = "new-board";
    stale.push(newer);
    await assert.rejects(f.store.build(stale, "design"), /最新完整/);
    assert.equal(f.executions(), 0);
    const result = await f.store.build(f.packets, "design");
    assert.equal(f.executions(), 1);
    assert.equal(result.assets.length, 7);
    assert.equal(result.geometryChecksPassed, true);
    assert.equal(result.printed, false);
    assert.equal(result.assemblyVerified, false);
    const file = result.assets[0];
    assert(
      (await f.store.asset(result.id, file.id, result.revision, file.sha256))
        .bytes.length > 0,
    );
    await assert.rejects(
      f.store.asset(result.id, "../model.json", result.revision, file.sha256),
    );
    await assert.rejects(
      f.store.asset(result.id, file.id, "c".repeat(64), file.sha256),
    );
    await writeFile(join(f.dir, result.id, file.id), "tampered");
    await assert.rejects(
      f.store.asset(result.id, file.id, result.revision, file.sha256),
      /摘要/,
    );
  } finally {
    await rm(f.dir, { recursive: true, force: true });
  }
});
test("assembly design validates without exterior-metadata mutation; model-authored execution proof rejects", async () => {
  const f = await fixture();
  try {
    const p = f.packets[2];
    validateAssemblyOutput(p);
    validateAppearanceOutput(p, f.packets, true);
    validateAssemblyOutput(p);
    assert.equal(p.data.structure[0].properties.meshUrl, undefined);
    assert.throws(
      () =>
        validateAssemblyOutput(packet([item("fake", "assembly-model", {})])),
      /执行器/,
    );
  } finally {
    await rm(f.dir, { recursive: true, force: true });
  }
});
test("failed geometry is retained as executed report, never relabeled successful", async () => {
  const f = await fixture(false);
  try {
    const observed: any[] = [],
      activity: any[] = [];
    const tools = assemblyAgentTools(
      f.packets,
      async (r) => {
        observed.push(r);
      },
      async (a) => {
        activity.push(a);
      },
      f.store,
    );
    const contract = await tools
      .find((t) => t.name === "assembly_design_contract")!
      .execute("schema", {}, undefined, undefined, {} as any);
    assert.match(JSON.stringify(contract), /dreamatic.assembly-design/);
    const tool = tools.find((t) => t.name === "build_printable_assembly")!;
    await tool.execute(
      "test",
      { designItemId: "design" },
      undefined,
      undefined,
      {} as any,
    );
    assert.equal(observed.length, 1);
    assert.equal(observed[0].geometryChecksPassed, false);
    assert.equal(activity[0].success, false);
    const p = assemblyPacket(observed[0]);
    assert.equal(p.evidence, "executed");
    assert.match(p.summary, /缺口/);
    assert.deepEqual(p.data.structure[0].properties.report, observed[0].report);
  } finally {
    await rm(f.dir, { recursive: true, force: true });
  }
});
test("assembly assets require authenticated session plus exact revision/digest", async () => {
  const f = await fixture();
  const result = await f.store.build(f.packets, "design");
  const { server } = makeServer(
    new Workbench(undefined, join(f.dir, "project")),
    "fixture",
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    f.store,
  );
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const address = server.address();
  assert(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const asset = result.assets[0],
      url = base + asset.url;
    assert.equal((await fetch(url)).status, 401);
    const login = await fetch(base + "/workbench-api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Workbench": "1" },
      body: JSON.stringify({ token: "fixture" }),
    });
    const headers = { Cookie: login.headers.get("set-cookie")!.split(";")[0] };
    assert.equal((await fetch(url, { headers })).status, 200);
    assert.notEqual(
      (await fetch(url.replace(result.revision, "c".repeat(64)), { headers }))
        .status,
      200,
    );
    assert.notEqual(
      (await fetch(url.replace(asset.sha256, "d".repeat(64)), { headers }))
        .status,
      200,
    );
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    await rm(f.dir, { recursive: true, force: true });
  }
});

test("runtime preserves assembly execution when assistant later fails", async () => {
  const f = await fixture();
  try {
    const result = await f.store.build(f.packets, "design");
    const workbench = new Workbench(
      async (_role, input) => {
        await input.onAssembly!(result);
        throw new Error("fixture assistant failure");
      },
      join(f.dir, "project"),
    );
    workbench.project = {
      version: VERSION,
      id: randomUUID(),
      brief: "fixture",
      phase: "running",
      questions: [],
      answers: {},
      nodes: [],
      plan: [],
      createdAt: new Date().toISOString(),
    };
    await assert.rejects(
      (workbench as any).invoke("mechanical", "fixture", "fixture", []),
      /assistant failure/,
    );
    const saved = JSON.parse(
      await readFile(join(f.dir, "project/current.json"), "utf8"),
    );
    assert.equal(saved.nodes[0].status, "error");
    assert.equal(saved.nodes[0].packet, undefined);
    assert.equal(
      saved.nodes[0].assemblyEvidence[0].data.structure[0].properties.id,
      result.id,
    );
  } finally {
    await rm(f.dir, { recursive: true, force: true });
  }
});

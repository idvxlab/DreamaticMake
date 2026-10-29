import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { hardwareFixture } from "./workbench-hardware-fixtures";
import {
  hardwarePacket,
  validateHardwareReferences,
} from "../packages/workbench/hardware-evidence";
import { hardwareTools } from "../packages/workbench/hardware-tools";
import { Workbench, type Caller } from "../packages/workbench/runtime";
import { fixtureCaller, emptyData } from "./workbench-fixtures";
import { makeServer } from "../apps/workbench/server";
import { connectionStore } from "../packages/workbench/connection";
import { packetSchema, type Packet } from "../packages/workbench/contracts";
import type { HardwareGeometry } from "../packages/workbench/hardware-contracts";

test("a placed hardware mesh must match the inspected asset, version and original dimensions", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dreamatic-geometry-binding-"));
  const lib = await hardwareFixture(dir);
  try {
    const r = await lib.get("arduino", "board");
    const reference = {
      source: r.source,
      recordId: r.recordId,
      revision: r.revision,
    };
    const geometry: HardwareGeometry = {
      version: r.version,
      reference,
      assetId: "model",
      sha256: r.assets[0].sha256!,
      coverage: "source_linked_model",
      units: "mm",
      coordinateFrame: "source-cad-native/1",
      dimensionsMm: [44, 18, 12],
      minMm: [-1, 0, -3],
      maxMm: [43, 18, 9],
      solidCount: 3,
      shapeValid: true,
      meshUrl: "/workbench-api/library/mesh?fixture",
      evidence: "executed_geometry_inspection",
      physicalVerified: false,
      assemblyVerified: false,
    };
    const evidence = hardwarePacket(r, geometry);
    packetSchema.parse(evidence);
    const packet: Packet = {
      ...hardwarePacket(r),
      data: {
        ...emptyData(),
        structure: [
          {
            id: "placement",
            kind: "component-placement",
            label: "board",
            properties: {
              geometryRef: {
                ...reference,
                assetId: "model",
                sha256: geometry.sha256,
              },
              positionMm: [0, 0, 12],
              rotationDeg: [0, 0, 90],
            },
            references: [],
          },
        ],
      },
    };
    validateHardwareReferences(packet, [evidence]);
    const props = packet.data.structure[0].properties;
    assert.deepEqual(props.dimensionsMm, [44, 18, 12]);
    assert.equal(props.meshUrl, geometry.meshUrl);
    assert.equal(props.assemblyVerified, false);
    const preciseEvidence = structuredClone(evidence);
    const precise = [44.291955, 17.780075, 11.7];
    preciseEvidence.data.structure.find(
      (i) => i.kind === "hardware-geometry",
    )!.properties.dimensionsMm = precise;
    props.dimensionsMm = [44.29, 17.78, 11.7];
    validateHardwareReferences(packet, [preciseEvidence]);
    assert.deepEqual(
      props.dimensionsMm,
      precise,
      "Two-decimal display rounding must still use the original geometry",
    );
    props.dimensionsMm = [10, 10, 10];
    assert.throws(() => validateHardwareReferences(packet, [evidence]), /尺寸/);
    delete props.dimensionsMm;
    props.geometryRef = {
      ...reference,
      assetId: "other",
      sha256: geometry.sha256,
    };
    assert.throws(
      () => validateHardwareReferences(packet, [evidence]),
      /几何引用/,
    );
  } finally {
    lib.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("failed expert output preserves real hardware evidence for the next manager and validation does not commit partial packets", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dreamatic-failed-evidence-"));
  const lib = await hardwareFixture(dir);
  const record = await lib.get("arduino", "board");
  let failures = 0,
    observedByManager = false;
  let workbench: Workbench;
  const caller: Caller = async (role, input) => {
    if (role === "embedded" && failures < 2) {
      failures++;
      await input.onHardware?.(record);
      await input.onTool?.({
        tool: "hardware_search",
        success: true,
        total: 1,
        query: "温度",
      });
      assert.throws(() =>
        input.validateOutput?.({ summary: "invalid", data: {} }),
      );
      assert(
        workbench
          .project!.nodes.filter(
            (n) => n.role === "embedded" && n.status === "running",
          )
          .every((n) => n.packet === undefined),
      );
      throw new Error("test output validation failure");
    }
    if (role === "coordinator" && failures === 2) {
      assert(
        input.packets.some((p) =>
          p.data.structure.some((i) => i.id === record.itemId),
        ),
      );
      assert(
        input.state?.invocations.some(
          (n) => n.status === "error" && n.toolActivity?.[0].total === 1,
        ),
      );
      observedByManager = true;
    }
    return fixtureCaller(role, input);
  };
  workbench = new Workbench(caller, join(dir, "project"), {
    visualContract: "legacy",
  });
  try {
    await workbench.start("fixture");
    await workbench.answer(
      Object.fromEntries(
        workbench.project!.questions.map((q) => [q.id, q.options[0]]),
      ),
    );
    assert(observedByManager);
    assert.equal(workbench.project!.phase, "complete");
    assert.equal(
      workbench.project!.nodes.filter((n) => n.status === "error").length,
      2,
    );
  } finally {
    lib.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("hardware adapters preserve provenance and distinguish empty, missing, marketplace and procurement sources", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dreamatic-library-"));
  const lib = await hardwareFixture(dir);
  try {
    const file = join(lib.root, "official_catalog/library/hardware.sqlite3"),
      before = await readFile(file);
    const status = await lib.status();
    assert.equal(
      status.sources.find((s) => s.source === "raspberrypi")?.state,
      "empty",
    );
    assert.equal(
      status.sources.find((s) => s.source === "seed")?.state,
      "missing",
    );
    assert.equal(
      (await lib.search("温度", "arduino")).items[0].recordId,
      "board",
    );
    assert.equal((await lib.search("' OR 1=1 --")).total, 0);
    const record = await lib.get("arduino", "board");
    assert.equal(record.physicalVerified, false);
    assert.match(JSON.stringify(record.parameters), /TO VERIFY/);
    assert.equal(record.assets[0].available, true);
    assert.match(record.assets[0].downloadUrl, /workbench-api/);
    assert.equal(
      (await lib.get("misumi", "series")).assets[0].coverage,
      "series_reference",
    );
    assert.equal(
      (await lib.get("requirements", "variant")).evidence,
      "requested_spec_not_supplier_fact",
    );
    const amazon = (await lib.search("mouse", "amazon")).items[0];
    const product = await lib.get("amazon", amazon.recordId);
    assert.equal(product.evidence, "marketplace_claim_not_verified");
    assert.match(JSON.stringify(product.parameters), /历史/);
    assert.equal(product.sourceText, "Seller claim");
    assert.match(
      (await lib.document("arduino", "board", "manual")).text,
      /Pin 1/,
    );
    await assert.rejects(() => lib.document("arduino", "other", "manual"));
    assert.deepEqual(
      await readFile(file),
      before,
      "Queries must never modify the source DB",
    );
  } finally {
    lib.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("assets require the selected record, matching digest and containment inside the library", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dreamatic-assets-"));
  const lib = await hardwareFixture(dir);
  try {
    const asset = await lib.asset("arduino", "board", "model");
    assert.match(asset.file, /model.step$/);
    await assert.rejects(() => lib.asset("arduino", "wrong", "model"));
    await writeFile(asset.file, "modified");
    await assert.rejects(
      () => lib.asset("arduino", "board", "model"),
      /SHA-256/,
    );
    await rm(asset.file);
    await writeFile(join(dir, "outside.step"), "fixture STEP bytes");
    await symlink(join(dir, "outside.step"), asset.file);
    await assert.rejects(() => lib.asset("arduino", "board", "model"), /超出/);
  } finally {
    lib.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("removed sources never leave stale searchable records and changed source facts get a new revision", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dreamatic-revision-"));
  const lib = await hardwareFixture(dir);
  try {
    const a = await lib.get("arduino", "board");
    const file = join(lib.root, "official_catalog/library/hardware.sqlite3");
    const db = new DatabaseSync(file);
    db.prepare(
      "UPDATE hardware SET record_json=? WHERE candidate_id='board'",
    ).run(
      JSON.stringify({
        title: "Updated source",
        parameters: [{ name: "Voltage", value: "5V" }],
      }),
    );
    db.close();
    const b = await lib.get("arduino", "board");
    assert.notEqual(a.revision, b.revision);
    await rm(file);
    await lib.refresh();
    assert.equal((await lib.search("board", "arduino")).total, 0);
    await assert.rejects(() => lib.get("arduino", "board"));
  } finally {
    lib.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("versioned hardware evidence rejects invented refs and is handed from embedded to design and mechanics", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dreamatic-evidence-"));
  const lib = await hardwareFixture(dir);
  try {
    const r = await lib.get("arduino", "board");
    const evidence = hardwarePacket(r);
    packetSchema.parse(evidence);
    const ref = {
      source: r.source,
      recordId: r.recordId,
      revision: r.revision,
    };
    const packet: Packet = { ...hardwarePacket(r), data: emptyData() };
    packet.data.circuit_energy.push({
      id: "part",
      kind: "hardware-option",
      label: "Real source",
      properties: { hardwareRefs: [ref] },
      references: [],
    });
    validateHardwareReferences(packet, [evidence]);
    assert.ok(packet.data.circuit_energy[0].references.includes(r.itemId));
    packet.data.circuit_energy[0].properties.hardwareRefs = [
      { ...ref, revision: "0".repeat(64) },
    ];
    assert.throws(
      () => validateHardwareReferences(packet, [evidence]),
      /版本不符/,
    );
    const seen = new Set<string>();
    const caller: Caller = async (role, input) => {
      if (role === "designer" || role === "mechanical") {
        assert.ok(
          input.packets.some((p) =>
            p.data.structure.some((i) => i.id === r.itemId),
          ),
        );
        seen.add(role);
      }
      if (role === "embedded") {
        await input.onHardware?.(r);
        await input.onHardware?.({
          ...r,
          documentExcerpts: [await lib.document("arduino", "board", "manual")],
        });
        await input.onHardware?.(r);
      }
      const out = (await fixtureCaller(role, input)) as any;
      if (role === "embedded")
        out.data.circuit_energy.forEach(
          (i: any) => (i.properties.hardwareRefs = [ref]),
        );
      return out;
    };
    const w = new Workbench(caller, join(dir, "project"), {
      visualContract: "legacy",
    });
    await w.start("source based design");
    await w.answer(
      Object.fromEntries(w.project!.questions.map((q) => [q.id, q.options[0]])),
    );
    assert.equal(w.project?.phase, "complete");
    assert.deepEqual([...seen].sort(), ["designer", "mechanical"]);
    assert.ok(
      w.project?.nodes
        .filter((n) => n.role === "embedded")
        .every((n) => n.hardwareEvidence?.length),
    );
    assert.ok(
      w.project?.nodes
        .filter((n) => n.role === "embedded")
        .every(
          (n) =>
            n.hardwareEvidence?.[0].data.structure[0].properties
              .documentExcerpts &&
            Array.isArray(
              n.hardwareEvidence[0].data.structure[0].properties
                .documentExcerpts,
            ),
        ),
    );
    const tools = hardwareTools(lib, async () => {});
    assert.deepEqual(
      tools.map((t) => t.name),
      [
        "hardware_search",
        "hardware_get",
        "hardware_document",
        "hardware_inspect_geometry",
      ],
    );
    assert.ok(tools.every((t) => !t.name.includes("approv")));
  } finally {
    lib.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("hardware HTTP routes require authentication and attach exact source revisions without dispatching agents", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dreamatic-library-http-"));
  const lib = await hardwareFixture(dir);
  const workbench = new Workbench(fixtureCaller, join(dir, "project"), {
    visualContract: "legacy",
  });
  const { server } = makeServer(
    workbench,
    "fixture-token",
    connectionStore,
    undefined,
    lib,
  );
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const address = server.address();
  assert(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}/workbench-api/`;
  try {
    assert.equal(
      (await fetch(base + "library/search?query=board")).status,
      401,
    );
    assert.equal(
      (
        await fetch(
          base + "library/asset?source=arduino&recordId=board&assetId=model",
        )
      ).status,
      401,
    );
    const headers = { "Content-Type": "application/json", "X-Workbench": "1" };
    const login = await fetch(base + "session", {
      method: "POST",
      headers,
      body: JSON.stringify({ token: "fixture-token" }),
    });
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    const auth = { ...headers, Cookie: cookie };
    assert.equal(
      (await fetch(base + "library/search?query=board", { headers: auth }))
        .status,
      200,
    );
    const download = await fetch(
      base + "library/asset?source=arduino&recordId=board&assetId=model",
      { headers: auth },
    );
    assert.equal(
      (
        await fetch(
          base +
            "library/asset?source=arduino&recordId=board&assetId=model&sha256=" +
            "0".repeat(64),
          { headers: auth },
        )
      ).status,
      409,
    );
    assert.equal(await download.text(), "fixture STEP bytes");
    assert.match(download.headers.get("content-disposition")!, /attachment/);
    await workbench.start("test product");
    const nodes = workbench.project!.nodes.length;
    const r = await lib.get("arduino", "board");
    const body = {
      source: r.source,
      recordId: r.recordId,
      revision: r.revision,
    };
    assert.equal(
      (
        await fetch(base + "library/attach", {
          method: "POST",
          headers: auth,
          body: JSON.stringify({ ...body, revision: "0".repeat(64) }),
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await fetch(base + "library/attach", {
          method: "POST",
          headers: { ...auth, Origin: "https://evil.example" },
          body: JSON.stringify(body),
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(base + "library/attach", {
          method: "POST",
          headers: auth,
          body: JSON.stringify(body),
        })
      ).status,
      200,
    );
    assert.equal(workbench.project!.nodes.length, nodes);
    assert.equal(workbench.project!.hardwareEvidence?.length, 1);
  } finally {
    await new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r())));
    lib.close();
    await rm(dir, { recursive: true, force: true });
  }
});

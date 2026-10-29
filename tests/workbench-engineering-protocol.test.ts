import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeEngineeringChannels,
  validateEngineeringPacket,
  ENGINEERING_PROTOCOL,
  inspectEngineeringPacket,
} from "../packages/workbench/engineering-protocol";
import { VERSION, type Packet } from "../packages/workbench/contracts";
const item = (id: string, properties: Record<string, unknown> = {}) => ({
  id,
  kind: "component-instance",
  label: id,
  properties,
  references: [] as string[],
});
const packet = (): Packet => ({
  version: VERSION,
  id: "p",
  invocationId: "i",
  inputs: [],
  summary: "",
  evidence: "proposal",
  data: { structure: [], motion: [], circuit_energy: [], flow: [], logic: [] },
});
test("channel normalization retains evidence and unknown domain properties without inventing execution", () => {
  const p = packet();
  p.data.structure.push(
    item("part", { geometryRef: { opaque: "evidence" }, unknown: null }),
  );
  const result = normalizeEngineeringChannels(p.data);
  assert.deepEqual(result.data, p.data);
  assert.deepEqual(result.issues, []);
  assert.equal(p.evidence, "proposal");
  assert.notEqual(
    result.data.structure[0].properties,
    p.data.structure[0].properties,
  );
});
test("missing channels are gaps, malformed or unknown channels are errors", () => {
  assert.equal(
    normalizeEngineeringChannels({}).issues.filter((i) => i.severity === "gap")
      .length,
    5,
  );
  assert.ok(
    normalizeEngineeringChannels({ structure: "bad", alien: [] }).issues.some(
      (i) => i.severity === "error",
    ),
  );
  assert.ok(
    normalizeEngineeringChannels({ structure: [item("", {})] }).issues.some(
      (i) => i.severity === "error",
    ),
  );
});
test("cross-channel references resolve against only supplied packets", () => {
  const p = packet();
  const dep = packet();
  p.data.logic.push({ ...item("control"), references: ["motor", "missing"] });
  dep.data.motion.push(item("motor"));
  const issues = validateEngineeringPacket(p, [dep]);
  assert.equal(issues.filter((i) => i.path.endsWith("references")).length, 1);
  assert.equal(issues[0].severity, "gap");
  assert.equal(
    validateEngineeringPacket(p, [dep], { completeReferenceScope: true })[0]
      .severity,
    "error",
  );
  p.data.flow.push(item("control"));
  assert.ok(
    validateEngineeringPacket(p).some((i) => i.message.includes("Duplicate")),
  );
});
test("geometry errors differ from unknown placement and assumed reserve gaps", () => {
  const p = packet();
  p.data.structure.push(
    item("bad", {
      units: "cm",
      positionMm: [NaN, 0, 0],
      dimensionsMm: [1, -1, 1],
      geometryRef: {},
    }),
  );
  p.data.structure.push({ ...item("reserve"), kind: "reserved-volume" });
  const issues = validateEngineeringPacket(p);
  assert.equal(issues.filter((i) => i.severity === "error").length, 4);
  assert.ok(
    issues.some((i) => i.severity === "gap" && i.path.endsWith("reserve")),
  );
  assert.equal(p.evidence, "proposal");
});
test("appearance revision must resolve exactly and native translation requires a frame", () => {
  const p = packet();
  const dep = packet();
  const ref = {
    modelId: "123e4567-e89b-42d3-a456-426614174000",
    revision: "a".repeat(64),
  };
  p.data.structure.push({
    ...item("body", { appearanceRef: ref }),
    kind: "enclosure",
  });
  dep.data.structure.push({
    ...item("source", { appearanceRef: { ...ref, revision: "b".repeat(64) } }),
    kind: "appearance-model",
  });
  assert.ok(
    validateEngineeringPacket(p, [dep]).some((i) =>
      i.path.endsWith("appearanceRef"),
    ),
  );
  dep.data.structure[0].properties.appearanceRef = ref;
  assert(
    !validateEngineeringPacket(p, [dep]).some((i) =>
      i.path.endsWith("appearanceRef"),
    ),
  );
  p.data.structure.push(item("native", { translationMm: [0, 0, 0] }));
  assert.ok(
    validateEngineeringPacket(p, [dep]).some((i) =>
      i.path.endsWith("sourceFrame"),
    ),
  );
});
test("domain quantities retain their own units and unknown relations are not guessed", () => {
  const p = packet();
  p.data.circuit_energy.push({
    ...item("power", {
      units: "V",
      voltage: 5,
      connections: { vendorFormat: true },
    }),
    kind: "supply",
  });
  p.data.flow.push({ ...item("flow", { units: "L/min" }), kind: "fluid" });
  assert(validateEngineeringPacket(p).every((i) => i.severity === "gap"));
});

test("remote ObjectRef maps explicitly without conflating record and item identity", async () => {
  const { normalizeEngineeringReference: normalize } = await import(
    "../packages/workbench/engineering-protocol"
  );
  const bindings = new Map([
    ["logic/unit_inputs/controller:enable", "input:enable"],
  ]);
  assert.equal(
    normalize(
      {
        record_id: "logic",
        collection: "unit_inputs",
        object_id: "controller:enable",
      },
      bindings,
    ).reference,
    "input:enable",
  );
  assert.equal(
    normalize({ record_id: "logic", collection: "unit_inputs" }, bindings)
      .issues[0].severity,
    "error",
  );
  assert.equal(
    normalize(
      {
        record_id: "logic",
        collection: "unit_inputs",
        object_id: "controller",
      },
      bindings,
    ).issues[0].severity,
    "error",
  );
  assert.equal(
    normalize({ record_id: "logic" }, bindings).issues[0].severity,
    "gap",
  );
  assert.equal(normalize(null, bindings).issues[0].severity, "gap");
});

const declared = (
  id: string,
  kind: string,
  properties: Record<string, unknown>,
) => ({
  ...item(id, { engineeringProtocol: ENGINEERING_PROTOCOL, ...properties }),
  kind,
});
const q = (value: number, unit: string) => ({ value, unit });
const joint = () =>
  declared("joint", "joint", {
    parentBody: "a",
    childBody: "b",
    jointKind: "prismatic",
    axis: [1, 0, 0],
    lower: q(0, "mm"),
    upper: q(10, "mm"),
    initial: q(5, "mm"),
  });
const bodyDependencies = () => {
  const p = packet();
  p.data.structure.push(
    { ...item("a"), kind: "enclosure" },
    { ...item("b"), kind: "enclosure" },
  );
  return p;
};
test("declared motion validates source bodies, normalized axis and dimensioned limits", () => {
  const p = packet();
  p.data.motion.push(joint());
  assert.deepEqual(
    inspectEngineeringPacket(p, [bodyDependencies()]).errors,
    [],
  );
  Object.assign(p.data.motion[0].properties, {
    axis: [2, 0, 0],
    initial: q(12, "deg"),
  });
  const report = inspectEngineeringPacket(p, [bodyDependencies()]);
  assert(report.errors.some((i) => i.message.includes("axis")));
  assert(report.errors.some((i) => i.message.includes("require mm")));
  assert(report.errors.some((i) => i.message.includes("outside")));
  p.data.motion[0].properties.parentBody = "unknown";
  assert(
    inspectEngineeringPacket(p).gaps.some((i) => i.path.endsWith("parentBody")),
  );
});
test("declared structure connections bind distinct bodies and joint references", () => {
  const p = packet();
  p.data.motion.push(joint());
  p.data.structure.push(
    declared("c", "structure-connection", {
      a: "a",
      b: "b",
      constraint: "joint",
      jointRef: "joint",
    }),
  );
  assert.deepEqual(
    inspectEngineeringPacket(p, [bodyDependencies()]).errors,
    [],
  );
  p.data.structure[0].properties.constraint = "fixed";
  assert(
    inspectEngineeringPacket(p, [bodyDependencies()]).errors.some((i) =>
      i.path.endsWith("jointRef"),
    ),
  );
});
const terminal = (id: string, min: number, max: number, role = "power") =>
  declared(id, "terminal", {
    role,
    voltageRange: { min: q(min, "V"), max: q(max, "V") },
  });
test("declared circuit rejects role mismatch, voltage incompatibility and multiple nets", () => {
  const p = packet();
  p.data.circuit_energy.push(
    terminal("a", 3, 5),
    terminal("b", 12, 24),
    declared("n", "net", { role: "power", members: ["a", "b"] }),
  );
  assert(
    inspectEngineeringPacket(p).errors.some((i) =>
      i.message.includes("no overlap"),
    ),
  );
  p.data.circuit_energy[1].properties.role = "ground";
  p.data.circuit_energy.push(
    declared("n2", "net", { role: "power", members: ["a", "b"] }),
  );
  const report = inspectEngineeringPacket(p);
  assert(report.errors.some((i) => i.message.includes("roles disagree")));
  assert(report.errors.some((i) => i.message.includes("already belongs")));
});
test("declared electrical unknown ranges remain gaps and malformed voltage units fail", () => {
  const p = packet();
  p.data.circuit_energy.push(terminal("a", 5, 3));
  assert(
    inspectEngineeringPacket(p).errors.some((i) =>
      i.message.includes("reversed"),
    ),
  );
  p.data.circuit_energy[0].properties.voltageRange = null;
  assert.equal(inspectEngineeringPacket(p).errors.length, 0);
  assert(inspectEngineeringPacket(p).gaps.length);
  p.data.circuit_energy[0].properties.voltageRange = {
    min: q(1, "mV"),
    max: q(2, "V"),
  };
  assert(inspectEngineeringPacket(p).errors.length);
});
const port = (id: string, direction: string, domain = "information") =>
  declared(id, "flow-port", {
    direction,
    domain,
    required: true,
    medium: domain === "material" ? "water" : null,
    valueType: domain === "information" ? { kind: "scalar", unit: "V" } : null,
  });
test("declared flow checks required connections, directions, domains and types", () => {
  const p = packet();
  p.data.flow.push(port("out", "out"), port("in", "in"));
  assert(
    inspectEngineeringPacket(p).gaps.some((i) =>
      i.message.includes("no declared connection"),
    ),
  );
  p.data.flow.push(
    declared("edge", "flow-edge", {
      domain: "information",
      from: "out",
      to: ["in"],
    }),
  );
  assert.deepEqual(inspectEngineeringPacket(p).errors, []);
  assert(
    !inspectEngineeringPacket(p).gaps.some((i) =>
      i.message.includes("no declared connection"),
    ),
  );
  p.data.flow[1].properties.direction = "out";
  p.data.flow[1].properties.valueType = { kind: "scalar", unit: "A" };
  const report = inspectEngineeringPacket(p);
  assert(report.errors.some((i) => i.message.includes("output-only")));
  assert(report.errors.some((i) => i.message.includes("types or units")));
});
test("declared material edges preserve medium incompatibility and unresolved endpoints", () => {
  const p = packet();
  p.data.flow.push(
    port("a", "out", "material"),
    port("b", "in", "material"),
    declared("e", "flow-edge", {
      domain: "material",
      from: "a",
      to: ["b", "missing"],
    }),
  );
  p.data.flow[1].properties.medium = "air";
  const report = inspectEngineeringPacket(p);
  assert(report.errors.some((i) => i.message.includes("media disagree")));
  assert(report.gaps.some((i) => i.message.includes("missing")));
});
test("typed logic ports and bindings reject incompatible payloads without execution claims", () => {
  const p = packet();
  p.data.logic.push(
    declared("a", "logic-port", {
      direction: "out",
      valueType: { kind: "event", schemaId: "event/v1" },
    }),
    declared("b", "logic-port", {
      direction: "in",
      valueType: { kind: "event", schemaId: "event/v2" },
    }),
    declared("binding", "logic-binding", { from: "a", to: "b" }),
  );
  assert(
    inspectEngineeringPacket(p).errors.some((i) =>
      i.message.includes("types or units"),
    ),
  );
  p.data.logic[1].properties.valueType = null;
  const report = inspectEngineeringPacket(p);
  assert.equal(report.errors.length, 0);
  assert(report.gaps.length);
  assert.equal(p.evidence, "proposal");
  assert.equal(report.packetId, p.id);
  assert.equal(report.invocationId, p.invocationId);
});
test("declaration versions, wrong channels, missing fields and unknown kinds stay distinct", () => {
  const p = packet();
  p.data.logic.push(
    declared("j", "joint", {}),
    declared("unknown", "vendor-extension", {}),
    { ...item("legacy"), kind: "source" },
  );
  const report = inspectEngineeringPacket(p);
  assert(report.errors.some((i) => i.message.includes("wrong channel")));
  assert.equal(report.gaps.length, 2);
  p.data.logic[0] = declared("binding", "logic-binding", {});
  assert(inspectEngineeringPacket(p).errors.length >= 2);
  p.data.logic[0].properties.engineeringProtocol = "dreamatic.engineering/99";
  assert(
    inspectEngineeringPacket(p).errors.some((i) =>
      i.message.includes("version"),
    ),
  );
});

test("runtime wiring persists declared-domain gaps without turning proposal into execution", async () => {
  const { Workbench } = await import("../packages/workbench/runtime");
  const { mkdtemp, readFile, rm } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const dir = await mkdtemp(join(tmpdir(), "cad-protocol-runtime-"));
  let calls = 0;
  const caller: import("../packages/workbench/runtime").Caller = async (
    role,
  ) => {
    if (role === "analyst")
      return {
        summary: "Unknown required flow path",
        items: [{ channel: "flow", ...port("required", "out") }],
      };
    return {
      summary: "decision",
      decision:
        ++calls === 1
          ? {
              action: "dispatch",
              reason: "inspect",
              tasks: [
                {
                  key: "analysis",
                  role: "analyst",
                  title: "analysis",
                  instruction: "inspect",
                  dependsOn: [],
                },
              ],
            }
          : { action: "blocked", reason: "Unknown flow path", tasks: [] },
    };
  };
  try {
    const w = new Workbench(caller, dir);
    await w.start("Protocol integration");
    const saved = JSON.parse(await readFile(join(dir, "current.json"), "utf8"));
    const node = saved.nodes.find(
      (n: { role: string }) => n.role === "analyst",
    );
    assert.equal(node.status, "done");
    assert.equal(node.packet.evidence, "proposal");
    assert(
      node.packet.data.logic.some(
        (i: { kind: string; properties: Record<string, unknown> }) =>
          i.kind === "engineering-diagnostic" &&
          i.properties.severity === "gap" &&
          String(i.properties.path).includes("required") &&
          i.properties.verificationStatus === "unverified",
      ),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("mixed error/gap reports retain every issue and explicit provenance without mutating evidence", () => {
  const p = packet();
  p.evidence = "executed";
  p.execution = {
    tool: "fixture-executor",
    artifact: "fixture.json",
    digest: "fixture",
  };
  p.data.motion.push(joint());
  p.data.motion[0].properties.axis = [2, 0, 0];
  p.data.logic.push(
    declared("unmapped", "vendor-extension", {
      sourceEvidence: { digest: "retained", status: "unknown" },
    }),
  );
  const original = structuredClone(p);
  const dep = packet();
  dep.id = "authorized-input";
  const report = inspectEngineeringPacket(p, [dep]);
  assert(report.errors.length > 0);
  assert(report.gaps.length > 0);
  assert.equal(report.packetId, p.id);
  assert.equal(report.invocationId, p.invocationId);
  assert.deepEqual(report.dependencyPacketIds, [dep.id]);
  const issues = validateEngineeringPacket(p, [dep]);
  assert.equal(report.errors.length + report.gaps.length, issues.length);
  assert.deepEqual(JSON.parse(JSON.stringify(report)), report);
  assert.deepEqual(p, original);
});

test("declared vendor kinds named after object prototype properties remain unknown gaps", () => {
  const p = packet();
  p.data.logic.push(declared("vendor", "constructor", {}));
  const report = inspectEngineeringPacket(p);
  assert.deepEqual(report.errors, []);
  assert(report.gaps.some((i) => i.message.includes("Unknown declared")));
});

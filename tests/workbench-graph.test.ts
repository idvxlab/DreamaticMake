import test from "node:test";
import assert from "node:assert/strict";
import {
  workflowEdges,
  workflowOverview,
  workflowLayout,
} from "../packages/workbench/graph";
import type { Invocation, Role } from "../packages/workbench/contracts";

const node = (id: string, role: Role, inputs: string[] = []): Invocation => ({
  id,
  role,
  inputs,
  title: id,
  status: "done",
});

test("presentation history preserves successful results and expands without mutating inputs", () => {
  const good = { ...node("ok", "mechanical", ["pm"]), title: "布局" };
  const retry = {
    ...node("bad", "mechanical", ["pm"]),
    title: "布局（重试）",
    status: "error" as const,
  };
  const nodes = [node("pm", "coordinator"), good, retry];
  const original = structuredClone(nodes);
  assert.deepEqual(
    workflowOverview(nodes).nodes.map((n) => n.id),
    ["pm", "ok"],
  );
  assert.deepEqual(
    workflowOverview(nodes).history.map((n) => n.id),
    ["bad"],
  );
  assert.deepEqual(workflowOverview(nodes, true).nodes, nodes);
  assert.deepEqual(nodes, original);
});

test("dependency layout keeps independent modules parallel, joins after parents, and tolerates unordered history", () => {
  const nodes = [
    node("join", "mechanical", ["a", "b"]),
    node("a", "embedded"),
    node("b", "designer"),
  ];
  const layout = workflowLayout(nodes);
  assert.equal(layout.a.x, layout.b.x);
  assert.notEqual(layout.a.y, layout.b.y);
  assert(layout.join.x > layout.a.x);
  const cycle = workflowLayout([
    node("a", "designer", ["b"]),
    node("b", "mechanical", ["a"]),
  ]);
  assert(
    Object.values(cycle).every(
      (p) => Number.isFinite(p.x) && Number.isFinite(p.y),
    ),
  );
});

test("overview preserves separate unconsumed functions with the same role and real join inputs", () => {
  const nodes = [
    node("pm", "coordinator"),
    node("sensor", "embedded", ["pm"]),
    node("power", "embedded", ["pm"]),
    node("display", "embedded", ["pm"]),
  ];
  assert.deepEqual(
    workflowOverview(nodes).nodes.map((n) => n.id),
    ["pm", "sensor", "power", "display"],
  );
  const joined = [
    ...nodes,
    node("layout", "mechanical", ["sensor", "power", "display"]),
    node("views", "designer", ["layout"]),
  ];
  const overview = workflowOverview(joined);
  assert(overview.nodes.some((n) => n.id === "layout"));
  assert(overview.nodes.some((n) => n.id === "views"));
  const revealed = workflowOverview(joined, false, ["layout"]);
  for (const id of ["sensor", "power", "display", "layout", "views"])
    assert(revealed.nodes.some((n) => n.id === id));
  assert(
    workflowEdges(overview.nodes).every((e) =>
      joined.find((n) => n.id === e.to)!.inputs.includes(e.from),
    ),
  );
  assert(
    workflowEdges(overview.nodes).every((e) =>
      joined.find((n) => n.id === e.to)!.inputs.includes(e.from),
    ),
  );
});

test("overview preserves parallel design dependencies and dispatch, hides historical observation fan-in", () => {
  const nodes = [
    node("m1", "coordinator"),
    node("a", "analyst", ["m1"]),
    node("m2", "coordinator", ["m1", "a"]),
    node("e", "embedded", ["m2", "a"]),
    node("d", "designer", ["m2", "a"]),
    node("m3", "coordinator", ["m1", "a", "m2", "e", "d"]),
    node("s", "mechanical", ["m3", "a", "e", "d"]),
  ];
  const original = structuredClone(nodes);
  const edges = workflowEdges(nodes);
  assert.equal(edges.filter((e) => e.kind === "observation").length, 0);
  assert.deepEqual(
    edges.filter((e) => e.to === "s").map((e) => e.from),
    ["m3", "e", "d"],
  );
  assert(
    edges.some((e) => e.from === "m1" && e.to === "a" && e.kind === "dispatch"),
  );
  assert.equal(
    workflowEdges(nodes, true).length,
    nodes.reduce((sum, n) => sum + n.inputs.length, 0),
  );
  assert.deepEqual(nodes, original);
});

test("artifact stages keep three designer results, real managers and analysis, with every old call expandable", () => {
  const imageNode = (id: string, set: string, method: string): Invocation => ({
    ...node(id, "designer", ["pm"]),
    imageEvidence: [
      {
        version: "dreamatic.workbench/1",
        id,
        invocationId: id,
        inputs: [],
        summary: "",
        evidence: "executed",
        execution: { tool: "fixture", artifact: "fixture", digest: "fixture" },
        data: {
          structure: [
            {
              id,
              kind: "generated-image",
              label: id,
              properties: { imageSet: set, generationMethod: method },
              references: [],
            },
          ],
          motion: [],
          circuit_energy: [],
          flow: [],
          logic: [],
        },
      },
    ],
  });
  const nodes = [
    node("pm", "coordinator"),
    node("analysis", "analyst", ["pm"]),
    imageNode("old", "appearance", "image_generation"),
    imageNode("effect", "appearance", "image_generation"),
    imageNode("views", "appearance", "appearance_geometry"),
    imageNode("structure", "component_layout", "geometry_projection"),
    node("finish", "coordinator", ["structure"]),
  ];
  const overview = workflowOverview(nodes);
  assert.deepEqual(
    overview.nodes.filter((n) => n.role === "designer").map((n) => n.id),
    ["effect", "views", "structure"],
  );
  for (const id of ["pm", "analysis", "finish"])
    assert(overview.nodes.some((n) => n.id === id));
  assert(overview.history.some((n) => n.id === "old"));
  assert.equal(workflowOverview(nodes, true).nodes.length, nodes.length);
});

test("PM observations cannot serialize engineering layers and managers occupy a separate visible lane", () => {
  const nodes = [
    node("pm1", "coordinator"),
    node("analysis", "analyst", ["pm1"]),
    node("pm2", "coordinator", ["analysis", "pm1"]),
    node("sensor", "embedded", ["analysis", "pm2"]),
    node("pm3", "coordinator", ["pm2", "sensor"]),
    node("power", "embedded", ["analysis", "pm3"]),
    node("join", "mechanical", ["sensor", "power", "pm3"]),
  ];
  const before = structuredClone(nodes);
  const layout = workflowLayout(nodes);
  assert.equal(
    layout.sensor.x,
    layout.power.x,
    "parallel functions cannot be separated by PM observation history",
  );
  assert(layout.join.x > layout.sensor.x);
  assert(
    layout.analysis.y >
      Math.max(layout.pm1.y, layout.pm2.y, layout.pm3.y) + 136,
  );
  const noObservations = nodes.map((n) =>
    n.role === "coordinator" ? { ...n, inputs: [] } : n,
  );
  assert.deepEqual(workflowLayout(noObservations), layout);
  assert(workflowEdges(nodes).every((e) => e.kind !== "observation"));
  assert.deepEqual(nodes, before);
});

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Workbench, type Caller } from "../packages/workbench/runtime";
import {
  VERSION,
  type Task,
  type Packet,
} from "../packages/workbench/contracts";
import {
  parseWorkflowPlan,
  validateVisualBatch,
  dispatchIdentity,
} from "../packages/workbench/workflow-plan";
import { stageGaps } from "../packages/workbench/stage-gaps";

const task = (title: string, instruction = "记录约束，不生成图像"): Task => ({
  key: "visual",
  title,
  instruction,
  role: "designer",
  dependsOn: [],
});
test("visual handoffs keep optional concept, one geometric four-view output and one structural projection", () => {
  validateVisualBatch([
    task("效果图"),
    task("外观三视图", "调用build_appearance_geometry"),
    task("结构三视图", "调用render_component_views"),
  ]);
  assert.throws(
    () => validateVisualBatch([task("正视图"), task("侧视图")]),
    /逐视图/,
  );
  const p: Packet = {
    version: VERSION,
    id: "p",
    invocationId: "analysis",
    inputs: [],
    summary: "plan",
    evidence: "proposal",
    data: {
      structure: [],
      motion: [],
      circuit_energy: [],
      flow: [],
      logic: [
        {
          id: "plan",
          kind: "workflow-plan",
          label: "plan",
          references: [],
          properties: {
            version: "dreamatic.workflow-plan/1",
            steps: ["正视图", "俯视图"].map((title, i) => ({
              ...task(title),
              key: `view${i}`,
              dependsOn: ["$source"],
            })),
          },
        },
      ],
    },
  };
  assert.throws(() => parseWorkflowPlan(p, []), /逐视图/);
});
test("deduplication uses real engineering input and user revision, ignoring PM observers and task synonyms", () => {
  const nodes: any[] = [
    { id: "real", role: "embedded", status: "done", inputs: [] },
    { id: "pm", role: "coordinator", status: "done", inputs: ["real"] },
  ];
  const a = { ...task("外观三视图"), dependsOn: ["real"] };
  assert.equal(
    dispatchIdentity(a, nodes, "r1"),
    dispatchIdentity(
      { ...task("侧视图"), dependsOn: ["real", "pm"] },
      nodes,
      "r1",
    ),
  );
  assert.notEqual(
    dispatchIdentity(a, nodes, "r1"),
    dispatchIdentity(a, nodes, "r2"),
  );
  assert.notEqual(
    dispatchIdentity(a, nodes, "r1"),
    dispatchIdentity({ ...a, dependsOn: [] }, nodes, "r1"),
  );
});
test("repeated successful visual stage stops before another expert call while manager and analyst remain real", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dreamatic-orchestration-003-"));
  let manager = 0,
    analyst = 0,
    designer = 0;
  const caller: Caller = async (role) => {
    if (role === "coordinator")
      return {
        summary: "real decision",
        decision: {
          action: "dispatch",
          reason: "evaluate existing results",
          tasks: [
            ++manager === 1
              ? {
                  key: "analysis",
                  role: "analyst",
                  title: "功能分析",
                  instruction: "拆解真实功能",
                  dependsOn: [],
                }
              : task("外观三视图"),
          ],
        },
      };
    if (role === "analyst") analyst++;
    if (role === "designer") designer++;
    return { summary: "constraint proposal only", items: [] };
  };
  try {
    const w = new Workbench(caller, dir);
    await w.start("test requirements");
    assert.equal(analyst, 1);
    assert.equal(designer, 1);
    assert.equal(manager, 3);
    assert.equal(w.project!.phase, "blocked");
    assert.match(w.project!.error!, /停止重复派工/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("same-input failed stage retries require the actual failed invocation in the manager reason", async () => {
  for (const explicit of [false, true]) {
    const dir = await mkdtemp(join(tmpdir(), "dreamatic-orchestration-retry-"));
    let managers = 0,
      designers = 0;
    const caller: Caller = async (role, input) => {
      if (role === "coordinator") {
        const failed = input.state!.invocations.find(
          (n) => n.role === "designer" && n.status === "error",
        );
        return {
          summary: "decision",
          decision: {
            action: "dispatch",
            reason:
              explicit && failed
                ? `修复 ${failed.id} 的渲染失败，补充实际执行`
                : "再次尝试",
            tasks: [
              ++managers === 1
                ? {
                    key: "analysis",
                    role: "analyst",
                    title: "功能分析",
                    instruction: "分析",
                    dependsOn: [],
                  }
                : task("外观三视图"),
            ],
          },
        };
      }
      if (role === "designer") {
        designers++;
        throw new Error("render unavailable");
      }
      return { summary: "analysis", items: [] };
    };
    try {
      const w = new Workbench(caller, dir);
      await w.start("test");
      assert.equal(designers, explicit ? 2 : 1);
      assert.equal(w.project!.phase, "blocked");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
});
test("printable assembly execution cannot proceed from an unproven layout envelope", () => {
  const gaps = stageGaps(
    {
      key: "assembly",
      role: "mechanical",
      title: "装配执行",
      instruction: "执行可打印分件",
      dependsOn: [],
    },
    [],
  );
  assert(gaps.some((g) => g.includes("assembly-design")));
  assert(gaps.some((g) => g.includes("实际零件布局")));
  assert(gaps.some((g) => g.includes("真实外形模型")));
  assert.deepEqual(
    stageGaps(
      {
        key: "proposal",
        role: "designer",
        title: "参数提案",
        instruction: "提出外形参数，不执行打印",
        dependsOn: [],
      },
      [],
    ),
    [],
  );
});

test("assembly tool requires one retained complete layout, matching instances and real placement rather than a single ancestor part", () => {
  const item = (
    id: string,
    kind: string,
    properties: Record<string, unknown>,
  ) => ({ id, kind, label: id, properties, references: [] });
  const component = (id: string) =>
    item(id, "component-instance", {
      geometryRef: { source: "fixture" },
      positionMm: [0, 0, 10],
      rotationDeg: [0, 0, 0],
    });
  const packet = (
    id: string,
    structure: ReturnType<typeof item>[],
  ): Packet => ({
    version: VERSION,
    id,
    invocationId: id,
    inputs: [],
    summary: id,
    evidence: "proposal",
    data: { structure, motion: [], circuit_energy: [], flow: [], logic: [] },
  });
  const nodes: any[] = [
    {
      id: "hardware",
      role: "embedded",
      status: "done",
      inputs: [],
      packet: packet("hardware", []),
    },
    {
      id: "shape",
      role: "designer",
      status: "done",
      inputs: [],
      packet: packet("shape", [item("shell", "appearance-model", {})]),
    },
    {
      id: "layout",
      role: "mechanical",
      status: "done",
      inputs: ["hardware", "shape"],
      packet: packet("layout", [component("board"), component("connector")]),
    },
    {
      id: "design",
      role: "mechanical",
      status: "done",
      inputs: ["layout"],
      packet: packet("design", [
        item("assembly", "assembly-design", { instances: [{ id: "board" }] }),
      ]),
    },
  ];
  const execution: Task = {
    key: "assembly",
    role: "mechanical",
    title: "装配执行",
    instruction: "调用build_printable_assembly",
    dependsOn: ["design"],
  };
  assert(stageGaps(execution, nodes).some((g) => g.includes("实例清单")));
  nodes[3].packet.data.structure[0].properties.instances.push({
    id: "connector",
  });
  assert(
    !stageGaps(execution, nodes).some((g) => /实例清单|实际零件布局/.test(g)),
  );
  nodes[2].packet.data.structure[1].properties.positionMm = [NaN, 0, 0];
  assert(stageGaps(execution, nodes).some((g) => g.includes("实际零件布局")));
  nodes[2].packet.data.structure[1] = item("cable", "reserved-volume", {});
  assert(stageGaps(execution, nodes).some((g) => g.includes("假设预留")));
  const negative = {
    ...execution,
    instruction: "不要调用build_printable_assembly；本次仅提出装配方案",
  };
  assert(!stageGaps(negative, nodes).some((g) => g.includes("可打印装配执行")));
});

test("finish consumes trusted matching assembly execution and retains failed closure and unverified ranges", () => {
  const make = (items: any[]): Packet => ({
    version: VERSION,
    id: "p",
    invocationId: "mechanical",
    inputs: [],
    summary: "全部成功可打印可回装",
    evidence: "proposal",
    data: {
      structure: items,
      motion: [],
      circuit_energy: [],
      flow: [],
      logic: [],
    },
  });
  const design = {
    id: "design",
    kind: "assembly-design",
    label: "design",
    properties: {},
    references: [],
  };
  const result = {
    id: "result",
    kind: "assembly-model",
    label: "result",
    properties: {
      sourceItemId: "design",
      geometryChecksPassed: false,
      report: {
        geometryChecksPassed: false,
        closure: { provided: false, passed: false },
        gaps: ["Physical printing unverified"],
      },
    },
    references: ["design"],
  };
  const n: any = {
    id: "mechanical",
    role: "mechanical",
    status: "done",
    inputs: [],
    packet: make([design, result]),
  };
  const finish: Task = {
    key: "finish",
    role: "mechanical",
    title: "finish",
    instruction: "核对现有缺口",
    dependsOn: [n.id],
  };
  assert(
    stageGaps(finish, [n]).some((g) => g.includes("真实执行证据")),
    "Model-owned packet presence and positive summary cannot satisfy execution",
  );
  n.assemblyEvidence = [
    {
      ...make([result]),
      evidence: "executed",
      execution: {
        tool: "build_printable_assembly",
        artifact: "result",
        digest: "sha",
      },
    },
  ];
  let gaps = stageGaps(finish, [n]);
  assert(gaps.some((g) => g.includes("几何检查尚未通过")));
  assert(gaps.some((g) => g.includes("闭合定位")));
  assert(gaps.some((g) => g.includes("Physical printing unverified")));
  result.properties.geometryChecksPassed = true;
  result.properties.report.geometryChecksPassed = true;
  result.properties.report.closure = { provided: true, passed: true };
  gaps = stageGaps(finish, [n]);
  assert(!gaps.some((g) => /几何检查尚未通过|闭合定位/.test(g)));
  assert(gaps.some((g) => g.includes("Physical printing unverified")));
  result.properties.sourceItemId = "stale-design";
  assert(stageGaps(finish, [n]).some((g) => g.includes("真实执行证据")));
});

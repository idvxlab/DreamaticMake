/** Test-only deterministic agent results; never used by the application server. */
import type { Caller } from "../packages/workbench/runtime";
import type { Role } from "../packages/workbench/contracts";
export const emptyData = () => ({
  structure: [],
  motion: [],
  circuit_energy: [],
  flow: [],
  logic: [],
});
export const fixtureCaller: Caller = async (role, input) => {
  const state = input.state?.invocations || [];
  const done = state.filter((n) => n.status === "done");
  const get = (r: Role) => done.filter((n) => n.role === r);
  const task = (
    key: string,
    r: Role,
    title: string,
    instruction: string,
    dependsOn: string[] = [],
  ) => ({ key, role: r, title, instruction, dependsOn });
  if (role === "coordinator") {
    let tasks: ReturnType<typeof task>[] = [];
    if (!get("analyst").length)
      tasks = [task("clarify", "analyst", "澄清需求", "clarify")];
    else if (!get("embedded").length)
      tasks = [
        task("power", "embedded", "供电方案", "power"),
        task("sensor", "embedded", "传感器方案", "sensor"),
        task("shape", "analyst", "外观约束分析", "shape"),
      ];
    else if (!get("designer").length)
      tasks = [
        task(
          "design",
          "designer",
          "效果图与三视图规范",
          "design",
          [...get("analyst"), ...get("embedded")].map((n) => n.id),
        ),
        task(
          "review-hardware",
          "reviewer",
          "硬件独立审查",
          "review-hardware",
          get("embedded").map((n) => n.id),
        ),
      ];
    else if (!get("mechanical").length)
      tasks = [
        task(
          "cad",
          "mechanical",
          "结构布置方案",
          "cad",
          [...get("embedded"), ...get("designer")].map((n) => n.id),
        ),
      ];
    else if (get("reviewer").length < 2)
      tasks = [
        task(
          "review-assembly",
          "reviewer",
          "装配独立审查",
          "review-assembly",
          get("mechanical").map((n) => n.id),
        ),
      ];
    else if (
      input.packets.some((p) =>
        p.data.logic.some((i) => i.kind === "user-feedback"),
      ) &&
      get("reviewer").length < 3
    )
      tasks = [
        task(
          "review-feedback",
          "reviewer",
          "根据补充要求复审",
          "review-feedback",
          get("mechanical").map((n) => n.id),
        ),
      ];
    return {
      summary: "测试用产品经理根据已有结果决定下一步",
      data: emptyData(),
      decision: {
        action: tasks.length ? "dispatch" : "finish",
        reason: tasks.length
          ? "结合实际返回结果，委派下一批任务"
          : "设计提案范围已完成；未执行生图、CAD或编译。审查建议保留供专家取舍。",
        tasks,
      },
    };
  }
  const data: Record<string, unknown[]> = emptyData();
  if (role === "embedded")
    data.circuit_energy = ["A", "B"].map((s) => ({
      id: `${input.instruction}-${s}`,
      kind: "hardware-option",
      label: `${input.instruction === "power" ? "供电" : "传感器"}候选 ${s}`,
      properties: {
        voltageV: s === "A" ? 3.3 : 5,
        components: ["测试元器件"],
        interfaces: ["I2C"],
        tradeoffs: "测试方案对比，未核验参数",
      },
      references: [],
    }));
  if (role === "embedded" && input.instruction === "power") {
    data.logic = data.circuit_energy;
    data.circuit_energy = [];
  }
  if (role === "designer")
    data.logic = ["perspective", "front", "top", "side"].map((v) => ({
      id: `image-${v}`,
      kind: "image-request",
      label: {
        perspective: "效果图",
        front: "前视图",
        top: "顶视图",
        side: "侧视图",
      }[v],
      properties: {
        view: v,
        status: "pending",
        prompt: "仅测试生成规范，未生成图片",
      },
      references: [],
    }));
  if (role === "mechanical")
    data.structure = [
      {
        id: "fixture-shell",
        kind: "envelope",
        label: "测试尺寸包络（非CAD）",
        properties: { dimensionsMm: [65, 35, 110], positionMm: [0, 0, 0] },
        references: [],
      },
    ];
  if (role === "reviewer")
    data.logic = [
      {
        id: `advice-${input.instruction}`,
        kind: "review-advice",
        label: "核实电压与装配间隙",
        properties: {
          severity: "suggestion",
          recommendation: "建议进一步核验，非批准或否决",
        },
        references: [],
      },
    ];
  return {
    summary: `测试 ${role} 返回的设计提案`,
    data,
    ...(role === "analyst" && input.instruction === "clarify"
      ? {
          questions: [
            { id: "use", title: "用途", options: ["办公", "游戏"] },
            { id: "power", title: "供电", options: ["有线", "无线"] },
          ],
        }
      : {}),
  };
};

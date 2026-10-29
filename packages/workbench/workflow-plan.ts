import { z } from "zod";
import type { Invocation, Packet, Task } from "./contracts";
import { engineeringDependencies } from "./engineering-dependencies";
import { visualTaskRequirements } from "./execution-evidence";

export function visualDeliverable(
  task: Pick<Task, "role" | "title" | "instruction">,
) {
  if (task.role !== "designer") return undefined;
  const text = `${task.title} ${visualTaskRequirements(task.instruction)}`;
  if (/render_component_views|结构三视图|轮廓三视图|零件轮廓/.test(text))
    return "structure";
  if (
    /build_appearance_geometry|外观三视图|外观四图|几何一致|正视图|俯视图|侧视图/.test(
      text,
    )
  )
    return "appearance";
  if (/generate_product_images|效果图|概念图|造型参考/.test(text))
    return "concept";
  return undefined;
}

export function validateVisualBatch(
  tasks: Pick<Task, "role" | "title" | "instruction">[],
) {
  const visual = tasks.map(visualDeliverable).filter(Boolean);
  if (
    new Set(visual).size !== visual.length ||
    tasks.filter((t) => t.role === "designer").length > 3
  )
    throw new Error(
      "同一计划外观任务应收敛为效果图、同源外观四图、结构三视图各至多一次；禁止逐视图拆派。参数提案合并至首个外观任务，非必需成果可省略",
    );
}

/** Real inputs and feedback identity, never PM observation nodes or retry titles. */
export function dispatchIdentity(
  task: Task,
  nodes: Invocation[],
  requestId: string,
) {
  const visual = visualDeliverable(task);
  const diagnostic = /诊断|核对|复核|检查|确认/.test(task.title);
  if (!visual && !diagnostic) return undefined;
  return JSON.stringify([
    task.role,
    visual || "diagnostic",
    engineeringDependencies(task.dependsOn, nodes)
      .map((n) => n.id)
      .sort(),
    requestId,
  ]);
}

const stepSchema = z
  .object({
    key: z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/),
    role: z.enum([
      "embedded",
      "designer",
      "mechanical",
      "software",
      "reviewer",
    ]),
    title: z.string().min(1).max(100),
    instruction: z.string().min(1).max(250),
    dependsOn: z.array(z.string().min(1)).min(1).max(16),
  })
  .strict();
const planSchema = z
  .object({
    version: z.literal("dreamatic.workflow-plan/1"),
    steps: z.array(stepSchema).min(1).max(12),
  })
  .strict();
export type WorkflowPlan = {
  sourceId: string;
  steps: z.infer<typeof stepSchema>[];
  completed: Map<string, string>;
};

/** An optional expert handoff, not an approval and not a new product contract. */
export function parseWorkflowPlan(packet: Packet, availableIds: string[]) {
  const items = packet.data.logic.filter(
    (item) => item.kind === "workflow-plan",
  );
  if (!items.length) return undefined;
  if (items.length !== 1)
    throw new Error("每次交接只能提出一个有界workflow-plan");
  const { steps } = planSchema.parse(items[0].properties);
  validateVisualBatch(steps);
  const known = new Set(["$source", ...availableIds]);
  const keys = new Set(steps.map((step) => step.key));
  if (
    keys.size !== steps.length ||
    steps.filter((s) => s.role === "reviewer").length > 2
  )
    throw new Error("工作计划步骤ID必须唯一，审查步骤至多2个");
  for (const step of steps) {
    if (known.has(step.key) || step.dependsOn.some((id) => !known.has(id)))
      throw new Error(
        "工作计划只能依赖$source、实际成功输入或前序步骤；禁止循环与未来依赖",
      );
    known.add(step.key);
  }
  return {
    sourceId: packet.invocationId,
    steps,
    completed: new Map<string, string>(),
  };
}

export function readyWorkflowTasks(plan: WorkflowPlan, nodes: Invocation[]) {
  const successful = new Set(
    nodes.filter((n) => n.status === "done").map((n) => n.id),
  );
  const resolve = (id: string) =>
    id === "$source" ? plan.sourceId : plan.completed.get(id) || id;
  return plan.steps
    .filter((step) => !plan.completed.has(step.key))
    .filter((step) => step.dependsOn.every((id) => successful.has(resolve(id))))
    .slice(0, 3)
    .map(
      (step): Task => ({
        ...step,
        dependsOn: [...new Set(step.dependsOn.map(resolve))],
      }),
    );
}

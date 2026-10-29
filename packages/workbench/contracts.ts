import { z } from "zod";

export const GEOMETRY_FRAME = "xyz-mm-center-z-up/1" as const;

export const VERSION = "dreamatic.workbench/1" as const;
export const channels = [
  "structure",
  "motion",
  "circuit_energy",
  "flow",
  "logic",
] as const;
export const roles = [
  "coordinator",
  "analyst",
  "embedded",
  "designer",
  "mechanical",
  "software",
  "reviewer",
] as const;
export type Role = (typeof roles)[number];
export const roleNames: Record<Role, string> = {
  coordinator: "产品经理",
  analyst: "调研与分析团队",
  embedded: "嵌入式团队",
  designer: "外观设计师",
  mechanical: "结构工程师",
  software: "软件工程师",
  reviewer: "独立审查者",
};
export const channelNames = {
  structure: "结构与布局",
  motion: "运动",
  circuit_energy: "电路与能源",
  flow: "物料与信息流",
  logic: "代码与逻辑",
};
const item = z.object({
  id: z.string().min(1),
  kind: z.string().min(1),
  label: z.string(),
  properties: z.record(z.string(), z.unknown()),
  references: z.array(z.string()).default([]),
});
export const packetSchema = z
  .object({
    version: z.literal(VERSION),
    id: z.string(),
    invocationId: z.string(),
    inputs: z.array(z.string()),
    summary: z.string(),
    evidence: z.enum(["proposal", "executed"]),
    execution: z
      .object({ tool: z.string(), artifact: z.string(), digest: z.string() })
      .optional(),
    data: z
      .object({
        structure: z.array(item),
        motion: z.array(item),
        circuit_energy: z.array(item),
        flow: z.array(item),
        logic: z.array(item),
      })
      .strict(),
  })
  .strict()
  .superRefine((p, ctx) => {
    if (p.evidence === "executed" && !p.execution)
      ctx.addIssue({
        code: "custom",
        message: "执行结果必须附工具、产物和摘要证据",
      });
    const ids = channels.flatMap((c) => p.data[c].map((i) => i.id));
    if (new Set(ids).size !== ids.length)
      ctx.addIssue({ code: "custom", message: "协议中的元素 ID 必须唯一" });
  });
export type Packet = z.infer<typeof packetSchema>;
export const questionsSchema = z
  .array(
    z.object({
      id: z.string(),
      title: z.string().min(1),
      options: z.array(z.string().min(1)).min(2).max(6),
    }),
  )
  .max(8);
export const taskSchema = z.object({
  key: z.string().regex(/^[a-zA-Z0-9_-]+$/),
  role: z.enum(roles),
  title: z.string().min(1),
  instruction: z.string().min(1),
  dependsOn: z.array(z.string()),
});
export const reviewFindingsSchema = z
  .array(
    z.object({
      id: z.string().min(1),
      label: z.string().min(1),
      severity: z.string().default("suggestion"),
      finding: z.string().min(1),
      suggestion: z.string(),
      references: z.array(z.string()).default([]),
    }),
  )
  .min(1)
  .max(12);
export type Task = z.infer<typeof taskSchema>;
export const decisionSchema = z
  .object({
    action: z.enum(["dispatch", "finish", "blocked"]),
    reason: z.string().min(1),
    tasks: z.array(taskSchema).max(3).default([]),
  })
  .strict()
  .superRefine((d, ctx) => {
    if ((d.action === "dispatch") !== d.tasks.length > 0)
      ctx.addIssue({
        code: "custom",
        message: "dispatch 必须含任务，其余决策不得含任务",
      });
    if (
      new Set(d.tasks.map((t) => t.key)).size !== d.tasks.length ||
      d.tasks.some((t) => t.role === "coordinator")
    )
      ctx.addIssue({
        code: "custom",
        message: "任务 key 不重复，产品经理不能递归调用自己",
      });
  });
export type Decision = z.infer<typeof decisionSchema>;
export type Question = z.infer<typeof questionsSchema>[number];
export type Invocation = {
  id: string;
  role: Role;
  title: string;
  status: "queued" | "running" | "done" | "error";
  inputs: string[];
  packet?: Packet;
  hardwareEvidence?: Packet[];
  imageEvidence?: Packet[];
  appearanceEvidence?: Packet[];
  assemblyEvidence?: Packet[];
  /** Application-owned diagnostic snapshot, retained even when output is rejected. */
  engineeringReport?: ReturnType<
    typeof import("./engineering-protocol").inspectEngineeringPacket
  >;
  protocolRepairs?: number;
  toolActivity?: {
    tool: string;
    success: boolean;
    query?: string;
    source?: string;
    total?: number;
    error?: string;
  }[];
  model?: { provider: string; id: string };
  questions?: Question[];
  decision?: Decision;
  error?: string;
  startedAt?: string;
  endedAt?: string;
};
export type Project = {
  version: typeof VERSION;
  id: string;
  brief: string;
  visualContract?: "shared-appearance/1";
  intake?: Packet;
  selection?: Packet;
  selections?: Packet[];
  requests?: Packet[];
  hardwareEvidence?: Packet[];
  gapOverrides?: {
    id: string;
    reason: string;
    gaps?: string[];
    at: string;
    active: boolean;
  }[];
  pendingGaps?: string[];
  stageReadiness?: { gaps: string[]; recoveryAttempts: number };
  phase:
    | "clarifying"
    | "choices"
    | "planning"
    | "running"
    | "complete"
    | "blocked"
    | "error";
  questions: Question[];
  answers: Record<string, string>;
  nodes: Invocation[];
  plan: Task[];
  error?: string;
  createdAt: string;
};
export function validateAnswers(
  questions: Question[],
  answers: Record<string, string>,
) {
  return (
    questions.length > 0 &&
    questions.every((q) => q.options.includes(answers[q.id])) &&
    Object.keys(answers).every((k) => questions.some((q) => q.id === k))
  );
}
export function parseJson(text: string): unknown {
  const clean = text
    .trim()
    .replace(/^```(?:json)?\s*/, "")
    .replace(/\s*```$/, "");
  return JSON.parse(clean);
}

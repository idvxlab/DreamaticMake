import { z } from "zod";
import {
  hardwareFeatureSchema,
  engineDesignSchema,
  type EngineVerification,
} from "./agent-design";
export const stages = [
  "requirements",
  "intent",
  "hardware",
  "appearance",
  "structure",
  "cad",
  "firmware",
  "delivery",
] as const;
export type StageId = (typeof stages)[number];
export const stageLabels: Record<StageId, string> = {
  requirements: "需求分析",
  intent: "意图理解",
  hardware: "硬件选型",
  appearance: "外观设计",
  structure: "结构设计",
  cad: "CAD 建模",
  firmware: "固件开发",
  delivery: "交付验证",
};
export const roleForStage: Record<StageId, string> = {
  requirements: "analyst",
  intent: "analyst",
  hardware: "hardware-engineer",
  appearance: "industrial-designer",
  structure: "mechanical-engineer",
  cad: "cad-engineer",
  firmware: "firmware-engineer",
  delivery: "reviewer",
};
export const enclosureSchema = z
  .object({
    width: z.number().min(20).max(300),
    depth: z.number().min(20).max(300),
    height: z.number().min(12).max(200),
    wall: z.number().min(1).max(6),
    clearance: z.number().min(0.1).max(2),
    lid: z.number().min(1).max(6),
    ports: z
      .array(
        z.object({
          face: z.enum(["front", "back", "left", "right", "lid"]),
          x: z.number(),
          y: z.number(),
          width: z.number().min(1).max(150),
          height: z.number().min(1).max(150),
        }),
      )
      .max(16)
      .default([]),
    mounts: z
      .array(
        z.object({
          x: z.number(),
          y: z.number(),
          height: z.number().min(1).max(50),
          outerDiameter: z.number().min(3).max(15),
          holeDiameter: z.number().min(1).max(8),
        }),
      )
      .max(16)
      .default([]),
    components: z
      .array(
        z.object({
          partId: z.string().regex(/^[a-z0-9_-]+$/),
          x: z.number(),
          y: z.number(),
          z: z.number(),
          width: z.number().positive().max(300),
          depth: z.number().positive().max(300),
          height: z.number().positive().max(200),
        }),
      )
      .max(20)
      .default([]),
    holes: z
      .array(
        z.object({
          x: z.number(),
          y: z.number(),
          diameter: z.number().min(1).max(15),
        }),
      )
      .max(12)
      .default([]),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (
      v.width <= 4 * v.wall + 12 ||
      v.depth <= 4 * v.wall + 12 ||
      v.height <= v.wall + v.lid + 3
    )
      ctx.addIssue({ code: "custom", message: "外壳内腔过小" });
    for (const m of v.mounts)
      if (
        m.holeDiameter >= m.outerDiameter - 1 ||
        Math.abs(m.x) + m.outerDiameter / 2 >= v.width / 2 - v.wall ||
        Math.abs(m.y) + m.outerDiameter / 2 >= v.depth / 2 - v.wall ||
        m.height + v.wall >= v.height - v.lid
      )
        ctx.addIssue({ code: "custom", message: "支柱尺寸或位置超出内腔" });
    for (const port of v.ports) {
      const span = ["left", "right"].includes(port.face) ? v.depth : v.width;
      if (
        Math.abs(port.x) + port.width / 2 >= span / 2 - v.wall ||
        (port.face === "lid"
          ? Math.abs(port.y) + port.height / 2 >= v.depth / 2 - v.wall
          : port.y - port.height / 2 <= v.wall ||
            port.y + port.height / 2 >= v.height - v.lid)
      )
        ctx.addIssue({ code: "custom", message: "开孔超出外壳有效面" });
    }
    for (const h of v.holes)
      if (
        Math.abs(h.x) + h.diameter / 2 + v.wall >= v.width / 2 ||
        Math.abs(h.y) + h.diameter / 2 + v.wall >= v.depth / 2
      )
        ctx.addIssue({ code: "custom", message: "孔位超出可用底板范围" });
  });
export type Enclosure = z.infer<typeof enclosureSchema>;
export const defaultEnclosure: Enclosure = {
  width: 90,
  depth: 65,
  height: 35,
  wall: 2,
  clearance: 0.3,
  lid: 2,
  holes: [],
  ports: [],
  mounts: [],
  components: [],
};
export const stageDraftSchema = z
  .object({
    title: z.string().min(1).max(160),
    summary: z.string().min(1).max(8000),
    facts: z
      .array(
        z.object({ label: z.string().max(100), value: z.string().max(2000) }),
      )
      .max(40),
    assumptions: z.array(z.string().max(1000)).max(20).default([]),
    blockers: z.array(z.string().max(1000)).max(20).default([]),
    futureChecks: z
      .array(
        z.object({
          stage: z.enum(stages),
          description: z.string().min(1).max(2000),
        }),
      )
      .max(30)
      .optional(),
    choices: z
      .array(
        z.object({
          id: z.string().regex(/^[a-z0-9_-]+$/),
          label: z.string().max(160),
          description: z.string().max(2000),
          parameters: enclosureSchema.optional(),
        }),
      )
      .max(6)
      .default([]),
    selectedChoice: z.string().optional(),
    partIds: z.array(z.string()).max(20).default([]),
    hardwareFeatures: z.array(hardwareFeatureSchema).max(20).optional(),
    engineDesign: engineDesignSchema.optional(),
    parameters: enclosureSchema.optional(),
  })
  .strict();
export type StageDraft = z.infer<typeof stageDraftSchema>;
/** Only appearance/structure authors can propose geometry. Keep tool and server validation identical. */
export function stageSubmissionSchema(stage: StageId) {
  if (stage === "appearance" || stage === "structure") return stageDraftSchema;
  return stageDraftSchema
    .omit({ parameters: true })
    .extend({
      choices: z
        .array(
          z
            .object({
              id: z.string().regex(/^[a-z0-9_-]+$/),
              label: z.string().max(160),
              description: z.string().max(2000),
            })
            .strict(),
        )
        .max(6)
        .default([]),
    })
    .strict();
}

export type Artifact = {
  id: string;
  name: string;
  path: string;
  mime: string;
  hash: string;
  size: number;
  stage: StageId;
  revision: number;
};
export type Stage = {
  designWorkspace?: import("./design-workspace").WorkspaceRecord;
  id: StageId;
  status:
    | "not_started"
    | "running"
    | "awaiting_confirmation"
    | "approved"
    | "failed"
    | "stale";
  revision: number;
  needsReviewOnly?: boolean;
  draft?: StageDraft;
  review?: {
    verdict: "pass" | "changes_requested";
    summary: string;
    inputHash: string;
    engineVerification?: EngineVerification;
  };
  error?: string;
  failureSummary?: {
    stage: StageId;
    revision: number;
    failedAt: string;
    error: string;
    tools: { name: string; error: string }[];
  };
  artifacts: Artifact[];
};
export type Answers = Record<string, string | string[]>;
export const answersSchema = z.record(
  z.string(),
  z.union([
    z.string().max(4000),
    z.array(z.string().trim().min(1).max(4000)).max(20),
  ]),
);
export type Interaction = {
  id: string;
  title: string;
  questions: {
    id: string;
    label: string;
    options: string[];
    selection?: "single" | "multiple";
    required: boolean;
  }[];
  answers?: Answers;
};
export type Message = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  createdAt: string;
  agent?: string;
  interaction?: Interaction;
  attachments?: string[];
};
export type Approval = {
  id: string;
  stage: StageId;
  revision: number;
  inputHash: string;
  artifactHashes: Record<string, string>;
  decision: "approved" | "changes_requested";
  actor: "local-user";
  createdAt: string;
  comment?: string;
};
export type Project = {
  id: string;
  name: string;
  brief: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  archived: boolean;
  stages: Record<StageId, Stage>;
  messages: Message[];
  approvals: Approval[];
  parameters: Enclosure;
  selectedParts: string[];
  running: boolean;
};
export type Event = {
  id: string;
  sequence: number;
  projectId: string;
  type: string;
  timestamp: string;
  payload: unknown;
};
export type Part = {
  id: string;
  name: string;
  manufacturer: string;
  revision: string;
  source: string;
  licenseSource: string;
  openHardware: "verified" | "unverified";
  geometryVerified: boolean;
  dimensions: { width: number; depth: number; height: number | null };
  holes: { x: number; y: number; diameter: number }[];
  voltage: string;
  logic: string;
  interfaces: string[];
  notes: string;
  checkedAt: string;
  /** Optional complete engine authoring contract for this exact hardware revision. */
  engineComponent?: Record<string, unknown>;
};

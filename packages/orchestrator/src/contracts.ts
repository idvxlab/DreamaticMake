export const agentIds = [
  "coordinator",
  "research",
  "embedded",
  "industrial-design",
  "mechanical",
  "software",
  "reviewer",
] as const;

export type AgentId = (typeof agentIds)[number];

export const stageIds = [
  "requirements",
  "appearance",
  "hardware_selection",
  "spatial_layout",
  "logical_layout",
  "software_design",
  "enclosure_detail",
  "motion_detail",
  "assembly_detail",
  "print_optimization",
  "procurement_assembly_guide",
] as const;

export type StageId = (typeof stageIds)[number];
export type RunStatus = "queued" | "running" | "review" | "blocked" | "completed" | "failed";

export interface ArtifactPin {
  artifact_id: string;
  revision: number;
  content_hash: string;
}

export interface StageExecutionRequest {
  runId: string;
  projectId: string;
  stage: StageId;
  agent: AgentId;
  objective: string;
  workspace: string;
  processRequest: unknown;
  upstream: ArtifactPin[];
}

export interface AgentRunEvent {
  runId: string;
  type: "started" | "delta" | "item" | "approval" | "completed" | "failed" | "stopped" | "message";
  stage?: StageId;
  at: string;
  payload: unknown;
}

export interface AgentExecutor {
  execute(request: StageExecutionRequest, signal?: AbortSignal): AsyncIterable<AgentRunEvent>;
}

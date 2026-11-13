import type { AgentId, AgentRunEvent, ArtifactPin, StageId } from "../../orchestrator/src/contracts";
import type { MechanicalEvidence } from "../../design-engine/src/bridge";

export type StageState = "pending" | "running" | "awaiting_details" | "ready" | "paused" | "completed" | "failed"
  | "reviewing" | "awaiting_approval" | "approved" | "blocked";

export interface DesignQuestion {
  prompt: string;
  options?: string[];
}

export interface StageRecord {
  id: StageId;
  state: StageState;
  owner: AgentId;
  revision: number;
  authorThreadId?: string;
  reviewerThreadId?: string;
  artifact?: {
    markdown: string;
    pin: ArtifactPin;
    createdAt: string;
    structured?: {
      deliverable: Record<string, unknown>;
      schemaSha256: string;
      contextManifestId: string;
      taskId: string;
      attemptId: string;
      upstream: Partial<Record<StageId, ArtifactPin>>;
      mechanicalEvidence?: MechanicalEvidence[];
    };
  };
  questions?: DesignQuestion[];
  confirmedDetails?: { question: string; answer: string }[];
  authorFeedback?: { runId: string; at: string; message: string }[];
  pauseReason?: "breakpoint" | "stopped" | "interrupted";
  review?: { markdown: string; passed: boolean; createdAt: string };
  approvedAt?: string;
  error?: string;
  hardwareBlocker?: { reason: string; reportedToCoordinator: boolean; coordinatorThreadId?: string };
}

export interface ImportedAsset {
  id: string;
  title: string;
  filename: string;
  sourcePath?: string;
  kind: "image" | "document" | "download";
  sha256: string;
  bytes: number;
}

export interface ImportedWork {
  id: string;
  role: string;
  title: string;
  status: string;
  summary: string;
  threadId: string;
  inputs: string[];
  assetIds: string[];
}

export interface ImportedRun {
  version: string;
  selected: string;
  nodes: ImportedWork[];
  assets: ImportedAsset[];
}

export interface Project {
  id: string;
  name: string;
  brief: string;
  createdAt: string;
  updatedAt: string;
  activeStage: StageId;
  stages: StageRecord[];
  events: AgentRunEvent[];
  breakpoints?: StageId[];
  importedRun?: ImportedRun;
}

export interface ProjectSummary extends Omit<Project, "events"> {
  eventCount: number;
}

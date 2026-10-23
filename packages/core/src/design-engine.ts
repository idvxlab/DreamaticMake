import type {
  EngineDiagnostic,
  EnginePose,
  EngineSample,
  EngineTerminal,
  EngineFrame,
  EngineShape,
  EngineScene,
} from "../../../engine/interface/contracts";
export type {
  EngineDiagnostic,
  EnginePose,
  EngineSample,
  EngineTerminal,
  EngineFrame,
  EngineShape,
  EngineScene,
} from "../../../engine/interface/contracts";
/** Web adapter v1. Engine records remain immutable DSL 0.2.0-proposal snapshots. */
export type EngineMethod = "validate" | "preview" | "workspace";
export type EngineDocument = Record<string, unknown>;
export type EngineMeshAsset = {
  assetVersion: 1;
  id: string;
  name: string;
  sha256: string;
  bytes: number;
  triangles: number;
  vertices: number;
  bounds_m: [number[], number[]];
  watertight: boolean;
  volume_candidate: boolean;
  unit: "mm" | "cm" | "m";
  warnings: string[];
  createdAt: string;
};
export type EnginePayload = {
  snapshot_id: string;
  input_revisions: Record<string, number>;
  diagnostics: EngineDiagnostic[];
  bodies?: number;
  joints?: number;
  nets?: number;
  preview_status?: string;
  scene?: EngineScene;
  circuit?: {
    snapshot_id: string;
    terminals: EngineTerminal[];
    nets: {
      entity_ref: string;
      members: string[];
      kind: string;
      sample: EngineSample | null;
    }[];
    behaviors: {
      entity_ref: string;
      model_id: string;
      sample: EngineSample | null;
    }[];
  };
  flow?: {
    snapshot_id: string;
    mode: "topology_only";
    ports: {
      entity_ref: string;
      direction: string;
      medium_kind: string;
      medium_ref: string;
    }[];
    paths: { entity_ref: string; inlet_ref: string; outlet_ref: string }[];
    connections: { entity_ref: string; a: string; b: string }[];
  };
  result?: {
    status: "completed" | "failed" | "unsupported" | "cancelled";
    snapshot_id: string;
    actual_end_s: number;
    coverage: string[];
    diagnostics: EngineDiagnostic[];
    frames: EngineFrame[];
  } | null;
};
export type EngineReply =
  | { request_id: string; type: "result"; payload: EnginePayload }
  | { request_id: string; type: "error"; diagnostics: EngineDiagnostic[] };
export type EngineRecord = {
  adapterVersion: 1;
  id: string;
  createdAt: string;
  contextKey: string;
  method: EngineMethod;
  bundle: EngineDocument;
  scenario?: EngineDocument;
  reply: EngineReply;
};
export type EngineState = {
  contextKey: string;
  stale: boolean;
  record: EngineRecord | null;
};

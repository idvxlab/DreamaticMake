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
export type EngineDiagnostic = {
  message: string;
  code?: string;
  severity?: string;
  outcome?: string;
  object_refs?: string[];
  location?: (string | number)[];
};
export type EnginePose = {
  translation_m: [number, number, number];
  rotation_xyzw: [number, number, number, number];
};
export type EngineSample = {
  value: string | number | boolean | null;
  quality: string;
  origin: string;
  time_s: number;
};
export type EngineFrame = {
  time_s: number;
  body_poses: Record<string, EnginePose>;
  joint_positions: Record<string, number>;
  network_samples: Record<string, EngineSample>;
  behavior_outputs: Record<string, EngineSample>;
  sensor_samples: Record<string, EngineSample>;
  effects: Record<string, EngineSample>;
  collisions: [string, string][];
};
export type EngineShape =
  | { kind: "box"; size_m: [number, number, number] }
  | { kind: "sphere"; radius_m: number }
  | { kind: "cylinder"; radius_m: number; length_m: number }
  | { kind: "capsule"; radius_m: number; segment_length_m: number }
  | { kind: "convex_asset" }
  | {
      kind: "triangle_mesh";
      unit: "m" | "cm" | "mm";
      collision_mode: "surface" | "solid";
      asset_ref: {
        artifact_id?: string | null;
        relative_path?: string | null;
        sha256: string;
        media_type: string;
      };
    };
export type EngineScene = {
  snapshot_id: string;
  bodies: { entity_ref: string; world_pose: EnginePose | null }[];
  envelopes: {
    entity_ref: string;
    body_ref: string;
    pose: EnginePose;
    shape: EngineShape;
    purpose: "solid" | "keepout" | "service";
    approximation: string;
    margin_m: number;
  }[];
  joints: { entity_ref: string; kind: string; parent: string; child: string }[];
  visual_assets: { entity_ref: string }[];
  collisions: [string, string][];
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
    terminals: { entity_ref: string; net_ref: string | null }[];
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

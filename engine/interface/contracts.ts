/** Legacy layout and the professional v2 projection boundary. */
export type DomainObjectRef = {
  domain: "mechanical" | "electrical" | "behavior" | "flow";
  collection: string;
  id: string;
};
export type OccurrenceObjectRef = DomainObjectRef & { instance: string };
export type ProjectObjectRef = { record_id: string; collection: string; id: string };
export type PinnedElementRef = {
  library_id: string;
  element_id: string;
  revision: number;
  content_hash: string;
};
export type ProfessionalSource = {
  pointer: string;
  element_ref?: PinnedElementRef;
  record_id?: string;
  revision?: number;
  path?: string;
};
export type ProfessionalView = {
  snapshot_id: string;
  object_refs: Record<string, OccurrenceObjectRef | ProjectObjectRef>;
  source_map: Record<string, ProfessionalSource>;
  capabilities: string[];
  diagnostics: EngineDiagnostic[];
};
export type ProfessionalProjection = ProfessionalView & {
  projection_version: 2;
  scene: ProfessionalView & Record<string, unknown>;
  motion: ProfessionalView & Record<string, unknown>;
  schematic: ProfessionalView & Record<string, unknown>;
  logic: ProfessionalView & Record<string, unknown>;
  bom: { element_ref: PinnedElementRef; instances: string[]; quantity: number }[];
};
export type ExecutionEvidence = {
  schema_version: "execution_contract/1.0.0-draft";
  run_id: string;
  subject_snapshot_id: string;
  scenario_hash: string | null;
  input_asset_hashes: Record<string, string>;
  backend_versions: Record<string, string>;
  model_versions: Record<string, string>;
  options_hash: string;
  execution: "completed" | "failed" | "unsupported" | "cancelled";
  outcome: "pass" | "fail" | "unknown";
  coverage: string[];
  diagnostics: Record<string, unknown>[];
  trace_refs: string[];
};
export type ProfessionalSample = {
  value: string | number | boolean | null;
  unit?: string;
  sampled_at_s: number;
  delivered_at_s: number;
  quality: "valid" | "unknown" | "stale" | "fault";
  origin: string;
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
export type EngineTerminal = {
  entity_ref: string;
  net_ref: string | null;
  body_ref?: string | null;
  pose?: EnginePose | null;
  physical_pin_number?: string;
  label?: string;
  electrical_role?: string;
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
  bodies: { entity_ref: string; world_pose: EnginePose | null; color?: string | null }[];
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
export type LayoutDraft = {
  record_kind: "layout_draft";
  layout_version: 1;
  entities: Record<string, { name: string; part_id?: string | null }>;
  bodies: Record<string, { entity: string; pose: EnginePose; color?: string | null }>;
  envelopes: Record<
    string,
    {
      body: string;
      pose: EnginePose;
      shape: EngineShape;
      purpose: "solid" | "keepout" | "service";
      approximation: "outer" | "inner" | "unknown";
      margin_m: number;
    }
  >;
  ports: Record<
    string,
    {
      entity: string;
      name: string;
      domain: "electrical" | "material" | "information";
      direction: "in" | "out" | "bidirectional";
      role: string;
      medium?: string | null;
      data_type?: string | null;
      required: boolean;
      body?: string | null;
      pose?: EnginePose | null;
    }
  >;
  edges: Record<
    string,
    {
      domain: "electrical" | "material" | "information";
      kind: string;
      members: string[];
      directed: boolean;
    }
  >;
  joints: Record<
    string,
    {
      parent: string;
      child: string;
      kind: "fixed" | "revolute" | "continuous" | "prismatic";
      axis: number[] | null;
      parent_anchor: EnginePose;
      child_anchor: EnginePose;
      lower: number | null;
      upper: number | null;
      initial: number | null;
    }
  >;
  transmissions: Record<
    string,
    {
      driver: string;
      follower: string;
      kind: "rotary_ratio" | "screw";
      factor: number | null;
      offset: number;
    }
  >;
  paths: {
    domain: "electrical" | "material" | "information";
    source: string;
    target: string;
  }[];
};
export type GraphProjection = {
  nodes: { id: string; label: string; refs: string[]; missing: boolean }[];
  edges: (LayoutDraft["edges"][string] & {
    id: string;
    endpoints: { node: string; port: string }[];
  })[];
  ports: Record<string, LayoutDraft["ports"][string] & {
    physical_pin_number?: string;
    connections?: { net_ref: string; kind: string; peers: string[] }[];
  }>;
};
export type LayoutReport = {
  kind: string;
  status: string;
  diagnostics: EngineDiagnostic[];
  pairs?: [string, string][];
  checked?: string[];
  skipped?: string[];
  missing_bodies?: string[];
  coverage?: string[];
  joint_positions?: Record<string, number>;
  accepted?: string[];
};
export type LayoutProjection = {
  draft: LayoutDraft;
  snapshot_id: string;
  pose_id?: string;
  diagnostics: EngineDiagnostic[];
  bindings: Record<string, string[]>;
  scene: EngineScene;
  circuit: GraphProjection;
  flow: GraphProjection;
  check?: LayoutReport;
  motion?: LayoutReport;
};
export type ToolDescriptor = {
  id: string;
  operations: string[];
  availability: { worker_ready: boolean | null; reason: string; versions: Record<string, string> };
};
export type ToolRunResult = {
  tool_contract_version: 'tools/1'; tool_id: string; operation: string;
  evidence: { run_id: string; subject_snapshot_id: string; execution: 'completed' | 'failed' | 'unsupported' | 'cancelled'; outcome: 'pass' | 'fail' | 'unknown' };
  findings: { finding_id: string; code: string; message: string; refs: string[] }[];
  coverage_items: { ref: string; covered: boolean; omissions: string[] }[];
  source_map: Record<string, { ref: string; display_ref?: string }>;
  presentation: { stale: boolean; overlay_refs: {ref: string; finding_id: string}[]; trajectory_ref: string | null };
};

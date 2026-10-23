/** Engine projection wire contracts: layout v1 and DSL 0.2.0-proposal. */
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
export type LayoutDraft = {
  record_kind: "layout_draft";
  layout_version: 1;
  entities: Record<string, { name: string; part_id?: string | null }>;
  bodies: Record<string, { entity: string; pose: EnginePose }>;
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
  ports: LayoutDraft["ports"];
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

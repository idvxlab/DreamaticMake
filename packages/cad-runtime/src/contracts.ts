export const cadCapabilities = [
  "brep",
  "constrained-sketch",
  "loft",
  "sweep",
  "fillet",
  "chamfer",
  "shell",
  "assembly",
  "step-import",
  "step-export",
  "mesh-export",
] as const;

export type CadCapability = (typeof cadCapabilities)[number];
export type CadBackendId = "rhino" | "jscad-preview";

export interface CadJob {
  jobId: string;
  projectId: string;
  workspace: string;
  objective: string;
  requiredCapabilities: CadCapability[];
  inputs: Array<{ path: string; sha256: string; kind: "step" | "stl" | "dxf" | "json" }>;
  parameters: Record<string, number | string | boolean>;
  outputs: Array<"source" | "step" | "stl" | "glb" | "drawing">;
}

export interface GeometryEvidence {
  backend: CadBackendId;
  backendVersion: string;
  sourceSha256: string;
  outputs: Array<{ path: string; sha256: string; bytes: number }>;
  solidCount: number;
  validBrep: boolean;
  volumeMm3: number;
  boundsMm: [number, number, number];
  watertightMeshes: boolean;
  warnings: string[];
}

export interface CadBackend {
  id: CadBackendId;
  capabilities: ReadonlySet<CadCapability>;
  available(): Promise<{ available: boolean; version?: string; reason?: string }>;
  execute(job: CadJob, signal?: AbortSignal): Promise<GeometryEvidence>;
}

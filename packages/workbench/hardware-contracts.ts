import { z } from "zod";

export const HARDWARE_VERSION = "dreamatic.hardware/1" as const;
export const hardwareSources = [
  "arduino",
  "raspberrypi",
  "misumi",
  "references",
  "amazon",
  "seed",
  "requirements",
  "curated",
] as const;
export const hardwareSourceNames: Record<HardwareSource, string> = {
  arduino: "Arduino 官方",
  raspberrypi: "树莓派官方",
  misumi: "米思米",
  references: "厂商外形参考",
  amazon: "亚马逊采集",
  seed: "元件种子库",
  requirements: "采购需求库",
  curated: "补充厂商与开源硬件资料",
};
export type HardwareSource = (typeof hardwareSources)[number];
export const hardwareLookupSchema = z.object({
  source: z.enum(hardwareSources),
  recordId: z.string().min(1).max(160),
});
export const hardwareRefSchema = hardwareLookupSchema.extend({
  revision: z.string().regex(/^[a-f0-9]{64}$/),
});
export type HardwareRef = z.infer<typeof hardwareRefSchema>;
export const bomLineSchema = z
  .object({
    bomVersion: z.literal("dreamatic.bom/1"),
    function: z.string().min(1),
    manufacturer: z.string().min(1),
    partNumber: z.string().min(1),
    quantity: z.number().int().positive(),
    unit: z.string().min(1),
    scope: z.string().min(1).max(80),
    selectionStatus: z.enum([
      "selected",
      "candidate",
      "custom_required",
      "missing",
    ]),
    interfaces: z.union([z.string().min(1), z.array(z.string()).min(1)]),
    unverified: z.union([z.string().min(1), z.array(z.string()).min(1)]),
    hardwareRefs: z.array(hardwareRefSchema).max(30),
  })
  .passthrough()
  .superRefine((v, ctx) => {
    if (v.selectionStatus === "selected" && !v.hardwareRefs.length)
      ctx.addIssue({
        code: "custom",
        message:
          "selected 必须绑定真实型号资料；未知或定制件使用 candidate/custom_required/missing",
      });
  });
// Descriptive annotations may carry structured reasons. Preserve their content
// as text in the existing contract; material rows remain strictly validated.
const bomDescriptions = z.array(
  z.union([
    z.string(),
    z
      .record(z.string(), z.unknown())
      .transform((value) => JSON.stringify(value)),
  ]),
);
export const bomBaselineSchema = z
  .object({
    contractVersion: z.literal("dreamatic.bom/1"),
    scope: z.string().min(1),
    rows: z
      .array(
        z.object({
          itemId: z.string().min(1),
          name: z.string().min(1),
          partNumber: z.string().min(1),
          quantity: z.number().int().positive(),
          unit: z.string().min(1),
          selectionStatus: z.enum([
            "selected",
            "candidate",
            "custom_required",
            "missing",
          ]),
        }),
      )
      .min(1)
      .max(300),
    excluded: bomDescriptions,
    procedures: bomDescriptions,
    openChecks: bomDescriptions,
  })
  .passthrough()
  .superRefine((v, ctx) => {
    if (new Set(v.rows.map((r) => r.itemId)).size !== v.rows.length)
      ctx.addIssue({
        code: "custom",
        message: "BOM总清单不能重复计入同一物料条目",
      });
  });
export const hardwareGeometryRefSchema = hardwareRefSchema.extend({
  assetId: z.string().min(1).max(160),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
export type HardwareHit = {
  source: HardwareSource;
  recordId: string;
  title: string;
  summary: string;
  kind: string;
};
export type HardwareAsset = {
  id: string;
  label: string;
  role: string;
  url?: string;
  sha256?: string;
  state: string;
  available: boolean;
  coverage: string;
  bytes?: number;
  downloadUrl: string;
};
export type HardwareRecord = HardwareHit & {
  version: typeof HARDWARE_VERSION;
  revision: string;
  itemId: string;
  url?: string;
  capturedAt?: string;
  evidence: string;
  parameters: unknown[];
  sourceText: string;
  notes: string[];
  assets: HardwareAsset[];
  assetCount: number;
  documents: { id: string; title: string; url?: string }[];
  documentCount: number;
  documentExcerpts?: {
    id: string;
    title: string;
    sha256?: string;
    textSha256: string;
    text: string;
    offset: number;
    totalCharacters: number;
  }[];
  physicalVerified: false;
  geometryVerified: false;
};
export type HardwareStatus = {
  version: typeof HARDWARE_VERSION;
  root: string;
  indexedAt: string;
  sources: {
    source: HardwareSource;
    name: string;
    state: "ready" | "empty" | "missing" | "error";
    count: number;
    message?: string;
  }[];
};
export type HardwareGeometry = {
  version: typeof HARDWARE_VERSION;
  reference: HardwareRef;
  assetId: string;
  sha256: string;
  coverage: string;
  units: "mm";
  coordinateFrame: "source-cad-native/1";
  dimensionsMm: [number, number, number];
  minMm: [number, number, number];
  maxMm: [number, number, number];
  solidCount: number;
  shapeValid: boolean;
  meshUrl: string;
  evidence: "executed_geometry_inspection";
  physicalVerified: false;
  assemblyVerified: false;
};

import { z } from "zod";

export const APPEARANCE_VERSION = "dreamatic.appearance/1" as const;
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const appearanceRefSchema = z
  .object({
    modelId: z.string().uuid(),
    revision: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type AppearanceRef = z.infer<typeof appearanceRefSchema>;
const section = z
  .object({
    offsetMm: z.number().min(-500).max(500),
    centerMm: z
      .tuple([z.number().min(-500).max(500), z.number().min(-500).max(500)])
      .default([0, 0]),
    shape: z.enum(["rounded_rectangle", "ellipse"]),
    sizeMm: z.tuple([z.number().min(10).max(500), z.number().min(10).max(500)]),
    radiusMm: z.number().min(0.5).max(100).default(8),
  })
  .strict()
  .superRefine((s, ctx) => {
    if (
      s.shape === "rounded_rectangle" &&
      s.radiusMm >= Math.min(...s.sizeMm) / 2
    )
      ctx.addIssue({ code: "custom", message: "圆角必须小于截面短边的一半" });
  });
export const appearanceDesignSchema = z
  .object({
    version: z.literal(APPEARANCE_VERSION),
    units: z.literal("mm"),
    geometryFrame: z.literal("xyz-mm-center-z-up/1"),
    label: z.string().min(1).max(160),
    axis: z.enum(["x", "y", "z"]).default("y"),
    sections: z.array(section).min(2).max(8),
    ruled: z.boolean().default(false),
    wallThicknessMm: z.number().min(1).max(6),
    bodyColor: color.default("#e9e8e1"),
    accentColor: color.default("#df956d"),
    features: z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
            kind: z.enum(["window", "button", "port"]),
            face: z.enum(["front", "back", "left", "right", "top", "bottom"]),
            centerMm: z.tuple([
              z.number().min(-500).max(500),
              z.number().min(-500).max(500),
            ]),
            sizeMm: z.tuple([
              z.number().min(1).max(150),
              z.number().min(1).max(150),
            ]),
            radiusMm: z.number().min(0.1).max(50).default(1),
            protrusionMm: z.number().min(0.1).max(15).default(1.2),
            openingClearanceMm: z.number().min(0).max(2).default(0.2),
            color: color.optional(),
          })
          .strict(),
      )
      .max(24),
    assumptions: z.array(z.string().max(1200)).max(30),
  })
  .strict()
  .superRefine((s, ctx) => {
    if (
      s.sections.some(
        (p, i) => i > 0 && p.offsetMm <= s.sections[i - 1].offsetMm,
      )
    )
      ctx.addIssue({ code: "custom", message: "外形截面offsetMm必须严格递增" });
    if (
      s.sections.at(-1)!.offsetMm - s.sections[0].offsetMm <=
      s.wallThicknessMm * 3
    )
      ctx.addIssue({ code: "custom", message: "外形长度不足以形成内腔" });
    if (new Set(s.sections.map((p) => p.shape)).size > 1)
      ctx.addIssue({ code: "custom", message: "同一放样使用相同截面类型" });
    if (
      s.sections.some(
        (p) =>
          Math.min(...p.sizeMm) <= s.wallThicknessMm * 4 ||
          (p.shape === "rounded_rectangle" &&
            p.radiusMm <= s.wallThicknessMm + 0.2),
      )
    )
      ctx.addIssue({
        code: "custom",
        message: "截面或圆角过小，无法按壁厚形成内腔",
      });
    if (new Set(s.features.map((f) => f.id)).size !== s.features.length)
      ctx.addIssue({ code: "custom", message: "外观特征ID重复" });
  });
export type AppearanceDesign = z.infer<typeof appearanceDesignSchema>;
export type AppearanceModel = {
  version: typeof APPEARANCE_VERSION;
  reference: AppearanceRef;
  itemId: string;
  label: string;
  design: AppearanceDesign;
  sourceItemId: string;
  bodyBounds: { minMm: number[]; maxMm: number[] };
  dimensionsMm: [number, number, number];
  positionMm: [number, number, number];
  sceneBounds: { minMm: number[]; maxMm: number[] };
  assets: { id: string; sha256: string; bytes: number; url: string }[];
  meshUrl: string;
  stepUrl: string;
  interiorStepUrl: string;
  geometryDigest: string;
  checks: Record<string, boolean>;
  physicalVerified: false;
  assemblyVerified: false;
};

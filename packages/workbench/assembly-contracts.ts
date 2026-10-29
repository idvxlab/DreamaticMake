import { z } from "zod";
import { appearanceRefSchema } from "./appearance-contracts";
import { hardwareGeometryRefSchema } from "./hardware-contracts";
export const ASSEMBLY_VERSION = "dreamatic.assembly-design/1" as const;
const id = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);
const vec = z.tuple([
  z.number().finite(),
  z.number().finite(),
  z.number().finite(),
]);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const assemblyDesignSchema = z
  .object({
    version: z.literal(ASSEMBLY_VERSION),
    units: z.literal("mm"),
    geometryFrame: z.literal("xyz-mm-center-z-up/1"),
    appearanceRef: appearanceRefSchema,
    shellSha256: digest,
    outerSha256: digest,
    instances: z
      .array(
        z
          .object({
            id,
            geometryRef: hardwareGeometryRefSchema,
            translationMm: vec,
            rotationDeg: vec,
          })
          .strict(),
      )
      .max(100),
    split: z
      .object({
        axis: z.literal("z"),
        atMm: z.number().finite(),
        gapMm: z.number().min(0.1).max(2),
      })
      .strict(),
    mounts: z
      .array(
        z
          .object({
            id,
            kind: z.enum(["mount", "stop"]),
            centerMm: z.tuple([z.number().finite(), z.number().finite()]),
            baseZMm: z.number().finite(),
            topZMm: z.number().finite(),
            radiusMm: z.number().positive().max(20),
            holeRadiusMm: z.number().nonnegative().max(10),
            instanceId: id,
          })
          .strict(),
      )
      .max(40),
    keepouts: z
      .array(
        z
          .object({
            id,
            kind: z.enum(["wire", "connector"]),
            centerMm: vec,
            sizeMm: vec.refine((v) => v.every((n) => n > 0 && n < 500)),
            assumption: z.string().min(1),
          })
          .strict(),
      )
      .max(40),
    print: z
      .object({
        bedMm: vec.refine((v) => v.every((n) => n > 0 && n <= 1000)),
        material: z.string().min(1),
        clearanceAssumption: z.string().min(1),
      })
      .strict(),
    closure: z
      .object({
        assumption: z.string().min(1),
        locators: z
          .array(
            z
              .object({
                id,
                centerMm: z.tuple([z.number().finite(), z.number().finite()]),
                pinRadiusMm: z.number().positive().max(10),
                bossRadiusMm: z.number().positive().max(20),
                anchorDepthMm: z.number().positive().max(20),
                engagementMm: z.number().positive().max(20),
                radialClearanceMm: z.number().min(0.05).max(1),
                axialClearanceMm: z.number().min(0.05).max(2),
                roofMm: z.number().min(0.5).max(10),
              })
              .strict(),
          )
          .min(2)
          .max(12),
        fasteners: z
          .array(
            z
              .object({
                id,
                centerMm: z.tuple([z.number().finite(), z.number().finite()]),
                baseZMm: z.number().finite(),
                bossRadiusMm: z.number().positive().max(20),
                pilotRadiusMm: z.number().positive().max(10),
                screwRadiusMm: z.number().positive().max(10),
                clearanceRadiusMm: z.number().positive().max(12),
                headRadiusMm: z.number().positive().max(20),
                source: z
                  .object({
                    basis: z.enum(["assumed", "documented"]),
                    reference: z.string().min(1),
                  })
                  .strict(),
                pilotDepthMm: z.number().positive().max(30),
                screwLengthMm: z.number().positive().max(100),
                minEngagementMm: z.number().positive().max(20),
                tipClearanceMm: z.number().min(0.1).max(5),
              })
              .strict(),
          )
          .min(2)
          .max(12),
      })
      .strict()
      .optional(),
    assemblyOrder: z.array(z.string().min(1)).min(1).max(30),
  })
  .strict()
  .superRefine((v, ctx) => {
    for (const rows of [v.instances, v.mounts, v.keepouts])
      if (new Set(rows.map((r) => r.id)).size !== rows.length)
        ctx.addIssue({ code: "custom", message: "Duplicate IDs" });
    if (v.closure) {
      const rows = [...v.closure.locators, ...v.closure.fasteners];
      for (let i = 0; i < rows.length; i++)
        for (let j = i + 1; j < rows.length; j++)
          if (
            Math.hypot(
              rows[i].centerMm[0] - rows[j].centerMm[0],
              rows[i].centerMm[1] - rows[j].centerMm[1],
            ) <=
            rows[i].bossRadiusMm + rows[j].bossRadiusMm
          )
            ctx.addIssue({
              code: "custom",
              message: "Closure features must have separated boss envelopes",
            });
      if (new Set(rows.map((r) => r.id)).size !== rows.length)
        ctx.addIssue({ code: "custom", message: "Closure IDs must be unique" });
      for (const p of v.closure.locators)
        if (p.bossRadiusMm <= p.pinRadiusMm + p.radialClearanceMm)
          ctx.addIssue({
            code: "custom",
            message: "Locator socket requires positive wall thickness",
          });
      for (const f of v.closure.fasteners)
        if (
          !(
            f.pilotRadiusMm < f.screwRadiusMm &&
            f.screwRadiusMm < f.clearanceRadiusMm &&
            f.clearanceRadiusMm < f.bossRadiusMm &&
            f.headRadiusMm > f.clearanceRadiusMm
          ) ||
          f.baseZMm >= v.split.atMm - v.split.gapMm / 2 ||
          f.pilotDepthMm <= f.minEngagementMm + f.tipClearanceMm
        )
          ctx.addIssue({
            code: "custom",
            message: "Fastener radii or engagement dimensions invalid",
          });
    }
    const ids = new Set(v.instances.map((i) => i.id));
    for (const m of v.mounts)
      if (
        !ids.has(m.instanceId) ||
        m.topZMm <= m.baseZMm ||
        m.holeRadiusMm >= m.radiusMm ||
        m.topZMm >= v.split.atMm - v.split.gapMm / 2
      )
        ctx.addIssue({
          code: "custom",
          message:
            "Mount reference or dimensions invalid; mount must remain below split",
        });
  });
export type AssemblyDesign = z.infer<typeof assemblyDesignSchema>;

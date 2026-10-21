import { z } from "zod";
import type { Project, StageId } from "./contracts";
import type { EnginePayload } from "./design-engine";

const document = z.record(z.string(), z.unknown());
export const hardwareFeatureSchema = z
  .object({
    partId: z.string(),
    selectionReason: z.string().min(1),
    envelopeMm: z.object({
      width: z.number().positive(),
      depth: z.number().positive(),
      height: z.number().positive().nullable(),
    }),
    mounting: z.array(z.string()),
    keepouts: z.array(z.string()),
    motion: z.array(z.string()),
    evidence: z.array(z.string()),
    unknowns: z.array(z.string()),
    engineComponent: document.optional(),
  })
  .strict();
export const designCheckSchema = z.discriminatedUnion("kind", [
  z
    .object({
      id: z.string().min(1),
      requirement: z.string().min(1),
      kind: z.literal("collision_free"),
    })
    .strict(),
  z
    .object({
      id: z.string().min(1),
      requirement: z.string().min(1),
      kind: z.literal("sample"),
      collection: z.enum([
        "network_samples",
        "behavior_outputs",
        "sensor_samples",
        "effects",
      ]),
      ref: z.string().min(1),
      timeS: z.number().nonnegative(),
      expected: z.union([z.number(), z.string(), z.boolean()]),
      tolerance: z.number().nonnegative().default(0),
    })
    .strict(),
]);
export const engineDesignSchema = z
  .object({
    version: z.literal(1),
    source: document,
    bundle: document,
    scenario: document,
    bindings: z
      .array(z.object({ partId: z.string(), instanceId: z.string() }).strict())
      .max(32),
    constraints: z
      .array(
        z
          .object({
            id: z.string().min(1),
            kind: z.enum([
              "mount",
              "opening",
              "keepout",
              "motion",
              "manufacturing",
            ]),
            instanceIds: z.array(z.string()),
            description: z.string().min(1),
          })
          .strict(),
      )
      .max(100),
    checks: z.array(designCheckSchema).min(1).max(100),
  })
  .strict();
export type EngineDesign = z.infer<typeof engineDesignSchema>;
export type EngineVerification = {
  designHash: string;
  artifactId: string;
  passed: boolean;
  checks: { id: string; passed: boolean; reason: string }[];
  limitations: string[];
};
export const engineStages: StageId[] = [
  "structure",
  "cad",
  "firmware",
  "delivery",
];
export function designForStage(
  p: Project,
  stage: StageId,
): EngineDesign | undefined {
  const order: StageId[] = ["structure", "cad", "firmware", "delivery"];
  for (const name of order.slice(0, order.indexOf(stage) + 1).reverse()) {
    const design = p.stages[name].draft?.engineDesign;
    if (design) return design;
  }
}
export function evaluateDesign(design: EngineDesign, payload?: EnginePayload) {
  const result = payload?.result;
  const diagnostics = [
    ...(payload?.diagnostics ?? []),
    ...(result?.diagnostics ?? []),
  ];
  const checks = design.checks.map((check) => {
    if (!result || result.status !== "completed" || !result.frames.length)
      return { id: check.id, passed: false, reason: "缺少完成的引擎执行帧" };
    if (check.kind === "collision_free") {
      const passed = result.frames.every(
        (frame) => frame.collisions.length === 0,
      );
      return {
        id: check.id,
        passed,
        reason: passed ? "采样帧中无包络重叠" : "存在包络重叠",
      };
    }
    const frame = result.frames.find(
      (frame) => Math.abs(frame.time_s - check.timeS) < 1e-9,
    );
    const sample = frame?.[check.collection]?.[check.ref];
    const passed =
      sample?.quality === "valid" &&
      (typeof sample.value === "number" && typeof check.expected === "number"
        ? Math.abs(sample.value - check.expected) <= check.tolerance
        : sample.value === check.expected);
    return {
      id: check.id,
      passed,
      reason: passed
        ? "有效样本符合目标"
        : "目标时刻/信号缺失、质量未知或结果不符合目标",
    };
  });
  const blocking = diagnostics.some(
    (d) =>
      d.severity === "error" ||
      d.outcome === "fail" ||
      d.outcome === "unsupported" ||
      (d.outcome === "unknown" && d.code !== "component.design_contract"),
  );
  return {
    passed:
      !!result &&
      result.status === "completed" &&
      result.actual_end_s >= Number(design.scenario.duration_s) &&
      design.checks.some((check) => check.kind === "collision_free") &&
      design.scenario.solver_options !== null &&
      (design.scenario.solver_options as any)?.collision !== false &&
      checks.every((check) => check.passed) &&
      !blocking,
    checks,
    limitations: [
      ...new Set(
        diagnostics.filter((d) => d.outcome !== "pass").map((d) => d.message),
      ),
    ],
  };
}

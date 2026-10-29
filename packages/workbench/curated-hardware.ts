import { z } from "zod";
import { createHash } from "node:crypto";
import { HARDWARE_VERSION, type HardwareRecord } from "./hardware-contracts";

// Operator-maintained source notes; product agents can read them but cannot write them.
// Imported claims never become physical or geometry verification.
const httpsUrl = z
  .string()
  .url()
  .refine((s) => new URL(s).protocol === "https:");
export const curatedCatalogSchema = z
  .object({
    version: z.literal("dreamatic.hardware-curated/1"),
    records: z
      .array(
        z
          .object({
            recordId: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,159}$/),
            title: z.string().min(1).max(300),
            summary: z.string().min(1).max(1000),
            url: httpsUrl,
            capturedAt: z.string().datetime(),
            parameters: z
              .array(
                z
                  .object({
                    name: z.string().min(1).max(200),
                    value: z.unknown(),
                    sourceUrl: httpsUrl,
                  })
                  .strict(),
              )
              .max(100),
            sourceText: z.string().max(12000),
            notes: z.array(z.string().max(2000)).max(30),
          })
          .strict(),
      )
      .max(10000),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (new Set(v.records.map((r) => r.recordId)).size !== v.records.length)
      ctx.addIssue({ code: "custom", message: "补充资料包含重复 recordId" });
  });
export function curatedRecords(input: unknown): HardwareRecord[] {
  return curatedCatalogSchema.parse(input).records.map((raw) => {
    const revision = createHash("sha256")
      .update(JSON.stringify(raw))
      .digest("hex");
    return {
      ...raw,
      version: HARDWARE_VERSION,
      source: "curated",
      revision,
      itemId: `hw:curated:${raw.recordId}:${revision.slice(0, 16)}`,
      kind: "documented_hardware_reference",
      evidence: "source_documentation_not_physical_validation",
      assets: [],
      assetCount: 0,
      documents: [],
      documentCount: 0,
      physicalVerified: false,
      geometryVerified: false,
      notes: [
        ...raw.notes,
        "厂商或开源设计资料摘记；没有登记本地几何资产，不得据此声称完成碰撞检查或实物验证。",
      ],
    };
  });
}

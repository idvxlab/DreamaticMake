import { z } from "zod";

const identifier = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
export const requirementCardSchema = z
  .object({
    id: identifier,
    title: z.string().min(1).max(160),
    description: z.string().min(1).max(2000),
    acceptance: z.array(z.string().min(1).max(1000)).max(12),
  })
  .strict();
export const functionModuleSchema = z
  .object({
    id: identifier,
    name: z.string().min(1).max(160),
    description: z.string().min(1).max(2000),
    requirementIds: z.array(identifier).min(1).max(30),
    inputs: z.array(z.string().min(1).max(500)).max(16),
    outputs: z.array(z.string().min(1).max(500)).min(1).max(16),
    acceptance: z.array(z.string().min(1).max(1000)).min(1).max(12),
    implementation: z.enum(["hardware", "software", "mixed"]),
  })
  .strict();
export const functionRoutingSchema = z
  .object({
    description: z.string().min(1).max(2000),
    links: z
      .array(
        z
          .object({
            functionId: identifier,
            partId: z.string().min(1).max(160),
            role: z.string().min(1).max(160),
            reason: z.string().min(1).max(1200),
          })
          .strict(),
      )
      .max(160),
    exceptions: z
      .array(
        z
          .object({
            functionId: identifier,
            kind: z.enum(["software", "unresolved"]),
            reason: z.string().min(1).max(1200),
          })
          .strict(),
      )
      .max(40),
  })
  .strict();
export type RequirementCard = z.infer<typeof requirementCardSchema>;
export type FunctionModule = z.infer<typeof functionModuleSchema>;
export type FunctionRoutingInput = z.infer<typeof functionRoutingSchema>;
export type ProductFlow = {
  version: 1;
  enabledThrough?: "hardware";
  routing?: FunctionRoutingInput & {
    author: "orchestrator";
    sourceKey: string;
    intentRevision: number;
    hardwareRevision: number;
    createdAt: string;
    sourceArtifacts?: { id: string; hash: string; name: string }[];
    partEvidence?: {
      partId: string;
      sourceUrl: string;
      libraryRef?: { candidateId: string; rawHash: string; sourceUrl: string };
    }[];
  };
  requests: {
    id: string;
    from: "intent" | "hardware";
    target: "requirements" | "intent";
    reason: string;
    needed: string[];
    status: "open" | "resolved";
    fromRevision: number;
    targetRevision: number;
    createdAt: string;
    resolvedAt?: string;
  }[];
};

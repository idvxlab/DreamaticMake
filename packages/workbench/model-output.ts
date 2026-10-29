import { z } from "zod";
import { channels, type Packet, type Role } from "./contracts";
import {
  hardwareRefSchema,
  hardwareGeometryRefSchema,
} from "./hardware-contracts";
import {
  normalizeEngineeringChannels,
  type EngineeringIssue,
} from "./engineering-protocol";

export class EngineeringOutputError extends Error {
  constructor(public issues: EngineeringIssue[]) {
    super(
      `工程通道协议错误：${issues
        .filter((issue) => issue.severity === "error")
        .map((issue) => `${issue.path}: ${issue.message}`)
        .join("；")}`,
    );
  }
}

// Models return a small list of typed items. The application owns the five-channel envelope.
const itemSchema = z
  .object({
    channel: z.enum(channels),
    id: z.string().min(1),
    kind: z.string().min(1),
    label: z.string(),
    properties: z.record(z.string(), z.unknown()).default({}),
    references: z.array(z.string()).default([]),
  })
  .strict();
export function normalizeModelOutput(
  raw: unknown,
  role: Role,
  evidence: Packet[],
) {
  const envelope = z
    .object({
      summary: z.string().min(1),
      items: z.array(itemSchema).optional(),
      data: z.unknown().optional(),
      questions: z.unknown().optional(),
      decision: z.unknown().optional(),
      findings: z.unknown().optional(),
    })
    .parse(raw);
  if (
    role === "coordinator" ||
    (role === "reviewer" && envelope.findings !== undefined)
  )
    return { ...envelope, engineeringIssues: [] as EngineeringIssue[] };
  if (envelope.items && envelope.data !== undefined)
    throw new Error("请使用items或旧版data之一，不能同时返回");
  const normalized = envelope.items
    ? undefined
    : normalizeEngineeringChannels(envelope.data);
  const errors =
    normalized?.issues.filter((issue) => issue.severity === "error") || [];
  if (errors.length) throw new EngineeringOutputError(normalized!.issues);
  const data: Packet["data"] = envelope.items
    ? {
        structure: [],
        motion: [],
        circuit_energy: [],
        flow: [],
        logic: [],
      }
    : normalized!.data;
  const records = new Map(
    evidence
      .flatMap((p) => p.data.structure)
      .filter((i) => i.kind === "hardware-record")
      .map((i) => [i.id, i.properties]),
  );
  const stableIds = new Map<string, Record<string, unknown>[]>();
  for (const record of records.values()) {
    const key = `hw:${record.source}:${record.recordId}`;
    stableIds.set(key, [...(stableIds.get(key) || []), record]);
  }
  const geometries = new Map(
    evidence
      .flatMap((p) => p.data.structure)
      .filter((i) => i.kind === "hardware-geometry")
      .map((i) => [i.id, i.properties]),
  );
  const sources = envelope.items
    ? envelope.items.map(({ channel, ...item }) => ({ channel, item }))
    : channels.flatMap((channel) =>
        Array.isArray(data[channel])
          ? data[channel].map((item) => ({ channel, item }))
          : [],
      );
  for (const { channel, item } of sources) {
    if (
      !item ||
      typeof item !== "object" ||
      !item.properties ||
      typeof item.properties !== "object"
    )
      continue;
    const ids = item.properties.hardwareItemIds;
    if (ids !== undefined) {
      const requested = z.array(z.string().min(1)).max(30).parse(ids);
      const resolved = requested.map((id) => {
        let versions = stableIds.get(id);
        if (!versions) {
          const suffix = id.match(/:([a-f0-9]{12,64})$/);
          const candidates =
            suffix && stableIds.get(id.slice(0, -(suffix[1].length + 1)));
          versions = candidates
            ? candidates.filter((r) =>
                String(r.revision).startsWith(suffix![1]),
              )
            : undefined;
        }
        const record =
          records.get(id) || (versions?.length === 1 ? versions[0] : undefined);
        if (!record)
          throw new Error(
            `硬件资料 ${id} 不在本次或上游证据中，请先读取真实记录`,
          );
        return hardwareRefSchema.parse({
          source: record.source,
          recordId: record.recordId,
          revision: record.revision,
        });
      });
      if (item.properties.hardwareRefs !== undefined) {
        const declared = z
          .array(hardwareRefSchema)
          .parse(item.properties.hardwareRefs);
        const canonical = (refs: typeof resolved) =>
          refs
            .map((r) => `${r.source}:${r.recordId}:${r.revision}`)
            .sort()
            .join("\n");
        if (declared.length && canonical(declared) !== canonical(resolved))
          throw new Error(
            "hardwareItemIds与hardwareRefs引用不一致，请保留实际证据ID",
          );
      }
      item.properties.hardwareRefs = resolved;
      delete item.properties.hardwareItemIds;
    }
    if (item.properties.geometryItemId !== undefined) {
      const id = z.string().min(1).parse(item.properties.geometryItemId);
      const geometry = geometries.get(id);
      if (!geometry)
        throw new Error(`几何证据 ${id} 不在本次或上游实际检查结果中`);
      const resolved = hardwareGeometryRefSchema.parse({
        ...(geometry.reference as object),
        assetId: geometry.assetId,
        sha256: geometry.sha256,
      });
      if (
        item.properties.geometryRef !== undefined &&
        JSON.stringify(
          hardwareGeometryRefSchema.parse(item.properties.geometryRef),
        ) !== JSON.stringify(resolved)
      )
        throw new Error("geometryItemId与geometryRef引用不一致");
      item.properties.geometryRef = resolved;
      delete item.properties.geometryItemId;
    }
    if (envelope.items) data[channel].push(item);
  }
  return { ...envelope, data, engineeringIssues: normalized?.issues || [] };
}

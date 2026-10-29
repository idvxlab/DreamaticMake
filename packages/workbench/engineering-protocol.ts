import { z } from "zod";
import { channels, GEOMETRY_FRAME, type Packet } from "./contracts";
import { appearanceRefSchema } from "./appearance-contracts";
import { hardwareGeometryRefSchema } from "./hardware-contracts";

export type EngineeringIssue = {
  severity: "error" | "gap";
  path: string;
  message: string;
};
type Data = Packet["data"];
const object = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const vector = (v: unknown) =>
  Array.isArray(v) &&
  v.length === 3 &&
  v.every((n) => typeof n === "number" && Number.isFinite(n));

/** Normalize channel containers only. Never infer evidence, units, IDs or geometry. */
export function normalizeEngineeringChannels(value: unknown) {
  const issues: EngineeringIssue[] = [];
  const data: Data = {
    structure: [],
    motion: [],
    circuit_energy: [],
    flow: [],
    logic: [],
  };
  if (!object(value)) {
    issues.push({
      severity: "error",
      path: "data",
      message: "Expected five-channel object",
    });
    return { data, issues };
  }
  for (const key of Object.keys(value))
    if (!(channels as readonly string[]).includes(key))
      issues.push({
        severity: "error",
        path: `data.${key}`,
        message: "Unknown channel; explicit mapping required",
      });
  for (const channel of channels) {
    const rows = value[channel];
    if (rows === undefined || rows === null) {
      issues.push({
        severity: "gap",
        path: `data.${channel}`,
        message: "Channel unspecified; no engineering conclusion inferred",
      });
      continue;
    }
    if (!Array.isArray(rows)) {
      issues.push({
        severity: "error",
        path: `data.${channel}`,
        message: "Channel must be an array",
      });
      continue;
    }
    rows.forEach((row, index) => {
      const path = `data.${channel}.${index}`;
      if (
        !object(row) ||
        typeof row.id !== "string" ||
        !row.id.trim() ||
        typeof row.kind !== "string" ||
        !row.kind.trim() ||
        typeof row.label !== "string" ||
        !object(row.properties) ||
        (row.references !== undefined &&
          (!Array.isArray(row.references) ||
            !row.references.every((r) => typeof r === "string" && r.trim())))
      ) {
        issues.push({
          severity: "error",
          path,
          message: "Invalid engineering item",
        });
        return;
      }
      data[channel].push({
        ...row,
        references: [...((row.references as string[] | undefined) ?? [])],
        properties: { ...row.properties },
      } as Data[typeof channel][number]);
    });
  }
  return { data, issues };
}

/** Read-only semantic checks. Dependencies must be the caller's authorized input packets.
 * This checks bindings, never authenticates execution or approves engineering results.
 */
export function validateEngineeringPacket(
  packet: Packet,
  dependencies: Packet[] = [],
  options: { completeReferenceScope?: boolean } = {},
): EngineeringIssue[] {
  const issues: EngineeringIssue[] = [];
  const add = (
    severity: EngineeringIssue["severity"],
    path: string,
    message: string,
  ) => issues.push({ severity, path, message });
  const items = channels.flatMap((c) => packet.data[c]);
  const available = [
    ...items,
    ...dependencies.flatMap((p) => channels.flatMap((c) => p.data[c])),
  ];
  const ids = new Set<string>();
  const known = new Set(available.map((i) => i.id));
  for (const channel of channels)
    for (const item of packet.data[channel]) {
      const path = `data.${channel}.${item.id}`;
      if (ids.has(item.id))
        add("error", path, "Duplicate item ID across channels");
      ids.add(item.id);
      for (const ref of item.references)
        if (!known.has(ref))
          add(
            options.completeReferenceScope ? "error" : "gap",
            `${path}.references`,
            `Unresolved item reference: ${ref}`,
          );
      const p = item.properties;
      // Unknown kinds/properties remain intact. No speculative circuit/flow unit conversion.
      if (channel !== "structure") continue;
      const geometric =
        item.kind === "component-instance" ||
        item.kind === "reserved-volume" ||
        p.appearanceRef !== undefined;
      if (!geometric) continue;
      if (p.units !== undefined && p.units !== "mm")
        add(
          "error",
          `${path}.units`,
          "Geometry requires explicit mm; conversion must be performed upstream",
        );
      if (p.geometryFrame !== undefined && p.geometryFrame !== GEOMETRY_FRAME)
        add("error", `${path}.geometryFrame`, "Unsupported geometry frame");
      for (const field of [
        "positionMm",
        "translationMm",
        "rotationDeg",
        "dimensionsMm",
      ])
        if (
          p[field] !== undefined &&
          (!vector(p[field]) ||
            (field === "dimensionsMm" &&
              (p[field] as number[]).some((n) => n <= 0)))
        )
          add(
            "error",
            `${path}.${field}`,
            "Expected finite three-vector; dimensions must be positive",
          );
      if (
        p.geometryRef !== undefined &&
        !hardwareGeometryRefSchema.safeParse(p.geometryRef).success
      )
        add(
          "error",
          `${path}.geometryRef`,
          "Invalid versioned hardware geometry reference",
        );
      if (p.appearanceRef !== undefined) {
        const ref = appearanceRefSchema.safeParse(p.appearanceRef);
        if (!ref.success)
          add(
            "error",
            `${path}.appearanceRef`,
            "Invalid versioned appearance reference",
          );
        else if (
          item.kind !== "appearance-model" &&
          !available.some((i) => {
            const source = appearanceRefSchema.safeParse(
              i.properties.appearanceRef,
            );
            return (
              i.kind === "appearance-model" &&
              source.success &&
              source.data.modelId === ref.data.modelId &&
              source.data.revision === ref.data.revision
            );
          })
        )
          add(
            "gap",
            `${path}.appearanceRef`,
            "No matching appearance-model in supplied scope; executor validation still required",
          );
      }
      if (item.kind === "component-instance") {
        if (p.geometryRef === undefined)
          add(
            "gap",
            `${path}.geometryRef`,
            "Component lacks source-bound CAD evidence",
          );
        if (p.positionMm === undefined && p.translationMm === undefined)
          add(
            "gap",
            path,
            "Placement unspecified; origin must not be inferred",
          );
        if (
          p.translationMm !== undefined &&
          p.positionMm === undefined &&
          p.sourceFrame !== "source-cad-native/1"
        )
          add(
            "error",
            `${path}.sourceFrame`,
            "Native translation requires source-cad-native/1",
          );
      }
      if (item.kind === "reserved-volume")
        add(
          "gap",
          path,
          "Reserved volume is an assumption, not verified component geometry",
        );
    }
  issues.push(...validateDeclaredEngineering(packet, dependencies));
  return issues;
}

/** Adapter for design-engine b8db633 ObjectRef. Mapping must be explicit: a remote
 * record ID is not a workbench item ID, and draft numeric revisions are not hashes.
 */
export function normalizeEngineeringReference(
  value: unknown,
  itemIds: ReadonlyMap<string, string>,
): { reference?: string; issues: EngineeringIssue[] } {
  const issue = (severity: EngineeringIssue["severity"], message: string) => ({
    issues: [{ severity, path: "reference", message }],
  });
  if (value === null || value === undefined)
    return issue("gap", "Reference unspecified");
  if (!object(value)) return issue("error", "Expected structured ObjectRef");
  const validId = (v: unknown): v is string =>
    typeof v === "string" && /^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/.test(v);
  if (
    !validId(value.record_id) ||
    Object.keys(value).some(
      (k) => !["record_id", "collection", "object_id"].includes(k),
    )
  )
    return issue("error", "Invalid ObjectRef record or fields");
  const collection = value.collection;
  const objectId = value.object_id;
  if ((collection == null) !== (objectId == null))
    return issue("error", "collection and object_id must be paired");
  let key = value.record_id;
  if (collection != null) {
    if (!validId(collection) || typeof objectId !== "string")
      return issue("error", "Invalid ObjectRef collection or object");
    const pieces = ["unit_inputs", "unit_outputs"].includes(collection)
      ? objectId.split(":")
      : [objectId];
    if (
      (["unit_inputs", "unit_outputs"].includes(collection) &&
        pieces.length !== 2) ||
      !pieces.every(validId)
    )
      return issue("error", "Invalid object or unit:port identifier");
    key += `/${collection}/${objectId}`;
  }
  const reference = itemIds.get(key);
  if (!reference?.trim())
    return issue("gap", `No explicit workbench binding for ${key}`);
  return { reference, issues: [] };
}

export const ENGINEERING_PROTOCOL = "dreamatic.engineering/1" as const;
const ref = z.string().trim().min(1).nullable();
const quantity = (unit: string) =>
  z.object({ value: z.number().finite(), unit: z.literal(unit) }).passthrough();
const valueType = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("boolean") }).passthrough(),
  z
    .object({ kind: z.literal("scalar"), unit: z.string().trim().min(1) })
    .passthrough(),
  z
    .object({
      kind: z.literal("enum"),
      values: z
        .array(z.string().min(1))
        .min(1)
        .refine((v) => new Set(v).size === v.length),
    })
    .passthrough(),
  z
    .object({ kind: z.literal("event"), schemaId: z.string().min(1) })
    .passthrough(),
  z
    .object({ kind: z.literal("stream"), schemaId: z.string().min(1) })
    .passthrough(),
]);
// Opt-in, intentionally narrower than the remote authoring contract. Null means
// explicitly unknown; absent required fields and incompatible known values are errors.
const semanticSchemas = {
  "structure-connection": {
    channel: "structure",
    schema: z
      .object({
        a: ref,
        b: ref,
        constraint: z.enum(["fixed", "joint"]),
        jointRef: ref,
      })
      .passthrough(),
  },
  joint: {
    channel: "motion",
    schema: z
      .object({
        parentBody: ref,
        childBody: ref,
        jointKind: z.enum(["fixed", "revolute", "continuous", "prismatic"]),
        axis: z
          .tuple([
            z.number().finite(),
            z.number().finite(),
            z.number().finite(),
          ])
          .nullable(),
        lower: z
          .object({ value: z.number().finite(), unit: z.enum(["mm", "deg"]) })
          .nullable(),
        upper: z
          .object({ value: z.number().finite(), unit: z.enum(["mm", "deg"]) })
          .nullable(),
        initial: z
          .object({ value: z.number().finite(), unit: z.enum(["mm", "deg"]) })
          .nullable(),
      })
      .passthrough(),
  },
  terminal: {
    channel: "circuit_energy",
    schema: z
      .object({
        role: z.enum(["signal", "power", "ground"]),
        voltageRange: z
          .object({ min: quantity("V"), max: quantity("V") })
          .nullable(),
      })
      .passthrough(),
  },
  net: {
    channel: "circuit_energy",
    schema: z
      .object({
        role: z.enum(["signal", "power", "ground"]),
        members: z
          .array(z.string().min(1))
          .min(2)
          .refine((v) => new Set(v).size === v.length),
      })
      .passthrough(),
  },
  "flow-port": {
    channel: "flow",
    schema: z
      .object({
        direction: z.enum(["in", "out", "bidirectional"]),
        domain: z.enum(["material", "information"]),
        required: z.boolean(),
        medium: z.string().min(1).nullable(),
        valueType: valueType.nullable(),
      })
      .passthrough(),
  },
  "flow-edge": {
    channel: "flow",
    schema: z
      .object({
        domain: z.enum(["material", "information"]),
        from: ref,
        to: z
          .array(z.string().min(1))
          .min(1)
          .refine((v) => new Set(v).size === v.length),
      })
      .passthrough(),
  },
  "logic-port": {
    channel: "logic",
    schema: z
      .object({
        direction: z.enum(["in", "out"]),
        valueType: valueType.nullable(),
      })
      .passthrough(),
  },
  "logic-binding": {
    channel: "logic",
    schema: z.object({ from: ref, to: ref }).passthrough(),
  },
} as const;

const semanticSpec = (kind: string) =>
  Object.hasOwn(semanticSchemas, kind)
    ? semanticSchemas[kind as keyof typeof semanticSchemas]
    : undefined;

function validateDeclaredEngineering(
  packet: Packet,
  dependencies: Packet[],
): EngineeringIssue[] {
  const issues: EngineeringIssue[] = [];
  const add = (
    severity: EngineeringIssue["severity"],
    path: string,
    message: string,
  ) => issues.push({ severity, path, message });
  type Entry = { channel: string; item: Data["structure"][number] };
  const index = new Map<string, Entry>();
  // Explicit dependency order, then local snapshot, wins. This is not a history merge.
  for (const source of [...dependencies, packet])
    for (const channel of channels)
      for (const item of source.data[channel])
        index.set(item.id, { channel, item });
  const parsed = new Map<string, Record<string, unknown>>();
  for (const [id, entry] of index) {
    const p = entry.item.properties;
    if (p.engineeringProtocol !== ENGINEERING_PROTOCOL) continue;
    const spec = semanticSpec(entry.item.kind);
    if (spec && entry.channel === spec.channel) {
      const result = spec.schema.safeParse(p);
      if (result.success) parsed.set(id, result.data);
    }
  }
  const target = (value: unknown, kind: string | string[], path: string) => {
    if (value === null) {
      add("gap", path, "Reference explicitly unknown");
      return;
    }
    const entry = typeof value === "string" ? index.get(value) : undefined;
    if (!entry) {
      add("gap", path, `Unresolved semantic reference: ${String(value)}`);
      return;
    }
    const kinds = Array.isArray(kind) ? kind : [kind];
    if (!kinds.includes(entry.item.kind)) {
      add("error", path, `Expected ${kinds.join("/")} reference`);
      return;
    }
    if (
      !parsed.has(entry.item.id) &&
      !["component-instance", "enclosure"].includes(entry.item.kind)
    ) {
      add(
        "gap",
        path,
        "Target does not have a validated engineering declaration",
      );
      return;
    }
    return entry.item;
  };
  const compatible = (a: unknown, b: unknown) => {
    if (!object(a) || !object(b)) return false;
    if (a.kind !== b.kind) return false;
    if (a.kind === "scalar") return a.unit === b.unit;
    if (a.kind === "event" || a.kind === "stream")
      return a.schemaId === b.schemaId;
    if (a.kind === "enum")
      return (
        Array.isArray(a.values) &&
        Array.isArray(b.values) &&
        a.values.length === b.values.length &&
        a.values.every((v) => (b.values as unknown[]).includes(v))
      );
    return a.kind === "boolean";
  };
  const occupiedTerminals = new Map<string, string>();
  for (const [id, entry] of index)
    if (entry.item.kind === "net" && parsed.has(id))
      for (const member of parsed.get(id)!.members as string[]) {
        const prior = occupiedTerminals.get(member);
        if (prior && prior !== id)
          add(
            "error",
            `data.circuit_energy.${id}.members`,
            `Terminal ${member} already belongs to net ${prior}`,
          );
        occupiedTerminals.set(member, id);
      }
  for (const channel of channels)
    for (const item of packet.data[channel]) {
      const path = `data.${channel}.${item.id}`;
      const p = item.properties;
      if (p.engineeringProtocol === undefined) {
        add(
          "gap",
          path,
          "Legacy kind has no declared engineering semantics; retained without domain verification",
        );
        continue;
      }
      if (p.engineeringProtocol !== ENGINEERING_PROTOCOL) {
        add(
          "error",
          `${path}.engineeringProtocol`,
          "Unsupported engineering protocol version",
        );
        continue;
      }
      const spec = semanticSpec(item.kind);
      if (!spec) {
        add(
          "gap",
          path,
          "Unknown declared engineering kind; retained without domain verification",
        );
        continue;
      }
      if (spec.channel !== channel) {
        add("error", path, "Engineering kind is in the wrong channel");
        continue;
      }
      const result = spec.schema.safeParse(p);
      if (!result.success) {
        for (const issue of result.error.issues)
          add("error", `${path}.${issue.path.join(".")}`, issue.message);
        continue;
      }
      const d = result.data as Record<string, unknown>;
      for (const [key, value] of Object.entries(d))
        if (value === null)
          add("gap", `${path}.${key}`, "Engineering value explicitly unknown");
      if (item.kind === "structure-connection") {
        target(d.a, ["component-instance", "enclosure"], `${path}.a`);
        target(d.b, ["component-instance", "enclosure"], `${path}.b`);
        if (d.a !== null && d.a === d.b)
          add("error", path, "Connection cannot join a body to itself");
        if (d.constraint === "joint")
          target(d.jointRef, "joint", `${path}.jointRef`);
        else if (d.jointRef !== null)
          add(
            "error",
            `${path}.jointRef`,
            "Fixed connection cannot bind a joint",
          );
      } else if (item.kind === "joint") {
        target(
          d.parentBody,
          ["component-instance", "enclosure"],
          `${path}.parentBody`,
        );
        target(
          d.childBody,
          ["component-instance", "enclosure"],
          `${path}.childBody`,
        );
        if (d.parentBody !== null && d.parentBody === d.childBody)
          add("error", path, "Joint needs distinct bodies");
        if (
          d.axis &&
          Math.abs((d.axis as number[]).reduce((n, v) => n + v * v, 0) - 1) >
            1e-6
        )
          add("error", `${path}.axis`, "Joint axis must be normalized");
        const limits = [d.lower, d.upper, d.initial] as ({
          value: number;
          unit: string;
        } | null)[];
        const unit = d.jointKind === "prismatic" ? "mm" : "deg";
        for (const limit of limits)
          if (limit && limit.unit !== unit)
            add("error", path, `Joint limits require ${unit}`);
        const [lower, upper, initial] = limits;
        if (lower && upper && lower.value > upper.value)
          add("error", path, "Joint limits are reversed");
        if (
          initial &&
          ((lower && initial.value < lower.value) ||
            (upper && initial.value > upper.value))
        )
          add("error", path, "Initial joint position outside limits");
      } else if (item.kind === "terminal") {
        const range = d.voltageRange as {
          min: { value: number };
          max: { value: number };
        } | null;
        if (range && range.min.value > range.max.value)
          add("error", `${path}.voltageRange`, "Voltage range is reversed");
      } else if (item.kind === "net") {
        const terminals = (d.members as string[])
          .map((id) => target(id, "terminal", `${path}.members`))
          .filter((v) => !!v);
        let min = -Infinity,
          max = Infinity;
        for (const terminal of terminals) {
          const t = parsed.get(terminal.id)!;
          if (t.role !== d.role)
            add("error", `${path}.members`, "Net and terminal roles disagree");
          const range = t.voltageRange as {
            min: { value: number };
            max: { value: number };
          } | null;
          if (range) {
            min = Math.max(min, range.min.value);
            max = Math.min(max, range.max.value);
          } else
            add(
              "gap",
              `${path}.members`,
              `Terminal ${terminal.id} voltage range unknown`,
            );
        }
        if (min > max)
          add("error", path, "Terminal voltage ranges have no overlap");
      } else if (item.kind === "flow-edge" || item.kind === "logic-binding") {
        const flow = item.kind === "flow-edge";
        const from = target(
          d.from,
          flow ? "flow-port" : "logic-port",
          `${path}.from`,
        );
        const to = (flow ? (d.to as string[]) : [d.to]).map((id) =>
          target(id, flow ? "flow-port" : "logic-port", `${path}.to`),
        );
        if (from) {
          const source = parsed.get(from.id)!;
          if (source.direction === "in")
            add("error", `${path}.from`, "Source port cannot be input-only");
          for (const t of to)
            if (t) {
              const dest = parsed.get(t.id)!;
              if (dest.direction === "out")
                add("error", `${path}.to`, "Target port cannot be output-only");
              if (
                flow &&
                (source.domain !== d.domain || dest.domain !== d.domain)
              )
                add("error", path, "Flow domains disagree");
              if (flow && d.domain === "material") {
                if (
                  source.medium !== null &&
                  dest.medium !== null &&
                  source.medium !== dest.medium
                )
                  add("error", path, "Material media disagree");
                else if (source.medium === null || dest.medium === null)
                  add("gap", path, "Material medium unknown");
              } else if (source.valueType === null || dest.valueType === null)
                add("gap", path, "Port value type unknown");
              else if (!compatible(source.valueType, dest.valueType))
                add("error", path, "Port value types or units disagree");
            }
        }
      } else if (item.kind === "flow-port" && d.required) {
        const connected = [...parsed].some(
          ([id, edge]) =>
            index.get(id)?.item.kind === "flow-edge" &&
            ((d.direction !== "in" && edge.from === item.id) ||
              (d.direction !== "out" &&
                (edge.to as string[]).includes(item.id))),
        );
        if (!connected)
          add("gap", path, "Required flow port has no declared connection");
      }
    }
  return issues;
}

/** Persist this report with the invocation, including gaps on successful proposals.
 * Errors reject the entire submission. Gaps preserve uncertainty, never confer approval.
 */
export function inspectEngineeringPacket(
  packet: Packet,
  dependencies: Packet[] = [],
  options: { completeReferenceScope?: boolean } = {},
) {
  const issues = validateEngineeringPacket(packet, dependencies, options);
  return {
    version: ENGINEERING_PROTOCOL,
    packetId: packet.id,
    invocationId: packet.invocationId,
    dependencyPacketIds: dependencies.map((p) => p.id),
    errors: issues.filter((i) => i.severity === "error"),
    gaps: issues.filter((i) => i.severity === "gap"),
  };
}

/** Serializable invocation diagnostic report; retain on both success and failure. */
export type EngineeringReport = ReturnType<typeof inspectEngineeringPacket>;

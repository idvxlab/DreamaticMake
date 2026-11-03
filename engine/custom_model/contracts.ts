/** Browser-local authoring contracts. No approval or engineering acceptance state. */
export const MATERIALS = {
  PLA: { label: "PLA", color: "#c4d3b0", process: "FDM" },
  PETG: { label: "PETG", color: "#77b7c8", process: "FDM" },
  ABS: { label: "ABS", color: "#e3b778", process: "FDM" },
  TPU: { label: "TPU", color: "#ad9dce", process: "FDM" },
  resin: { label: "光敏树脂", color: "#d2c9bc", process: "SLA" },
} as const;
export type MaterialId = keyof typeof MATERIALS;
export type ConditionPack = Record<string, unknown> & {
  record_kind: "custom_model_conditions";
  schema_version: "0.1.0-draft";
  condition_id: string;
  revision: number;
  title: string;
};
export function parseCondition(value: unknown): ConditionPack {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("条件包必须是 JSON 对象");
  const p = value as ConditionPack;
  if (
    p.record_kind !== "custom_model_conditions" ||
    p.schema_version !== "0.1.0-draft"
  )
    throw new Error("需要 custom_model_conditions / 0.1.0-draft 条件包");
  if (
    typeof p.condition_id !== "string" ||
    !/^[\w.-]{1,100}$/.test(p.condition_id) ||
    typeof p.title !== "string" ||
    !p.title.trim() ||
    !Number.isSafeInteger(p.revision) ||
    p.revision < 1
  )
    throw new Error("条件包需要有效的 condition_id、title 和正整数 revision");
  return p; // Preserve every field; no engineering constraint checking in this version.
}
export type ModelProject = {
  record_kind: "custom_model_project";
  schema_version: "0.1.0-draft";
  design_id: string;
  source_snapshot_id: string;
  commands: string;
  material: MaterialId;
  conditions: ConditionPack[];
};
export function parseProject(value: unknown): ModelProject {
  const p = value as ModelProject;
  if (
    !p ||
    p.record_kind !== "custom_model_project" ||
    p.schema_version !== "0.1.0-draft" ||
    typeof p.design_id !== "string" ||
    typeof p.source_snapshot_id !== "string" ||
    typeof p.commands !== "string" ||
    p.commands.length > 64000 ||
    !Object.hasOwn(MATERIALS, p.material) ||
    !Array.isArray(p.conditions) ||
    p.conditions.length > 100
  )
    throw new Error("模型项目格式无效或版本不支持");
  const conditions = p.conditions.map(parseCondition);
  if (new Set(conditions.map((c) => c.condition_id)).size !== conditions.length)
    throw new Error("条件包 condition_id 重复");
  return { ...p, conditions };
}

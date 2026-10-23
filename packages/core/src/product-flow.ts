import type { Project, StageDraft, StageId } from "./contracts";
import {
  functionRoutingSchema,
  type FunctionRoutingInput,
} from "./product-flow-schema";
import { hash, HttpError } from "./store";
import { requirementOutputs, functionOutputs } from "./product-flow-data";
export { requirementOutputs, functionOutputs } from "./product-flow-data";
export function validateProductSubmission(
  project: Project,
  stage: StageId,
  draft: StageDraft,
) {
  if (stage === "intent" && !draft.functionModules?.length)
    throw new HttpError(
      400,
      "意图理解必须提交可独立连接的 functionModules 功能输出",
    );
  if (draft.requirementCards && stage !== "requirements")
    throw new HttpError(400, "只有需求分析阶段能提交需求卡");
  if (draft.functionModules && stage !== "intent")
    throw new HttpError(400, "只有意图理解阶段能提交功能模块");
  for (const items of [draft.requirementCards, draft.functionModules]) {
    if (items && new Set(items.map((item) => item.id)).size !== items.length)
      throw new HttpError(400, "输出端口 ID 不能重复");
  }
  if (draft.functionModules) {
    const requirements = requirementOutputs(project);
    if (project.stages.requirements.status !== "approved")
      throw new HttpError(409, "功能模块需要已确认的需求输入");
    const valid = new Set(requirements.map((item) => item.id));
    for (const module of draft.functionModules) {
      if (module.requirementIds.some((id) => !valid.has(id)))
        throw new HttpError(400, `功能 ${module.id} 引用了不存在的需求端口`);
    }
    const covered = new Set(
      draft.functionModules.flatMap((module) => module.requirementIds),
    );
    for (const requirement of requirements)
      if (!covered.has(requirement.id))
        throw new HttpError(
          400,
          `需求 ${requirement.id} 尚未由功能覆盖，请补充功能或向上游请求澄清`,
        );
  }
}
/** Routing stamps only its source data, so saving a route cannot invalidate itself. */
export function routingSourceKey(project: Project) {
  return hash({
    requirementsRevision: project.stages.requirements.revision,
    requirements: requirementOutputs(project),
    intentRevision: project.stages.intent.revision,
    functions: functionOutputs(project),
    hardwareRevision: project.stages.hardware.revision,
    hardwareDraft: project.stages.hardware.draft,
    partIds: project.stages.hardware.draft?.partIds ?? [],
    sourceArtifacts: project.stages.hardware.artifacts
      .filter((a) => a.name.startsWith("source-"))
      .map((a) => [a.id, a.hash]),
  });
}
export function currentFunctionRouting(project: Project) {
  const routing = project.productFlow?.routing;
  return routing?.sourceKey === routingSourceKey(project) ? routing : undefined;
}
export function validateFunctionRouting(
  project: Project,
  value: unknown,
): FunctionRoutingInput {
  const input = functionRoutingSchema.parse(value);
  const functions = functionOutputs(project);
  const parts = project.stages.hardware.draft?.partIds ?? [];
  if (!functions.length || !project.stages.hardware.draft)
    throw new HttpError(
      409,
      "需要结构化功能输出和硬件选型草稿，不能从旧版文字猜测连接",
    );
  if (project.stages.intent.status !== "approved")
    throw new HttpError(409, "必须使用已确认的功能版本");
  const seen = new Set<string>();
  for (const link of input.links) {
    if (
      !functions.some((f) => f.id === link.functionId) ||
      !parts.includes(link.partId)
    )
      throw new HttpError(400, "连接必须引用当前功能和已选硬件端口");
    const key = `${link.functionId}:${link.partId}`;
    if (seen.has(key)) throw new HttpError(400, "功能与器件连接重复");
    seen.add(key);
  }
  const exceptions = new Set<string>();
  for (const item of input.exceptions) {
    const module = functions.find((f) => f.id === item.functionId);
    if (
      !module ||
      exceptions.has(item.functionId) ||
      input.links.some((link) => link.functionId === item.functionId)
    )
      throw new HttpError(400, "功能例外必须唯一，且不能与硬件连接重叠");
    if (item.kind === "software" && module.implementation !== "software")
      throw new HttpError(400, "硬件或混合功能不能通过标记纯软件绕过器件选型");
    exceptions.add(item.functionId);
  }
  for (const module of functions) {
    if (
      !input.links.some((link) => link.functionId === module.id) &&
      !exceptions.has(module.id)
    )
      throw new HttpError(
        400,
        `功能 ${module.id} 没有硬件响应或明确的未解决原因`,
      );
  }
  for (const partId of parts)
    if (!input.links.some((link) => link.partId === partId))
      throw new HttpError(400, `器件 ${partId} 没有回应任何功能`);
  return input;
}
export function productFlowIssues(project: Project) {
  if (!functionOutputs(project).length)
    return project.stages.intent.draft
      ? ["意图理解尚未输出结构化功能模块，请返回上游补齐后再确认硬件"]
      : [];
  const routing = currentFunctionRouting(project);
  if (!routing) return ["统筹者尚未提交当前版本的功能—硬件连接"];
  return routing.exceptions
    .filter((item) => item.kind === "unresolved")
    .map((item) => `功能 ${item.functionId} 尚未落实：${item.reason}`);
}

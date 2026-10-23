import { z } from "zod";
import { Type } from "typebox";
import { functionRoutingSchema } from "../../core/src/product-flow-schema";
import {
  requirementOutputs,
  functionOutputs,
  currentFunctionRouting,
} from "../../core/src/product-flow";
import type { Project, StageId } from "../../core/src/contracts";
import type { Workflow } from "../../core/src/workflow";

export class UpstreamRequested extends Error {
  constructor(readonly target: "requirements" | "intent") {
    super(`流程已返回 ${target} 补充输入`);
  }
}
export function productFlowContext(project: Project) {
  return {
    requirements: requirementOutputs(project),
    functions: functionOutputs(project),
    routing: currentFunctionRouting(project),
    previousRouting: project.productFlow?.routing,
    upstreamRequests:
      project.productFlow?.requests.filter((r) => r.status === "open") ?? [],
    legacyFunctionsMissing:
      !!project.stages.intent.draft && !functionOutputs(project).length,
  };
}
export function productFlowInstruction(stage: StageId, role?: string) {
  if (
    role === "reviewer" &&
    ["requirements", "intent", "hardware"].includes(stage)
  )
    return "数据流审阅：核对真实需求卡、功能输入输出及需求覆盖；核对所有未关闭 upstreamRequests 的 needed，尚未补齐不能 pass。硬件阶段检查当前版本的统筹连接，确保每个功能有响应、每个器件有依据。连接不构成几何或电气验证。只调用 review_submit，不创作 stage_submit 输出、不代用户批准。";
  if (role === "orchestrator" && stage !== "hardware")
    return "统筹当前阶段的真实输入输出并委派作者，不能代作者 stage_submit；缺少上游输入时请求补充。用户审批由 UI/API 完成。";
  if (stage === "requirements")
    return "数据流输出：stage_submit 可提供 requirementCards，每张需求卡须包含唯一 id、title、description、acceptance[]；每张卡是下游功能模块的输入端口。沿用当前需求澄清策略，不预选硬件。";
  if (stage === "intent")
    return "数据流输出：必须把产品拆解成 functionModules，每个模块包含唯一 id、name、description、requirementIds（引用 context_read.productFlow.requirements 的真实 id）、inputs[]、outputs[]、acceptance[]、implementation（hardware/software/mixed）。每项需求均需覆盖；不同功能可引用同一需求。不要选硬件。缺少已确认的需求应 workflow_request_upstream，而非猜测。";
  if (stage === "hardware")
    return "数据流统筹：基于 productFlow.functions 选择精确器件，器件可承担多个功能，一个功能可需多个器件。作者提交后，统筹者必须 workflow_route 提交当前函数—器件多对多连接；不得从名字自动猜配，也不得把连接当成电气/几何验证。功能信息缺失或互相冲突，使用 workflow_request_upstream 返回 requirements/intent，明确缺什么。旧版意图没有功能模块时，不能伪造结构化功能；建议返回 intent 补齐。";
  return "";
}
export function registerProductFlowTools(
  add: (
    name: string,
    description: string,
    parameters: any,
    fn: (args: any) => Promise<unknown>,
  ) => void,
  context: {
    workflow: Workflow;
    id: string;
    stage: StageId;
    revision: number;
    role: string;
    controller: AbortController;
  },
) {
  const { workflow, id, stage, revision, role, controller } = context;
  if (stage === "hardware" && role === "orchestrator")
    add(
      "workflow_route",
      "统筹者提交当前已确认功能与所选硬件的多对多连接；每个功能须被覆盖或说明未解决，所有器件须回应功能。这不是用户批准，不证明几何或电气兼容。",
      z.toJSONSchema(functionRoutingSchema, { io: "input" }) as any,
      async (value) => workflow.routeFunctions(id, stage, revision, value),
    );
  if (stage === "intent" || stage === "hardware")
    add(
      "workflow_request_upstream",
      "请求上游补充真实输入。必须说明具体缺口；当前链停止并回到更早的需求/功能阶段，原确认记录保留，下游版本失效。补充版本仍须独立审阅与用户确认。不得因模型/网络错误回退需求，也不得借此放宽未验证的硬件约束。",
      Type.Object({
        target: Type.Union([
          Type.Literal("requirements"),
          Type.Literal("intent"),
        ]),
        reason: Type.String({ minLength: 1, maxLength: 2000 }),
        needed: Type.Array(Type.String({ minLength: 1, maxLength: 1000 }), {
          minItems: 1,
          maxItems: 8,
        }),
      }),
      async ({ target, reason, needed }) => {
        const request = await workflow.requestUpstream(
          id,
          stage,
          revision,
          target,
          reason,
          needed,
        );
        controller.abort(new UpstreamRequested(target));
        return { request, returnedTo: target, requiresUserApproval: true };
      },
    );
}

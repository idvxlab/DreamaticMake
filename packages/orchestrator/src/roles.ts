import type { AgentId, StageId } from "./contracts";

export interface RoleDefinition {
  id: AgentId;
  name: string;
  purpose: string;
  stages: readonly StageId[];
  canReview: boolean;
}

export const roles: Record<AgentId, RoleDefinition> = {
  coordinator: {
    id: "coordinator",
    name: "项目协调者",
    purpose: "理解目标、拆分工作、维护依赖和风险，并把任务交给唯一责任团队。",
    stages: ["requirements", "procurement_assembly_guide"],
    canReview: false,
  },
  research: {
    id: "research",
    name: "调研与分析团队",
    purpose: "收集证据、比较方案、记录来源、不确定性和待验证假设。",
    stages: ["requirements", "hardware_selection"],
    canReview: false,
  },
  embedded: {
    id: "embedded",
    name: "嵌入式团队",
    purpose: "负责电子器件、电源、接口、网络、固件约束和板级验证计划。",
    stages: ["hardware_selection", "logical_layout", "software_design"],
    canReview: false,
  },
  "industrial-design": {
    id: "industrial-design",
    name: "外观设计师",
    purpose: "建立产品语言、CMF、人体工学与可追踪的多视角效果图。",
    stages: ["appearance"],
    canReview: false,
  },
  mechanical: {
    id: "mechanical",
    name: "结构工程师",
    purpose: "负责空间、外壳、运动、装配、公差和制造约束；通过 Rhino 8 完成参数化 NURBS/B-rep 建模与验证。",
    stages: ["spatial_layout", "enclosure_detail", "motion_detail", "assembly_detail", "print_optimization"],
    canReview: false,
  },
  software: {
    id: "software",
    name: "软件工程师",
    purpose: "负责主控软件架构、模块接口、控制逻辑、实现与测试证据。",
    stages: ["software_design"],
    canReview: false,
  },
  reviewer: {
    id: "reviewer",
    name: "独立审查者",
    purpose: "独立核对输入、产物、证据和跨专业冲突；不能自审或替用户批准。",
    stages: [],
    canReview: true,
  },
};

const stageOwners: Record<StageId, AgentId> = {
  requirements: "coordinator",
  appearance: "industrial-design",
  hardware_selection: "embedded",
  spatial_layout: "mechanical",
  logical_layout: "embedded",
  software_design: "software",
  enclosure_detail: "mechanical",
  motion_detail: "mechanical",
  assembly_detail: "mechanical",
  print_optimization: "mechanical",
  procurement_assembly_guide: "coordinator",
};

export function ownerFor(stage: StageId): AgentId {
  return stageOwners[stage];
}

import type { Project, StageState } from "../../../packages/core/src/project";
import type { AgentId, AgentRunEvent, StageId } from "../../../packages/orchestrator/src/contracts";

export const stageNames: Record<StageId, string> = {
  requirements: "需求定义",
  appearance: "外观设计",
  hardware_selection: "硬件选型",
  spatial_layout: "空间布局",
  logical_layout: "电路逻辑",
  software_design: "软件工程",
  enclosure_detail: "外壳深化",
  motion_detail: "运动设计",
  assembly_detail: "装配深化",
  print_optimization: "制造优化",
  procurement_assembly_guide: "采购与装配说明",
};

export const roleNames: Record<AgentId, string> = {
  coordinator: "产品经理",
  research: "调研",
  embedded: "硬件",
  "industrial-design": "外观",
  mechanical: "结构",
  software: "软件",
  reviewer: "独立审查",
};

export const stageStatus: Record<StageState, string> = {
  pending: "待开始",
  running: "执行中",
  awaiting_details: "待确认细节",
  ready: "细节已确认",
  paused: "已暂停",
  completed: "已完成",
  reviewing: "审查中",
  awaiting_approval: "待继续",
  approved: "已确认",
  blocked: "待继续",
  failed: "未完成",
};

const stageDescriptions: Record<StageId, string> = {
  requirements: "整理产品目标、使用场景、约束与验收条件。",
  appearance: "形成产品形态、交互与外观设计要求。",
  hardware_selection: "依据需求检索并核对器件、电源和接口。",
  spatial_layout: "确定器件、操作面与结构空间的布置。",
  logical_layout: "整理端口、供电与电路连接关系。",
  software_design: "明确控制逻辑、软件接口与测试计划。",
  enclosure_detail: "根据布局和外观要求深化外壳。",
  motion_detail: "核对运动关系、行程与干涉限制。",
  assembly_detail: "深化安装、紧固与装配顺序。",
  print_optimization: "整理打印方向、公差与制造约束。",
  procurement_assembly_guide: "汇总单台用量、采购核对项、装配步骤和首件验收。",
};

// Immediate design dependencies from the process contracts. Indirect ancestors
// (such as requirements → layout via hardware selection) need no second wire.
export const stageInputs: Record<StageId, readonly StageId[]> = {
  requirements: [],
  appearance: ["requirements"],
  hardware_selection: ["requirements"],
  spatial_layout: ["hardware_selection", "appearance"],
  logical_layout: ["hardware_selection"],
  software_design: ["logical_layout"],
  enclosure_detail: ["spatial_layout"],
  motion_detail: ["spatial_layout"],
  assembly_detail: ["enclosure_detail"],
  print_optimization: ["assembly_detail"],
  procurement_assembly_guide: ["hardware_selection", "logical_layout", "assembly_detail", "print_optimization"],
};

export function stageDescription(stage: StageId) {
  return stageDescriptions[stage];
}

export function displayStageStatus(state: StageState, disconnected = false) {
  return disconnected && (state === "running" || state === "reviewing") ? "状态待同步" : stageStatus[state];
}

export function workflowNodes(project?: Project, disconnected = false) {
  if (!project) return [];
  if (project.importedRun) return project.importedRun.nodes;

  // Completing a stage advances activeStage before the next call. Keep that pending
  // stage available in the inspector, but don't put it on the canvas yet.
  return project.stages.filter((stage) => stage.state !== "pending" && !(stage.state === "paused" && stage.pauseReason === "breakpoint" && !stage.revision)).map((stage) => ({
    id: stage.id,
    title: stageNames[stage.id],
    role: roleNames[stage.owner],
    status: displayStageStatus(stage.state, disconnected),
    summary: stage.artifact?.markdown.replace(/^#+\s*/gm, "").trim().slice(0, 180) || stageDescription(stage.id),
    inputs: stageInputs[stage.id],
  }));
}

export function eventData(event: AgentRunEvent) {
  const data = event.payload as {
    threadId?: string; agent?: AgentId; delta?: string; message?: string; error?: string;
    turn?: { items?: { type: string; text?: string }[]; error?: { message?: string } };
  } | null;
  return data ?? {};
}

export function runText(events: AgentRunEvent[]) {
  const completed = events.find((event) => event.type === "completed");
  const final = completed && eventData(completed).turn?.items?.filter((item) => item.type === "agentMessage").map((item) => item.text ?? "").join("\n\n");
  return final || events.filter((event) => event.type === "delta").map((event) => eventData(event).delta ?? "").join("");
}

function groupRuns(project: Project) {
  const runs = new Map<string, AgentRunEvent[]>();
  for (const event of project.events) {
    const group = runs.get(event.runId) ?? [];
    group.push(event);
    runs.set(event.runId, group);
  }
  return [...runs.values()];
}

export function threadRuns(project: Project, threadId: string) {
  return groupRuns(project).filter((events) => events.some((event) => eventData(event).threadId === threadId));
}

export function stageRuns(project: Project, stage: StageId) {
  const record = project.stages.find((item) => item.id === stage);
  const threads = new Set([record?.authorThreadId, record?.reviewerThreadId].filter(Boolean));
  // Legacy projects did not label events with their stage; match their thread IDs.
  return groupRuns(project).filter((events) => events.some((event) => {
    const threadId = eventData(event).threadId;
    return event.stage === stage || (threadId && threads.has(threadId));
  }));
}

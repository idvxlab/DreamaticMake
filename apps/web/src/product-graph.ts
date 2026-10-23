import type { Node, Edge } from "@xyflow/react";
import type { ProjectView } from "./api";
import type { Part, StageId } from "../../../packages/core/src/contracts";
import {
  requirementOutputs,
  functionOutputs,
} from "../../../packages/core/src/product-flow-data";
import { workflowExcerpt, workflowState } from "./workflow";

export type Port = {
  id: string;
  label: string;
  kind: "text" | "requirement" | "function" | "hardware" | "feedback" | "model";
  ready?: boolean;
};
export type ProductNodeData = {
  title: string;
  subtitle: string;
  description: string;
  kind: "raw" | "agent" | "manager" | "part" | "proposal";
  stage?: StageId;
  partId?: string;
  status: string;
  inputs: Port[];
  outputs: Port[];
  onPort?: (nodeId: string, portId: string) => void;
};
export type ProductNode = Node<ProductNodeData, "product">;
export type ProductEdge = Edge<{
  kind: "data" | "mapping" | "request" | "proposal";
  reason?: string;
  functionId?: string;
  partId?: string;
}>;
export function buildProductGraph(project: ProjectView, catalog: Part[]) {
  const requirements = requirementOutputs(project),
    functions = functionOutputs(project);
  const partIds = [
    ...new Set(project.stages.hardware.draft?.partIds ?? project.selectedParts),
  ];
  const routing = project.flowRoutingCurrent
    ? project.productFlow?.routing
    : undefined;
  const requests =
    project.productFlow?.requests.filter((r) => r.status === "open") ?? [];
  const nodes: ProductNode[] = [],
    edges: ProductEdge[] = [];
  const node = (id: string, x: number, y: number, data: ProductNodeData) =>
    nodes.push({ id, type: "product", position: { x, y }, data });
  const edge = (
    source: string,
    sourceHandle: string,
    target: string,
    targetHandle: string,
    label: string,
    kind: NonNullable<ProductEdge["data"]>["kind"],
    ready = true,
    extra: Partial<NonNullable<ProductEdge["data"]>> = {},
  ) =>
    edges.push({
      id: `${source}:${sourceHandle}>${target}:${targetHandle}`,
      source,
      sourceHandle,
      target,
      targetHandle,
      label,
      type: "default",
      data: { kind, ...extra },
      animated: false,
      style: {
        stroke:
          kind === "request"
            ? "#bd7450"
            : kind === "mapping"
              ? "#7e9c4a"
              : kind === "proposal"
                ? "#a5ac9b"
                : "#7d928e",
        strokeWidth: kind === "mapping" ? 2 : 1.5,
        strokeDasharray: ready ? undefined : "5 5",
      },
      labelStyle: { fontSize: 11, fill: "#66735d" },
      labelBgStyle: { fill: "#f2f4ed", fillOpacity: 0.94 },
    });
  node("raw", 0, 170, {
    kind: "raw",
    title: "原始需求",
    subtitle: "用户输入",
    description: workflowExcerpt(project.brief, 110),
    status: "已输入",
    inputs: [],
    outputs: [{ id: "brief", label: "需求文本", kind: "text", ready: true }],
  });
  const reqInputs: Port[] = [
    { id: "brief", label: "原始需求", kind: "text", ready: true },
  ];
  if (requests.some((r) => r.target === "requirements"))
    reqInputs.push({
      id: "feedback",
      label: "上游补充请求",
      kind: "feedback",
      ready: true,
    });
  node("requirements", 330, 150, {
    kind: "agent",
    stage: "requirements",
    title: "需求分析",
    subtitle: "ANALYST · 01",
    description: "引导用户明确目标、场景与偏好",
    status: workflowState(project, "requirements").label,
    inputs: reqInputs,
    outputs: requirements.length
      ? requirements.map((r) => ({
          id: `req:${r.id}`,
          label: r.title,
          kind: "requirement",
          ready: true,
        }))
      : [{ id: "pending", label: "需求卡 · 待产出", kind: "requirement" }],
  });
  const intentInputs: Port[] = requirements.length
    ? requirements.map((r) => ({
        id: `req:${r.id}`,
        label: r.title,
        kind: "requirement",
        ready: true,
      }))
    : [{ id: "pending", label: "需求卡", kind: "requirement" }];
  if (requests.some((r) => r.target === "intent"))
    intentInputs.push({
      id: "feedback",
      label: "补充功能输入",
      kind: "feedback",
      ready: true,
    });
  node("intent", 740, 150, {
    kind: "agent",
    stage: "intent",
    title: "意图理解 · 功能拆解",
    subtitle: "FUNCTION ANALYST · 02",
    description: "每个功能模块都是独立输出",
    status: workflowState(project, "intent").label,
    inputs: intentInputs,
    outputs: [
      ...(functions.length
        ? functions.map((f) => ({
            id: `fn:${f.id}`,
            label: f.name,
            kind: "function" as const,
            ready: true,
          }))
        : [
            {
              id: "pending",
              label: "功能模块 · 待拆分",
              kind: "function" as const,
            },
          ]),
      ...(requests.some((r) => r.from === "intent")
        ? [
            {
              id: "request",
              label: "请求上游补充",
              kind: "feedback" as const,
              ready: true,
            },
          ]
        : []),
    ],
  });
  node("hardware", 1170, 150, {
    kind: "agent",
    stage: "hardware",
    title: "硬件选型",
    subtitle: "HARDWARE ENGINEER · 03",
    description: "按功能组合器件，读取参数与来源",
    status: workflowState(project, "hardware").label,
    inputs: functions.length
      ? functions.map((f) => ({
          id: `fn:${f.id}`,
          label: f.name,
          kind: "function",
          ready: true,
        }))
      : [{ id: "pending", label: "功能模块", kind: "function" }],
    outputs: [
      ...(partIds.length
        ? partIds.map((id) => ({
            id: `part:${id}`,
            label: catalog.find((p) => p.id === id)?.name ?? id,
            kind: "hardware" as const,
            ready: true,
          }))
        : [
            {
              id: "pending",
              label: "候选器件 · 待选型",
              kind: "hardware" as const,
            },
          ]),
      {
        id: "constraints",
        label: "选型与空间约束",
        kind: "hardware",
        ready: partIds.length > 0,
      },
    ],
  });
  node("coordinator", 1610, 100, {
    kind: "manager",
    stage: "hardware",
    title: "统筹者 · 功能与硬件",
    subtitle: "ORCHESTRATOR",
    description: routing
      ? workflowExcerpt(routing.description, 100)
      : "决定每项功能由哪些器件回应；检查遗漏与冗余",
    status: routing
      ? "连接已记录"
      : functions.length
        ? "等待统筹连接"
        : "等待功能输出",
    inputs: [
      ...functions.map((f) => ({
        id: `fn:${f.id}`,
        label: f.name,
        kind: "function" as const,
        ready: true,
      })),
      ...partIds.map((id) => ({
        id: `part:${id}`,
        label: catalog.find((p) => p.id === id)?.name ?? id,
        kind: "hardware" as const,
        ready: true,
      })),
    ],
    outputs: [
      ...functions.map((f) => ({
        id: `route:${f.id}`,
        label: f.name,
        kind: "function" as const,
        ready: !!routing,
      })),
      ...(requests.some((r) => r.from === "hardware")
        ? [
            {
              id: "request",
              label: "请求上游补充",
              kind: "feedback" as const,
              ready: true,
            },
          ]
        : []),
    ],
  });
  edge("raw", "brief", "requirements", "brief", "原始需求", "data");
  for (const req of requirements)
    edge(
      "requirements",
      `req:${req.id}`,
      "intent",
      `req:${req.id}`,
      "需求卡",
      "data",
      project.stages.requirements.status === "approved",
    );
  if (!requirements.length)
    edge(
      "requirements",
      "pending",
      "intent",
      "pending",
      "待生成需求卡",
      "proposal",
      false,
    );
  for (const f of functions) {
    edge(
      "intent",
      `fn:${f.id}`,
      "hardware",
      `fn:${f.id}`,
      "功能需求",
      "data",
      project.stages.intent.status === "approved",
    );
    edge(
      "intent",
      `fn:${f.id}`,
      "coordinator",
      `fn:${f.id}`,
      "",
      "data",
      project.stages.intent.status === "approved",
    );
  }
  if (!functions.length)
    edge(
      "intent",
      "pending",
      "hardware",
      "pending",
      "待拆分功能模块",
      "proposal",
      false,
    );
  for (const id of partIds)
    edge("hardware", `part:${id}`, "coordinator", `part:${id}`, "候选", "data");
  for (const [index, id] of partIds.entries()) {
    const part = catalog.find((p) => p.id === id),
      links = routing?.links.filter((link) => link.partId === id) ?? [];
    node(`part:${id}`, 2070, index * 250 + 80, {
      kind: "part",
      stage: "hardware",
      partId: id,
      title: part?.name ?? id,
      subtitle: "硬件实例",
      description: part?.voltage
        ? `${part.voltage} · ${part.interfaces.join(" / ")}`
        : "精确器件资料待补充",
      status: part?.geometryVerified ? "安装几何已核验" : "安装几何未核验",
      inputs: links.length
        ? links.map((link) => ({
            id: `fn:${link.functionId}`,
            label:
              functions.find((f) => f.id === link.functionId)?.name ??
              link.functionId,
            kind: "function",
            ready: true,
          }))
        : [{ id: "pending", label: "等待功能连接", kind: "function" }],
      outputs: [
        {
          id: "spec",
          label: "参数 / 来源 / 模型",
          kind: "hardware",
          ready: !!part,
        },
      ],
    });
    for (const link of links)
      edge(
        "coordinator",
        `route:${link.functionId}`,
        `part:${id}`,
        `fn:${link.functionId}`,
        link.role,
        "mapping",
        true,
        { reason: link.reason, functionId: link.functionId, partId: id },
      );
  }
  for (const req of requests)
    edge(
      req.from === "hardware" ? "coordinator" : "intent",
      "request",
      req.target,
      "feedback",
      "请求补充",
      "request",
      false,
      { reason: `${req.reason}：${req.needed.join("；")}` },
    );
  const bottom = Math.max(
    950,
    240 +
      Math.max(
        requirements.length,
        functions.length,
        partIds.length + functions.length,
      ) *
        30,
  );
  node("proposal:appearance", 930, bottom, {
    kind: "proposal",
    stage: "appearance",
    title: "外观设计",
    subtitle: "后续草案 · 待确认",
    description: "输入需求与器件约束，输出形态方案与操作布局",
    status: "草拟分工",
    inputs: [{ id: "constraints", label: "需求 / 器件约束", kind: "hardware" }],
    outputs: [{ id: "form", label: "外观方案", kind: "model" }],
  });
  node("proposal:structure", 1330, bottom, {
    kind: "proposal",
    stage: "structure",
    title: "结构设计",
    subtitle: "后续草案 · 待确认",
    description: "输入外观与硬件空间，输出装配、安装与走线约束",
    status: "草拟分工",
    inputs: [
      { id: "form", label: "外观与操作布局", kind: "model" },
      { id: "constraints", label: "硬件几何 / 接口", kind: "hardware" },
    ],
    outputs: [{ id: "structure", label: "结构与装配约束", kind: "model" }],
  });
  node("proposal:cad", 1730, bottom, {
    kind: "proposal",
    stage: "cad",
    title: "CAD 生成与验证",
    subtitle: "后续草案 · 待确认",
    description: "按已确认外观与结构建模，输出工程文件及检查报告",
    status: "草拟分工",
    inputs: [{ id: "structure", label: "结构 / 形态 / 硬件", kind: "model" }],
    outputs: [{ id: "model", label: "CAD 模型与报告", kind: "model" }],
  });
  edge(
    "hardware",
    "constraints",
    "proposal:appearance",
    "constraints",
    "拟议输入",
    "proposal",
    false,
  );
  edge(
    "hardware",
    "constraints",
    "proposal:structure",
    "constraints",
    "拟议输入",
    "proposal",
    false,
  );
  edge(
    "proposal:appearance",
    "form",
    "proposal:structure",
    "form",
    "拟议输入",
    "proposal",
    false,
  );
  edge(
    "proposal:structure",
    "structure",
    "proposal:cad",
    "structure",
    "拟议输入",
    "proposal",
    false,
  );
  return { nodes, edges };
}

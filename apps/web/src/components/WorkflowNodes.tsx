import {
  useEffect,
  useMemo,
  useState,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
  useUpdateNodeInternals,
  type NodeProps,
  type Viewport,
} from "@xyflow/react";
import {
  ChevronRight,
  Focus,
  GitBranch,
  Layers3,
  Maximize,
  PanelRightOpen,
  RotateCcw,
} from "lucide-react";
import {
  stageLabels,
  type Part,
  type StageId,
} from "../../../../packages/core/src/contracts";
import type { ProjectView } from "../api";
import {
  buildProductGraph,
  type ProductNode,
  type Port,
} from "../product-graph";
import { ProductPreview, type PreviewMode } from "./ProductPreview";
import { t, useLanguage } from "../i18n";
import "@xyflow/react/dist/style.css";
import "./WorkflowNodes.css";

function FlowPort({
  nodeId,
  port,
  direction,
  onPreview,
}: {
  nodeId: string;
  port: Port;
  direction: "source" | "target";
  onPreview?: ProductNode["data"]["onPort"];
}) {
  return (
    <div
      className={`product-flow-port ${direction} ${port.kind} ${port.ready ? "is-ready" : ""}`}
    >
      <Handle
        type={direction}
        position={direction === "source" ? Position.Right : Position.Left}
        id={port.id}
        isConnectable={false}
      />
      <button
        className="nodrag nopan"
        onClick={(event) => {
          event.stopPropagation();
          onPreview?.(nodeId, port.id);
        }}
        title={port.label}
      >
        {port.ready && port.kind !== "text" ? port.label : t(port.label)}
      </button>
    </div>
  );
}
function FlowNode({ id, data, selected }: NodeProps<ProductNode>) {
  const updateInternals = useUpdateNodeInternals();
  useEffect(
    () => updateInternals(id),
    [id, data.inputs, data.outputs, updateInternals],
  );
  return (
    <article
      className={`product-flow-node ${data.kind} ${selected ? "is-selected" : ""}`}
      data-product-node={id}
    >
      <header className="product-flow-node-header">
        <span>{t(data.subtitle)}</span>
        <strong>{data.kind === "part" ? data.title : t(data.title)}</strong>
        <small>{t(data.status)}</small>
      </header>
      <p className="product-flow-node-description">
        {data.kind === "agent" || data.kind === "proposal"
          ? t(data.description)
          : data.description}
      </p>
      <div className="product-flow-ports">
        <div className="product-flow-inputs">
          {data.inputs.map((port) => (
            <FlowPort
              key={port.id}
              nodeId={id}
              port={port}
              direction="target"
              onPreview={data.onPort}
            />
          ))}
        </div>
        <div className="product-flow-outputs">
          {data.outputs.map((port) => (
            <FlowPort
              key={port.id}
              nodeId={id}
              port={port}
              direction="source"
              onPreview={data.onPort}
            />
          ))}
        </div>
      </div>
      <footer>
        {t(
          data.kind === "proposal"
            ? "拟议端口 · 尚未执行"
            : data.kind === "manager"
              ? "维护连接 · 处理上游补充"
              : data.kind === "part"
                ? "点击预览来源与响应功能"
                : "点击端口预览数据",
        )}
        <ChevronRight size={12} />
      </footer>
    </article>
  );
}
const nodeTypes = { product: FlowNode };
type SavedLayout = {
  positions: Record<string, { x: number; y: number }>;
  viewport?: Viewport;
};
function readLayout(key: string): SavedLayout {
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? "null");
    if (saved && saved.positions && typeof saved.positions === "object")
      return saved;
  } catch {
    /* local layout is optional */
  }
  return { positions: {} };
}
function validPosition(point: unknown): point is { x: number; y: number } {
  return (
    !!point &&
    typeof point === "object" &&
    ["x", "y"].every(
      (key) =>
        typeof (point as any)[key] === "number" &&
        Number.isFinite((point as any)[key]) &&
        Math.abs((point as any)[key]) < 100000,
    )
  );
}
type Props = {
  project: ProjectView;
  selected: StageId;
  catalog: Part[];
  onSelect: (id: StageId) => void;
  onDetails: () => void;
  onConversation: () => void;
  actions: ReactNode;
};
export function WorkflowNodes(props: Props) {
  return (
    <ReactFlowProvider>
      <FlowWorkspace {...props} />
    </ReactFlowProvider>
  );
}
function FlowWorkspace({
  project,
  selected,
  catalog,
  onSelect,
  onDetails,
  onConversation,
  actions,
}: Props) {
  useLanguage();
  const layoutKey = `make-port-flow-v1:${project.id}`;
  const [saved] = useState(() => readLayout(layoutKey));
  const graph = useMemo(
    () => buildProductGraph(project, catalog),
    [project, catalog],
  );
  const [nodes, setNodes, onNodesChange] = useNodesState<ProductNode>([]);
  const [selectedId, setSelectedId] = useState("raw"),
    [selectedPort, setSelectedPort] = useState<string>(),
    [selectedEdgeId, setSelectedEdgeId] = useState<string>();
  const [preview, setPreview] = useState(true),
    [mode, setMode] = useState<PreviewMode>("cards");
  const flow = useReactFlow<ProductNode>();
  const requestedStage = useRef(selected);
  const selectNode = useCallback(
    (id: string, port?: string) => {
      const node = graph.nodes.find((n) => n.id === id);
      if (!node) return;
      setSelectedId(id);
      setSelectedPort(port);
      setSelectedEdgeId(undefined);
      setPreview(true);
      setMode(
        node.data.kind === "manager"
          ? "relations"
          : node.data.kind === "part"
            ? "hardware"
            : "cards",
      );
      if (node.data.stage) {
        requestedStage.current = node.data.stage;
        onSelect(node.data.stage);
      }
    },
    [graph.nodes, onSelect],
  );
  useEffect(() => {
    setNodes((previous) => {
      const byId = new Map(previous.map((node) => [node.id, node]));
      return graph.nodes.map((node) => ({
        ...node,
        selected: node.id === selectedId && !selectedEdgeId,
        position:
          byId.get(node.id)?.position ??
          (validPosition(saved.positions[node.id])
            ? saved.positions[node.id]
            : node.position),
        data: { ...node.data, onPort: selectNode },
      }));
    });
  }, [graph.nodes, selectNode, selectedId, selectedEdgeId, saved, setNodes]);
  const persist = (_?: unknown, viewport?: Viewport, moved?: ProductNode) => {
    try {
      const positions = Object.fromEntries(
        flow.getNodes().map((node) => [node.id, node.position]),
      );
      if (moved) positions[moved.id] = moved.position;
      localStorage.setItem(
        layoutKey,
        JSON.stringify({
          positions,
          viewport: viewport ?? flow.getViewport(),
        }),
      );
    } catch {
      /* Do not block design on browser storage. */
    }
  };
  const focusNode = (id: string) => {
    selectNode(id);
    void flow.fitView({
      nodes: [{ id }],
      padding: 0.5,
      maxZoom: 1,
      duration: 250,
    });
  };
  const goStage = (stage: StageId) =>
    focusNode(
      ["requirements", "intent", "hardware"].includes(stage)
        ? stage
        : `proposal:${stage}`,
    );
  useEffect(() => {
    if (selected !== requestedStage.current) {
      requestedStage.current = selected;
      const id = ["requirements", "intent", "hardware"].includes(selected)
        ? selected
        : `proposal:${selected}`;
      if (graph.nodes.some((n) => n.id === id)) {
        selectNode(id);
        void flow.fitView({
          nodes: [{ id }],
          padding: 0.5,
          maxZoom: 1,
          duration: 250,
        });
      }
    }
  }, [selected, selectNode, graph.nodes, flow]);
  const selectedNode = graph.nodes.find((node) => node.id === selectedId);
  const scopeComplete =
    project.productFlow?.enabledThrough === "hardware" &&
    project.stages.hardware.status === "approved";
  const waiting = project.messages.some(
    (m) => m.interaction && !m.interaction.answers,
  );
  const selectedEdge = graph.edges.find((edge) => edge.id === selectedEdgeId);
  const viewport =
    saved.viewport &&
    validPosition(saved.viewport) &&
    Number.isFinite(saved.viewport.zoom) &&
    saved.viewport.zoom >= 0.12 &&
    saved.viewport.zoom <= 1.8
      ? saved.viewport
      : { x: 40, y: 70, zoom: 0.85 };
  return (
    <section
      className="workflow-workbench port-workbench"
      aria-label={t("节点工作台")}
    >
      <header className="port-workbench-header">
        <div>
          <span className="eyebrow">DATAFLOW WORKSPACE</span>
          <h1>{t("把输入、功能与器件接起来")}</h1>
          <p>{t("节点负责处理，端口交接数据，统筹者维护连接。")}</p>
        </div>
        <button
          onClick={() => {
            setPreview(!preview);
          }}
          aria-pressed={preview}
        >
          <PanelRightOpen size={15} />
          {t("预览区")}
        </button>
      </header>
      <div className={`product-flow-split ${preview ? "" : "preview-hidden"}`}>
        <div className="product-flow-main">
          <nav className="product-flow-toolbar" aria-label={t("画布导航")}>
            <div className="product-flow-stages">
              <button
                onClick={() => {
                  selectNode("raw");
                  void flow.setViewport(
                    { x: 40, y: 70, zoom: 0.85 },
                    { duration: 250 },
                  );
                }}
              >
                <RotateCcw size={13} />
                {t("从头开始")}
              </button>
              {(
                [
                  ["requirements", "需求分析"],
                  ["intent", "功能拆解"],
                  ["hardware", "硬件选型"],
                ] as const
              ).map(([id, label]) => (
                <button key={id} onClick={() => goStage(id)}>
                  {t(label)}
                  <ChevronRight size={11} />
                </button>
              ))}
            </div>
            <div className="product-flow-tools">
              <button
                aria-label={t("定位当前任务")}
                onClick={() =>
                  goStage(
                    scopeComplete
                      ? "hardware"
                      : (project.currentStage ?? "hardware"),
                  )
                }
              >
                <Focus size={15} />
                <span>
                  {scopeComplete
                    ? t("硬件阶段已确认")
                    : waiting && project.currentStage
                      ? `${t(stageLabels[project.currentStage])} · ${t("等待回答")}`
                      : t(project.running ? "正在执行" : "当前任务")}
                </span>
              </button>
              <button
                aria-label={t("查看全部节点")}
                onClick={() =>
                  void flow.fitView({
                    padding: 0.15,
                    duration: 300,
                    maxZoom: 0.85,
                  })
                }
              >
                <Maximize size={15} />
              </button>
              <button
                onClick={() =>
                  void flow.fitView({
                    nodes: graph.nodes.filter(
                      (n) => n.data.kind === "proposal",
                    ),
                    padding: 0.3,
                    maxZoom: 0.8,
                    duration: 300,
                  })
                }
              >
                {t("后续草案")}
              </button>
            </div>
          </nav>
          <div
            className="product-flow-surface"
            data-testid="product-flow-canvas"
          >
            <ReactFlow<ProductNode>
              nodes={nodes}
              edges={graph.edges}
              nodeTypes={nodeTypes}
              onNodesChange={onNodesChange}
              onNodeClick={(_event, node) => selectNode(node.id)}
              onEdgeClick={(_event, edge) => {
                setSelectedEdgeId(edge.id);
                setMode("relations");
                setPreview(true);
              }}
              onNodeDragStop={(_event, node) =>
                persist(undefined, undefined, node)
              }
              onMoveEnd={persist}
              nodesConnectable={false}
              edgesReconnectable={false}
              deleteKeyCode={null}
              minZoom={0.12}
              maxZoom={1.8}
              defaultViewport={viewport}
              panOnScroll={false}
              aria-label={t("产品输入输出工作流画布")}
            >
              <Background gap={18} size={1} color="#c7d0bd" />
              <Controls showInteractive={false} />
              <MiniMap
                nodeColor={(n) =>
                  n.data.kind === "manager"
                    ? "#bdcda4"
                    : n.data.kind === "part"
                      ? "#d9c7a2"
                      : n.data.kind === "proposal"
                        ? "#d8ddd3"
                        : "#d0dbcb"
                }
                pannable
                zoomable
                ariaLabel={t("流程缩略图")}
              />
            </ReactFlow>
          </div>
          <footer className="product-flow-footer">
            <span>
              <GitBranch size={13} />
              {t("连线由统筹者维护")}
            </span>
            <span>{t("拖动节点或画布 · 滚轮缩放 · 点击端口预览")}</span>
          </footer>
        </div>
        {preview && (
          <ProductPreview
            project={project}
            node={selectedNode}
            edge={selectedEdge}
            port={selectedPort}
            catalog={catalog}
            mode={mode}
            onMode={setMode}
            actions={actions}
            onDetails={onDetails}
            onConversation={onConversation}
            onClose={() => setPreview(false)}
            onStage={goStage}
          />
        )}
      </div>
      <div className="product-flow-scope">
        <span>
          <Layers3 size={13} />
          {t("本次实现：需求 → 功能 → 硬件")}
        </span>
        <span>{t("外观 / 结构 / CAD 为待确认的后续草案")}</span>
      </div>
    </section>
  );
}

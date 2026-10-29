import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowUpRight,
  Box,
  Check,
  ChevronDown,
  Code2,
  Database,
  Expand,
  Focus,
  Layers,
  LoaderCircle,
  MousePointer2,
  Network,
  Play,
  Plus,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  channels,
  channelNames,
  roleNames,
  roles,
  type Invocation,
  type Project,
  type Role,
} from "../../../packages/workbench/contracts";
import { AssemblyEvidence } from "./AssemblyEvidence";
import { ExecutionNotice } from "./Evidence";
import { WorkPreview } from "./WorkPreview";
import { ConnectionSettings } from "./ConnectionSettings";
import { HardwareLibrary } from "./HardwareLibrary";
import {
  workflowEdges,
  workflowOverview,
  workflowLayout,
  designerStage,
  designerStageNames,
} from "../../../packages/workbench/graph";
import "./style.css";

const roleIcons = ["◎", "⌕", "⏚", "✧", "⬡", "⌘", "✓"];
const phaseNames = {
  clarifying: "分析需求",
  choices: "等待选择",
  planning: "规划流程",
  running: "专家协作中",
  complete: "本轮完成",
  error: "执行中断",
  blocked: "等待处理",
};
class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
async function api(path: string, body?: unknown) {
  const res = await fetch(`/workbench-api/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", "X-Workbench": "1" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new ApiError(data.error || "请求失败", res.status);
  return data;
}
function App() {
  const [project, setProject] = useState<Project>();
  const [connectionState, setConnectionState] = useState<
    "checking" | "login" | "unavailable" | "ready"
  >("checking");
  const ready = connectionState === "ready";
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [brief, setBrief] = useState("");
  const [pending, setPending] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<string>();
  const [zoom, setZoom] = useState(0.78);
  const [allWires, setAllWires] = useState(false);
  const [expandedHistory, setExpandedHistory] = useState(false);
  const [stageHistory, setStageHistory] = useState<string>();
  const [revealedInputs, setRevealedInputs] = useState<string[]>([]);
  const [offset, setOffset] = useState({ x: 35, y: 65 });
  const [positions, setPositions] = useState<
    Record<string, { x: number; y: number }>
  >({});
  const [extraInstruction, setExtraInstruction] = useState("");
  const [inputIds, setInputIds] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState("summary");
  const [channel, setChannel] = useState("all");
  const drag = useRef<{
    id?: string;
    x: number;
    y: number;
    origin: { x: number; y: number };
    moved?: boolean;
  }>(undefined);
  const canvas = useRef<HTMLDivElement>(null);
  const refresh = async () => {
    const data = await api("project");
    setProject(data.project || undefined);
    setConnectionState("ready");
  };
  const connectionFailed = (e: Error) => {
    setConnectionState(
      e instanceof ApiError && e.status === 401 ? "login" : "unavailable",
    );
    setError(e.message);
  };
  useEffect(() => {
    let active = true;
    const connect = async () => {
      try {
        setConnectionState("checking");
        setError("");
        const t = new URLSearchParams(location.hash.slice(1)).get("token");
        if (t) {
          await api("session", { token: t });
          history.replaceState(null, "", location.pathname);
        }
        await refresh();
      } catch (e) {
        if (active) connectionFailed(e as Error);
      }
    };
    void connect();
    window.addEventListener("hashchange", connect);
    return () => {
      active = false;
      window.removeEventListener("hashchange", connect);
    };
  }, []);
  useEffect(() => {
    if (!ready) return;
    const timer = setInterval(() => {
      refresh().catch(connectionFailed);
    }, 2000);
    return () => clearInterval(timer);
  }, [ready]);
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      if (!event.ctrlKey && !event.metaKey) {
        const unit =
          event.deltaMode === 1
            ? 16
            : event.deltaMode === 2
              ? el.clientHeight
              : 1;
        setOffset((p) => ({
          x: p.x - event.deltaX * unit,
          y: p.y - event.deltaY * unit,
        }));
        return;
      }
      const rect = el.getBoundingClientRect();
      const x = event.clientX - rect.left,
        y = event.clientY - rect.top;
      const next = Math.max(0.05, Math.min(1.8, zoom - event.deltaY * 0.003));
      setOffset({
        x: x - ((x - offset.x) * next) / zoom,
        y: y - ((y - offset.y) * next) / zoom,
      });
      setZoom(next);
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [ready, zoom, offset]);
  const nodes: Invocation[] = project?.nodes || [];
  const overview = useMemo(
    () => workflowOverview(nodes, expandedHistory, revealedInputs),
    [nodes, expandedHistory, revealedInputs],
  );
  const visibleNodes = overview.nodes;
  const edges = useMemo(
    () => workflowEdges(visibleNodes, allWires),
    [visibleNodes, allWires],
  );
  const layout = useMemo(() => {
    const base = workflowLayout(visibleNodes);
    return Object.fromEntries(
      Object.entries(base).map(([id, p]) => [id, positions[id] || p]),
    );
  }, [visibleNodes, positions]);
  useEffect(() => {
    if (selected || !nodes.length || !canvas.current) return;
    const last = layout[visibleNodes.at(-1)?.id || ""];
    if (!last) return;
    setOffset({
      x: Math.min(35, canvas.current.clientWidth - (last.x + 250) * zoom - 30),
      y: Math.min(65, canvas.current.clientHeight - (last.y + 145) * zoom - 45),
    });
  }, [project?.nodes.length, selected]);
  const packets = useMemo(
    () => project?.nodes.flatMap((n) => (n.packet ? [n.packet] : [])) || [],
    [project],
  );
  const selectedNode = nodes.find((n) => n.id === selected);
  const currentNode = selectedNode || nodes.at(-1);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const busy =
    pending ||
    (!!project &&
      ["clarifying", "planning", "running"].includes(project.phase));
  const act = async (path: string, body: unknown) => {
    setPending(true);
    setError("");
    try {
      await api(path, body);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  };
  const fit = () => {
    const el = canvas.current;
    if (!el || !nodes.length) return;
    const points = Object.values(layout);
    if (!points.length) return;
    const minX = Math.min(...points.map((p) => p.x)),
      minY = Math.min(...points.map((p) => p.y));
    const width = Math.max(...points.map((p) => p.x)) + 245 - minX;
    const height = Math.max(...points.map((p) => p.y)) + 145 - minY;
    const scale = Math.min(
      (el.clientWidth - 60) / width,
      (el.clientHeight - 85) / height,
      1,
    );
    setZoom(scale);
    setOffset({ x: 30 - minX * scale, y: 45 - minY * scale });
  };
  return (
    <div className="workbench">
      {libraryOpen && (
        <HardwareLibrary
          close={() => setLibraryOpen(false)}
          hasProject={!!project}
          busy={busy}
          attached={refresh}
        />
      )}
      {settingsOpen && (
        <ConnectionSettings close={() => setSettingsOpen(false)} busy={busy} />
      )}
      <header className="topbar">
        <a className="brand" href="/workbench/">
          <span className="brand-mark">
            d<span>·</span>
          </span>{" "}
          dreamatic<span className="brand-sub">工作台</span>
        </a>
        <div className="project-label">
          <span className="breadcrumb">工作空间 /</span>
          <span className="small-square" />
          {!ready
            ? "等待加载项目"
            : project
              ? project.brief.slice(0, 24)
              : "未命名的产品探索"}
          <ChevronDown size={13} />
        </div>
        <div className="header-right">
          <span className="live-dot" />
          {ready
            ? "本地工作台已连接"
            : connectionState === "checking"
              ? "正在连接"
              : connectionState === "login"
                ? "需要本地认证"
                : "连接中断"}
          <button
            className="outline"
            disabled={!ready}
            onClick={() => setLibraryOpen(true)}
          >
            <Database size={14} />
            硬件库
            {project?.hardwareEvidence?.length
              ? ` · ${project.hardwareEvidence.length}`
              : ""}
          </button>
          <button
            className="outline"
            disabled={!ready}
            onClick={() => setSettingsOpen(true)}
          >
            <SlidersHorizontal size={14} />
            模型设置
          </button>
          <button
            className="outline"
            onClick={() => {
              const blob = new Blob([JSON.stringify(project || {}, null, 2)], {
                type: "application/json",
              });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = "dreamatic-project.json";
              a.click();
              URL.revokeObjectURL(url);
            }}
            disabled={!project}
          >
            <ArrowUpRight size={14} />
            导出协议
          </button>
        </div>
      </header>
      <nav className="projectbar">
        <div>
          <span className="eyebrow">DESIGN ENGINEERING</span>
          <strong>
            从一个想法，到一套系统<span className="muted">。</span>
          </strong>
        </div>
        <div className="project-stats">
          <span>
            <b>{ready ? project?.nodes.length || 0 : "—"}</b> 次调用
          </span>
          <span>
            <b>{ready ? packets.length : "—"}</b> 数据包
          </span>
          <span className="phase">
            <span className={busy ? "live-dot pulse" : "live-dot"} />
            {!ready
              ? "项目尚未加载"
              : project
                ? project.phase === "complete" && project.gapOverrides?.length
                  ? "本轮完成 · 有未解决缺口"
                  : phaseNames[project.phase]
                : "等待你的第一个想法"}
          </span>
        </div>
      </nav>
      {connectionState === "login" && (
        <div className="authbar">
          <ShieldCheck size={18} />
          <span>
            首次连接请填写本地访问令牌；此浏览器将记住登录，重启服务后仍然有效。
          </span>
          <input
            aria-label="本地访问令牌"
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
          <button
            onClick={async () => {
              try {
                await api("session", { token });
                setToken("");
                await refresh();
                setError("");
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            连接
          </button>
        </div>
      )}
      {error && (
        <div role="alert" className="errorbar">
          {error}
          <button aria-label="关闭错误" onClick={() => setError("")}>
            <X size={14} />
          </button>
        </div>
      )}
      <main>
        {!ready ? (
          <section className="connection-gate" aria-live="polite">
            <ShieldCheck size={36} />
            <h2>
              {connectionState === "checking"
                ? "正在加载工作台"
                : connectionState === "login"
                  ? "连接后查看已有项目"
                  : "暂时无法连接本地服务"}
            </h2>
            <p>
              {connectionState === "login"
                ? "当前浏览器尚未登录，项目数据尚未加载。使用终端中的带令牌链接或在上方填写令牌即可继续。"
                : connectionState === "checking"
                  ? "正在检查此浏览器的登录并读取项目。"
                  : "服务恢复后，点击重试即可读取原项目。"}
            </p>
            {connectionState === "unavailable" && (
              <button
                className="primary"
                onClick={() => {
                  setConnectionState("checking");
                  setError("");
                  refresh().catch(connectionFailed);
                }}
              >
                重试连接
              </button>
            )}
          </section>
        ) : (
          <>
            <WorkPreview
              project={project}
              node={currentNode}
              selected={selected}
              select={(id) => {
                setSelected(id);
                setDetailsOpen(false);
              }}
              details={() => {
                if (currentNode) {
                  setSelected(currentNode.id);
                  setInputIds(
                    currentNode.status === "done" ? [currentNode.id] : [],
                  );
                  setDetailsOpen(true);
                }
              }}
              answers={answers}
              setAnswer={(id, value) =>
                setAnswers((a) => ({ ...a, [id]: value }))
              }
              confirm={() => {
                setSelected(undefined);
                act("answers", { answers });
              }}
              continueWithGaps={(projectId, reason) => {
                setSelected(undefined);
                void act("continue-with-gaps", { projectId, reason });
              }}
              pending={pending}
            />
            <section className="graph-pane">
              <div className="pane-head">
                <span>
                  <Network size={16} />
                  协作流程 <small>AGENT CANVAS</small>
                </span>
                <div className="graph-controls">
                  <button
                    aria-pressed={expandedHistory}
                    onClick={() => {
                      setExpandedHistory((v) => !v);
                      setPositions({});
                      setOffset({ x: 35, y: 65 });
                    }}
                    title="仅折叠展示，完整调用和模型上下文不变"
                  >
                    {expandedHistory ? "收拢历史" : "展开管理与重试"}
                  </button>
                  <button
                    title="重置画布"
                    onClick={() => {
                      setPositions({});
                      setOffset({ x: 35, y: 65 });
                      setZoom(0.78);
                    }}
                  >
                    <RotateCcw size={15} />
                  </button>
                  <button
                    className="wire-toggle"
                    aria-pressed={allWires}
                    onClick={() => setAllWires((value) => !value)}
                    title="切换主要依赖或全部历史连线；完整输入始终保留在调用详情中"
                  >
                    {allWires ? "全部连线" : "主要依赖"} · {edges.length}
                  </button>
                  <button
                    title="缩小"
                    onClick={() => setZoom((z) => Math.max(0.2, z - 0.1))}
                  >
                    <ZoomOut size={15} />
                  </button>
                  <span>{Math.round(zoom * 100)}%</span>
                  <button
                    title="放大"
                    onClick={() => setZoom((z) => Math.min(1.8, z + 0.1))}
                  >
                    <ZoomIn size={15} />
                  </button>
                  <button title="适应画布" onClick={fit}>
                    <Focus size={15} />
                  </button>
                </div>
              </div>
              <div
                className="canvas"
                ref={canvas}
                onPointerDown={(e) => {
                  if (
                    e.button === 0 &&
                    !(e.target as HTMLElement).closest(
                      ".agent-node, button, summary, details",
                    )
                  ) {
                    drag.current = {
                      x: e.clientX,
                      y: e.clientY,
                      origin: offset,
                    };
                    e.currentTarget.setPointerCapture(e.pointerId);
                  }
                }}
                onPointerMove={(e) => {
                  const d = drag.current;
                  if (!d) return;
                  const dx = e.clientX - d.x,
                    dy = e.clientY - d.y;
                  if (Math.hypot(dx, dy) < 5 && !d.moved) return;
                  d.moved = true;
                  if (d.id)
                    setPositions((p) => ({
                      ...p,
                      [d.id!]: {
                        x: d.origin.x + dx / zoom,
                        y: d.origin.y + dy / zoom,
                      },
                    }));
                  else setOffset({ x: d.origin.x + dx, y: d.origin.y + dy });
                }}
                onPointerUp={() => {
                  const d = drag.current;
                  if (d?.id && !d.moved) {
                    setSelected(d.id);
                    setInputIds(
                      nodes.find((n) => n.id === d.id)?.status === "done"
                        ? [d.id]
                        : [],
                    );
                    setActiveTab("summary");
                    setExtraInstruction("");
                  }
                  drag.current = undefined;
                }}
                onPointerCancel={() => (drag.current = undefined)}
              >
                {stageHistory && (
                  <button
                    className="stage-history-clear"
                    onClick={() => setStageHistory(undefined)}
                  >
                    查看全部历史
                  </button>
                )}
                {!expandedHistory && overview.history.length > 0 && (
                  <details className="graph-history" open={!!stageHistory}>
                    <summary>
                      管理与历史轨迹 · {overview.history.length} 次 ·{" "}
                      {
                        overview.history.filter((n) => n.status === "error")
                          .length
                      }{" "}
                      次失败（仅展示折叠）
                    </summary>
                    <div>
                      {overview.history
                        .filter(
                          (n) =>
                            !stageHistory || designerStage(n) === stageHistory,
                        )
                        .map((n) => (
                          <button
                            key={n.id}
                            onClick={() => {
                              setSelected(n.id);
                              setDetailsOpen(true);
                            }}
                          >
                            {nodes.indexOf(n) + 1} · {roleNames[n.role]} ·{" "}
                            {n.title} ·{" "}
                            {n.status === "error"
                              ? "失败"
                              : n.status === "done"
                                ? "已返回"
                                : "执行中"}
                          </button>
                        ))}
                    </div>
                  </details>
                )}
                <div className="canvas-label">
                  <span className="live-dot" />
                  {project ? "LIVE WORKFLOW" : "AWAITING FIRST REQUEST"}
                  <small>
                    {project
                      ? expandedHistory
                        ? "完整调用轨迹"
                        : "成果阶段与真实工程依赖"
                      : "流程由产品经理按需组织"}
                  </small>
                </div>
                {!nodes.length && (
                  <div className="graph-empty">
                    <div className="manager-symbol">◎</div>
                    <span className="eyebrow">
                      PRODUCT MANAGER ORCHESTRATION
                    </span>
                    <h2>流程，从你的需求开始生长</h2>
                    <p>
                      产品经理会委派合适的专家，观察结果，再决定下一步。
                      <br />
                      这里只记录真实发生的调用，没有预设的七步流程。
                    </p>
                    <div className="manager-loop">
                      <span>产品经理决策</span>
                      <span>→</span>
                      <span>专家执行</span>
                      <span>→</span>
                      <span>结果回流</span>
                    </div>
                  </div>
                )}
                <div
                  className="graph-world"
                  style={{
                    transform: `translate(${offset.x}px,${offset.y}px) scale(${zoom})`,
                  }}
                >
                  <svg className="wires" width="12000" height="12000">
                    {edges.map((edge) => {
                      const a = layout[edge.from],
                        b = layout[edge.to];
                      if (!a || !b) return null;
                      return (
                        <path
                          key={`${edge.from}-${edge.to}`}
                          data-kind={edge.kind}
                          className={
                            nodes.find((n) => n.id === edge.to)?.status ===
                            "done"
                              ? "done"
                              : ""
                          }
                          d={`M ${a.x + 232} ${a.y + 68} C ${a.x + 265} ${a.y + 68}, ${b.x - 45} ${b.y + 68}, ${b.x} ${b.y + 68}`}
                        />
                      );
                    })}
                  </svg>
                  {visibleNodes.map((n) => (
                    <article
                      key={n.id}
                      className={`agent-node ${n.role} ${n.status} ${selected === n.id ? "selected" : ""} ${project ? "" : "blueprint"}`}
                      style={{ left: layout[n.id]?.x, top: layout[n.id]?.y }}
                      tabIndex={0}
                      role="button"
                      aria-label={`${roleNames[n.role]}：${n.title}`}
                      onKeyDown={(e) => {
                        if (
                          e.target === e.currentTarget &&
                          (e.key === "Enter" || e.key === " ")
                        ) {
                          e.preventDefault();
                          setSelected(n.id);
                          setDetailsOpen(true);
                        }
                      }}
                      onDoubleClick={() => {
                        setSelected(n.id);
                        setDetailsOpen(true);
                      }}
                      onPointerDown={(e) => {
                        if (
                          e.button !== 0 ||
                          (e.target as HTMLElement).closest("button")
                        )
                          return;
                        e.stopPropagation();
                        drag.current = {
                          id: n.id,
                          x: e.clientX,
                          y: e.clientY,
                          origin: layout[n.id],
                        };
                        e.currentTarget.setPointerCapture(e.pointerId);
                      }}
                    >
                      {!expandedHistory &&
                        n.role === "designer" &&
                        designerStage(n) && (
                          <button
                            className="stage-history-link"
                            onClick={(e) => {
                              e.stopPropagation();
                              setStageHistory(designerStage(n));
                            }}
                          >
                            {designerStageNames[designerStage(n)!]} ·
                            展开阶段历史
                          </button>
                        )}
                      <div className="node-top">
                        <span className="node-role-icon">
                          {roleIcons[roles.indexOf(n.role)]}
                        </span>
                        <span>{roleNames[n.role]}</span>
                        <span className="node-number">
                          {String(
                            nodes.findIndex((item) => item.id === n.id) + 1,
                          ).padStart(2, "0")}
                        </span>
                      </div>
                      <div className="node-body">
                        <h4>{n.title}</h4>
                        <span>
                          {n.status === "running" ? (
                            <>
                              <LoaderCircle size={12} className="spin" />
                              {n.imageEvidence?.length
                                ? `已生成 ${n.imageEvidence.length} 幅 · 继续执行`
                                : "正在执行"}
                            </>
                          ) : n.status === "done" ? (
                            <>
                              <Check size={12} />
                              提案已返回
                            </>
                          ) : n.status === "error" ? (
                            n.imageEvidence?.length ? (
                              `已保存 ${n.imageEvidence.length} 幅 · 调用中断`
                            ) : (
                              "调用失败"
                            )
                          ) : project ? (
                            "等待依赖"
                          ) : (
                            "尚未调用"
                          )}
                        </span>
                      </div>
                      {!expandedHistory &&
                        n.inputs.some(
                          (id) =>
                            nodes.some(
                              (parent) =>
                                parent.id === id &&
                                parent.role !== "coordinator",
                            ) &&
                            !visibleNodes.some((parent) => parent.id === id),
                        ) && (
                          <button
                            className="reveal-inputs"
                            onClick={(e) => {
                              e.stopPropagation();
                              setRevealedInputs((ids) => [...ids, n.id]);
                            }}
                          >
                            展开历史工程输入
                          </button>
                        )}
                      <div className="node-footer">
                        <span>{n.inputs.length} 输入汇聚</span>
                        <span>
                          {n.packet
                            ? channels.filter((c) => n.packet!.data[c].length)
                                .length
                            : "5"}{" "}
                          类数据 · 1 包
                        </span>
                      </div>
                      <span
                        className="port in"
                        title="共享协议输入，多条连线汇聚"
                      />
                      <span
                        className="port out"
                        title="版本化五通道数据包输出"
                      />
                    </article>
                  ))}
                </div>
                <div className="canvas-help">
                  <MousePointer2 size={13} />
                  点击选择 · 拖动移动
                  <span>双指滑动平移 · 捏合缩放 · 双击详情</span>
                </div>
                <div className="canvas-key">
                  <i />
                  协议包连线 <span>v1</span>
                </div>
              </div>
              <div className="channel-strip">
                <span>数据通道</span>
                {channels.map((c, i) => (
                  <span key={c}>
                    <i className={`channel-dot c${i}`} />
                    {channelNames[c]}
                  </span>
                ))}
                <Code2 size={14} />
              </div>
            </section>
          </>
        )}
      </main>
      {ready && (
        <footer className="composer">
          <div className="composer-icon">
            <Plus size={20} />
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (brief.trim() && !pending && project?.phase !== "choices") {
                setPositions({});
                setAnswers({});
                setSelected(undefined);
                if (project)
                  act("request", { instruction: brief.trim(), inputs: [] });
                else act("start", { brief: brief.trim() });
                setBrief("");
              }
            }}
          >
            <input
              aria-label="产品需求"
              placeholder={
                project
                  ? "补充需求、反馈或调整，由产品经理决定如何继续…"
                  : "描述你想做的产品，比如：一个适合长时间办公的无线鼠标…"
              }
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              maxLength={6000}
              disabled={pending || project?.phase === "choices"}
            />
            <span className="composer-hint">
              {busy
                ? "专家正在工作，你可以查看每个节点"
                : "从需求开始 · 由协调者编排"}
            </span>
            <button
              className="primary"
              disabled={
                !ready ||
                pending ||
                !brief.trim() ||
                project?.phase === "choices"
              }
              type="submit"
            >
              {busy ? (
                <LoaderCircle size={15} className="spin" />
              ) : (
                <Play size={13} />
              )}
              {busy ? "追加给产品经理" : project ? "交给产品经理" : "开始探索"}
            </button>
          </form>
        </footer>
      )}
      <div className="statusbar">
        <span>
          <span className="live-dot" />
          Pi SDK · 独立调用
        </span>
        <span>审查为建议 · 人工决策通过认证路由</span>
        <span>DREAMATIC WORKBENCH / 01</span>
      </div>
      {selectedNode && detailsOpen && (
        <>
          <div
            className="inspector-backdrop"
            onClick={() => setDetailsOpen(false)}
          />
          <aside className="inspector">
            <div className="inspector-head">
              <span>{roleNames[selectedNode.role]}</span>
              <button title="关闭详情" onClick={() => setDetailsOpen(false)}>
                <X size={18} />
              </button>
            </div>
            <span className="eyebrow">INVOCATION DETAILS</span>
            <h2>{selectedNode.title}</h2>
            <p className="inspector-id">{selectedNode.id}</p>
            {selectedNode.model && (
              <p className="inspector-id">
                请求模型：{selectedNode.model.id} ·{" "}
                {selectedNode.model.provider}
              </p>
            )}
            {!!selectedNode.protocolRepairs && (
              <p className="inspector-id">
                本次调用内修复协议 {selectedNode.protocolRepairs} 次
              </p>
            )}
            {!!selectedNode.toolActivity?.length && (
              <details className="hardware-evidence-details">
                <summary>
                  实际工具记录 · {selectedNode.toolActivity.length}
                </summary>
                <pre>{JSON.stringify(selectedNode.toolActivity, null, 2)}</pre>
              </details>
            )}
            {!!selectedNode.hardwareEvidence?.length && (
              <details className="hardware-evidence-details">
                <summary>
                  本次读取的真实硬件证据 ·{" "}
                  {selectedNode.hardwareEvidence.length}
                </summary>
                {selectedNode.hardwareEvidence
                  .flatMap((p) => p.data.structure)
                  .filter((i) => i.kind === "hardware-record")
                  .map((i) => (
                    <p key={i.id}>
                      {i.label}
                      <br />
                      <small>
                        {String(i.properties.source)} ·{" "}
                        {String(i.properties.revision).slice(0, 16)}
                      </small>
                    </p>
                  ))}
                <pre>
                  {JSON.stringify(selectedNode.hardwareEvidence, null, 2)}
                </pre>
              </details>
            )}
            <div className="inspector-tabs">
              <button
                className={activeTab === "summary" ? "active" : ""}
                onClick={() => setActiveTab("summary")}
              >
                工作结果
              </button>
              <button
                className={activeTab === "protocol" ? "active" : ""}
                onClick={() => setActiveTab("protocol")}
              >
                输入 / 输出协议
              </button>
            </div>
            {activeTab === "summary" ? (
              <>
                <div className="info-notice">
                  {selectedNode.role === "reviewer" ? (
                    "独立意见仅供参考；专家可保留不同结论。"
                  ) : (
                    <ExecutionNotice node={selectedNode} />
                  )}
                </div>
                <AssemblyEvidence node={selectedNode} />
                <p className="node-summary">
                  {selectedNode.packet?.summary ||
                    selectedNode.error ||
                    "此节点尚无输出。真实调用后会在这里显示工作结果。"}
                </p>
                {selectedNode.packet &&
                  channels.map(
                    (c) =>
                      selectedNode.packet!.data[c].length > 0 && (
                        <section className="result-channel" key={c}>
                          <h4>{channelNames[c]}</h4>
                          {selectedNode.packet!.data[c].map((i) => (
                            <details key={i.id}>
                              <summary>
                                {i.label}
                                <small>{i.kind}</small>
                              </summary>
                              <pre>{JSON.stringify(i, null, 2)}</pre>
                            </details>
                          ))}
                        </section>
                      ),
                  )}
              </>
            ) : (
              <>
                <div className="protocol-filters">
                  {["all", ...channels].map((c) => (
                    <button
                      className={channel === c ? "active" : ""}
                      key={c}
                      onClick={() => setChannel(c)}
                    >
                      {c === "all"
                        ? "全部"
                        : channelNames[c as keyof typeof channelNames]}
                    </button>
                  ))}
                </div>
                <h4>输入 · 同类汇聚</h4>
                <pre>
                  {JSON.stringify(
                    selectedNode.packet?.inputs
                      .map((id) =>
                        [project?.intake, project?.selection, ...packets].find(
                          (p) => p?.id === id,
                        ),
                      )
                      .filter(Boolean) ||
                      selectedNode.inputs.flatMap((id) => {
                        const p = nodes.find((n) => n.id === id)?.packet;
                        return p ? [p] : [];
                      }),
                    null,
                    2,
                  )}
                </pre>
                <h4>
                  输出 ·{" "}
                  {selectedNode.packet?.version || "dreamatic.workbench/1"}
                </h4>
                <pre>
                  {JSON.stringify(
                    selectedNode.packet
                      ? channel === "all"
                        ? selectedNode.packet
                        : {
                            [channel]:
                              selectedNode.packet.data[
                                channel as keyof typeof channelNames
                              ],
                          }
                      : { status: "waiting" },
                    null,
                    2,
                  )}
                </pre>
              </>
            )}
            <section className="followup">
              <h4>向产品经理提出调整</h4>
              <p>选中的结果与补充要求会交给产品经理，由其决定调用哪位专家。</p>
              <textarea
                aria-label="补充指令"
                placeholder="补充需求、比较另一组方案，或反馈审查意见…"
                value={extraInstruction}
                onChange={(e) => setExtraInstruction(e.target.value)}
                maxLength={6000}
              />
              <fieldset>
                <legend>参考已有结果</legend>
                {project?.nodes
                  .filter((n) => n.status === "done")
                  .map((n) => (
                    <label key={n.id}>
                      <input
                        type="checkbox"
                        checked={inputIds.includes(n.id)}
                        onChange={(e) =>
                          setInputIds((ids) =>
                            e.target.checked
                              ? [...ids, n.id]
                              : ids.filter((id) => id !== n.id),
                          )
                        }
                      />
                      {n.title}
                    </label>
                  ))}
              </fieldset>
              <button
                className="primary"
                disabled={
                  busy ||
                  !extraInstruction.trim() ||
                  project?.phase === "choices"
                }
                onClick={() =>
                  act("request", {
                    instruction: extraInstruction,
                    inputs: inputIds,
                  })
                }
              >
                提交产品经理
                <ArrowUpRight size={14} />
              </button>
            </section>
          </aside>
        </>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);

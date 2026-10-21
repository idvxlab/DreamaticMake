import { ReviewReport } from "./components/ReviewReport";
import { ChatResizeHandle, readChatWidth } from "./components/ChatResizeHandle";
import { StageProgress } from "./components/StageProgress";
import { StageStart } from "./components/StageStart";
import { choiceQuestions } from "../../../packages/core/src/choice-questions";
import { t, useLanguage, setLanguage } from "./i18n";
import { MarkdownMessage } from "./components/MarkdownMessage";
import { toolActivityLabel } from "../../../packages/core/src/tool-activity";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  lazy,
  Suspense,
} from "react";
import {
  Plus,
  Trash2,
  Search,
  Settings,
  ArrowUp,
  Square,
  Paperclip,
  ChevronRight,
  Check,
  Box,
  Layers3,
  PanelRightClose,
  PanelRightOpen,
  Download,
  ArrowRight,
  Activity,
  FolderOpen,
  LayoutDashboard,
  Cpu,
  MessageSquare,
  Sparkles,
  LoaderCircle,
  X,
  Archive,
  RotateCcw,
  Image,
  FileCode2,
  Pencil,
  BookOpen,
} from "lucide-react";
import {
  stages,
  stageLabels,
  roleForStage,
  type StageId,
  type Project,
  type Enclosure,
  type Part,
  type Event,
} from "../../../packages/core/src/contracts";
import { api, type ProjectView, type Upload, type SettingsView } from "./api";
import {
  QuestionCard,
  ChoiceCards,
  ApprovalCard,
  ParameterEditor,
  ArtifactList,
  ArtifactPreview,
  StructuralEditor,
} from "./components/Interactions";
import { BrandMenu } from "./components/BrandMenu";
import { SettingsDialog } from "./components/SettingsDialog";
const ModelViewer = lazy(() =>
  import("./components/ModelViewer").then((m) => ({ default: m.ModelViewer })),
);
const DesignWorkbench = lazy(() =>
  import("./components/DesignWorkbench").then((m) => ({
    default: m.DesignWorkbench,
  })),
);
const statusLabels: Record<string, string> = {
  not_started: "尚未开始",
  running: "正在执行",
  awaiting_confirmation: "等待确认",
  approved: "已确认",
  failed: "执行失败",
  stale: "需要重新审阅",
};
const agentNames: Record<string, string> = {
  orchestrator: "项目协调",
  analyst: "需求分析",
  "hardware-engineer": "电子硬件",
  "industrial-designer": "工业设计",
  "mechanical-engineer": "结构工程",
  "cad-engineer": "CAD 工程",
  "firmware-engineer": "固件工程",
  reviewer: "工程审阅",
};
const suggestions = [
  {
    title: "桌面环境终端",
    text: "设计一个 USB 供电的桌面环境显示终端，使用已有开源主控和传感器，3D 打印外壳。先和我确认需求与预算。",
    icon: Cpu,
  },
  {
    title: "专注计时器",
    text: "我想做一个桌面专注计时器，有旋钮和小屏幕，使用现成开发板，外壳可以在家里 3D 打印。",
    icon: Activity,
  },
  {
    title: "从外壳开始",
    text: "我想从一个 90×65×35mm 的打印外壳开始，壁厚 2mm，后续选择适配的开源硬件。",
    icon: Box,
  },
];
export function App() {
  const language = useLanguage();
  const [revisionOpen, setRevisionOpen] = useState(false),
    [revisionText, setRevisionText] = useState("");
  const [list, setList] = useState<Project[]>([]),
    [project, setProject] = useState<ProjectView>(),
    [selected, setSelected] = useState(""),
    [stage, setStage] = useState<StageId>("requirements"),
    [tab, setTab] = useState("overview"),
    [search, setSearch] = useState(""),
    [archived, setArchived] = useState(false),
    [settings, setSettings] = useState(false),
    [newProject, setNewProject] = useState(false),
    [name, setName] = useState(""),
    [brief, setBrief] = useState(""),
    [text, setText] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [chat, setChat] = useState(true),
    [chatWidth, setChatWidth] = useState(readChatWidth),
    [events, setEvents] = useState<Event[]>([]),
    [live, setLive] = useState(""),
    [catalog, setCatalog] = useState<Part[]>([]),
    [agents, setAgents] = useState<any[]>([]),
    [parameters, setParameters] = useState<Enclosure>(),
    [uploads, setUploads] = useState<Upload[]>([]),
    [width, setWidth] = useState(90),
    [imageId, setImageId] = useState(""),
    [candidate, setCandidate] = useState<any>(),
    [cadText, setCadText] = useState(""),
    [rename, setRename] = useState(false),
    [deleteOpen, setDeleteOpen] = useState(false),
    [deleteName, setDeleteName] = useState(""),
    [history, setHistory] = useState<any[]>([]),
    [measure, setMeasure] = useState(false),
    [measurementId, setMeasurementId] = useState("rpi-pico"),
    [measuredWidth, setMeasuredWidth] = useState(21),
    [measuredDepth, setMeasuredDepth] = useState(51),
    [measuredHeight, setMeasuredHeight] = useState(5),
    [measureNote, setMeasureNote] = useState("");
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const scroll = useRef<HTMLDivElement>(null),
    fileInput = useRef<HTMLInputElement>(null);
  const current = project?.stages[stage];
  const pendingQuestion = project?.messages.find(
    (message) => message.interaction && !message.interaction.answers,
  )?.interaction;
  const refreshList = useCallback(
    async () => setList(await api("/projects")),
    [],
  );
  const refresh = useCallback(async (id: string) => {
    const next = await api<ProjectView>("/projects/" + id);
    if (selectedRef.current !== id) return;
    setProject(next);
    setParameters((old) => old ?? next.parameters);
  }, []);
  useEffect(() => {
    void api<SettingsView>("/settings")
      .then((view) => {
        setLanguage(
          view.fields.find((field) => field.key === "MAKE_LANGUAGE")?.value ??
            "zh",
        );
      })
      .catch((e) => setError(e.message));
    void refreshList().catch((e) => setError(e.message));
    void api<Part[]>("/catalog")
      .then(setCatalog)
      .catch((e) => setError(e.message));
    void api<any[]>("/agents")
      .then(setAgents)
      .catch((e) => setError(e.message));
  }, [refreshList]);
  useEffect(() => {
    if (!selected) {
      setProject(undefined);
      return;
    }
    let disposed = false;
    setProject(undefined);
    setParameters(undefined);
    setEvents([]);
    setLive("");
    setUploads([]);
    setCandidate(undefined);
    void api<ProjectView>("/projects/" + selected)
      .then((p) => {
        if (!disposed) {
          setProject(p);
          setParameters(p.parameters);
          setStage(p.currentStage ?? "delivery");
        }
      })
      .catch((e) => setError(e.message));
    void api<Part[]>(`/projects/${selected}/catalog`)
      .then((parts) => {
        if (!disposed) setCatalog(parts);
      })
      .catch((e) => {
        if (!disposed) setError(e.message);
      });
    void api<Upload[]>(`/projects/${selected}/uploads`).then((v) => {
      if (!disposed) setUploads(v);
    });
    const source = new EventSource(`/api/projects/${selected}/events`);
    let timer: ReturnType<typeof setTimeout> | undefined;
    source.onmessage = (e) => {
      const event = JSON.parse(e.data) as Event;
      if (event.type === "project.deleted") {
        source.close();
        setSelected("");
        setProject(undefined);
        void refreshList();
        return;
      }
      if (disposed) return;
      if (event.type === "agent.delta")
        setLive((s) => (s + (event.payload as any).text).slice(-1800));
      else {
        setEvents((previous) =>
          [...previous.filter((e) => e.id !== event.id), event].slice(-100),
        );
        if (event.type === "project.updated") {
          clearTimeout(timer);
          timer = setTimeout(() => {
            void refresh(selected)
              .then(refreshList)
              .catch((e) => setError(e.message));
          }, 120);
        }
      }
    };
    source.onerror = () => {};
    return () => {
      disposed = true;
      clearTimeout(timer);
      source.close();
    };
  }, [selected, refresh, refreshList]);
  useEffect(() => {
    scroll.current?.scrollTo({
      top: scroll.current.scrollHeight,
      behavior: "smooth",
    });
  }, [project?.messages.length, live]);
  async function action(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      if (selectedRef.current) await refresh(selectedRef.current);
      await refreshList();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function create() {
    await action(async () => {
      const p = await api<ProjectView>("/projects", "POST", { name, brief });
      setSelected(p.id);
      setNewProject(false);
      setName("");
      setBrief("");
      setTab("overview");
    });
  }
  async function run() {
    if (!project) return;
    setLive("");
    await api(`/projects/${project.id}/run`, "POST", {});
  }
  function selectChoice(choice: string) {
    if (!project || !current || current.draft?.selectedChoice === choice)
      return;
    void action(async () => {
      await api(`/projects/${project.id}/choice`, "POST", {
        stage,
        revision: current.revision,
        choice,
      });
      await run();
    });
  }
  async function decision(
    decision: "approved" | "changes_requested",
    comment?: string,
  ) {
    if (!project || !current) return;
    await action(async () => {
      await api(`/projects/${project.id}/approvals`, "POST", {
        stage,
        revision: current.revision,
        inputHash: project.hashes[stage],
        decision,
        comment,
        key: crypto.randomUUID(),
      });
      const p = await api<ProjectView>("/projects/" + project.id);
      setStage(p.currentStage ?? stage);
      setTab("overview");
      if (p.currentStage) await api(`/projects/${project.id}/run`, "POST", {});
    });
  }
  async function send() {
    if (!text.trim() || !project) return;
    const content = text;
    setText("");
    await action(async () => {
      await api(`/projects/${project.id}/messages`, "POST", {
        text: content,
        mode: "steer",
        attachments: uploads.slice(-5).map((u) => u.id),
      });
      if (!project.running && current?.status !== "approved") await run();
    });
  }
  async function upload(file: File) {
    if (!project) return;
    await action(async () => {
      const data = await new Promise<string>((accept, reject) => {
        const reader = new FileReader();
        reader.onload = () => accept(String(reader.result).split(",")[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const result = await api<Upload>(
        `/projects/${project.id}/uploads`,
        "POST",
        { name: file.name, mime: file.type || "text/plain", data },
      );
      setUploads((u) => [...u, result]);
      setImageId(result.id);
    });
  }
  function openWorkbench() {
    selectedRef.current = "";
    setSelected("");
    setProject(undefined);
    setParameters(undefined);
    setEvents([]);
    setLive("");
    setUploads([]);
    setCandidate(undefined);
    setError("");
    setTab("overview");
    setArchived(false);
    setSearch("");
  }
  const visible = list.filter(
    (p) =>
      p.archived === archived &&
      p.name.toLowerCase().includes(search.toLowerCase()),
  );
  const isRunning = project?.running || busy;
  const artifacts = project
    ? Object.values(project.stages).flatMap((s) => s.artifacts)
    : [];
  const tools = events.filter(
    (e) => e.type.startsWith("tool.") || e.type === "agent.started",
  );
  const latestTool = tools.at(-1);
  const approved = project
    ? stages.filter((id) => project.stages[id].status === "approved").length
    : 0;
  const activePart = catalog.find((p) => p.id === measurementId);
  return (
    <div
      className={`app-shell ${chat ? "" : "chat-hidden"}`}
      style={
        chatWidth
          ? ({ "--chat-width": `${chatWidth}px` } as React.CSSProperties)
          : undefined
      }
    >
      <aside className="sidebar">
        <BrandMenu
          onSettings={() => setSettings(true)}
          onWorkbench={openWorkbench}
        />
        <button
          className="new-project"
          onClick={() => {
            setNewProject(true);
            setName("");
            setBrief("");
          }}
        >
          <Plus size={16} />
          {t("新建项目")}
          <span>⌘ N</span>
        </button>
        <label className="search">
          <Search size={14} />
          <input
            aria-label={t("搜索项目")}
            placeholder={t("搜索项目")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <button
          className={`nav-item workbench-nav ${!selected ? "active" : ""}`}
          aria-label={t("工作台")}
          title={t("工作台")}
          aria-current={!selected ? "page" : undefined}
          onClick={openWorkbench}
        >
          <LayoutDashboard size={16} />
          {t("工作台")}{" "}
        </button>
        <div className="nav-caption">WORKSPACE</div>
        <button
          className={`nav-item ${selected && !archived ? "active" : ""}`}
          onClick={() => setArchived(false)}
        >
          <FolderOpen size={16} />
          {t("我的项目")}
          <span>{list.filter((p) => !p.archived).length}</span>
        </button>
        <button
          className={`nav-item ${selected && archived ? "active" : ""}`}
          onClick={() => setArchived(true)}
        >
          <Archive size={16} />
          {t("已归档")}
          <span>{list.filter((p) => p.archived).length}</span>
        </button>
        <div className="nav-caption project-caption">
          {archived ? "ARCHIVED PROJECTS" : "RECENT PROJECTS"}
        </div>
        <div className="project-list">
          {visible.map((p) => (
            <button
              key={p.id}
              className={`project-row ${selected === p.id ? "selected" : ""}`}
              onClick={() => {
                setSelected(p.id);
                setTab("overview");
              }}
            >
              <div className="project-icon">
                <Box size={17} />
              </div>
              <div>
                <strong>{p.name}</strong>
                <small>
                  {p.running
                    ? t("正在执行")
                    : t(
                        stageLabels[
                          stages.find(
                            (s) => p.stages[s].status !== "approved",
                          ) ?? "delivery"
                        ],
                      )}
                </small>
              </div>
              {p.running && <LoaderCircle size={13} className="spin" />}
            </button>
          ))}
          {!visible.length && (
            <p className="no-projects">
              {archived ? t("还没有归档项目") : t("从一个想法开始你的项目")}
            </p>
          )}
        </div>
        <div className="sidebar-note">
          <div className="local-dot" />
          {t("本地工作空间")}
          <small>{t("开源硬件 + 3D 打印")}</small>
        </div>
        <div className="sidebar-footer">
          <span>DM</span>
          <div>
            Maker workspace<small>Pi harness · v1.3.0</small>
          </div>
          <i>LOCAL</i>
        </div>
      </aside>
      <main className="workspace">
        <header className="workspace-header">
          <div>
            <span className="breadcrumb">{t("工作空间")}</span>
            <ChevronRight size={13} />
            {project ? (
              <button className="project-title" onClick={() => setRename(true)}>
                {project.name}
                <Pencil size={12} />
              </button>
            ) : (
              <strong>{t("工作台")}</strong>
            )}
          </div>
          <div className="header-actions">
            {project && (
              <>
                <button
                  aria-label={project.archived ? t("恢复项目") : t("归档项目")}
                  disabled={!!isRunning}
                  onClick={() =>
                    void action(() =>
                      api("/projects/" + project.id, "PATCH", {
                        archived: !project.archived,
                      }),
                    )
                  }
                >
                  {project.archived ? (
                    <RotateCcw size={15} />
                  ) : (
                    <Archive size={15} />
                  )}
                </button>
                <button
                  aria-label={t("彻底删除项目")}
                  title={t("彻底删除项目")}
                  disabled={!!isRunning}
                  onClick={() => {
                    setDeleteName("");
                    setDeleteOpen(true);
                  }}
                >
                  <Trash2 size={15} />
                </button>
                <a
                  className="button"
                  href={`/api/projects/${project.id}/export`}
                >
                  <Download size={14} />
                  <span>{t("导出项目")}</span>
                </a>
              </>
            )}
            <button
              aria-label={chat ? t("收起对话") : t("展开对话")}
              onClick={() => setChat(!chat)}
            >
              {chat ? (
                <PanelRightClose size={17} />
              ) : (
                <PanelRightOpen size={17} />
              )}
            </button>
          </div>
        </header>
        {project ? (
          <>
            <div className="progress-section">
              <div className="progress-top">
                <span>
                  <i className={project.running ? "pulse" : ""} />
                  {project.running
                    ? t("智能体正在工作")
                    : project.archived
                      ? t("项目已归档")
                      : t("项目进度")}
                </span>
                <small>
                  {t("已确认")} <b>{Math.min(approved, 6)}</b>{" "}
                  {t("/ 6 个设计阶段")}{" "}
                </small>
              </div>
              <StageProgress
                project={project}
                selected={stage}
                onSelect={(id) => {
                  setStage(id);
                  setTab("overview");
                }}
              />
            </div>
            <nav className="workspace-tabs">
              {[
                ["overview", t("阶段概览")],
                ["hardware", t("硬件")],
                ["cad", t("CAD 工作台")],
                ["files", t("工程文件")],
                ["agents", t("智能体")],
                ["history", t("历史")],
              ].map(([id, label]) => (
                <button
                  className={tab === id ? "active" : ""}
                  key={id}
                  onClick={() => {
                    setTab(id);
                    if (id === "history")
                      void api<any[]>(`/projects/${project.id}/history`)
                        .then(setHistory)
                        .catch((e) => setError(e.message));
                  }}
                >
                  {label}
                  {id === "files" && artifacts.length > 0 && (
                    <i>{artifacts.length}</i>
                  )}
                </button>
              ))}
              <span>{t(statusLabels[current?.status ?? "not_started"])}</span>
            </nav>
            <div className="workspace-body">
              {tab === "overview" && (
                <>
                  <div className="section-heading">
                    <div>
                      <div className="eyebrow">
                        STAGE{" "}
                        {String(stages.indexOf(stage) + 1).padStart(2, "0")} /
                        08
                      </div>
                      <h1>{t(stageLabels[stage])}</h1>
                      <p>
                        {current?.draft?.title ??
                          t("让每一步设计，都有清晰的依据。")}
                      </p>
                    </div>
                    <span className={`status-chip ${current?.status}`}>
                      {t(statusLabels[current?.status ?? "not_started"])}
                    </span>
                  </div>
                  {current?.draft ? (
                    <>
                      <div className="summary-card">
                        <div className="summary-heading">
                          <span className="summary-icon">
                            <BookOpen size={17} strokeWidth={1.6} />
                          </span>
                          <h2>{t("设计说明")}</h2>
                          <span
                            className="summary-version"
                            aria-label={`${t("版本")} ${current.revision}`}
                          >
                            V{current.revision}
                          </span>
                        </div>
                        <MarkdownMessage text={current.draft.summary} card />
                      </div>
                      {current.draft.choices.length > 0 &&
                        !choiceQuestions(current.draft.choices) && (
                          <ChoiceCards
                            choices={current.draft.choices}
                            selected={current.draft.selectedChoice}
                            disabled={
                              !!isRunning || stage !== project.currentStage
                            }
                            onSelect={selectChoice}
                          />
                        )}
                      <div className="facts-grid">
                        {current.draft.facts.map((f, i) => (
                          <div key={i}>
                            <span>
                              <MarkdownMessage text={f.label} card inline />
                            </span>
                            <MarkdownMessage text={f.value} card />
                          </div>
                        ))}
                      </div>
                      {current.draft.hardwareFeatures?.map((feature) => (
                        <details key={feature.partId} className="assumptions">
                          <summary>
                            {t("硬件物理与空间特征")} · {feature.partId}
                          </summary>
                          <MarkdownMessage
                            text={feature.selectionReason}
                            card
                          />
                          <p>
                            {feature.envelopeMm.width} ×{" "}
                            {feature.envelopeMm.depth} ×{" "}
                            {feature.envelopeMm.height ?? "?"} mm
                          </p>
                          {[
                            ...feature.mounting,
                            ...feature.keepouts,
                            ...feature.motion,
                            ...feature.evidence,
                            ...feature.unknowns,
                          ].map((text, index) => (
                            <MarkdownMessage key={index} text={text} card />
                          ))}
                        </details>
                      ))}
                      {current.draft.engineDesign && (
                        <details className="assumptions">
                          <summary>{t("布局目标与建模约束")}</summary>
                          {current.draft.engineDesign.constraints.map(
                            (constraint) => (
                              <MarkdownMessage
                                key={constraint.id}
                                text={`${constraint.kind} · ${constraint.instanceIds.join(", ")}：${constraint.description}`}
                                card
                              />
                            ),
                          )}
                          {current.draft.engineDesign.checks.map((check) => (
                            <MarkdownMessage
                              key={check.id}
                              text={`${check.id}：${check.requirement}`}
                              card
                            />
                          ))}
                        </details>
                      )}
                      {current.draft.assumptions.length > 0 && (
                        <div className="assumptions">
                          <strong>{t("当前假设")}</strong>
                          {current.draft.assumptions.map((s, i) => (
                            <MarkdownMessage key={i} text={s} card />
                          ))}
                        </div>
                      )}
                      {current.review && (
                        <ReviewReport review={current.review} />
                      )}
                      {["structure", "cad", "appearance"].includes(stage) && (
                        <Suspense fallback={<p>{t("加载 3D 预览…")}</p>}>
                          <ModelViewer
                            parameters={project.parameters}
                            artifacts={project.stages.cad.artifacts}
                            projectId={project.id}
                          />
                        </Suspense>
                      )}
                      <ArtifactList
                        projectId={project.id}
                        artifacts={current.artifacts}
                      />
                    </>
                  ) : (
                    <StageStart
                      stage={stage}
                      active={stage === project.currentStage}
                      running={project.running}
                      busy={busy}
                      archived={project.archived}
                      pending={pendingQuestion}
                      onRun={() => void action(run)}
                      onAnswer={(answers) =>
                        action(async () => {
                          await api(`/projects/${project.id}/answers`, "POST", {
                            interactionId: pendingQuestion!.id,
                            answers,
                          });
                          await run();
                        })
                      }
                    />
                  )}
                  {current?.status === "approved" && (
                    <button
                      className="button rerun"
                      disabled={!!isRunning}
                      onClick={() => {
                        setRevisionText("");
                        setRevisionOpen(true);
                      }}
                    >
                      <Pencil size={14} />
                      {t("修改此阶段")}{" "}
                    </button>
                  )}
                  {current?.error && (
                    <div className="error error-panel">{t(current.error)}</div>
                  )}
                  {current?.draft &&
                    stage === project.currentStage &&
                    current.status !== "approved" && (
                      <button
                        className="button rerun"
                        disabled={!!isRunning || project.archived}
                        onClick={() => void action(run)}
                      >
                        <RotateCcw size={14} />
                        {current.status === "stale"
                          ? t("更新并重新审阅")
                          : t("重新执行当前阶段")}
                      </button>
                    )}
                </>
              )}
              {tab === "hardware" && (
                <>
                  <div className="section-heading">
                    <div>
                      <div className="eyebrow">HARDWARE LIBRARY</div>
                      <h1>{t("从已有硬件出发")}</h1>
                      <p>{t("精确型号、可追溯资料，以及诚实的尺寸状态。")}</p>
                    </div>
                    <Cpu size={28} />
                  </div>
                  {catalog.map((part) => (
                    <article className="part-card" key={part.id}>
                      <div className="part-visual">
                        <Cpu size={52} />
                        <span>{part.manufacturer}</span>
                      </div>
                      <div className="part-info">
                        <div className="card-kicker">
                          {part.openHardware === "verified"
                            ? t("开源许可已核验")
                            : t("开源状态待核验")}
                        </div>
                        <h2>{part.name}</h2>
                        <p>{part.revision}</p>
                        <div className="part-specs">
                          <span>
                            {part.dimensions.width} × {part.dimensions.depth} ×{" "}
                            {part.dimensions.height ?? "?"} mm
                          </span>
                          <span>
                            {part.geometryVerified
                              ? t("实测包络已记录")
                              : t("完整安装几何待核验")}
                          </span>
                        </div>
                        <MarkdownMessage text={part.notes} card />
                        <div className="button-row">
                          <a
                            target="_blank"
                            rel="noreferrer"
                            href={part.source}
                          >
                            {t("查看资料 ↗")}{" "}
                          </a>
                          {
                            <button
                              disabled={!!isRunning}
                              onClick={() => {
                                setMeasurementId(part.id);
                                setMeasuredWidth(part.dimensions.width);
                                setMeasuredDepth(part.dimensions.depth);
                                setMeasuredHeight(part.dimensions.height ?? 5);
                                setMeasureNote("");
                                setMeasure(true);
                              }}
                            >
                              {t("补充实测尺寸")}{" "}
                            </button>
                          }
                        </div>
                      </div>
                    </article>
                  ))}
                  <p className="muted footnote">
                    {t(
                      "部件检索、BOM 与引脚建议由电子硬件智能体生成。未核验的尺寸会阻止工程确认。",
                    )}{" "}
                  </p>
                </>
              )}
              {tab === "cad" && parameters && (
                <>
                  <div className="section-heading">
                    <div>
                      <div className="eyebrow">PRODUCT DESIGN</div>
                      <h1>{t("产品设计与工程验证")}</h1>
                      <p>
                        {t("查看装配与信号，运行模型仿真，继续生成工程 CAD。")}
                      </p>
                    </div>
                    <span className="badge">3D · {t("仿真")} · CAD</span>
                  </div>
                  <Suspense fallback={<p>{t("加载 3D 预览…")}</p>}>
                    <DesignWorkbench
                      key={project.id}
                      projectVersion={project.version}
                      parameters={parameters}
                      artifacts={
                        JSON.stringify(parameters) ===
                        JSON.stringify(project.parameters)
                          ? project.stages.cad.artifacts
                          : []
                      }
                      projectId={project.id}
                    />
                  </Suspense>
                  <div className="cad-panels">
                    <div className="tool-card">
                      <div className="card-kicker">
                        <FileCode2 size={14} />
                        {t("参数化外壳")}{" "}
                      </div>
                      <ParameterEditor
                        value={parameters}
                        onChange={setParameters}
                        disabled={!!isRunning}
                      />
                      <StructuralEditor
                        value={parameters}
                        onChange={setParameters}
                        disabled={!!isRunning}
                        parts={catalog}
                      />
                      <p className="muted">
                        {t(
                          "通用上下壳模板。参数修改会使结构及后续确认失效。开孔、支柱和部件包络可展开编辑；实际装配仍需验证。",
                        )}{" "}
                      </p>
                      <div className="button-row">
                        <button
                          disabled={!!isRunning || project.archived}
                          onClick={() =>
                            void action(() =>
                              api(
                                `/projects/${project.id}/parameters`,
                                "PUT",
                                parameters,
                              ),
                            )
                          }
                        >
                          {t("保存参数")}{" "}
                        </button>
                        <button
                          className="primary"
                          disabled={!!isRunning || project.archived}
                          onClick={() =>
                            void action(async () => {
                              if (
                                JSON.stringify(parameters) !==
                                JSON.stringify(project.parameters)
                              )
                                await api(
                                  `/projects/${project.id}/parameters`,
                                  "PUT",
                                  parameters,
                                );
                              await api(
                                `/projects/${project.id}/cad`,
                                "POST",
                                {},
                              );
                            })
                          }
                        >
                          {busy ? (
                            <LoaderCircle size={14} className="spin" />
                          ) : (
                            <Box size={14} />
                          )}
                          {t("生成 CAD")}{" "}
                        </button>
                      </div>
                    </div>
                    <div className="tool-card">
                      <div className="card-kicker">
                        <Sparkles size={14} />
                        {t("文生 CAD · 图生 CAD")}{" "}
                      </div>
                      <textarea
                        aria-label={t("CAD 设计描述")}
                        placeholder={t(
                          "例如：宽 90mm，深 65mm，高 35mm 的桌面外壳，壁厚 2mm",
                        )}
                        value={cadText}
                        onChange={(e) => setCadText(e.target.value)}
                      />
                      <button
                        disabled={!!isRunning || !cadText.trim()}
                        onClick={() =>
                          void action(async () =>
                            setCandidate(
                              await api(
                                `/projects/${project.id}/text-parameters`,
                                "POST",
                                { instruction: cadText },
                              ),
                            ),
                          )
                        }
                      >
                        {t("从描述提取参数")} <ArrowRight size={14} />
                      </button>
                      <div className="image-divider">{t("或从参考图开始")}</div>
                      <select
                        aria-label={t("参考图片")}
                        value={imageId}
                        onChange={(e) => setImageId(e.target.value)}
                      >
                        <option value="">{t("选择已上传参考图")}</option>
                        {uploads
                          .filter((u) => u.mime.startsWith("image/"))
                          .map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.name}
                            </option>
                          ))}
                      </select>
                      <label className="inline-field">
                        {t("参考外廓宽度")}{" "}
                        <input
                          aria-label={t("参考宽度")}
                          type="number"
                          min="20"
                          max="300"
                          value={width}
                          onChange={(e) => setWidth(+e.target.value)}
                        />
                        mm
                      </label>
                      <button
                        disabled={!!isRunning || !imageId}
                        onClick={() =>
                          void action(async () =>
                            setCandidate(
                              await api(
                                `/projects/${project.id}/image-parameters`,
                                "POST",
                                {
                                  attachmentId: imageId,
                                  referenceWidthMm: width,
                                  instruction: cadText,
                                },
                              ),
                            ),
                          )
                        }
                      >
                        <Image size={14} />
                        {t("理解参考图")}{" "}
                      </button>
                      <p className="muted">
                        {t(
                          "图像用于推断候选外形。单图不能确定内部结构或精确尺寸，必须确认参数后再生成。",
                        )}{" "}
                      </p>
                    </div>
                  </div>
                  {candidate && (
                    <div className="candidate-card">
                      <h3>{t("候选参数 · 等待你确认")}</h3>
                      <ParameterEditor
                        value={candidate.parameters}
                        onChange={(p) =>
                          setCandidate({ ...candidate, parameters: p })
                        }
                      />
                      {[
                        ...candidate.observations,
                        ...candidate.uncertainties,
                      ].map((t: string, i: number) => (
                        <MarkdownMessage key={i} text={t} card />
                      ))}
                      <button
                        className="primary"
                        disabled={!!isRunning}
                        onClick={() => {
                          setParameters(candidate.parameters);
                          setCandidate(undefined);
                        }}
                      >
                        {t("采用为待编辑参数")} <Check size={14} />
                      </button>
                    </div>
                  )}
                  <ArtifactList
                    projectId={project.id}
                    artifacts={project.stages.cad.artifacts}
                  />
                </>
              )}
              {tab === "files" && (
                <>
                  <div className="section-heading">
                    <div>
                      <div className="eyebrow">PROJECT ARTIFACTS</div>
                      <h1>{t("每一个可追溯的成果")}</h1>
                      <p>
                        {t(
                          "源文件、工程模型与执行报告。导出包只包含已确认阶段的文件。",
                        )}{" "}
                      </p>
                    </div>
                  </div>
                  <ArtifactPreview
                    key={project.id + artifacts.map((a) => a.id).join()}
                    projectId={project.id}
                    artifacts={artifacts}
                  />
                  <ArtifactList projectId={project.id} artifacts={artifacts} />
                </>
              )}
              {tab === "history" && (
                <>
                  <div className="section-heading">
                    <div>
                      <div className="eyebrow">PROJECT HISTORY</div>
                      <h1>{t("保留每一步决策")}</h1>
                      <p>{t("阶段、审阅与用户输入的只读版本快照。")}</p>
                    </div>
                  </div>
                  <div className="history-list">
                    {history.map((h) => (
                      <details key={h.version}>
                        <summary>
                          <strong>V{h.version}</strong>
                          <span>
                            {new Date(h.updatedAt).toLocaleString(
                              language === "en" ? "en-US" : "zh-CN",
                            )}
                          </span>
                          <small>
                            {h.messageCount} {t("条消息")}
                          </small>
                        </summary>
                        {h.stages.map((s: any) => (
                          <p key={s.id}>
                            <b>{t(stageLabels[s.id as StageId])}</b>
                            <span>
                              {t(statusLabels[s.status])} · V{s.revision}
                            </span>
                            {s.title && <small>{s.title}</small>}
                          </p>
                        ))}
                      </details>
                    ))}
                  </div>
                </>
              )}
              {tab === "agents" && (
                <>
                  <div className="section-heading">
                    <div>
                      <div className="eyebrow">SPECIALISTS, SHARED CONTEXT</div>
                      <h1>{t("各司其职，共同设计")}</h1>
                      <p>
                        {t("独立 MD 定义角色、输入输出、工具权限与停止条件。")}
                      </p>
                    </div>
                  </div>
                  <div className="agent-grid">
                    {agents.map((a) => (
                      <details className="agent-card" key={a.id}>
                        <summary>
                          <div className="agent-avatar">
                            <Cpu size={18} />
                          </div>
                          <strong>{t(a.name)}</strong>
                          <small>{a.mode}</small>
                        </summary>
                        <code>{a.id}.md</code>
                        <div className="tool-tags">
                          {a.allowed_tools.map((t: string) => (
                            <span key={t}>{t}</span>
                          ))}
                        </div>
                        <MarkdownMessage text={a.prompt} card />
                      </details>
                    ))}
                  </div>
                  <div className="assumptions">
                    <strong>{t("合作协议")}</strong>
                    <p>
                      {t(
                        "阶段作者提交 → 独立审阅 → 用户确认 → 下一阶段。所有结果绑定项目与版本，智能体无用户审批权限。",
                      )}{" "}
                    </p>
                  </div>
                </>
              )}
            </div>
          </>
        ) : (
          <div className="welcome">
            <div className="welcome-kicker">
              <span />
              YOUR NEXT OBJECT STARTS HERE
            </div>
            <div className="welcome-mark">
              <Layers3 size={43} />
            </div>
            <h1>
              {t("让想法，")} <br />
              {t("成为手中的实物")}
              <span>{t("。")}</span>
            </h1>
            <p>
              {t("从开源硬件到打印外壳，从第一句想法到可运行的原型。")} <br />
              {t("你的智能终端设计工作台。")}{" "}
            </p>
            <button className="primary" onClick={() => setNewProject(true)}>
              {t("开始一个新项目")} <ArrowRight size={16} />
            </button>
            <div className="suggestion-grid">
              {suggestions.map((s) => (
                <button
                  key={s.title}
                  onClick={() => {
                    setName(t(s.title));
                    setBrief(t(s.text));
                    setNewProject(true);
                  }}
                >
                  <s.icon size={21} />
                  <strong>{t(s.title)}</strong>
                  <span>
                    {t("探索这个方向")} <ArrowRight size={13} />
                  </span>
                </button>
              ))}
            </div>
            <div className="welcome-bottom">
              <span>{t("01 需求对齐")}</span>
              <i />
              <span>{t("02 开源硬件")}</span>
              <i />
              <span>{t("03 参数化 CAD")}</span>
              <i />
              <span>{t("04 固件与交付")}</span>
            </div>
          </div>
        )}
      </main>
      {chat && (
        <aside className="chat-panel">
          <ChatResizeHandle onResize={setChatWidth} />
          <header>
            <div className="assistant-icon">
              <Sparkles size={18} />
            </div>
            <div>
              <strong>{t("设计助手")}</strong>
              <small>
                <i />
                {project?.running ? t("正在推进项目") : t("一起把想法做出来")}
              </small>
            </div>
            <span>Pi 1.3</span>
          </header>
          <div className="chat-scroll" ref={scroll}>
            {project ? (
              <>
                <div className="conversation-intro">
                  <span>PROJECT CONVERSATION</span>
                  <p>{t("每一次讨论，都连接着真实的设计决策。")}</p>
                </div>
                {project.messages
                  .filter(
                    (message) =>
                      !(
                        tab === "overview" &&
                        !current?.draft &&
                        stage === project.currentStage &&
                        message.interaction?.id === pendingQuestion?.id &&
                        pendingQuestion
                      ),
                  )
                  .map((m) => (
                    <div key={m.id} className={`message ${m.role}`}>
                      <div className="message-label">
                        {m.role === "user"
                          ? t("你")
                          : m.role === "system"
                            ? t("系统")
                            : (t(agentNames[m.agent ?? "orchestrator"]) ??
                              t("设计助手"))}
                      </div>
                      {m.interaction ? (
                        <QuestionCard
                          card={m.interaction}
                          disabled={busy || project.archived}
                          onAnswer={(answers) =>
                            action(async () => {
                              await api(
                                `/projects/${project.id}/answers`,
                                "POST",
                                { interactionId: m.interaction!.id, answers },
                              );
                              await run();
                            })
                          }
                        />
                      ) : (
                        <MarkdownMessage text={m.text} />
                      )}
                    </div>
                  ))}
                {project.running && (
                  <div className="live-message">
                    <span>
                      <LoaderCircle className="spin" size={14} />
                      {latestTool
                        ? (latestTool.payload as any).role
                          ? t(agentNames[(latestTool.payload as any).role])
                          : t("正在处理")
                        : t("正在连接模型")}
                    </span>
                    {live && <MarkdownMessage text={live} />}
                  </div>
                )}
                {tools.length > 0 && (
                  <details className="activity-log">
                    <summary>
                      <Activity size={13} />
                      {t("执行记录 ·")} {tools.length}
                    </summary>
                    {tools.slice(-20).map((e) => (
                      <div key={e.id}>
                        <span
                          className={e.type === "tool.failed" ? "error" : ""}
                        >
                          {e.type === "agent.started"
                            ? t("开始")
                            : e.type === "tool.completed"
                              ? t("完成")
                              : e.type === "tool.failed"
                                ? t("失败")
                                : t("执行")}
                        </span>
                        <code>
                          {toolActivityLabel(
                            (e.payload as any).name ??
                              t(agentNames[(e.payload as any).role]) ??
                              t("智能体"),
                            (e.payload as any).object,
                          )}
                        </code>
                      </div>
                    ))}
                  </details>
                )}
                {current?.draft &&
                  current.review &&
                  current.status === "awaiting_confirmation" &&
                  stage === project.currentStage &&
                  !isRunning &&
                  !project.archived && (
                    <ApprovalCard
                      stage={current}
                      disabled={!!isRunning || project.archived}
                      onDecision={decision}
                      unverifiedParts={
                        stage === "hardware"
                          ? catalog
                              .filter(
                                (part) =>
                                  current.draft?.partIds.includes(part.id) &&
                                  !part.geometryVerified,
                              )
                              .map((part) => part.name)
                          : []
                      }
                      onInspectHardware={() => setTab("hardware")}
                      onSelectChoice={selectChoice}
                      onAnswerChoices={(answers) =>
                        action(async () => {
                          await api(
                            `/projects/${project.id}/choice-answers`,
                            "POST",
                            { stage, revision: current.revision, answers },
                          );
                          await run();
                        })
                      }
                    />
                  )}
              </>
            ) : (
              <div className="chat-welcome">
                <Sparkles size={26} />
                <h2>{t("你的创作搭档")}</h2>
                <p>
                  {t("描述你想做的智能终端。")} <br />
                  {t("我们会一起确认需求、选择部件，")} <br />
                  {t("逐步完成外观、结构与程序。")}{" "}
                </p>
                <div>
                  <span>{t("可审阅的每一步")}</span>
                  <span>{t("可编辑的工程文件")}</span>
                  <span>{t("始终由你确认")}</span>
                </div>
              </div>
            )}
          </div>
          <div className="composer-wrap">
            {uploads.length > 0 && (
              <div className="attachment-chips">
                {uploads.map((u) => (
                  <span key={u.id}>
                    <Paperclip size={11} />
                    {u.name}
                  </span>
                ))}
              </div>
            )}
            <div className="composer">
              <textarea
                aria-label={t("发送消息")}
                disabled={!project || project.archived || busy}
                placeholder={
                  project
                    ? t("描述想法，或告诉我哪里需要调整…")
                    : t("创建或选择项目，开始设计…")
                }
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    !e.shiftKey &&
                    !e.nativeEvent.isComposing
                  ) {
                    e.preventDefault();
                    void send();
                  }
                }}
              />
              <div className="composer-toolbar">
                <input
                  ref={fileInput}
                  hidden
                  type="file"
                  accept="image/png,image/jpeg,image/webp,text/plain,application/pdf"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void upload(file);
                    e.target.value = "";
                  }}
                />
                <button
                  aria-label={t("添加附件")}
                  disabled={!project || !!isRunning || project.archived}
                  onClick={() => fileInput.current?.click()}
                >
                  <Plus size={18} />
                </button>
                <span>
                  {project?.running ? t("补充当前任务") : t("项目助手")}
                  <ChevronRight size={11} />
                </span>
                {project?.running ? (
                  <button
                    className="send-button stop"
                    aria-label={t("停止任务")}
                    onClick={() =>
                      void action(() =>
                        api(`/projects/${project.id}/abort`, "POST", {}),
                      )
                    }
                  >
                    <Square size={13} />
                  </button>
                ) : (
                  <button
                    className="send-button"
                    aria-label={t("发送")}
                    disabled={
                      !project || !text.trim() || busy || project.archived
                    }
                    onClick={() => void send()}
                  >
                    <ArrowUp size={17} />
                  </button>
                )}
              </div>
            </div>
            <p className="composer-note">
              {t("设计建议需验证 · 关键阶段由你确认")}
            </p>
          </div>
        </aside>
      )}
      {error && (
        <div className="toast" role="alert">
          <span>{t(error)}</span>
          <button aria-label={t("关闭提示")} onClick={() => setError("")}>
            <X size={16} />
          </button>
        </div>
      )}
      {settings && <SettingsDialog onClose={() => setSettings(false)} />}
      {newProject && (
        <div className="modal-backdrop">
          <form
            className="project-dialog"
            onSubmit={(e) => {
              e.preventDefault();
              void create();
            }}
          >
            <div className="dialog-header">
              <div>
                <Box size={19} />
                <h2>{t("开始一个新项目")}</h2>
              </div>
              <button
                type="button"
                aria-label={t("关闭新建项目")}
                onClick={() => setNewProject(false)}
              >
                <X size={18} />
              </button>
            </div>
            <p className="muted">
              {t("先描述想法，系统会与你一起澄清设计方向。")}
            </p>
            <label>
              {t("项目名称")}{" "}
              <input
                autoFocus
                required
                maxLength={100}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("例如：桌面环境终端")}
              />
            </label>
            <label>
              {t("你想做什么？")}{" "}
              <textarea
                required
                maxLength={16000}
                value={brief}
                onChange={(e) => setBrief(e.target.value)}
                placeholder={t(
                  "使用场景、主要功能、预算、已有的硬件或外观想法…",
                )}
              />
            </label>
            <div className="dialog-footer">
              <span>{t("开源硬件 + 3D 打印")}</span>
              <button className="primary" disabled={busy}>
                {t("创建项目")} <ArrowRight size={14} />
              </button>
            </div>
          </form>
        </div>
      )}
      {revisionOpen && project && current && (
        <div className="modal-backdrop">
          <form
            className="project-dialog small"
            onSubmit={(e) => {
              e.preventDefault();
              void action(async () => {
                await api(`/projects/${project.id}/revisions`, "POST", {
                  stage,
                  revision: current.revision,
                  comment: revisionText,
                });
                setRevisionOpen(false);
              });
            }}
          >
            <h2>
              {t("修改")}
              {t(stageLabels[stage])}
            </h2>
            <p className="muted">
              {t(
                "将保留历史版本，并使本阶段及下游结果失效。重新执行后需要再次审阅与确认。",
              )}{" "}
            </p>
            <label>
              {t("修改要求")}{" "}
              <textarea
                required
                maxLength={4000}
                value={revisionText}
                onChange={(e) => setRevisionText(e.target.value)}
              />
            </label>
            <div className="dialog-footer">
              <button type="button" onClick={() => setRevisionOpen(false)}>
                {t("取消")}{" "}
              </button>
              <button className="primary" disabled={!!isRunning}>
                {t("提交修改")}{" "}
              </button>
            </div>
          </form>
        </div>
      )}
      {deleteOpen && project && (
        <div className="modal-backdrop">
          <form
            className="project-dialog small"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-title"
            onSubmit={(e) => {
              e.preventDefault();
              void action(async () => {
                await api(`/projects/${project.id}`, "DELETE", {
                  confirmName: deleteName,
                });
                selectedRef.current = "";
                setSelected("");
                setProject(undefined);
                setDeleteOpen(false);
              });
            }}
          >
            <h2 id="delete-title">{t("彻底删除项目")}</h2>
            <p className="error">
              {t("将永久删除「")}
              {project.name}
              {t("」的全部项目文件、对话、工程产物和历史，无法恢复。")}{" "}
            </p>
            <label>
              {t("输入项目名称以确认")}{" "}
              <input
                autoFocus
                aria-label={t("确认删除项目名称")}
                value={deleteName}
                onChange={(e) => setDeleteName(e.target.value)}
                autoComplete="off"
              />
            </label>
            <div className="dialog-footer">
              <button
                type="button"
                disabled={busy}
                onClick={() => setDeleteOpen(false)}
              >
                {t("取消")}{" "}
              </button>
              <button
                className="danger-button"
                disabled={!!isRunning || deleteName !== project.name}
              >
                {t("永久删除")}{" "}
              </button>
            </div>
          </form>
        </div>
      )}
      {rename && project && (
        <div className="modal-backdrop">
          <form
            className="project-dialog small"
            onSubmit={(e) => {
              e.preventDefault();
              const v = new FormData(e.currentTarget).get("name");
              void action(async () => {
                await api("/projects/" + project.id, "PATCH", { name: v });
                setRename(false);
              });
            }}
          >
            <h2>{t("重命名项目")}</h2>
            <input
              name="name"
              required
              maxLength={100}
              defaultValue={project.name}
            />
            <div className="dialog-footer">
              <button type="button" onClick={() => setRename(false)}>
                {t("取消")}{" "}
              </button>
              <button className="primary" disabled={!!isRunning}>
                {t("保存")}{" "}
              </button>
            </div>
          </form>
        </div>
      )}
      {measure && activePart && (
        <div className="modal-backdrop">
          <form
            className="project-dialog small"
            onSubmit={(e) => {
              e.preventDefault();
              void action(async () => {
                await api(
                  `/projects/${project!.id}/catalog/${activePart.id}/measure`,
                  "PUT",
                  {
                    width: measuredWidth,
                    depth: measuredDepth,
                    height: measuredHeight,
                    notes: measureNote,
                  },
                );
                setCatalog(await api(`/projects/${project!.id}/catalog`));
                setMeasure(false);
              });
            }}
          >
            <h2>
              {t("记录")} {activePart.name} {t("实测包络")}
            </h2>
            <p className="muted">
              {t(
                "记录实测板框宽深、器件与焊点占用的总高度。不包含猜测的安装孔。修改只影响当前项目的硬件及后续阶段，其他项目不受影响。",
              )}{" "}
            </p>
            <label>
              {t("宽度（mm）")}{" "}
              <input
                required
                type="number"
                min="1"
                max="300"
                step="0.1"
                value={measuredWidth}
                onChange={(e) => setMeasuredWidth(+e.target.value)}
              />
            </label>
            <label>
              {t("深度（mm）")}{" "}
              <input
                required
                type="number"
                min="1"
                max="300"
                step="0.1"
                value={measuredDepth}
                onChange={(e) => setMeasuredDepth(+e.target.value)}
              />
            </label>
            <label>
              {t("总高度（mm）")}{" "}
              <input
                aria-label={t("部件总高度")}
                type="number"
                min="1"
                max="100"
                step="0.1"
                required
                value={measuredHeight}
                onChange={(e) => setMeasuredHeight(+e.target.value)}
              />
            </label>
            <label>
              {t("测量依据与安装限制")}{" "}
              <textarea
                required
                value={measureNote}
                onChange={(e) => setMeasureNote(e.target.value)}
                placeholder={t(
                  "记录所用板卡、测量方法，以及接头和线缆需要的空间",
                )}
              />
            </label>
            <div className="dialog-footer">
              <button type="button" onClick={() => setMeasure(false)}>
                {t("取消")}{" "}
              </button>
              <button className="primary" disabled={!!isRunning}>
                {t("保存实测数据")}{" "}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

import { useEffect, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent } from "react";
import type { Project, ProjectSummary, StageRecord } from "../../../packages/core/src/project";
import type { PurchaseCandidate } from "../../../packages/design-engine/src/bridge";
import { stageIds, type StageId } from "../../../packages/orchestrator/src/contracts";
import type { RoleDefinition } from "../../../packages/orchestrator/src/roles";
import type { ToolApproval } from "../../../packages/codex-server/src/executor";
import { hasCadResults } from "../../../packages/core/src/cad-results";
import { api } from "./api";
import { Dialog } from "./WorkflowDialog";
import { AppearancePreview } from "./AppearancePreview";
import { CadResults } from "./CadResults";
import { DesignDetailsForm } from "./DesignDetailsForm";
import { WorkflowGraph } from "./WorkflowGraph";
import { HardwareLibrary, PurchaseLinks } from "./HardwareLibrary";
import { ImportedResults } from "./ImportedResults";
import { MarkdownPreview } from "./MarkdownPreview";
import { displayStageStatus, eventData, roleNames, runText, stageDescription, stageInputs, stageNames, stageRuns, threadRuns, workflowNodes } from "./workflow-model";

type Panel = "left" | "right" | "bottom";
type Conversation = "auto" | "author" | "research" | "coordinator";

function phase(project: ProjectSummary | Project, disconnected = false) {
  if (project.importedRun) return "原型成果";
  if (project.stages.every((stage) => stage.state === "completed" || stage.state === "approved")) return "已完成";
  const stage = project.stages.find((stage) => stage.id === project.activeStage);
  return stage?.state === "paused" && stage.pauseReason === "breakpoint" ? "断点暂停" : displayStageStatus(stage?.state ?? "pending", disconnected);
}

function projectLocation(id?: string) {
  const url = new URL(location.href);
  if (id) url.searchParams.set("project", id);
  else url.searchParams.delete("project");
  history.replaceState(null, "", url);
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function runningConversation(project: Project) {
  const pending = new Set<string>();
  for (const event of project.events) {
    if (event.type === "message") pending.add(event.runId);
    if (event.type === "completed" || event.type === "failed" || event.type === "stopped") pending.delete(event.runId);
  }
  return pending.size > 0;
}

export function App() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [project, setProject] = useState<Project>();
  const [disconnectedId, setDisconnectedId] = useState<string>();
  const [toolApprovals, setToolApprovals] = useState<{ projectId: string; requests: ToolApproval[] }>();
  const [agents, setAgents] = useState<RoleDefinition[]>([]);
  const [model, setModel] = useState<{ runtime: string; model: string | null }>();
  const [modelDraft, setModelDraft] = useState("");
  const [modelSaved, setModelSaved] = useState(false);
  const [selected, setSelected] = useState<string>();
  const [follow, setFollow] = useState(true);
  const [conversation, setConversation] = useState<Conversation>("auto");
  const [tab, setTab] = useState("当前工作");
  const [brief, setBrief] = useState("");
  const [newBreakpoints, setNewBreakpoints] = useState<StageId[]>([]);
  const [breakpointDraft, setBreakpointDraft] = useState<StageId[]>();
  const [stoppingId, setStoppingId] = useState<string>();
  const [projectMenu, setProjectMenu] = useState<{ item: ProjectSummary; x: number; y: number }>();
  const [deleteTarget, setDeleteTarget] = useState<ProjectSummary>();
  const [removedProject, setRemovedProject] = useState<ProjectSummary>();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState(false);
  const [library, setLibrary] = useState(false);
  const [briefOpen, setBriefOpen] = useState(false);
  const [nav, setNav] = useState(false);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [resultsOpen, setResultsOpen] = useState(true);
  const [canvasOpen, setCanvasOpen] = useState(true);
  const [panelSize, setPanelSize] = useState({ left: 230, right: 360, bottom: 390 });
  const activeId = useRef<string | undefined>(undefined);
  const openSequence = useRef(0);
  const resultsHost = useRef<HTMLElement>(null);

  async function refreshList() {
    const values = await api<ProjectSummary[]>("/projects");
    setProjects(values);
    return values;
  }

  async function open(id: string) {
    const sequence = ++openSequence.current;
    try {
      const next = await api<Project>(`/projects/${id}`);
      if (sequence !== openSequence.current) return;
      activeId.current = id;
      setProject(next);
      setFollow(true);
      setSelected(undefined);
      setConversation("auto");
      setNav(false);
      setError("");
      localStorage.setItem("dreamatic-project", id);
      projectLocation(id);
    } catch (failure) {
      if (sequence === openSequence.current) setError(String(failure));
    }
  }

  function clearProject() {
    ++openSequence.current;
    activeId.current = undefined;
    setProject(undefined);
    setSelected(undefined);
    setFollow(true);
    localStorage.removeItem("dreamatic-project");
    projectLocation();
  }

  useEffect(() => {
    let alive = true;
    void Promise.all([refreshList(), api<RoleDefinition[]>("/agents"), api<{ runtime: string; model: string | null }>("/model")])
      .then(([list, roles, config]) => {
        if (!alive) return;
        setAgents(roles);
        setModel(config);
        const saved = new URLSearchParams(location.search).get("project") ?? localStorage.getItem("dreamatic-project");
        const previous = list.find((item) => item.id === saved);
        if (previous) void open(previous.id);
      })
      .catch((failure) => { if (alive) setError(String(failure)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!project?.id) return;
    const id = project.id;
    let version = 0;
    let stream: EventSource | undefined;
    let reconnect: ReturnType<typeof setTimeout> | undefined;
    const refreshToolApprovals = async () => {
      const request = ++version;
      try {
        const requests = await api<ToolApproval[]>(`/projects/${id}/tool-approvals`, {
          headers: { "x-dreamatic-project-action": "tool-approval" },
        });
        if (request === version && activeId.current === id) setToolApprovals({ projectId: id, requests });
      } catch (failure) {
        if (request === version && activeId.current === id) setError(String(failure));
      }
    };
    function connect() {
      const connection = new EventSource(`/api/projects/${id}/events`);
      stream = connection;
      connection.onerror = () => {
        connection.close();
        if (activeId.current !== id) return;
        version++;
        setDisconnectedId(id);
        setToolApprovals(undefined);
        reconnect = setTimeout(connect, 2_000);
      };
      connection.onmessage = (message) => {
        if (activeId.current !== id) return;
        const update = JSON.parse(message.data);
        if (update.type === "connected") setDisconnectedId(undefined);
        if (update.type === "connected" || update.type === "tool-approvals-changed") void refreshToolApprovals();
        if (update.type === "project-deleted") {
          clearProject();
          setProjects((items) => items.filter((item) => item.id !== id));
          return;
        }
        if (update.project) {
          setProject(update.project);
          const { events, ...summary } = update.project as Project;
          setProjects((items) => items.map((item) => item.id === id ? { ...summary, eventCount: events.length } : item));
        }
        if (update.type === "project-error") setError(update.error);
      };
    }
    connect();
    return () => { version++; clearTimeout(reconnect); stream?.close(); };
  }, [project?.id]);

  const importedRun = project?.importedRun;
  const pickedId = follow ? importedRun?.selected ?? project?.activeStage : selected;
  const importedWork = importedRun?.nodes.find((node) => node.id === pickedId);
  const picked = project?.stages.find((stage) => stage.id === pickedId);
  const disconnected = !!project && disconnectedId === project.id;
  const graphNodes = workflowNodes(project, disconnected);
  const active = project?.stages.find((stage) => stage.id === project.activeStage);
  const detailsStage = !importedRun && active?.state === "awaiting_details" && active.questions?.length ? active : undefined;
  const pendingToolApprovals = toolApprovals?.projectId === project?.id ? toolApprovals?.requests ?? [] : [];
  const isRunning = !!project && !disconnected && (["running", "reviewing"].includes(active?.state ?? "") || runningConversation(project));
  const blocked = pending || isRunning || disconnected;
  const runs = project && importedWork ? threadRuns(project, importedWork.threadId) : project && picked ? stageRuns(project, picked.id) : [];
  const researchRun = [...runs].reverse().find((run) => run.some((event) => eventData(event).agent === "research"));
  const researchThread = researchRun?.map(eventData).find((data) => data.threadId)?.threadId;
  const latestAgent = runs.flat().filter((event) => event.type === "started").map(eventData).at(-1)?.agent;
  const lastStageEnd = runs.flat().filter(({ type }) => type === "completed" || type === "failed" || type === "stopped").at(-1);
  const failureData = lastStageEnd?.type === "failed" ? eventData(lastStageEnd) : undefined;
  const stageFailure = picked?.error === "Author agent turn failed" || picked?.error === "Research support turn failed"
    ? failureData?.turn?.error?.message || failureData?.error || picked.error : picked?.error;
  const automaticConversation = picked?.state === "running" && latestAgent === "research" ? "research" : "author";
  const effectiveConversation = conversation === "auto" ? automaticConversation : conversation;
  const threadId = importedWork?.threadId ?? (effectiveConversation === "research" ? researchThread
    : effectiveConversation === "coordinator" ? picked?.hardwareBlocker?.coordinatorThreadId : picked?.authorThreadId);
  const selectedRuns = runs.filter((run) => run.some((event) => eventData(event).threadId === threadId));
  const messageKey = JSON.stringify([project?.id, pickedId, effectiveConversation, threadId]);
  const message = drafts[messageKey] ?? "";
  const transcript = selectedRuns.map((run) => ({
    id: run[0].runId, at: run[0].at,
    user: run.find((event) => event.type === "message"),
    text: runText(run),
    failed: run.find((event) => event.type === "failed"),
    stopped: run.some((event) => event.type === "stopped"),
  }));
  const transcriptContent = transcript.length ? transcript.map((turn) => <div key={turn.id} className="wf-conversation-message">
    <small>{new Date(turn.at).toLocaleString()}</small>
    {turn.user && <div className="wf-user"><strong>你</strong><p>{eventData(turn.user).message}</p></div>}
    {turn.text && <div className="wf-markdown">{turn.text}</div>}
    {turn.failed && <p role="alert">{eventData(turn.failed).turn?.error?.message ?? eventData(turn.failed).error ?? "本次调用未完成。"}</p>}
    {turn.stopped && <p>本次调用已停止。</p>}
    {!turn.text && !turn.failed && !turn.stopped && <p>等待会话响应…</p>}
  </div>) : <p>{threadId ? "已关联原会话。" : "该工作尚未创建会话。"}</p>;

  useEffect(() => {
    setTab("当前工作");
    setConversation("auto");
    resultsHost.current?.scrollTo({ top: 0 });
  }, [project?.id, pickedId]);

  useEffect(() => {
    if (!isRunning && stoppingId === project?.id) setStoppingId(undefined);
  }, [isRunning, project?.id, stoppingId]);

  useEffect(() => {
    if (!projectMenu) return;
    function outside(event: globalThis.PointerEvent) {
      if (!(event.target instanceof Element) || !event.target.closest(".wf-project-menu, .wf-project-menu-trigger")) setProjectMenu(undefined);
    }
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") setProjectMenu(undefined);
    }
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [projectMenu]);

  async function syncProject(id: string, beforeDispatch?: string) {
    // /run can acknowledge before its first persisted state or streamed event.
    // Re-read briefly so the initiating tab can show the running card promptly.
    for (let attempt = 0; attempt < (beforeDispatch ? 5 : 1); attempt++) {
      if (activeId.current !== id) return;
      const next = await api<Project>(`/projects/${id}`, { cache: "no-store" });
      if (activeId.current !== id) return;
      if (!beforeDispatch || next.updatedAt > beforeDispatch) {
        setProject((current) => current?.id === id && current.updatedAt <= next.updatedAt ? next : current);
        return;
      }
      if (attempt < 4) await new Promise<void>((resolve) => setTimeout(resolve, 100));
    }
  }

  async function act(path: string, body: unknown, headers?: HeadersInit) {
    setPending(true);
    setError("");
    const id = activeId.current;
    try {
      await api(path, { method: "POST", headers, body: JSON.stringify(body) });
      if (id) await syncProject(id, path === `/projects/${id}/run` ? project?.updatedAt : undefined);
      await refreshList();
      return true;
    } catch (failure) {
      setError(String(failure));
      return false;
    } finally {
      setPending(false);
    }
  }

  async function create() {
    if (!brief.trim() || pending) return;
    setPending(true);
    setError("");
    try {
      const created = await api<Project>("/projects", {
        method: "POST", body: JSON.stringify({ name: brief.trim().split("\n")[0].slice(0, 70), brief: brief.trim(), breakpoints: newBreakpoints }),
      });
      activeId.current = created.id;
      setProject(created);
      setFollow(true);
      localStorage.setItem("dreamatic-project", created.id);
      projectLocation(created.id);
      setBrief("");
      setNewBreakpoints([]);
      await refreshList();
      await api(`/projects/${created.id}/run`, { method: "POST", body: "{}" });
      await syncProject(created.id, created.updatedAt);
    } catch (failure) {
      setError(String(failure));
    } finally {
      setPending(false);
    }
  }

  function select(id: string) {
    setSelected(id);
    setFollow(false);
    if (id === detailsStage?.id) setRightOpen(true);
  }

  function showProjectMenu(event: MouseEvent<HTMLButtonElement>, item: ProjectSummary) {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.type === "contextmenu" && event.clientX ? event.clientX : rect.left;
    const y = event.type === "contextmenu" && event.clientY ? event.clientY : rect.bottom;
    setProjectMenu({ item, x: Math.min(x, window.innerWidth - 146), y: Math.min(y, window.innerHeight - 52) });
  }

  async function deleteProject(item: ProjectSummary) {
    setPending(true);
    setError("");
    try {
      await api(`/projects/${item.id}`, { method: "DELETE", headers: { "x-dreamatic-project-action": "delete" } });
      if (activeId.current === item.id) clearProject();
      setProjects((items) => items.filter((project) => project.id !== item.id));
      setDeleteTarget(undefined);
      setRemovedProject(item);
    } catch (failure) {
      setError(String(failure));
    } finally { setPending(false); }
  }

  function resizePanel(event: PointerEvent<HTMLDivElement>, panel: Panel) {
    event.preventDefault();
    const element = event.currentTarget;
    const startX = event.clientX;
    const startY = event.clientY;
    const initial = panelSize[panel];
    element.setPointerCapture(event.pointerId);
    function move(next: globalThis.PointerEvent) {
      const delta = panel === "left" ? next.clientX - startX : panel === "right" ? startX - next.clientX : startY - next.clientY;
      const maximum = panel === "bottom" ? window.innerHeight - 180 : window.innerWidth * 0.4;
      const minimum = panel === "bottom" ? 100 : 180;
      setPanelSize((old) => ({ ...old, [panel]: Math.max(minimum, Math.min(maximum, initial + delta)) }));
    }
    function end() {
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerup", end);
      element.removeEventListener("pointercancel", end);
      element.removeEventListener("lostpointercapture", end);
    }
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerup", end);
    element.addEventListener("pointercancel", end);
    element.addEventListener("lostpointercapture", end);
  }

  function separator(panel: Panel, label: string, orientation: "vertical" | "horizontal") {
    return <div className={`wf-splitter wf-splitter-${panel}`} role="separator" tabIndex={0}
      aria-label={label} aria-orientation={orientation} aria-valuenow={panelSize[panel]}
      onPointerDown={(event) => resizePanel(event, panel)}
      onKeyDown={(event) => {
        const direction = ({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: 1, ArrowDown: -1 } as Record<string, number>)[event.key];
        if (!direction) return;
        event.preventDefault();
        const amount = direction * (panel === "right" ? -16 : 16);
        setPanelSize((old) => ({ ...old, [panel]: Math.max(100, old[panel] + amount) }));
      }} />;
  }

  const classes = ["wf-app", "wf-flexible", !leftOpen && !nav && "wf-left-closed", !rightOpen && "wf-right-closed", !resultsOpen && "wf-results-closed", !canvasOpen && "wf-canvas-closed"].filter(Boolean).join(" ");
  return (
    <div className={classes} style={{
      "--wf-left": `${leftOpen ? panelSize.left : 44}px`,
      "--wf-right": `${rightOpen ? panelSize.right : 44}px`,
      "--wf-bottom": `${panelSize.bottom}px`,
    } as CSSProperties}>
      <aside className={`wf-sidebar ${nav ? "open" : ""}`}>
        <button className="wf-panel-toggle" aria-label={leftOpen || nav ? "收起项目面板" : "展开项目面板"} onClick={() => nav ? setNav(false) : setLeftOpen(!leftOpen)}>{leftOpen || nav ? "‹ 收起项目" : "项目 ›"}</button>
        {separator("left", "调整项目面板宽度", "vertical")}
        <div className="wf-brand"><span>✦</span><b>Dreamatic · Make</b><button onClick={() => setNav(false)} aria-label="关闭导航">×</button></div>
        <h3>项目</h3>
        <button className="wf-new" onClick={() => {
          clearProject();
          setBrief("");
          setNewBreakpoints([]);
          setNav(false);
        }}>＋ 新建项目</button>
        <div className="wf-projects">
          {projects.map((item) => <div key={item.id} className={`wf-project-row${project?.id === item.id ? " active" : ""}`}>
            <button onClick={() => void open(item.id)} onContextMenu={(event) => showProjectMenu(event, item)}>
              <strong>{item.name || item.brief}</strong><small>{phase(item, disconnected)} · {new Date(item.updatedAt).toLocaleString()}</small>
            </button>
            <button className="wf-project-menu-trigger" aria-label={`${item.name}的项目菜单`} aria-haspopup="menu" aria-expanded={projectMenu?.item.id === item.id} onClick={(event) => showProjectMenu(event, item)}>⋯</button>
          </div>)}
          {!projects.length && <p>{loading ? "正在加载项目…" : "暂无项目"}</p>}
        </div>
        <button onClick={() => setLibrary(true)}>▣ 硬件资料库</button>
        <button onClick={() => { setModelDraft(model?.model ?? ""); setModelSaved(false); setSettings(true); }}>⚙ 模型设置</button>
      </aside>
      <main className="wf-main">
        <header className="wf-header">
          <button className="wf-nav" aria-label="打开项目导航" onClick={() => setNav(true)}>☰</button>
          <div><small>DESIGN WORKSPACE</small><strong>{project?.name || "新的产品探索"}</strong></div>
          <button onClick={() => setCanvasOpen(!canvasOpen)}>{canvasOpen ? "收起画布" : "展开画布"}</button>
          <button onClick={() => setResultsOpen(!resultsOpen)}>{resultsOpen ? "收起结果" : "展开结果"}</button>
          {project && !importedRun && <button disabled={blocked} onClick={() => setBreakpointDraft(project.breakpoints ?? [])}>断点{project.breakpoints?.length ? ` · ${project.breakpoints.length}` : ""}</button>}
          {project && isRunning && <button className="wf-stop" disabled={stoppingId === project.id} onClick={async () => {
            const id = project.id;
            setStoppingId(id);
            if (!await act(`/projects/${id}/stop`, {}, { "x-dreamatic-project-action": "stop" })) setStoppingId(undefined);
          }}>{stoppingId === project.id ? "停止中…" : "停止运行"}</button>}
          {disconnected
            ? <span role="status">服务连接中断，正在重连</span>
            : pendingToolApprovals.length
            ? <button className="wf-detail-notice" onClick={() => setRightOpen(true)}>待确认工具权限</button>
            : detailsStage
            ? <button className="wf-detail-notice" onClick={() => { setFollow(true); setRightOpen(true); }}>待确认细节</button>
            : <span>{isRunning ? "工作进行中" : project ? phase(project) : "等待需求"}</span>}
        </header>
        {error && <div className="wf-error" role="alert"><b>操作未完成，请检查状态后重试。</b><details><summary>技术详情</summary>{error}</details><button onClick={() => setError("")}>关闭</button></div>}
        {removedProject && <div className="wf-project-removed" role="status">
          <span>已删除「{removedProject.name}」</span>
          <button disabled={pending} onClick={async () => {
            if (await act(`/projects/${removedProject.id}/restore`, {}, { "x-dreamatic-project-action": "restore" })) setRemovedProject(undefined);
          }}>撤销</button>
          <button aria-label="关闭删除提示" onClick={() => setRemovedProject(undefined)}>×</button>
        </div>}
        {project ? <>
          <WorkflowGraph key={project.id} nodes={graphNodes} selected={pickedId} initialNode={importedRun?.selected}
            followNode={follow && canvasOpen && picked?.state !== "pending" ? picked?.id : undefined}
            onSelect={select} onBrief={() => setBriefOpen(true)} />
          {separator("bottom", "调整结果面板高度", "horizontal")}
          <section className="wf-results" ref={resultsHost}>
            {importedRun && importedWork ? <ImportedResults key={importedWork.id} projectId={project.id} run={importedRun} node={importedWork} /> : <>
            <div className="wf-section-head">
              <div><small>当前工作</small><h2>{picked ? stageNames[picked.id] : "工作成果"}</h2></div>
              <button onClick={() => { setFollow(true); setSelected(undefined); }}>{follow ? "正在跟随" : "跟随最新工作"}</button>
            </div>
            {picked && <>
              <p className="wf-status">{roleNames[picked.owner]} · {displayStageStatus(picked.state, disconnected)}{picked.revision > 0 && ` · R${picked.revision}`}</p>
              <nav className="wf-tabs" aria-label="工作成果视图">
                {["当前工作", "成果", "记录"].map((name) => <button key={name} aria-pressed={tab === name} onClick={() => setTab(name)}>{name}</button>)}
              </nav>
              {picked.id === "appearance" && tab !== "记录" &&
                <AppearancePreview key={project.id} projectId={project.id} running={picked.state === "running"} />}
              {picked.id === "hardware_selection" && picked.artifact && tab !== "记录" &&
                <HardwarePurchases key={`${project.id}:${picked.artifact.pin.content_hash}`}
                  projectId={project.id} hash={picked.artifact.pin.content_hash} />}
              {hasCadResults(picked.id) && tab !== "记录" &&
                <CadResults key={`${project.id}:${picked.id}`} projectId={project.id} stage={picked} />}
              {tab === "当前工作" && <section className="wf-current-work">
                <details className="wf-technical"><summary>工作要求</summary><p>{stageDescription(picked.id)}</p><p>{project.brief}</p></details>
                {picked.artifact ? <StageMarkdown projectId={project.id} stage={picked} /> : <p>{isRunning && picked.state === "running" ? "团队正在处理，实时工作过程显示在右侧。" : "当前工作尚无记录成果。"}</p>}
              </section>}
              {tab === "成果" && <StageArtifact projectId={project.id} stage={picked} />}
              {tab === "记录" && <><StageArtifact projectId={project.id} stage={picked} /><details open><summary>调用与会话记录 · {runs.length}</summary>
                {runs.map((run) => <article className="wf-record" key={run[0].runId}>
                  <strong>{roleNames[eventData(run.find((event) => event.type === "started") ?? run[0]).agent ?? picked.owner]}</strong>
                  <small>{new Date(run[0].at).toLocaleString()}</small><pre>{JSON.stringify(run, null, 2)}</pre>
                </article>)}
              </details></>}
            </>}
            </>}
          </section>
        </> : <section className="wf-welcome">
          <small>START WITH AN OUTCOME</small><h1>从一个想法，到一套系统。</h1>
          <p>描述产品、使用场景和限制，团队将逐步形成可检查的成果。</p>
          <form onSubmit={(event) => { event.preventDefault(); void create(); }}>
            <textarea aria-label="产品需求" placeholder="描述你希望制作的产品…" value={brief} maxLength={20000} onChange={(event) => setBrief(event.target.value)} />
            <details className="wf-new-breakpoints"><summary>设置断点{newBreakpoints.length ? ` · ${newBreakpoints.length}` : ""}</summary>
              <BreakpointOptions value={newBreakpoints} onChange={setNewBreakpoints} />
            </details>
            <button disabled={pending || loading || !brief.trim()}>{pending ? "正在开始…" : "开始探索"}</button>
          </form>
        </section>}
      </main>
      <aside className="wf-agent">
        <button className="wf-panel-toggle" aria-label={rightOpen ? "收起协作面板" : "展开协作面板"} onClick={() => setRightOpen(!rightOpen)}>{rightOpen ? "收起协作 ›" : "‹ 协作"}</button>
        {separator("right", "调整协作面板宽度", "vertical")}
        <header><b>✦ 协作对话</b><small>{isRunning ? "团队正在工作" : "查看工作与结果"}</small></header>
        <div className="wf-agent-body">
          {project && pendingToolApprovals.map((request) => <section key={request.token} className="wf-process">
            <h3>确认工具权限</h3>
            <p>{request.server}</p>
            <pre className="wf-markdown" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: 320, overflow: "auto" }}>{request.message}</pre>
            <div className="wf-tabs">
              <button disabled={pending} onClick={() => void act(`/projects/${project.id}/tool-approvals`, {
                token: request.token, decision: "accept",
              }, { "x-dreamatic-project-action": "tool-approval" })}>允许本次</button>
              <button disabled={pending} onClick={() => void act(`/projects/${project.id}/tool-approvals`, {
                token: request.token, decision: "decline",
              }, { "x-dreamatic-project-action": "tool-approval" })}>拒绝</button>
            </div>
          </section>)}
          {project && importedWork ? <>
            <details className="wf-user"><summary>原始需求</summary><p>{project.brief}</p></details>
            <section className="wf-process">
              <h3>{importedWork.role}</h3><p>{importedWork.title} · {importedWork.status}</p>
              <details open><summary>已记录的工作结果</summary><p>{importedWork.summary}</p></details>
              <details open={transcript.length > 0}><summary>会话消息</summary>{transcriptContent}</details>
              <details><summary>会话信息</summary><code>{importedWork.threadId}</code></details>
            </section>
          </> : project && picked ? <>
            <details className="wf-user"><summary>原始需求</summary><p>{project.brief}</p></details>
            {detailsStage?.id === picked.id && detailsStage.questions && <DesignDetailsForm
              key={`${project.id}:${picked.id}:${picked.revision}`}
              questions={detailsStage.questions}
              disabled={blocked}
              onConfirm={(answers) => {
                setFollow(true);
                void act(`/projects/${project.id}/confirm-details`, { stage: picked.id, revision: picked.revision, answers }, {
                  "x-dreamatic-confirm": `details:${picked.id}:${picked.revision}`,
                });
              }}
            />}
            <section className="wf-process">
              <h3>{stageNames[picked.id]}</h3><p>{roleNames[picked.owner]} · {displayStageStatus(picked.state, disconnected)}</p>
              <div className="wf-tabs" aria-label="选择节点会话">
                <button aria-pressed={effectiveConversation === "author"} onClick={() => setConversation("author")}>工作会话</button>
                {researchThread && <button aria-pressed={effectiveConversation === "research"} onClick={() => setConversation("research")}>调研会话</button>}
                {picked.hardwareBlocker?.coordinatorThreadId && <button aria-pressed={effectiveConversation === "coordinator"} onClick={() => setConversation("coordinator")}>产品经理</button>}
              </div>
              <details open={isRunning}><summary>已记录的工作过程</summary>
                {transcriptContent}
              </details>
              <details><summary>任务与输入</summary><p>{stageDescription(picked.id)}</p>
                {stageInputs[picked.id].map((id) => <p key={id}><button onClick={() => select(id)}>{stageNames[id]}</button></p>)}
                {!stageInputs[picked.id].length && <p>{project.brief}</p>}
              </details>
              {!!picked.confirmedDetails?.length && <details><summary>已确认的设计细节</summary>
                <dl>{picked.confirmedDetails.map(({ question, answer }, index) => <div key={index}><dt>{question}</dt><dd>{answer}</dd></div>)}</dl>
              </details>}
              <details><summary>调用历史</summary><p>{runs.length} 次调用</p>
                {runs.map((run) => <details key={run[0].runId}><summary>{new Date(run[0].at).toLocaleString()}</summary><pre>{JSON.stringify(run, null, 2)}</pre></details>)}
              </details>
              {threadId && <details><summary>会话信息</summary><code>{threadId}</code></details>}
              {picked.state === "failed" && stageFailure && <div role="alert">
                <p>{stageFailure === "workspace routing discovery failed" ? "本次工作未完成，连接模型服务失败。" : "本次工作未完成。"}</p>
                <details><summary>错误详情</summary>{stageFailure}</details>
              </div>}
              {picked.hardwareBlocker && <details open={picked.state === "blocked"}>
                <summary>{picked.state === "blocked"
                  ? picked.hardwareBlocker.reportedToCoordinator ? "缺件报告已退回产品经理" : "缺件报告尚未送达产品经理"
                  : "上次选型的缺件记录"}</summary>
                <div className="wf-markdown">{picked.hardwareBlocker.reason}</div>
              </details>}
              {picked.state !== "failed" && !picked.hardwareBlocker && picked.error &&
                <div role="alert"><p>本次工作未完成。</p><details><summary>错误详情</summary>{picked.error}</details></div>}
              {picked.id === "hardware_selection" && picked.artifact?.structured &&
                !picked.artifact.structured.mechanicalEvidence && (picked.state === "completed" || picked.state === "approved") &&
                <p>历史选型缺少已核验的零件尺寸附件，装配限位仍需复核。</p>}
              {picked.state === "paused" && <p>{picked.pauseReason === "breakpoint" ? "已在此阶段开始前暂停。" : picked.pauseReason === "interrupted" ? "本地服务中断，此阶段可以重新执行。" : "当前工作已停止，可以重新执行此阶段。"}</p>}
              {picked.id === project.activeStage && ["pending", "ready", "paused", "blocked", "failed", "awaiting_approval"].includes(picked.state) &&
                <button disabled={blocked} onClick={() => void act(`/projects/${project.id}/run`, { resume: picked.state === "paused" })}>{picked.state === "pending" ? "开始当前工作" : "继续当前工作"}</button>}
            </section>
            <details><summary>调度记录 · {project.events.length}</summary>
              {project.events.filter((event) => ["started", "completed", "failed", "stopped"].includes(event.type)).slice(-30).map((event, index) =>
                <p key={`${event.runId}:${index}`}>{event.stage ? stageNames[event.stage] : "会话"} · {event.type === "started" ? "开始" : event.type === "completed" ? "完成" : event.type === "stopped" ? "停止" : "未完成"}<br /><small>{new Date(event.at).toLocaleString()}</small></p>)}
            </details>
          </> : <p>需求和实际工作记录会显示在这里。</p>}
        </div>
        {project && (picked || importedWork) && <form className="wf-compose" onSubmit={async (event) => {
          event.preventDefault();
          if (!threadId || !message.trim() || blocked) return;
          const key = messageKey;
          const ok = await act(`/projects/${project.id}/message`, { threadId, message: message.trim() });
          if (ok) setDrafts((old) => ({ ...old, [key]: "" }));
        }}>
          <textarea aria-label="补充需求" value={message} onChange={(event) => setDrafts((old) => ({ ...old, [messageKey]: event.target.value }))} maxLength={20000}
            placeholder={importedWork ? `给「${importedWork.role}」补充需求或反馈…` : threadId ? "补充需求、反馈或调整…" : "运行到该工作后可向会话发消息"}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }} />
          <button disabled={blocked || !threadId || !message.trim()}>{pending ? "发送中" : "发送"}</button>
        </form>}
      </aside>
      {projectMenu && <div className="wf-project-menu" role="menu" style={{ left: projectMenu.x, top: projectMenu.y }}>
        <button role="menuitem" autoFocus onClick={() => { setError(""); setDeleteTarget(projectMenu.item); setProjectMenu(undefined); }}>删除项目…</button>
      </div>}
      {deleteTarget && <Dialog title="删除项目" close={() => { setDeleteTarget(undefined); setError(""); }}>
        <p>将「{deleteTarget.name}」从项目列表中移除。</p>
        {error && <p role="alert">{error}</p>}
        <div className="wf-buttons">
          <button onClick={() => setDeleteTarget(undefined)}>取消</button>
          <button disabled={pending} onClick={() => void deleteProject(deleteTarget)}>删除项目</button>
        </div>
      </Dialog>}
      {project && breakpointDraft && <Dialog title="流程断点" close={() => { setBreakpointDraft(undefined); setError(""); }}>
        <form onSubmit={async (event) => {
          event.preventDefault();
          if (await act(`/projects/${project.id}/breakpoints`, { breakpoints: breakpointDraft }, { "x-dreamatic-project-action": "breakpoints" })) setBreakpointDraft(undefined);
        }}>
          <BreakpointOptions value={breakpointDraft} onChange={setBreakpointDraft} />
          {error && <p role="alert">{error}</p>}
          <button disabled={blocked}>保存断点</button>
        </form>
      </Dialog>}
      {briefOpen && project && <Dialog title="原始需求" close={() => setBriefOpen(false)}><div className="wf-markdown">{project.brief}</div></Dialog>}
      {library && <HardwareLibrary close={() => setLibrary(false)} />}
      {settings && <Dialog title="模型设置" close={() => setSettings(false)}>
        <section className="wf-settings"><p>{model?.runtime ?? "正在加载运行时"} · {model?.model || "使用 Codex 默认模型"}</p>
          <form className="wf-settings" onSubmit={async (event) => {
            event.preventDefault();
            setPending(true);
            setError("");
            try {
              const next = await api<{ runtime: string; model: string | null }>("/model", {
                method: "POST", headers: { "x-dreamatic-settings": "model" }, body: JSON.stringify({ model: modelDraft.trim() }),
              });
              setModel(next);
              setModelSaved(true);
            } catch (failure) {
              setError(String(failure));
            } finally {
              setPending(false);
            }
          }}>
            <label>模型<input aria-label="工作流模型" value={modelDraft} onChange={(event) => { setModelDraft(event.target.value); setModelSaved(false); }} placeholder="留空使用运行时默认模型" maxLength={160} /></label>
            <button disabled={blocked}>{pending ? "正在保存…" : "保存模型设置"}</button>
            {modelSaved && <p role="status">已保存，将在新的工作会话中使用。</p>}
            {error && <p role="alert">{error}</p>}
          </form>
          {agents.filter((agent) => agent.id !== "reviewer").map((agent) => <article className="wf-record" key={agent.id}><strong>{agent.name}</strong><p>{agent.purpose}</p><small>{agent.stages.map((stage) => stageNames[stage]).join(" · ")}</small></article>)}
        </section>
      </Dialog>}
    </div>
  );
}

function BreakpointOptions({ value, onChange }: { value: StageId[]; onChange: (value: StageId[]) => void }) {
  return <fieldset className="wf-breakpoints">
    <legend>在选中的阶段开始前暂停</legend>
    {stageIds.map((id) => <label key={id}>
      <input type="checkbox" checked={value.includes(id)} onChange={(event) => onChange(event.target.checked ? [...value, id] : value.filter((stage) => stage !== id))} />
      {stageNames[id]}
    </label>)}
  </fieldset>;
}

function StageArtifact({ projectId, stage }: { projectId: string; stage: StageRecord }) {
  const artifact = stage.artifact;
  if (!artifact) return <p>当前工作尚无记录成果。</p>;
  const revision = artifact.pin.revision;
  return <details className="wf-output-files" open>
    <summary>文件与原始记录</summary>
    <article className="wf-record">
      <strong>{stageNames[stage.id]} · R{revision}</strong>
      <small>{new Date(artifact.createdAt).toLocaleString()}</small>
      {stage.id !== "procurement_assembly_guide" &&
        <button onClick={() => download(`${stage.id}-r${revision}.md`, artifact.markdown)}>下载原文件</button>}
      <details><summary>版本与内容指纹</summary><pre>{JSON.stringify(artifact.pin, null, 2)}</pre></details>
      <StageMarkdown projectId={projectId} stage={stage} downloadable />
    </article>
  </details>;
}

function StageMarkdown({ projectId, stage, downloadable = false }: {
  projectId: string; stage: StageRecord; downloadable?: boolean;
}) {
  const artifact = stage.artifact!;
  const filename = `${stage.id}-r${artifact.pin.revision}.md`;
  if (stage.id === "procurement_assembly_guide") {
    return <GuideMarkdown key={`${projectId}:${artifact.pin.content_hash}`} projectId={projectId}
      artifact={artifact} filename={downloadable ? filename : undefined} />;
  }
  return <div className="wf-markdown">{artifact.markdown}</div>;
}

function GuideMarkdown({ projectId, artifact, filename }: {
  projectId: string; artifact: NonNullable<StageRecord["artifact"]>; filename?: string;
}) {
  const [preview, setPreview] = useState<{ markdown: string; failed?: boolean }>();
  const saved = artifact.markdown.includes("\n### 购买链接\n");
  const hash = artifact.pin.content_hash;
  useEffect(() => {
    if (saved) return;
    let active = true;
    void api<{ markdown: string }>(`/projects/${projectId}/procurement-guide?hash=${encodeURIComponent(hash)}`)
      .then((report) => { if (active) setPreview(report); })
      .catch(() => { if (active) setPreview({ markdown: artifact.markdown, failed: true }); });
    return () => { active = false; };
  }, [projectId, hash, saved, artifact.markdown]);
  const text = preview?.markdown ?? artifact.markdown;
  return <>
    {preview?.failed && <p role="status">购买链接暂时无法载入。</p>}
    {filename && <button disabled={!saved && !preview} onClick={() => download(filename, text)}>下载说明书</button>}
    <MarkdownPreview text={text} />
  </>;
}

function HardwarePurchases({ projectId, hash }: { projectId: string; hash: string }) {
  const [candidates, setCandidates] = useState<PurchaseCandidate[]>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    void api<PurchaseCandidate[]>(`/projects/${projectId}/hardware-purchases?hash=${encodeURIComponent(hash)}`)
      .then((items) => { if (active) setCandidates(items); })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [projectId, hash]);
  if (failed) return <p role="status">购买链接暂时无法载入。</p>;
  if (!candidates?.length) return null;
  return <details className="wf-output-files" open>
    <summary>采购候选 · {candidates.length}</summary>
    <div className="wf-cards">
      {candidates.map(({ model, name, status, note, purchase_links }) => <article className="wf-record" key={model}>
        <strong>{name}</strong><small>{status}{note ? ` · ${note}` : ""}</small>
        <PurchaseLinks links={purchase_links} />
      </article>)}
    </div>
  </details>;
}

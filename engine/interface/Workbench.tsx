import { useEffect, useMemo, useState } from "react";
import { api, type ProjectInfo, type View } from "./api";
import { EngineScene } from "./components/EngineScene";
import { TopologyGraph } from "./components/TopologyGraph";
import { SourceExplorer } from "./components/SourceExplorer";
import { createProjectMeshLoader } from "./meshAssets";

type Layer = "structure" | "motion" | "circuit" | "source";
const layers: [Layer, string][] = [["structure", "结构 / 3D"], ["motion", "运动视图"], ["circuit", "电路逻辑"], ["source", "设计源文件"]];
const storageKey = "dreamatic.workbench.project-path";

export function Workbench() {
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [path, setPath] = useState(() => { try { return localStorage.getItem(storageKey) ?? ""; } catch { return ""; } });
  const [target, setTarget] = useState<string | null>(null);
  const [layer, setLayer] = useState<Layer>("structure");
  const [view, setView] = useState<View | null>(null);
  const [inputs, setInputs] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState("");
  const [opening, setOpening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [projectError, setProjectError] = useState("");
  const [viewError, setViewError] = useState("");
  const [revision, setRevision] = useState(0);
  const meshProject = view?.project.path;
  const meshTarget = view?.selection.key;
  const loadMesh = useMemo(() => createProjectMeshLoader(meshProject, meshTarget), [meshProject, meshTarget]);

  const accept = (info: ProjectInfo) => {
    setProject(info); setPath(info.path); setTarget(null); setInputs({}); setSelected(""); setView(null); setRevision((r) => r + 1);
    try { localStorage.setItem(storageKey, info.path); } catch { /* Reading a project does not depend on local storage. */ }
  };
  useEffect(() => {
    const controller = new AbortController();
    setOpening(true);
    api<ProjectInfo>({ method: "open_project", project_path: path }, controller.signal)
      .then(accept).catch((e) => { if (e.name !== "AbortError") setProjectError(String(e.message)); })
      .finally(() => { if (!controller.signal.aborted) setOpening(false); });
    return () => controller.abort();
  }, []);

  const openProject = async (value: string) => {
    setOpening(true); setProjectError("");
    try { accept(await api<ProjectInfo>({ method: "open_project", project_path: value })); }
    catch (e) { setProjectError(e instanceof Error ? e.message : String(e)); }
    finally { setOpening(false); }
  };
  const browse = async () => {
    setOpening(true); setProjectError("");
    try {
      const result = await api<{ path: string | null }>({ method: "pick_project" });
      if (result.path) { setPath(result.path); await openProject(result.path); }
    } catch (e) { setProjectError(e instanceof Error ? e.message : String(e)); }
    finally { setOpening(false); }
  };
  useEffect(() => {
    if (!project || layer === "source") { setBusy(false); return; }
    const controller = new AbortController();
    setBusy(true); setViewError("");
    const timer = setTimeout(() => {
      api<View>({ method: "view", project_path: project.path, target, mode: layer, joint_inputs: layer === "motion" ? inputs : {} }, controller.signal)
        .then(setView).catch((e) => { if (e.name !== "AbortError") { setView(null); setViewError(String(e.message)); } })
        .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    }, 100);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [project, target, layer, inputs, revision]);
  const chooseTarget = (value: string) => {
    setTarget(value || null); setInputs({}); setSelected(""); setView(null); setViewError("");
  };
  const chosen = project?.targets.find((item) => item.key === target);
  return <>
    <header>
      <div><small>DREAMATIC / ENGINE</small><h1>工程设计工作台</h1></div>
      <div className="workspace-status"><strong>{project?.title ?? "打开项目"}</strong>
        <span>{target === null ? "项目整体" : `${target} · ${chosen?.kind === "library" ? "库元件" : "自定义元件"}`}</span></div>
      <label className="target-picker">查看范围
        <select aria-label="查看范围" value={target ?? ""} onChange={(e) => chooseTarget(e.target.value)} disabled={!project || opening}>
          <option value="">整个项目{project ? ` · ${project.title}` : ""}</option>
          {project && <optgroup label="项目中的元件">{project.targets.map((item) =>
            <option value={item.key} key={item.key}>{item.key} · {item.name}（{item.kind === "library" ? "库引用" : "自定义"}）</option>)}</optgroup>}
        </select>
      </label>
    </header>
    <form className="project-location" onSubmit={(e) => { e.preventDefault(); void openProject(path); }}>
      <label htmlFor="project-path">项目文件夹</label>
      <input id="project-path" value={path} onChange={(e) => setPath(e.target.value)} placeholder="输入包含 project.json 的文件夹路径" disabled={opening} />
      <button type="button" onClick={() => void browse()} disabled={opening}>选择文件夹</button>
      <button type="submit" disabled={opening}>{opening ? "正在打开…" : "打开项目"}</button>
    </form>
    {projectError && <p role="alert">{projectError}</p>}
    <nav aria-label="设计视图">{layers.map(([key, label]) => <button key={key} aria-pressed={layer === key}
      onClick={() => setLayer(key)}>{label}</button>)}</nav>
    <div className="selection-heading"><span>{project?.title ?? "尚未打开项目"} / {target === null ? "整个项目" : `${target} · ${chosen?.name ?? ""}`}</span>
      <span>{view && layer !== "source" ? `${Object.keys(view.draft.entities).length} 个元件 · ${view.scene.bodies.length} 个刚体` : ""}</span></div>
    {!project ? <main className="project-empty">{opening ? "正在读取项目…" : "选择一个项目文件夹，开始查看结构、运动、电路和源文件。"}</main>
      : layer === "source" ? <SourceExplorer key={`${project.path}:${target}:${revision}`} projectPath={project.path} target={target} />
      : <main className="workspace">
        <aside aria-label="设计层级"><h2>{target === null ? "项目元件" : "元件刚体"}</h2>
          {view && Object.entries(view.draft.entities).map(([key, entity]) => <details key={key} open>
            <summary onClick={() => setSelected(key)}><code className="entity-key">{key}</code>{entity.name}</summary>
            {Object.entries(view.draft.bodies).filter(([, body]) => body.entity === key).map(([ref]) =>
              <button key={ref} title={ref} aria-pressed={selected === ref} onClick={() => setSelected(ref)}>{ref.split("/").pop()}</button>)}
          </details>)}
        </aside>
        <section className="viewport" aria-label="设计预览" aria-busy={busy}>
          {busy && <div className="loading" role="status">正在计算设计投影…</div>}
          {viewError && <p role="alert">{viewError}</p>}
          {view && (layer === "structure" || layer === "motion") && <EngineScene scene={view.scene} selected={selected} onSelect={setSelected} highlighted={view.bindings[selected] || []} loadMesh={loadMesh} />}
          {view && layer === "circuit" && <TopologyGraph graph={view.circuit} selected={selected} onSelect={setSelected} onHover={() => {}} />}
        </section>
        <aside className="inspector"><h2>{layer === "motion" ? "关节控制" : layer === "circuit" ? "电路详情" : "结构详情"}</h2>
          {view && <>
            <p>{view.scene.bodies.length} 个刚体 · {Object.keys(view.draft.joints).length} 个关节</p>
            {layer === "motion" && <>
              {Object.entries(view.draft.joints).filter(([, joint]) => joint.kind !== "fixed").map(([key, joint]) =>
                <label className="joint" key={key}>{key}
                  <input aria-label={key} type="range" min={joint.lower ?? -3.14} max={joint.upper ?? 3.14} step="any"
                    value={inputs[key] ?? joint.initial ?? 0} onChange={(e) => setInputs({ ...inputs, [key]: Number(e.target.value) })} />
                  <output>{(inputs[key] ?? joint.initial ?? 0).toFixed(4)} {joint.kind === "prismatic" ? "m" : "rad"}</output>
                </label>)}
              {!Object.values(view.draft.joints).some((joint) => joint.kind !== "fixed") && <p className="muted">当前对象没有可调运动自由度。</p>}
              <button onClick={() => setInputs({})}>重置姿态</button>
            </>}
            <h3>当前选择</h3><code>{selected || "点击模型或层级节点"}</code>
            {layer === "circuit" && view.circuit.ports[selected] && (() => {
              const port = view.circuit.ports[selected];
              const roles: Record<string, string> = { power_in: "电源输入", power_out: "电源输出", ground: "接地", input: "信号输入", output: "信号输出", bidirectional: "双向接口", passive: "无源接口" };
              return <section className="port-inspector" aria-label="接口详情">
                <h3>接口详情</h3><strong>{port.name || selected.split("/").pop()}</strong>
                {port.physical_pin_number && <p>物理脚号：{port.physical_pin_number}</p>}
                <p>{roles[port.role] || port.role || "接口角色未定义"}</p>
                {port.connections?.length ? port.connections.map((connection) => <div className="port-connection" key={connection.net_ref}>
                  <p>项目接线：<code>{connection.net_ref}</code></p>
                  <ul>{connection.peers.map((peer) => <li key={peer}><code>{peer.replace("/terminals/", "/")}</code></li>)}</ul>
                </div>) : <p className="muted">未声明项目接线</p>}
              </section>;
            })()}
            <h3>计算状态</h3><p>{view.motion?.status}</p>
            {[...view.diagnostics, ...(view.motion?.diagnostics || [])].map((d, i) => <p key={i}>{d.message}</p>)}
          </>}
          <p className="note">几何与运动学预览；工程参数和制造结果以实际验证为准。</p>
        </aside>
      </main>}
  </>;
}

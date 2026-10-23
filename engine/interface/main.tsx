import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { EngineScene } from "./components/EngineScene";
import { TopologyGraph } from "./components/TopologyGraph";
import type { LayoutProjection } from "./contracts";
import "./style.css";
type Design = { id: string; title: string; level: string };
type View = LayoutProjection & { source: Record<string, unknown> };
type Hit = {
  name: string;
  category: string;
  ref: { element_id: string; revision: number };
  definition: {
    model: {
      procurement?: {
        purchase_url?: string;
        price?: number;
        currency: string;
        manufacturer?: string;
        model?: string;
      } | null;
    };
  };
};
async function api<T>(body: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch("/engine-api", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "引擎请求失败");
  return result;
}
function App() {
  const [designs, setDesigns] = useState<Design[]>([]),
    [id, setId] = useState("gripper"),
    [view, setView] = useState<View | null>(null);
  const [layer, setLayer] = useState("structure"),
    [selected, setSelected] = useState(""),
    [inputs, setInputs] = useState<Record<string, number>>({});
  const [text, setText] = useState(""),
    [category, setCategory] = useState(""),
    [hits, setHits] = useState<Hit[]>([]),
    [searchError, setSearchError] = useState("");
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [searching, setSearching] = useState(false);
  useEffect(() => {
    api<Design[]>({ method: "list" })
      .then(setDesigns)
      .catch((e) => setError(String(e)));
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setBusy(true);
    setError("");
    const timer = setTimeout(
      () =>
        api<View>(
          { method: "view", id, joint_inputs: inputs },
          controller.signal,
        )
          .then(setView)
          .catch((e) => {
            if (e.name !== "AbortError") setError(String(e));
          })
          .finally(() => {
            if (!controller.signal.aborted) setBusy(false);
          }),
      100,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [id, inputs]);
  useEffect(() => {
    const controller = new AbortController();
    setSearching(true);
    setSearchError("");
    const timer = setTimeout(
      () =>
        api<{ items: Hit[] }>(
          { method: "search", text, categories: category ? [category] : [] },
          controller.signal,
        )
          .then((r) => setHits(r.items))
          .catch((e) => {
            if (e.name !== "AbortError") setSearchError(String(e));
          })
          .finally(() => {
            if (!controller.signal.aborted) setSearching(false);
          }),
      300,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [text, category]);
  const choose = (value: string) => {
    setView(null);
    setSelected("");
    setInputs({});
    setId(value);
  };
  const layers = [
    ["structure", "结构 / 3D"],
    ["motion", "运动机构"],
    ["circuit", "电路与能量"],
    ["flow", "物质与信息"],
    ["source", "设计源文件"],
    ["library", "元件库"],
  ];
  return (
    <>
      <header>
        <div>
          <small>DREAMATIC / ENGINE</small>
          <h1>设计浏览器</h1>
        </div>
        <span>独立引擎界面 · 概念设计预览</span>
        <select
          aria-label="设计方案"
          value={id}
          onChange={(e) => choose(e.target.value)}
        >
          {["element", "engine", "project"].map((level) => (
            <optgroup label={level} key={level}>
              {designs
                .filter((d) => d.level === level)
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.title}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
      </header>
      <nav>
        {layers.map(([key, label]) => (
          <button
            aria-pressed={layer === key}
            key={key}
            onClick={() => setLayer(key)}
          >
            {label}
          </button>
        ))}
      </nav>
      {error && <p role="alert">{error}</p>}
      {layer === "library" ? (
        <main className="library">
          <h2>元件索引</h2>
          <p>按标识、名称、分类、标签、型号、厂商检索；价格未知时保留为空。</p>
          <div className="search">
            <input
              aria-label="搜索元件"
              placeholder="搜索，例如 servo、夹爪、sensor…"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <select
              aria-label="元件分类"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="">全部分类</option>
              {[
                "structure",
                "transmission",
                "actuator",
                "light",
                "display",
                "sound",
                "human_input",
                "sensor",
                "controller",
                "driver",
                "power",
                "transport",
                "energy_storage",
                "circuit_element",
              ].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>
          {searchError && <p role="alert">{searchError}</p>}
          <p>{searching ? "检索中…" : `${hits.length} 个匹配元件`}</p>
          <div className="cards">
            {hits.map((h) => {
              const p = h.definition.model.procurement;
              const design = designs.find(
                (d) => d.id.startsWith("element.") && d.title === h.name,
              );
              return (
                <article key={h.ref.element_id}>
                  <small>
                    {h.category} · r{h.ref.revision}
                  </small>
                  <h3>{h.name}</h3>
                  <code>{h.ref.element_id}</code>
                  <p>
                    {p?.manufacturer || "厂商未指定"} ·{" "}
                    {p?.model || "型号未指定"}
                  </p>
                  <p>
                    {p?.price == null
                      ? "价格待补充"
                      : `${p.price} ${p.currency}`}
                  </p>
                  {p?.purchase_url ? (
                    <a href={p.purchase_url} target="_blank" rel="noreferrer">
                      购买链接
                    </a>
                  ) : (
                    <span>购买链接待补充</span>
                  )}
                  {design && (
                    <button
                      onClick={() => {
                        choose(design.id);
                        setLayer("structure");
                      }}
                    >
                      查看设计
                    </button>
                  )}
                </article>
              );
            })}
          </div>
        </main>
      ) : (
        <main className="workspace">
          <aside>
            <h2>设计层级</h2>
            <strong>{designs.find((d) => d.id === id)?.title}</strong>
            {view &&
              Object.entries(view.draft.entities).map(([key, entity]) => (
                <details key={key} open>
                  <summary onClick={() => setSelected(key)}>
                    {entity.name}
                  </summary>
                  {Object.entries(view.draft.bodies)
                    .filter(([, b]) => b.entity === key)
                    .map(([body]) => (
                      <button
                        key={body}
                        aria-pressed={selected === body}
                        onClick={() => setSelected(body)}
                      >
                        {body}
                      </button>
                    ))}
                </details>
              ))}
          </aside>
          <section className="viewport" aria-busy={busy}>
            {busy && <div className="loading">正在计算设计投影…</div>}
            {view && (layer === "structure" || layer === "motion") && (
              <EngineScene
                scene={view.scene}
                selected={selected}
                onSelect={setSelected}
                highlighted={view.bindings[selected] || []}
              />
            )}
            {view && (layer === "circuit" || layer === "flow") && (
              <TopologyGraph
                graph={view[layer]}
                selected={selected}
                onSelect={setSelected}
                onHover={() => {}}
              />
            )}
            {view && layer === "source" && (
              <pre>{JSON.stringify(view.source, null, 2)}</pre>
            )}
          </section>
          <aside className="inspector">
            <h2>{layer === "motion" ? "关节控制" : "设计详情"}</h2>
            {view && (
              <>
                <p>
                  {view.scene.bodies.length} 个刚体 ·{" "}
                  {Object.keys(view.draft.joints).length} 个关节
                </p>
                {Object.entries(view.draft.joints)
                  .filter(([, j]) => j.kind !== "fixed")
                  .map(([key, j]) => (
                    <label className="joint" key={key}>
                      {key}
                      <input
                        aria-label={key}
                        type="range"
                        min={j.lower ?? -3.14}
                        max={j.upper ?? 3.14}
                        step="any"
                        value={inputs[key] ?? j.initial ?? 0}
                        onChange={(e) =>
                          setInputs({
                            ...inputs,
                            [key]: Number(e.target.value),
                          })
                        }
                      />
                      <output>
                        {(inputs[key] ?? j.initial ?? 0).toFixed(4)}{" "}
                        {j.kind === "prismatic" ? "m" : "rad"}
                      </output>
                    </label>
                  ))}
                <button onClick={() => setInputs({})}>重置姿态</button>
                <h3>当前选择</h3>
                <code>{selected || "点击模型或层级节点"}</code>
                <h3>计算状态</h3>
                <p>{view.motion?.status}</p>
                {[...view.diagnostics, ...(view.motion?.diagnostics || [])].map(
                  (d, i) => (
                    <p key={i}>{d.message}</p>
                  ),
                )}
              </>
            )}
            <p className="note">
              合成几何与运动学预览；不代表制造验证或物理性能验证。
            </p>
          </aside>
        </main>
      )}
    </>
  );
}
createRoot(document.getElementById("root")!).render(<App />);

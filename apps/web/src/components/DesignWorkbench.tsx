import { useEffect, useRef, useState, type ComponentProps } from "react";
import {
  Activity,
  Box,
  CircuitBoard,
  Download,
  Play,
  Square,
  Upload,
  Workflow,
} from "lucide-react";
import type {
  EngineDocument,
  EngineMethod,
  EngineSample,
  EngineState,
} from "../../../../packages/core/src/design-engine";
import { api } from "../api";
import { t, useLanguage } from "../i18n";
import { ModelViewer } from "./ModelViewer";
import { EngineScene } from "./EngineScene";
import { MeshImporter } from "./MeshImporter";

const pretty = (value: unknown) => JSON.stringify(value, null, 2);
function sampleText(sample?: EngineSample | null) {
  return sample
    ? `${sample.value ?? "—"} · ${sample.quality} · ${sample.origin}`
    : "—";
}
function saveJSON(name: string, value: unknown) {
  const url = URL.createObjectURL(
    new Blob([pretty(value)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function DesignWorkbench(
  props: ComponentProps<typeof ModelViewer> & { projectVersion: number },
) {
  useLanguage();
  const [view, setView] = useState("scene");
  const [state, setState] = useState<EngineState | null>(null);
  const [bundle, setBundle] = useState("");
  const [scenario, setScenario] = useState("");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState("");
  const [frameIndex, setFrameIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const hydrated = useRef(false);
  const alive = useRef(true);
  const base = `/projects/${props.projectId}/engine`;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    void api<EngineState>(base)
      .then((next) => {
        if (cancelled) return;
        setState(next);
        if (!hydrated.current) {
          hydrated.current = true;
          if (next.record) {
            setBundle(pretty(next.record.bundle));
            setScenario(
              next.record.scenario ? pretty(next.record.scenario) : "",
            );
          }
        }
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [base, props.projectVersion]);
  const record = dirty ? null : state?.record;
  const payload = record?.reply.type === "result" ? record.reply.payload : null;
  const diagnostics =
    record?.reply.type === "error"
      ? record.reply.diagnostics
      : (payload?.diagnostics ?? []);
  const frames = payload?.result?.frames ?? [];
  const frame = frames[Math.min(frameIndex, frames.length - 1)];
  useEffect(() => {
    if (!playing || !frames.length) return;
    const start = performance.now(),
      startTime = frames[frameIndex]?.time_s ?? 0;
    let animation = 0,
      index = frameIndex;
    const tick = () => {
      const time = startTime + (performance.now() - start) / 1000;
      while (index + 1 < frames.length && frames[index + 1].time_s <= time)
        index++;
      setFrameIndex(index);
      if (index === frames.length - 1) setPlaying(false);
      else animation = requestAnimationFrame(tick);
    };
    animation = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animation);
  }, [playing, record?.id]);
  const edit = (kind: "bundle" | "scenario", value: string) => {
    (kind === "bundle" ? setBundle : setScenario)(value);
    setDirty(true);
    setPlaying(false);
    setFrameIndex(0);
    setSelected("");
  };
  async function example(name: string) {
    setBusy(true);
    setError("");
    setPlaying(false);
    try {
      const value = await api<{
        bundle: EngineDocument;
        scenario: EngineDocument;
      }>(`${base}/examples/${name}`);
      if (!alive.current) return;
      edit("bundle", pretty(value.bundle));
      edit("scenario", pretty(value.scenario));
      setView("scene");
    } catch (e) {
      if (alive.current) setError(String(e));
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function importFile(kind: "bundle" | "scenario", file?: File) {
    if (!file) return;
    try {
      if (file.size > 5_000_000) throw new Error(t("单个文件不能超过 5 MB"));
      const value = JSON.parse(await file.text());
      if (!value || Array.isArray(value) || typeof value !== "object")
        throw new Error(t("请输入 JSON 对象"));
      if (alive.current) {
        edit(kind, pretty(value));
        setError("");
      }
    } catch (e) {
      if (alive.current) setError(String(e));
    }
  }
  async function run(method: EngineMethod) {
    if (!state) return;
    setBusy(true);
    setError("");
    setPlaying(false);
    setFrameIndex(0);
    try {
      const next = await api<EngineState>(base, "POST", {
        method,
        bundle: JSON.parse(bundle),
        scenario: scenario.trim() ? JSON.parse(scenario) : undefined,
        contextKey: state.contextKey,
      });
      if (!alive.current) return;
      setState(next);
      setDirty(false);
      setSelected("");
      if (next.record?.reply.type === "error" || method === "validate")
        setView("diagnostics");
      else setView("scene");
    } catch (e) {
      if (alive.current) setError(String(e));
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return (
    <section className="design-workbench" aria-label={t("产品设计引擎")}>
      <div className="engine-heading">
        <div>
          <span className="eyebrow">PRODUCT DESIGN ENGINE</span>
          <h2>{t("设计与仿真工作台")}</h2>
        </div>
        <span className="badge">DSL 0.2 · {t("模型级仿真")}</span>
      </div>
      <p className="engine-scope">
        {t("模型是独立快照，不自动同步项目 BOM；仿真完成不代表实物验证通过。")}
      </p>
      <div className="engine-toolbar">
        <span>{t("载入示例")}</span>
        {[
          ["actuator", "舵机连杆"],
          ["fan", "连续风扇"],
          ["lamp", "温控指示灯"],
        ].map(([id, label]) => (
          <button
            key={id}
            disabled={busy || !state}
            onClick={() => void example(id)}
          >
            {t(label)}
          </button>
        ))}
        <button
          disabled={!record || busy}
          onClick={() => saveJSON(`engine-${record!.id}.json`, record)}
        >
          <Download size={14} />
          {t("导出运行记录")}
        </button>
      </div>
      <MeshImporter
        projectId={props.projectId}
        contextKey={state?.contextKey}
        busy={busy}
        onBusy={setBusy}
        onDocuments={(b, s) => {
          edit("bundle", pretty(b));
          edit("scenario", pretty(s));
          setView("scene");
        }}
      />
      <details className="engine-inputs">
        <summary>
          <Upload size={14} />
          {t("模型与场景 JSON")}{" "}
          {dirty && <span className="badge">{t("输入已修改")}</span>}
        </summary>
        <div className="engine-editors">
          {(
            [
              ["bundle", "模型快照", bundle],
              ["scenario", "仿真场景", scenario],
            ] as const
          ).map(([kind, label, value]) => (
            <label key={kind}>
              {t(label)}
              <input
                aria-label={t(`导入${label}`)}
                type="file"
                accept=".json,application/json"
                disabled={busy}
                onChange={(e) => {
                  void importFile(kind, e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
              <textarea
                aria-label={t(label)}
                spellCheck={false}
                value={value}
                disabled={busy}
                onChange={(e) => edit(kind, e.target.value)}
                placeholder={
                  kind === "bundle" ? "model_bundle.json" : "scenario.json"
                }
              />
            </label>
          ))}
        </div>
      </details>
      <div className="engine-actions">
        <button
          disabled={busy || !bundle || !state}
          onClick={() => void run("validate")}
        >
          {t("校验模型")}
        </button>
        <button
          disabled={busy || !bundle || !scenario || !state}
          onClick={() => void run("preview")}
        >
          <Box size={14} />
          {t("加载初始场景")}
        </button>
        <button
          className="engine-primary"
          disabled={busy || !bundle || !scenario || !state}
          onClick={() => void run("workspace")}
        >
          <Play size={14} />
          {t("运行仿真")}
        </button>
        {busy && (
          <>
            <span role="status">{t("引擎处理中…")}</span>
            <button
              onClick={() =>
                void api(`${base}/cancel`, "POST", {}).catch((e) =>
                  setError(String(e)),
                )
              }
            >
              <Square size={12} />
              {t("取消")}
            </button>
          </>
        )}
        {payload && (
          <span className="engine-run-status">
            {payload.result
              ? `${t("仿真状态")} · ${payload.result.status}`
              : record?.method === "validate"
                ? t("模型校验完成")
                : `${t("初始场景")} · ${payload.preview_status}`}
          </span>
        )}
      </div>
      {error && (
        <p className="engine-notice error" role="alert">
          {error}
        </p>
      )}
      {state?.stale && (
        <p className="engine-notice" role="status">
          {t("项目输入已变化，保存的引擎结果已过期。请检查模型后重新运行。")}
        </p>
      )}
      {dirty && (
        <p className="engine-notice">
          {t("输入已修改，请重新校验或运行；旧结果已隐藏。")}
        </p>
      )}
      <nav className="engine-tabs" aria-label={t("设计视图")}>
        {[
          ["scene", "三维场景", Box],
          ["circuit", "电路与信号", CircuitBoard],
          ["flow", "物料流", Workflow],
          ["diagnostics", "诊断与覆盖", Activity],
          ["cad", "外壳 CAD", Box],
        ].map(([id, label, Icon]) => {
          const TabIcon = Icon as typeof Box;
          return (
            <button
              key={id as string}
              aria-pressed={view === id}
              className={view === id ? "active" : ""}
              onClick={() => setView(id as string)}
            >
              <TabIcon size={14} />
              {t(label as string)}
              {id === "diagnostics" && !!diagnostics.length && (
                <span>{diagnostics.length}</span>
              )}
            </button>
          );
        })}
      </nav>
      {view === "cad" ? (
        <ModelViewer {...props} />
      ) : (
        <>
          {!payload?.scene && view !== "diagnostics" && (
            <div className="engine-empty">
              <Box size={38} />
              <h3>{t("从一个可执行的模型开始")}</h3>
              <p>
                {t("选择示例或导入模型与场景，然后加载初始场景或运行仿真。")}
              </p>
              <small>{t("示例采用假设参数，仅用于演示引擎能力。")}</small>
            </div>
          )}
          {view === "scene" && payload?.scene && (
            <div className="engine-scene-layout">
              <EngineScene
                projectId={props.projectId}
                scene={payload.scene}
                frame={frame}
                selected={selected}
                onSelect={setSelected}
              />
              <aside className="engine-inspector">
                <h3>{t("装配结构")}</h3>
                {payload.scene.bodies.map((body) => (
                  <button
                    className={selected === body.entity_ref ? "active" : ""}
                    key={body.entity_ref}
                    onClick={() => setSelected(body.entity_ref)}
                  >
                    {body.entity_ref}
                  </button>
                ))}
                {!payload.scene.bodies.length && <p>{t("无几何刚体")}</p>}
                {selected && (
                  <div className="engine-properties">
                    <strong>{t("部件包络")}</strong>
                    {payload.scene.envelopes
                      .filter((e) => e.body_ref === selected)
                      .map((e) => (
                        <p key={e.entity_ref}>
                          {e.entity_ref}
                          <br />
                          <small>
                            {e.shape.kind} · {e.purpose} · {e.approximation}
                          </small>
                        </p>
                      ))}
                  </div>
                )}
                <h3>{t("关节状态 · SI")}</h3>
                {payload.scene.joints.map((j) => (
                  <p key={j.entity_ref}>
                    <code>{j.entity_ref}</code>
                    <br />
                    {j.kind} ·{" "}
                    {frame?.joint_positions[j.entity_ref]?.toFixed(4) ?? "—"}
                  </p>
                ))}
                <h3>{t("包络重叠")}</h3>
                <p>
                  {(frame?.collisions ?? payload.scene.collisions).length}{" "}
                  {t("对")}
                </p>
                {(frame?.collisions ?? payload.scene.collisions).map(
                  (pair, i) => (
                    <small className="engine-collision" key={i}>
                      {pair.join(" ↔ ")}
                    </small>
                  ),
                )}
              </aside>
            </div>
          )}
          {view === "circuit" && payload?.circuit && (
            <div className="engine-data-panel">
              <h3>{t("网络连接与采样")}</h3>
              <div className="engine-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>{t("网络")}</th>
                      <th>{t("连接端子")}</th>
                      <th>{t("值 · 质量 · 来源")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payload.circuit.nets.map((net) => (
                      <tr key={net.entity_ref}>
                        <td>
                          {net.entity_ref}
                          <small>{net.kind}</small>
                        </td>
                        <td>{net.members.join(" ↔ ")}</td>
                        <td>
                          {sampleText(
                            frame
                              ? frame.network_samples[net.entity_ref]
                              : net.sample,
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!payload.circuit.nets.length && <p>{t("未声明电气网络")}</p>}
              <h3>{t("行为 / 传感器 / 效应")}</h3>
              <div className="engine-samples">
                {payload.circuit.behaviors.map((b) => (
                  <article key={b.entity_ref}>
                    <strong>{b.entity_ref}</strong>
                    <small>{b.model_id}</small>
                    <span>
                      {sampleText(
                        frame ? frame.behavior_outputs[b.entity_ref] : b.sample,
                      )}
                    </span>
                  </article>
                ))}
                {Object.entries(frame?.sensor_samples ?? {}).map(
                  ([id, sample]) => (
                    <article key={id}>
                      <strong>{id}</strong>
                      <span>{sampleText(sample)}</span>
                    </article>
                  ),
                )}
                {Object.entries(frame?.effects ?? {}).map(([id, sample]) => (
                  <article key={id}>
                    <strong>{id}</strong>
                    <span>{sampleText(sample)}</span>
                  </article>
                ))}
              </div>
            </div>
          )}
          {view === "flow" && payload?.flow && (
            <div className="engine-data-panel">
              <h3>{t("物料流拓扑")}</h3>
              <p className="engine-notice">
                {t("仅展示端口、路径与连接，不计算流量或压力。")}
              </p>
              {payload.flow.paths.map((path) => (
                <article className="engine-flow" key={path.entity_ref}>
                  <strong>{path.entity_ref}</strong>
                  <div>
                    <span>{path.inlet_ref}</span>
                    <b>→</b>
                    <span>{path.outlet_ref}</span>
                  </div>
                </article>
              ))}
              {payload.flow.connections.map((c) => (
                <p key={c.entity_ref}>
                  {c.a} ↔ {c.b}
                </p>
              ))}
              <div className="engine-samples">
                {payload.flow.ports.map((p) => (
                  <article key={p.entity_ref}>
                    <strong>{p.entity_ref}</strong>
                    <span>
                      {p.direction} · {p.medium_kind} · {p.medium_ref}
                    </span>
                  </article>
                ))}
              </div>
              {!payload.flow.ports.length && <p>{t("未声明物料端口")}</p>}
            </div>
          )}
          {view === "diagnostics" && (
            <div className="engine-data-panel">
              <h3>{t("诊断与覆盖")}</h3>
              {!record && <p>{t("运行模型校验或仿真后查看诊断。")}</p>}
              {payload && (
                <p>
                  {t("快照")} <code>{payload.snapshot_id.slice(0, 16)}</code> ·{" "}
                  {payload.scene?.bodies.length ?? payload.bodies ?? 0}{" "}
                  {t("刚体")} ·{" "}
                  {payload.scene?.joints.length ?? payload.joints ?? 0}{" "}
                  {t("关节")}
                </p>
              )}
              {!!record && !diagnostics.length && (
                <p>{t("本次请求没有诊断项；这不代表物理验证通过。")}</p>
              )}
              {diagnostics.map((d, i) => (
                <article
                  className={`engine-diagnostic ${d.severity ?? "error"}`}
                  key={i}
                >
                  <strong>
                    {d.code ?? "schema"} · {d.outcome ?? d.severity ?? "error"}
                  </strong>
                  <p>{d.message}</p>
                  <small>
                    {d.object_refs?.join(", ") ?? d.location?.join(".")}
                  </small>
                </article>
              ))}
              {payload?.result && (
                <>
                  <h3>{t("计算覆盖范围")}</h3>
                  <ul>
                    {payload.result.coverage.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                  <p>
                    {t("实际结束时间")} {payload.result.actual_end_s.toFixed(3)}{" "}
                    s
                  </p>
                </>
              )}
            </div>
          )}
          {!!frames.length && (
            <div className="engine-timeline">
              <button
                aria-label={playing ? t("暂停回放") : t("播放回放")}
                onClick={() => {
                  if (frameIndex >= frames.length - 1) setFrameIndex(0);
                  setPlaying(!playing);
                }}
              >
                {playing ? <Square size={14} /> : <Play size={14} />}
              </button>
              <input
                type="range"
                aria-label={t("仿真时间轴")}
                min={0}
                max={frames.length - 1}
                value={frameIndex}
                onChange={(e) => {
                  setPlaying(false);
                  setFrameIndex(+e.target.value);
                }}
              />
              <output>
                {frame?.time_s.toFixed(3)} /{" "}
                {frames[frames.length - 1].time_s.toFixed(3)} s
              </output>
              <span>
                {frameIndex + 1} / {frames.length}
              </span>
            </div>
          )}
        </>
      )}
    </section>
  );
}

import {
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { Matrix4, Quaternion, Vector3 } from "three";
import { api } from "../api";
import { t, useLanguage } from "../i18n";
import { EngineScene } from "./EngineScene";
import { MeshImporter } from "./MeshImporter";
import { ModelViewer } from "./ModelViewer";
import { TopologyGraph } from "./TopologyGraph";
import { LogicNotebook } from "./LogicNotebook";
import {
  defaultNotebook,
  emptyLayout,
  identityPose,
  mergeLayout,
  notebookSchema,
  type LayoutDraft,
  type LayoutProjection,
  type NotebookDocument,
  type WorkspaceState,
} from "../../../../packages/core/src/design-workspace";
import type {
  EngineFrame,
  EnginePose,
} from "../../../../packages/core/src/design-engine";

export function DesignWorkspace(
  props: ComponentProps<typeof ModelViewer> & {
    projectVersion: number;
    children?: ReactNode;
  },
) {
  useLanguage();
  const [view, setView] = useState("structure"),
    [state, setState] = useState<WorkspaceState | null>(null);
  const [draft, setDraft] = useState<LayoutDraft>(emptyLayout),
    [notebook, setNotebook] = useState<NotebookDocument>(defaultNotebook);
  const [projection, setProjection] = useState<LayoutProjection | null>(null),
    [preview, setPreview] = useState<LayoutProjection | null>(null);
  const [selected, setSelected] = useState(""),
    [hovered, setHovered] = useState<string[]>([]),
    [dirty, setDirty] = useState(false);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [processing, setProcessing] = useState(false);
  const [jointInputs, assignJointInputs] = useState<Record<string, number>>({}),
    [playing, setPlaying] = useState(false),
    [samples, setSamples] = useState<Record<string, unknown>>({});
  const [raw, setRaw] = useState(""),
    [rawError, setRawError] = useState("");
  const [sampleFrames, setSampleFrames] = useState<
      { input: Record<string, number>; result: LayoutProjection }[]
    >([]),
    [sampleIndex, setSampleIndex] = useState(0);
  const queue = useRef<Promise<unknown>>(Promise.resolve()),
    generation = useRef(0),
    alive = useRef(true),
    stateRef = useRef(state),
    draftRef = useRef(draft),
    pendingSeq = useRef(0);
  const editRevision = useRef(0);
  function setJointInputs(inputs: Record<string, number>) {
    pendingSeq.current++;
    assignJointInputs(inputs);
    setPreview(null);
    setSampleFrames([]);
  }
  function changeNotebook(doc: NotebookDocument) {
    editRevision.current++;
    setNotebook(doc);
    setDirty(true);
  }
  stateRef.current = state;
  draftRef.current = draft;
  const base = `/projects/${props.projectId}/design`;
  const draftKey = JSON.stringify(draft),
    inputKey = JSON.stringify(jointInputs);
  useEffect(() => {
    alive.current = true;
    void load();
    return () => {
      alive.current = false;
      generation.current++;
    };
  }, [props.projectId]);
  useEffect(() => {
    if (!stateRef.current) return;
    let disposed = false;
    void api<WorkspaceState>(base)
      .then((next) => {
        const current = stateRef.current;
        if (
          !disposed &&
          current &&
          (next.contextKey !== current.contextKey ||
            next.stage !== current.stage)
        ) {
          generation.current++;
          pendingSeq.current++;
          setPreview(null);
          setPlaying(false);
          setState({ ...current, stale: true, editable: next.editable });
        }
      })
      .catch(() => {});
    return () => {
      disposed = true;
    };
  }, [props.projectVersion]);
  async function load() {
    generation.current++;
    pendingSeq.current++;
    setPlaying(false);
    setJointInputs({});
    setSamples({});
    setBusy(true);
    setError("");
    try {
      const next = await api<WorkspaceState>(base);
      if (!alive.current) return;
      stateRef.current = next;
      setState(next);
      setDraft(next.record.draft);
      setNotebook(next.record.notebook);
      setDirty(false);
      setRaw(JSON.stringify(next.record.draft, null, 2));
    } catch (e) {
      if (alive.current) setError(String(e));
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  function change(next: LayoutDraft) {
    editRevision.current++;
    generation.current++;
    draftRef.current = next;
    setDraft(next);
    setDirty(true);
    setPlaying(false);
    setPreview(null);
    setJointInputs({});
    setSamples({});
    setSampleFrames([]);
  }
  const operate = (
    method: string,
    value: LayoutDraft,
    inputs: Record<string, number> = {},
  ): Promise<LayoutProjection> => {
    const task = queue.current
      .catch(() => {})
      .then(async () => {
        if (!alive.current || !stateRef.current)
          throw new Error("工作台未就绪");
        return api<LayoutProjection>(`${base}/operate`, "POST", {
          method,
          draft: value,
          joint_inputs: inputs,
          contextKey: stateRef.current.contextKey,
        });
      });
    queue.current = task;
    return task;
  };
  useEffect(() => {
    if (!state) return;
    const token = ++generation.current;
    setPreview(null);
    setSampleFrames([]);
    setProcessing(true);
    const timer = setTimeout(() => {
      void operate("layout_project", draft)
        .then((p) => {
          if (alive.current && generation.current === token) {
            setProjection(p);
            setError("");
          }
        })
        .catch((e) => {
          if (alive.current && generation.current === token)
            setError(String(e));
        })
        .finally(() => {
          if (alive.current && generation.current === token)
            setProcessing(false);
        });
    }, 150);
    return () => clearTimeout(timer);
  }, [draftKey, state?.record.revision]);
  useEffect(() => {
    if (!state || !Object.keys(jointInputs).length) return;
    const token = generation.current,
      seq = ++pendingSeq.current;
    setPreview(null);
    setSampleFrames([]);
    const timer = setTimeout(() => {
      const task = queue.current
        .catch(() => {})
        .then(async () => {
          if (seq !== pendingSeq.current || !alive.current) return;
          return api<LayoutProjection>(`${base}/operate`, "POST", {
            method: "layout_motion",
            draft: draftRef.current,
            joint_inputs: jointInputs,
            contextKey: stateRef.current!.contextKey,
          });
        });
      queue.current = task;
      void task
        .then((p) => {
          if (p && token === generation.current && seq === pendingSeq.current)
            setPreview(p);
        })
        .catch((e) => {
          if (seq === pendingSeq.current) setError(String(e));
        });
    }, 120);
    return () => {
      clearTimeout(timer);
      pendingSeq.current++;
    };
  }, [inputKey]);
  const followers = new Set(
    Object.values(draft.transmissions).map((tr) => tr.follower),
  );
  useEffect(() => {
    if (!playing) return;
    const start = performance.now();
    const id = setInterval(() => {
      const seconds = (performance.now() - start) / 1000;
      setJointInputs(
        Object.fromEntries(
          Object.entries(draft.joints)
            .filter(([id, j]) => j.kind !== "fixed" && !followers.has(id))
            .map(([id, j]) => [
              id,
              j.kind === "continuous"
                ? seconds
                : (j.lower ?? 0) +
                  ((Math.sin(seconds) + 1) / 2) *
                    ((j.upper ?? 1) - (j.lower ?? 0)),
            ]),
        ),
      );
    }, 180);
    return () => clearInterval(id);
  }, [playing, draftKey]);
  async function check(method: string) {
    setBusy(true);
    setPlaying(false);
    const token = generation.current,
      seq = ++pendingSeq.current;
    try {
      const result = await operate(
        method,
        draft,
        sampleFrames[sampleIndex]?.input ?? jointInputs,
      );
      if (
        token === generation.current &&
        seq === pendingSeq.current &&
        alive.current
      )
        setPreview(result);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function sampleMotion() {
    setPlaying(false);
    setBusy(true);
    const token = generation.current,
      seq = ++pendingSeq.current;
    const frames = [];
    try {
      for (let i = 0; i <= 12; i++) {
        if (
          !alive.current ||
          generation.current !== token ||
          seq !== pendingSeq.current
        )
          break;
        const input = Object.fromEntries(
          Object.entries(draft.joints)
            .filter(([id, j]) => j.kind !== "fixed" && !followers.has(id))
            .map(([id, j]) => [
              id,
              j.kind === "continuous"
                ? (i / 12) * Math.PI * 2
                : (j.lower ?? 0) + (i / 12) * ((j.upper ?? 1) - (j.lower ?? 0)),
            ]),
        );
        const result = await operate("layout_collision", draft, input);
        frames.push({ input, result });
      }
      if (
        generation.current === token &&
        seq === pendingSeq.current &&
        alive.current
      ) {
        setSampleFrames(frames);
        setSampleIndex(0);
        setPreview(frames[0]?.result ?? null);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (!state) return;
    setBusy(true);
    setPlaying(false);
    setError("");
    const revision = editRevision.current;
    try {
      await queue.current.catch(() => {});
      const response = await api<{
        state: WorkspaceState;
        projection: LayoutProjection;
      }>(base, "POST", {
        contextKey: state.contextKey,
        baseRevision: state.record.revision,
        draft,
        notebook,
      });
      if (!alive.current) return;
      stateRef.current = response.state;
      setState(response.state);
      if (editRevision.current === revision) {
        setProjection(response.projection);
        setDirty(false);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function importSource(
    source: object,
    scenario?: object,
    append = false,
  ) {
    setBusy(true);
    setError("");
    const revision = editRevision.current;
    try {
      await queue.current.catch(() => {});
      const result = await api<{ draft: LayoutDraft }>(
        `${base}/operate`,
        "POST",
        {
          method: "layout_import",
          source,
          scenario,
          contextKey: stateRef.current!.contextKey,
        },
      );
      if (!alive.current) return;
      if (!append && revision !== editRevision.current)
        throw new Error(t("导入期间布局已变化，请重试"));
      const next = append
        ? mergeLayout(
            draftRef.current,
            result.draft,
            `import_${crypto.randomUUID()}`,
          )
        : result.draft;
      change(next);
      setRaw(JSON.stringify(next, null, 2));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function example(name: string) {
    try {
      const value = await api<{ bundle: object; scenario: object }>(
        `/projects/${props.projectId}/engine/examples/${name}`,
      );
      await importSource(value.bundle, value.scenario);
    } catch (e) {
      setError(String(e));
    }
  }
  function addBox() {
    const next = structuredClone(draft),
      id = `part_${Date.now()}`,
      body = `${id}/bodies/body`;
    next.entities[id] = {
      name: `元件 ${Object.keys(next.entities).length + 1}`,
    };
    next.bodies[body] = {
      entity: id,
      pose: {
        ...identityPose(),
        translation_m: [Object.keys(next.entities).length * 0.025, 0, 0],
      },
    };
    next.envelopes[`${id}/envelopes/solid`] = {
      body,
      pose: identityPose(),
      shape: { kind: "box", size_m: [0.03, 0.02, 0.02] },
      purpose: "solid",
      approximation: "outer",
      margin_m: 0,
    };
    change(next);
    setSelected(body);
  }
  function poseChange(body: string, pose: EnginePose) {
    const next = structuredClone(draft);
    if (next.bodies[body]) {
      next.bodies[body].pose = pose;
      change(next);
    }
  }
  const displayed = preview ?? projection;
  const mapped = (refs: string[]) => [
    ...new Set(
      refs.flatMap(
        (ref) =>
          projection?.bindings[ref] ??
          (draft.joints[ref]
            ? [draft.joints[ref].parent, draft.joints[ref].child]
            : []),
      ),
    ),
  ];
  const selectedBody = draft.bodies[selected]
    ? selected
    : (mapped([selected])[0] ?? "");
  const selectedEntity = draft.entities[selected]
    ? selected
    : (draft.bodies[selectedBody]?.entity ?? "");
  const highlights = mapped(hovered.length ? hovered : [selected]);
  const anchors = hovered.flatMap((ref) => {
    const p = draft.ports[ref];
    return p?.body && p.pose ? [{ body: p.body, pose: p.pose }] : [];
  });
  const frame: EngineFrame | undefined = preview
    ? {
        time_s: 0,
        body_poses: Object.fromEntries(
          preview.scene.bodies.map((b) => [b.entity_ref, b.world_pose!]),
        ),
        joint_positions: preview.motion?.joint_positions ?? jointInputs,
        network_samples: {},
        behavior_outputs: {},
        sensor_samples: {},
        effects: {},
        collisions: preview.scene.collisions,
      }
    : undefined;
  const problems = [
    ...(displayed?.diagnostics ?? []),
    ...(preview?.check?.diagnostics ?? []),
    ...(preview?.motion?.diagnostics ?? []),
  ];
  function outputs(value: Record<string, unknown>) {
    const inputs: Record<string, number> = {},
      signals: Record<string, unknown> = {};
    for (const b of notebook.bindings) {
      const result = value[b.output];
      if (result === undefined) continue;
      if (
        b.unit === "sample" &&
        draft.ports[b.target]?.domain === "information"
      )
        signals[b.target] = result;
      else if (
        typeof result === "number" &&
        Number.isFinite(result) &&
        draft.joints[b.target]
      ) {
        const j = draft.joints[b.target],
          linear = j.kind === "prismatic";
        if (
          (linear && !["m", "mm"].includes(b.unit)) ||
          (!linear && !["deg", "rad"].includes(b.unit))
        ) {
          setError(t("输出单位与关节不兼容"));
          continue;
        }
        inputs[b.target] =
          result *
          (b.unit === "deg" ? Math.PI / 180 : b.unit === "mm" ? 0.001 : 1);
      }
    }
    setSamples(signals);
    setJointInputs(inputs);
    if (!Object.keys(inputs).length) setPreview(null);
  }
  const scene = projection && (
    <EngineScene
      projectId={props.projectId}
      scene={projection.scene}
      frame={frame}
      selected={selectedBody}
      onSelect={setSelected}
      highlighted={highlights}
      anchors={anchors}
      onPoseChange={view === "structure" && !busy ? poseChange : undefined}
    />
  );
  return (
    <section
      className="design-workbench layout-workbench"
      aria-label={t("产品设计工作台")}
    >
      <header className="engine-heading">
        <div>
          <span className="eyebrow">DESIGN WORKSPACE</span>
          <h2>{t("布局、连接与逻辑")}</h2>
        </div>
        <span className="badge">
          {t("草稿版本")} {state?.record.revision ?? 0} {dirty ? "· *" : ""}
        </span>
      </header>
      <div className="engine-toolbar">
        <button disabled={busy || !state?.editable} onClick={() => void save()}>
          {t("保存设计草稿")}
        </button>
        <button disabled={busy} onClick={() => void load()}>
          {t("重新加载项目设计")}
        </button>
        <button disabled={busy} onClick={addBox}>
          {t("添加元件")}
        </button>
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
          onClick={() => {
            const url = URL.createObjectURL(
              new Blob([JSON.stringify({ draft, notebook }, null, 2)], {
                type: "application/json",
              }),
            );
            const a = document.createElement("a");
            a.href = url;
            a.download = "design-workspace.json";
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          }}
        >
          {t("导出布局")}
        </button>
        <span role="status">
          {processing
            ? t("更新视图…")
            : busy
              ? t("处理中…")
              : dirty
                ? t("未保存")
                : t("布局就绪")}
        </span>
      </div>
      {error && (
        <p className="engine-notice error" role="alert">
          {error}
        </p>
      )}
      {state?.stale && (
        <p className="engine-notice">
          {t("项目输入已变化，请检查布局来源；旧检查不作为当前证据。")}
        </p>
      )}
      <nav className="engine-tabs" aria-label={t("设计视图")}>
        {[
          ["structure", "结构"],
          ["motion", "运动"],
          ["circuit", "电路与能源"],
          ["flow", "物料与信息流动"],
          ["logic", "代码与逻辑"],
        ].map(([id, label]) => (
          <button
            key={id}
            aria-pressed={view === id}
            className={view === id ? "active" : ""}
            onClick={() => {
              setView(id);
              setHovered([]);
              setPlaying(false);
            }}
          >
            {t(label)}
          </button>
        ))}
      </nav>
      <div
        className={`workspace-grid ${view === "structure" || view === "motion" ? "spatial" : "diagram"}`}
      >
        <aside className="workspace-tree">
          <h3>{t("元件")}</h3>
          {Object.entries(draft.entities).map(([id, e]) => (
            <button
              key={id}
              className={selectedEntity === id ? "active" : ""}
              onClick={() => setSelected(id)}
              onMouseEnter={() => setHovered([id])}
              onMouseLeave={() => setHovered([])}
            >
              {e.name}
            </button>
          ))}
          {!Object.keys(draft.entities).length && (
            <p>{t("添加元件或载入示例开始布局")}</p>
          )}
        </aside>
        <main className="workspace-canvas">
          {(view === "structure" || view === "motion") && scene}
          {(view === "circuit" || view === "flow") && projection && (
            <TopologyGraph
              graph={projection[view]}
              selected={selectedEntity || selected}
              onSelect={setSelected}
              onHover={setHovered}
              samples={samples}
            />
          )}
          {view === "logic" && (
            <LogicNotebook
              document={notebook}
              onChange={changeNotebook}
              draft={draft}
              onOutputs={outputs}
              onHover={setHovered}
            />
          )}
        </main>
        <aside className="workspace-inspector">
          {!["structure", "motion"].includes(view) && (
            <div className="workspace-mini-scene">{scene}</div>
          )}
          <h3>{t("选中对象")}</h3>
          <code>{selected || "—"}</code>
          {selectedBody && draft.bodies[selectedBody] && (
            <>
              <p>{selectedBody}</p>
              {view === "structure" && (
                <>
                  {["X", "Y", "Z"].map((axis, i) => (
                    <label key={axis}>
                      {axis} mm
                      <input
                        aria-label={`${axis} mm`}
                        type="number"
                        step="1"
                        value={
                          +(
                            draft.bodies[selectedBody].pose.translation_m[i] *
                            1000
                          ).toFixed(4)
                        }
                        onChange={(e) => {
                          const pose = structuredClone(
                            draft.bodies[selectedBody].pose,
                          );
                          pose.translation_m[i] = +e.target.value / 1000;
                          poseChange(selectedBody, pose);
                        }}
                      />
                    </label>
                  ))}
                  {Object.entries(draft.envelopes)
                    .filter(
                      ([, e]) =>
                        e.body === selectedBody && e.shape.kind === "box",
                    )
                    .map(
                      ([id, env]) =>
                        env.shape.kind === "box" && (
                          <div key={id}>
                            {["宽", "深", "高"].map((label, i) => (
                              <label key={label}>
                                {t(label)} mm
                                <input
                                  type="number"
                                  min="0.1"
                                  value={
                                    env.shape.kind === "box"
                                      ? env.shape.size_m[i] * 1000
                                      : 0
                                  }
                                  onChange={(e) => {
                                    if (+e.target.value <= 0) return;
                                    const next = structuredClone(draft);
                                    const shape = next.envelopes[id].shape;
                                    if (shape.kind === "box")
                                      shape.size_m[i] = +e.target.value / 1000;
                                    change(next);
                                  }}
                                />
                              </label>
                            ))}
                          </div>
                        ),
                    )}
                  <button
                    onClick={() => {
                      const next = structuredClone(draft);
                      delete next.bodies[selectedBody];
                      for (const [id, env] of Object.entries(next.envelopes))
                        if (env.body === selectedBody)
                          delete next.envelopes[id];
                      change(next);
                      setSelected("");
                    }}
                  >
                    {t("移除刚体")}
                  </button>
                </>
              )}
            </>
          )}
          {view === "motion" && (
            <>
              <button onClick={() => setPlaying(!playing)} disabled={busy}>
                {t(playing ? "暂停" : "播放运动")}
              </button>
              <button
                onClick={() => {
                  setPlaying(false);
                  setJointInputs({});
                  setPreview(null);
                }}
              >
                {t("重置姿态")}
              </button>
              {Object.entries(draft.joints)
                .filter(([, j]) => j.kind !== "fixed")
                .map(([id, j]) => {
                  const factor = j.kind === "prismatic" ? 1000 : 180 / Math.PI,
                    value =
                      (preview?.motion?.joint_positions?.[id] ??
                        jointInputs[id] ??
                        j.initial ??
                        0) * factor;
                  return (
                    <label key={id}>
                      {id} ({j.kind === "prismatic" ? "mm" : "°"})
                      <input
                        aria-label={id}
                        type="range"
                        min={(j.lower ?? -Math.PI) * factor}
                        max={(j.upper ?? Math.PI) * factor}
                        step="any"
                        value={value}
                        disabled={followers.has(id) || busy}
                        onChange={(e) => {
                          setPlaying(false);
                          setJointInputs({
                            ...jointInputs,
                            [id]: +e.target.value / factor,
                          });
                        }}
                      />
                      <input
                        aria-label={`${id} value`}
                        type="number"
                        step={0.1}
                        value={+value.toFixed(3)}
                        disabled={followers.has(id) || busy}
                        onChange={(e) =>
                          setJointInputs({
                            ...jointInputs,
                            [id]: +e.target.value / factor,
                          })
                        }
                      />
                    </label>
                  );
                })}
              <button disabled={busy} onClick={() => void sampleMotion()}>
                {t("检查 13 个运动采样姿态")}
              </button>
            </>
          )}
        </aside>
      </div>
      <div className="engine-actions">
        <button
          disabled={busy || !projection}
          onClick={() => void check("layout_collision")}
        >
          {t("检查当前姿态碰撞")}
        </button>
        <button
          disabled={busy || !projection}
          onClick={() => void check("layout_connectivity")}
        >
          {t("检查连通关系")}
        </button>
        {busy && (
          <button
            onClick={() => {
              generation.current++;
              void api(
                `/projects/${props.projectId}/engine/cancel`,
                "POST",
                {},
              );
            }}
          >
            {t("取消检查")}
          </button>
        )}
        <span>
          {preview?.check
            ? `${preview.check.kind} · ${preview.check.status}`
            : t("当前姿态尚未检查")}
        </span>
      </div>
      {!!sampleFrames.length && (
        <div className="engine-timeline">
          <input
            aria-label={t("运动采样帧")}
            type="range"
            min="0"
            max={sampleFrames.length - 1}
            value={sampleIndex}
            onChange={(e) => {
              const i = +e.target.value;
              setSampleIndex(i);
              setPreview(sampleFrames[i].result);
            }}
          />
          <span>
            {sampleIndex + 1}/{sampleFrames.length} ·{" "}
            {sampleFrames.filter((f) => f.result.check?.pairs?.length).length}{" "}
            {t("个采样姿态存在重叠")}
          </span>
        </div>
      )}
      <details className="workspace-diagnostics" open={problems.length > 0}>
        <summary>
          {t("检查与问题")} · {problems.length}
        </summary>
        {problems.map((d, i) => (
          <button
            key={i}
            className={`engine-diagnostic ${d.severity}`}
            onClick={() => {
              setSelected(d.object_refs?.[0] ?? "");
              setHovered(d.object_refs ?? []);
            }}
          >
            <strong>{d.code}</strong>
            <span>{d.message}</span>
            <small>{d.object_refs?.join(" ↔ ")}</small>
          </button>
        ))}
        {preview?.check && (
          <p>
            {t("未检查对象")}:{" "}
            {[
              ...(preview.check.skipped ?? []),
              ...(preview.check.missing_bodies ?? []),
            ].join(", ") || "—"}
            <br />
            {preview.check.coverage?.join(" · ")}
          </p>
        )}
      </details>
      <details>
        <summary>{t("编辑关节、端口与连接")}</summary>
        <LayoutRelations draft={draft} onChange={change} />
      </details>
      <details
        onToggle={(e) => {
          if (e.currentTarget.open) setRaw(JSON.stringify(draft, null, 2));
        }}
      >
        <summary>{t("布局 JSON 与导入")}</summary>
        <input
          aria-label={t("导入布局 JSON")}
          type="file"
          accept=".json"
          disabled={busy}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            try {
              if (file.size > 5000000) throw new Error("文件不能超过 5 MB");
              const data = JSON.parse(await file.text());
              const doc = data.notebook
                ? notebookSchema.parse(data.notebook)
                : null;
              if (data.draft) {
                await importSource(data.draft);
                if (doc) changeNotebook(doc);
              } else await importSource(data.bundle ?? data, data.scenario);
            } catch (err) {
              setRawError(String(err));
            }
          }}
        />
        <textarea
          aria-label={t("布局源 JSON")}
          className="layout-json"
          value={raw}
          spellCheck={false}
          onChange={(e) => setRaw(e.target.value)}
        />
        <button
          disabled={busy}
          onClick={() => {
            try {
              const next = JSON.parse(raw);
              void importSource(next);
              setRawError("");
            } catch (e) {
              setRawError(String(e));
            }
          }}
        >
          {t("应用布局")}
        </button>
        {rawError && <p role="alert">{rawError}</p>}
      </details>
      {view === "structure" && (
        <details className="workspace-cad">
          <summary>{t("CAD 几何与构件映射")}</summary>
          <MeshImporter
            projectId={props.projectId}
            contextKey={state?.contextKey}
            busy={busy}
            onBusy={setBusy}
            onDocuments={(b, s) => importSource(b, s, true)}
          />
          <CadBindings
            projectId={props.projectId}
            draft={draft}
            onChange={change}
            busy={busy}
          />
          {props.children}
        </details>
      )}
    </section>
  );
}

function LayoutRelations({
  draft,
  onChange,
}: {
  draft: LayoutDraft;
  onChange: (d: LayoutDraft) => void;
}) {
  const [owner, setOwner] = useState(""),
    [domain, setDomain] = useState<"electrical" | "material" | "information">(
      "information",
    ),
    [name, setName] = useState("port"),
    [a, setA] = useState(""),
    [b, setB] = useState("");
  const [parent, setParent] = useState(""),
    [child, setChild] = useState(""),
    [kind, setKind] = useState<
      "revolute" | "prismatic" | "continuous" | "fixed"
    >("revolute"),
    [driver, setDriver] = useState(""),
    [follower, setFollower] = useState(""),
    [ratio, setRatio] = useState(1);
  return (
    <div className="relation-editors">
      <fieldset>
        <legend>{t("端口和连接")}</legend>
        <select
          aria-label={t("端口实体")}
          value={owner}
          onChange={(e) => setOwner(e.target.value)}
        >
          <option value="">{t("选择实体")}</option>
          {Object.entries(draft.entities).map(([id, e]) => (
            <option key={id} value={id}>
              {e.name}
            </option>
          ))}
        </select>
        <select
          aria-label={t("端口领域")}
          value={domain}
          onChange={(e) => setDomain(e.target.value as typeof domain)}
        >
          <option value="electrical">{t("电路")}</option>
          <option value="material">{t("物料")}</option>
          <option value="information">{t("信息")}</option>
        </select>
        <input
          aria-label={t("端口名称")}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button
          disabled={!owner || !name.trim()}
          onClick={() => {
            const next = structuredClone(draft);
            next.ports[`${owner}/ports/${Date.now()}`] = {
              entity: owner,
              name,
              domain,
              direction: "bidirectional",
              role: domain === "electrical" ? "passive" : "",
              required: false,
              body:
                Object.keys(draft.bodies).find(
                  (k) => draft.bodies[k].entity === owner,
                ) ?? null,
            };
            onChange(next);
          }}
        >
          {t("添加端口")}
        </button>
        {[a, b].map((value, index) => (
          <select
            key={index}
            aria-label={t(index ? "连接终点" : "连接起点")}
            value={value}
            onChange={(e) => (index ? setB : setA)(e.target.value)}
          >
            <option value="">{t("选择端口")}</option>
            {Object.entries(draft.ports).map(([id, p]) => (
              <option key={id} value={id}>
                {id} · {p.domain}
              </option>
            ))}
          </select>
        ))}
        <button
          disabled={!a || !b || a === b}
          onClick={() => {
            const next = structuredClone(draft);
            next.edges[`edge_${Date.now()}`] = {
              domain: draft.ports[a].domain,
              members: [a, b],
              kind: "connection",
              directed: draft.ports[a].domain !== "electrical",
            };
            onChange(next);
          }}
        >
          {t("添加连接")}
        </button>
        {Object.entries(draft.ports).map(([id, p]) => (
          <label key={id}>
            {p.name}
            <select
              value={p.direction}
              onChange={(e) => {
                const next = structuredClone(draft);
                next.ports[id].direction = e.target.value as typeof p.direction;
                onChange(next);
              }}
            >
              <option value="bidirectional">↔</option>
              <option value="in">in</option>
              <option value="out">out</option>
            </select>
            <input
              type="checkbox"
              checked={p.required}
              onChange={(e) => {
                const next = structuredClone(draft);
                next.ports[id].required = e.target.checked;
                onChange(next);
              }}
            />
            {t("必需连接")}
            <button
              onClick={() => {
                const next = structuredClone(draft);
                delete next.ports[id];
                onChange(next);
              }}
            >
              {t("移除")}
            </button>
          </label>
        ))}
        {Object.keys(draft.edges).map((id) => (
          <button
            key={id}
            onClick={() => {
              const next = structuredClone(draft);
              delete next.edges[id];
              onChange(next);
            }}
          >
            {t("移除连接")} {id}
          </button>
        ))}
      </fieldset>
      <fieldset>
        <legend>{t("关节与传动")}</legend>
        {[parent, child].map((value, index) => (
          <select
            key={index}
            aria-label={t(index ? "子刚体" : "父刚体")}
            value={value}
            onChange={(e) => (index ? setChild : setParent)(e.target.value)}
          >
            <option value="">{t("选择刚体")}</option>
            {Object.keys(draft.bodies).map((id) => (
              <option key={id}>{id}</option>
            ))}
          </select>
        ))}
        <select
          value={kind}
          aria-label={t("关节类型")}
          onChange={(e) => setKind(e.target.value as typeof kind)}
        >
          {["revolute", "prismatic", "continuous", "fixed"].map((k) => (
            <option key={k}>{k}</option>
          ))}
        </select>
        <button
          disabled={!parent || !child}
          onClick={() => {
            const next = structuredClone(draft);
            next.joints[`joints/joint_${Date.now()}`] = {
              parent,
              child,
              kind,
              axis: kind === "fixed" ? null : [0, 0, 1],
              parent_anchor: identityPose(),
              child_anchor: identityPose(),
              initial: kind === "fixed" ? null : 0,
              lower:
                kind === "prismatic"
                  ? 0
                  : kind === "revolute"
                    ? -Math.PI
                    : null,
              upper:
                kind === "prismatic"
                  ? 0.1
                  : kind === "revolute"
                    ? Math.PI
                    : null,
            };
            onChange(next);
          }}
        >
          {t("添加关节")}
        </button>
        {[driver, follower].map((value, index) => (
          <select
            key={index}
            aria-label={t(index ? "从动关节" : "主动关节")}
            value={value}
            onChange={(e) => (index ? setFollower : setDriver)(e.target.value)}
          >
            <option value="">{t("选择关节")}</option>
            {Object.keys(draft.joints).map((id) => (
              <option key={id}>{id}</option>
            ))}
          </select>
        ))}
        <input
          type="number"
          aria-label={t("传动比或导程")}
          value={ratio}
          onChange={(e) => setRatio(+e.target.value)}
        />
        <button
          disabled={!driver || !follower}
          onClick={() => {
            const next = structuredClone(draft);
            next.transmissions[`transmission_${Date.now()}`] = {
              driver,
              follower,
              factor: ratio,
              offset: 0,
              kind:
                draft.joints[follower].kind === "prismatic"
                  ? "screw"
                  : "rotary_ratio",
            };
            onChange(next);
          }}
        >
          {t("添加传动")}
        </button>
        <p>{t("轴线、锚点、内部路径和额定描述可在布局 JSON 中编辑。")}</p>
        {Object.keys(draft.joints).map((id) => (
          <button
            key={id}
            onClick={() => {
              const next = structuredClone(draft);
              delete next.joints[id];
              onChange(next);
            }}
          >
            {t("移除关节")} {id}
          </button>
        ))}
      </fieldset>
    </div>
  );
}

function CadBindings({
  projectId,
  draft,
  onChange,
  busy,
}: {
  projectId: string;
  draft: LayoutDraft;
  onChange: (d: LayoutDraft) => void;
  busy: boolean;
}) {
  const [meshes, setMeshes] = useState<
      {
        id: string;
        name: string;
        sha256: string;
        unit: "m" | "mm" | "cm";
        volume_candidate: boolean;
        assemblyPose?: EnginePose;
      }[]
    >([]),
    [asset, setAsset] = useState(""),
    [body, setBody] = useState(""),
    [error, setError] = useState("");
  async function refresh(cad = false) {
    try {
      setMeshes(
        cad
          ? await api(`/projects/${projectId}/design/cad-assets`, "POST", {})
          : await api(`/projects/${projectId}/engine/meshes`),
      );
      setError("");
    } catch (e) {
      setError(String(e));
    }
  }
  return (
    <div className="engine-toolbar">
      <button disabled={busy} onClick={() => void refresh()}>
        {t("刷新网格资产")}
      </button>
      <button disabled={busy} onClick={() => void refresh(true)}>
        {t("导入当前 CAD 构件")}
      </button>
      <select
        aria-label={t("绑定网格")}
        value={asset}
        onChange={(e) => setAsset(e.target.value)}
      >
        <option value="">{t("选择 STL")}</option>
        {meshes.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>
      <select
        aria-label={t("绑定刚体")}
        value={body}
        onChange={(e) => setBody(e.target.value)}
      >
        <option value="">{t("新建 CAD 构件")}</option>
        {Object.keys(draft.bodies).map((id) => (
          <option key={id}>{id}</option>
        ))}
      </select>
      <button
        disabled={!asset || busy}
        onClick={() => {
          const mesh = meshes.find((m) => m.id === asset);
          if (!mesh) return;
          const next = structuredClone(draft),
            entity = `cad_${mesh.id.replaceAll("-", "_")}`,
            target = body || `${entity}/bodies/body`;
          if (!body) {
            next.entities[entity] = { name: mesh.name };
            next.bodies[target] = {
              entity,
              pose: mesh.assemblyPose ?? identityPose(),
            };
          }
          for (const [key, envelope] of Object.entries(next.envelopes))
            if (envelope.body === target && envelope.purpose === "solid")
              delete next.envelopes[key];
          const matrix = (p: EnginePose) =>
            new Matrix4().compose(
              new Vector3(...p.translation_m),
              new Quaternion(...p.rotation_xyzw),
              new Vector3(1, 1, 1),
            );
          let pose = identityPose();
          if (body && mesh.assemblyPose) {
            const position = new Vector3(),
              rotation = new Quaternion();
            matrix(next.bodies[target].pose)
              .invert()
              .multiply(matrix(mesh.assemblyPose))
              .decompose(position, rotation, new Vector3());
            pose = {
              translation_m: position.toArray(),
              rotation_xyzw: rotation.toArray(),
            };
          }
          next.envelopes[`${target}/geometry/${mesh.id}`] = {
            body: target,
            pose,
            shape: {
              kind: "triangle_mesh",
              unit: mesh.unit,
              collision_mode: mesh.volume_candidate ? "solid" : "surface",
              asset_ref: {
                artifact_id: mesh.id,
                sha256: mesh.sha256,
                media_type: "model/stl",
              },
            },
            purpose: "solid",
            approximation: "outer",
            margin_m: 0,
          };
          onChange(next);
        }}
      >
        {t("绑定到布局")}
      </button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}

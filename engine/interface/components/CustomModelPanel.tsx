import { useEffect, useMemo, useRef, useState } from "react";
import { EngineScene } from "./EngineScene";
import type { EngineScene as SceneData, LayoutProjection } from "../contracts";
import {
  MATERIALS,
  parseCondition,
  parseProject,
  type ConditionPack,
  type ModelProject,
  type MaterialId,
} from "../../custom_model/contracts";
import { EXAMPLE, toSTL, type ModelResult } from "../../custom_model/model";
import "./CustomModelPanel.css";

const GROUPS: Record<string, string> = {
  intent: "设计目标与范围",
  references: "参考图片与外观",
  context: "元件、位置与 CAD",
  design_space: "设计空间与避让",
  requirements: "连接、承托与装配要求",
  manufacturing: "材料与制造工艺",
  objectives: "设计偏好",
  acceptance: "验收要求（仅记录）",
  deliverables: "交付要求",
  sources: "来源",
  evidence: "证据",
  open_questions: "待补充信息",
};
function download(name: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function readSaved(key: string): ModelProject | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? parseProject(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}
type Preview = {
  result: ModelResult;
  signature: string;
  scene: SceneData;
  assets: Map<string, ArrayBuffer>;
};
export function CustomModelPanel({
  designId,
  title,
  view,
}: {
  designId: string;
  title: string;
  view: LayoutProjection;
}) {
  const storageKey = `dreamatic.custom-model.v1.${designId}`;
  const [initial] = useState(() => readSaved(storageKey));
  const [sourceSnapshot, setSourceSnapshot] = useState(
    initial?.source_snapshot_id ?? view.snapshot_id,
  );
  const [commands, setCommands] = useState(initial?.commands ?? EXAMPLE);
  const [material, setMaterial] = useState<MaterialId>(
    initial?.material ?? "PLA",
  );
  const [packs, setPacks] = useState<ConditionPack[]>(
    initial?.conditions ?? [],
  );
  const [selectedPack, setSelectedPack] = useState<string | null>(null);
  const [editor, setEditor] = useState("");
  const [editing, setEditing] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [running, setRunning] = useState(false),
    [error, setError] = useState("");
  const [storageError, setStorageError] = useState("");
  const [selectedBody, setSelectedBody] = useState("");
  const [contextVisible, setContextVisible] = useState(true);
  const job = useRef<{
    worker: Worker;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);
  const generation = useRef(0);
  const context: ConditionPack = useMemo(
    () => ({
      record_kind: "custom_model_conditions",
      schema_version: "0.1.0-draft",
      condition_id: "resolved_context",
      revision: 1,
      title: `${title} · 当前设计上下文`,
      source_design: { design_id: designId, snapshot_id: view.snapshot_id },
      intent: {
        description: "为已放置的元件设计外壳或连接结构",
        placement_policy: "locked",
      },
      references: {},
      context: { unit: "m", draft: view.draft, scene: view.scene },
      design_space: {},
      requirements: {},
      manufacturing: {},
      objectives: {},
      acceptance: {},
      deliverables: {},
      open_questions: ["本包仅提取已有空间事实；请导入或新增定制设计条件。"],
    }),
    [designId, title, view],
  );
  const active =
    selectedPack === null
      ? context
      : (packs.find((p) => p.condition_id === selectedPack) ?? context);
  const project: ModelProject = {
    record_kind: "custom_model_project",
    schema_version: "0.1.0-draft",
    design_id: designId,
    source_snapshot_id: sourceSnapshot,
    commands,
    material,
    conditions: packs,
  };
  const signature = JSON.stringify([commands, packs, view.snapshot_id]);
  const stale = !!preview && preview.signature !== signature;
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(project));
      setStorageError("");
    } catch {
      setStorageError("浏览器本地保存失败，请下载模型项目备份。");
    }
  }, [storageKey, commands, material, packs, sourceSnapshot]);
  function cancel() {
    generation.current++;
    if (job.current) {
      clearTimeout(job.current.timer);
      job.current.worker.terminate();
      job.current = null;
    }
    setRunning(false);
  }
  useEffect(
    () => () => {
      generation.current++;
      if (job.current) {
        clearTimeout(job.current.timer);
        job.current.worker.terminate();
      }
    },
    [],
  );
  async function run() {
    cancel();
    setRunning(true);
    setError("");
    const token = generation.current;
    const worker = new Worker(
      new URL("../../custom_model/model.worker.ts", import.meta.url),
      { type: "module" },
    );
    const fail = (message: string) => {
      if (token === generation.current) {
        cancel();
        setError(message);
      }
    };
    const timer = setTimeout(
      () => fail("建模超过 30 秒，已停止。请简化命令后重试。"),
      30000,
    );
    job.current = { worker, timer };
    worker.onerror = (e) => fail(e.message || "CAD 工作器启动失败");
    worker.onmessage = async (
      e: MessageEvent<{ error?: string; result: ModelResult }>,
    ) => {
      if (token !== generation.current) return;
      if (e.data.error) {
        fail(e.data.error);
        return;
      }
      try {
        const result = e.data.result;
        const assets = new Map<string, ArrayBuffer>();
        const scene: SceneData = {
          snapshot_id: signature,
          bodies: [],
          envelopes: [],
          joints: [],
          visual_assets: [],
          collisions: [],
        };
        for (const part of result.parts) {
          const bytes = toSTL(part);
          const sha256 = [
            ...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
          ]
            .map((n) => n.toString(16).padStart(2, "0"))
            .join("");
          assets.set(sha256, bytes);
          const id = `custom/${part.id}`;
          const pose = {
            translation_m: [0, 0, 0] as [number, number, number],
            rotation_xyzw: [0, 0, 0, 1] as [number, number, number, number],
          };
          scene.bodies.push({ entity_ref: id, world_pose: pose });
          scene.envelopes.push({
            entity_ref: `${id}/mesh`,
            body_ref: id,
            pose,
            shape: {
              kind: "triangle_mesh",
              unit: "mm",
              collision_mode: "surface",
              asset_ref: { artifact_id: id, sha256, media_type: "model/stl" },
            },
            purpose: "solid",
            approximation: "unknown",
            margin_m: 0,
          });
        }
        if (token !== generation.current) return;
        setPreview({ result, signature, scene, assets });
        setSourceSnapshot(view.snapshot_id);
        cancel();
      } catch (err) {
        fail(String(err));
      }
    };
    worker.postMessage(commands);
  }
  const scene = useMemo(
    () => ({
      ...(preview?.scene ?? {
        snapshot_id: view.snapshot_id,
        bodies: [],
        envelopes: [],
        joints: [],
        visual_assets: [],
        collisions: [],
      }),
      bodies: [
        ...(contextVisible ? view.scene.bodies : []),
        ...(preview?.scene.bodies ?? []),
      ],
      envelopes: [
        ...(contextVisible
          ? view.scene.envelopes.filter(
              (e) =>
                e.shape.kind !== "triangle_mesh" &&
                e.shape.kind !== "convex_asset",
            )
          : []),
        ...(preview?.scene.envelopes ?? []),
      ],
      collisions: [] as [string, string][],
    }),
    [preview, contextVisible, view],
  );
  const colors = Object.fromEntries(
    (preview?.scene.bodies ?? []).map((b) => [
      b.entity_ref,
      MATERIALS[material].color,
    ]),
  );
  const loadMesh = useMemo(
    () => async (asset: { sha256: string }) => {
      const bytes = preview?.assets.get(asset.sha256);
      if (!bytes) throw new Error("预览资产不存在");
      return bytes;
    },
    [preview],
  );
  async function importFiles(files: FileList | null) {
    if (!files) return;
    setError("");
    try {
      const incoming: ConditionPack[] = [];
      let incomingProject: ModelProject | null = null;
      for (const file of Array.from(files)) {
        if (file.size > 2_000_000) throw new Error("每个 JSON 文件最多 2 MB");
        const data = JSON.parse(await file.text());
        if (data.record_kind === "custom_model_project") {
          if (files.length !== 1) throw new Error("模型项目需单独导入");
          incomingProject = parseProject(data);
          if (incomingProject.design_id !== designId)
            throw new Error("模型项目属于其他方案，请先切换方案");
        } else incoming.push(parseCondition(data));
      }
      if (incomingProject) {
        if (incomingProject.source_snapshot_id !== view.snapshot_id)
          throw new Error(
            "模型项目的源快照已变化，请单独导入条件包并核对当前上下文",
          );
        setCommands(incomingProject.commands);
        setMaterial(incomingProject.material);
        setPacks(incomingProject.conditions);
      } else {
        if (
          new Set([...packs, ...incoming].map((p) => p.condition_id)).size !==
          packs.length + incoming.length
        )
          throw new Error(
            "条件包 ID 重复；请在编辑条件时更新已有包，或使用新的 ID",
          );
        if (packs.length + incoming.length > 100)
          throw new Error("最多保存 100 个条件包");
        setPacks([...packs, ...incoming]);
        setSelectedPack(incoming[0]?.condition_id ?? null);
      }
      setEditing(false);
    } catch (err) {
      setError(String(err));
    }
  }
  function saveCondition() {
    try {
      const pack = parseCondition(JSON.parse(editor));
      if (selectedPack === null) {
        if (packs.some((p) => p.condition_id === pack.condition_id))
          throw new Error("条件包 ID 重复");
        if (packs.length >= 100) throw new Error("最多保存 100 个条件包");
        setPacks([...packs, pack]);
      } else {
        if (
          packs.some(
            (p) =>
              p.condition_id === pack.condition_id &&
              p.condition_id !== selectedPack,
          )
        )
          throw new Error("条件包 ID 重复");
        setPacks(
          packs.map((p) =>
            p.condition_id === selectedPack
              ? { ...pack, revision: Math.max(p.revision + 1, pack.revision) }
              : p,
          ),
        );
      }
      setSelectedPack(pack.condition_id);
      setEditing(false);
      setError("");
    } catch (err) {
      setError(String(err));
    }
  }
  return (
    <main className="custom-model">
      <div className="custom-heading">
        <div>
          <small>深化设计</small>
          <h2>定制化模型</h2>
          <p>围绕已放置元件，用命令构建外壳、支架与连接结构。</p>
        </div>
        <span className="custom-badge">
          JSCAD 2.13 · 本地建模 · 不执行约束检查
        </span>
      </div>
      <div className="custom-actions">
        <label>
          导入条件包 / 模型项目
          <input
            aria-label="导入条件包或模型项目"
            type="file"
            accept=".json,application/json"
            multiple
            disabled={running}
            onChange={(e) => {
              void importFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </label>
        <button
          onClick={() =>
            download(
              `${designId}.custom-model.json`,
              JSON.stringify(
                { ...project, context_snapshot: context },
                null,
                2,
              ),
              "application/json",
            )
          }
        >
          下载模型项目
        </button>
        <label>
          材料
          <select
            aria-label="模型材料"
            value={material}
            onChange={(e) => setMaterial(e.target.value as MaterialId)}
          >
            {Object.entries(MATERIALS).map(([id, m]) => (
              <option key={id} value={id}>
                {m.label} · {m.process}
              </option>
            ))}
          </select>
        </label>
      </div>
      {(error || storageError) && <p role="alert">{error || storageError}</p>}
      {sourceSnapshot !== view.snapshot_id && (
        <p role="status">
          本地草稿来自旧快照；下方显示当前上下文，请核对条件后重新建模。
        </p>
      )}
      <div className="custom-grid">
        <aside className="custom-conditions">
          <h3>
            设计条件包 <span>{packs.length + 1}</span>
          </h3>
          <button
            aria-pressed={selectedPack === null}
            onClick={() => {
              setSelectedPack(null);
              setEditing(false);
            }}
          >
            当前方案上下文
          </button>
          {packs.map((p) => (
            <button
              key={p.condition_id}
              aria-pressed={selectedPack === p.condition_id}
              onClick={() => {
                setSelectedPack(p.condition_id);
                setEditing(false);
              }}
            >
              {p.title}
              <small>
                {p.condition_id} · r{p.revision}
              </small>
            </button>
          ))}
          <h3>{active.title}</h3>
          <div className="condition-actions">
            <button
              disabled={running}
              onClick={() => {
                setEditor(
                  JSON.stringify(
                    selectedPack === null
                      ? {
                          ...context,
                          condition_id: `conditions_${Date.now()}`,
                          title: "新的定制设计条件",
                        }
                      : active,
                    null,
                    2,
                  ),
                );
                setEditing(true);
              }}
            >
              {selectedPack === null ? "新增条件包" : "编辑条件包"}
            </button>
            <button
              onClick={() =>
                download(
                  `${active.condition_id}.json`,
                  JSON.stringify(active, null, 2),
                  "application/json",
                )
              }
            >
              下载条件包
            </button>
          </div>
          {editing ? (
            <>
              <textarea
                aria-label="条件包 JSON"
                value={editor}
                onChange={(e) => setEditor(e.target.value)}
              />
              <button onClick={saveCondition} disabled={running}>
                保存条件包
              </button>
              <button onClick={() => setEditing(false)}>取消编辑</button>
            </>
          ) : (
            Object.entries(active).map(([key, value]) => (
              <details key={key} open={key === "intent"}>
                <summary>{GROUPS[key] ?? key}</summary>
                <pre>{JSON.stringify(value, null, 2)}</pre>
              </details>
            ))
          )}
          {selectedPack !== null && (
            <button
              disabled={running}
              onClick={() => {
                setPacks(packs.filter((p) => p.condition_id !== selectedPack));
                setSelectedPack(null);
                setEditing(false);
              }}
            >
              移除此条件包
            </button>
          )}
        </aside>
        <section className="custom-center">
          <div className="custom-preview" aria-busy={running}>
            <EngineScene
              scene={scene}
              selected={selectedBody}
              onSelect={setSelectedBody}
              loadMesh={loadMesh}
              bodyColors={colors}
            />
          </div>
          <div className="custom-preview-footer">
            <label>
              <input
                type="checkbox"
                checked={contextVisible}
                onChange={(e) => setContextVisible(e.target.checked)}
              />
              显示方案参考几何
            </label>
            <span>坐标：右手 / Z 向上；命令和 STL：mm</span>
          </div>
          <p className="custom-note">
            条件包供建模时查阅。材料切换保存选择并更新模型颜色；不自动改变形状或公差。参考场景仅显示可用基本包络，外部
            CAD 资产仍保留在条件包中。
          </p>
          {stale && (
            <p role="status">
              输入已变化，当前显示上次模型。请重新建模后导出。
            </p>
          )}
          {preview && (
            <div className="custom-parts">
              <h3>生成零件</h3>
              {preview.result.parts.map((part) => (
                <div key={part.id}>
                  <strong>{part.id}</strong>
                  <span>
                    {part.positions.length / 9} 个三角形 ·{" "}
                    {part.volume_mm3.toFixed(1)} mm³
                  </span>
                  <button
                    disabled={stale || running}
                    onClick={() =>
                      download(`${part.id}.mm.stl`, toSTL(part), "model/stl")
                    }
                  >
                    导出 STL
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
        <aside className="custom-command">
          <h3>建模命令</h3>
          <p>命令按顺序执行；可定义多个实体，使用 show 输出独立零件。</p>
          <textarea
            aria-label="CAD 建模命令"
            spellCheck={false}
            value={commands}
            disabled={running}
            onChange={(e) => setCommands(e.target.value)}
          />
          <div className="condition-actions">
            <button
              className="custom-run"
              onClick={() => void run()}
              disabled={running}
            >
              {running ? "建模中…" : "运行建模"}
            </button>
            <button disabled={!running} onClick={cancel}>
              停止
            </button>
            <button disabled={running} onClick={() => setCommands(EXAMPLE)}>
              载入外壳示例
            </button>
          </div>
          <p role="status">
            {running
              ? "CAD 内核正在工作…"
              : preview
                ? `${preview.result.command_count} 条命令已执行${stale ? "（输入已变化）" : ""}`
                : "等待运行建模命令"}
          </p>
          <details open>
            <summary>命令参考</summary>
            <pre>{`box 名称 宽 深 高
cylinder 名称 半径 高
sphere 名称 半径
move 新名 原名 x y z
rotate 新名 原名 rx ry rz
union 新名 实体1 实体2 …
subtract 新名 基体 刀具 …
intersect 新名 实体1 实体2 …
extrude 名称 高度 x,y x,y x,y …
show 实体名
# 注释；旋转为度，围绕原点
# 名称唯一，末尾未写 show 时输出最后实体`}</pre>
          </details>
          <p className="custom-note">
            项目自动保存在当前浏览器。下载项目可保留命令、材料和全部条件；STL
            仅保存几何。当前内核输出多边形实体，不提供 STEP
            或特征树，也不执行装配与制造验收。
          </p>
        </aside>
      </div>
    </main>
  );
}

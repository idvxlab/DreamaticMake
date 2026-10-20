import { useEffect, useState } from "react";
import type {
  EngineDocument,
  EngineMeshAsset,
} from "../../../../packages/core/src/design-engine";
import { api } from "../api";
import { t } from "../i18n";

type Placement = {
  assetId: string;
  selected: boolean;
  unit: "mm" | "cm" | "m";
  collisionMode: "surface" | "solid";
  position: [number, number, number];
  rotation: [number, number, number];
};
export function MeshImporter({
  projectId,
  contextKey,
  busy,
  onBusy,
  onDocuments,
}: {
  projectId: string;
  contextKey?: string;
  busy: boolean;
  onBusy: (value: boolean) => void;
  onDocuments: (bundle: EngineDocument, scenario: EngineDocument) => void;
}) {
  const [assets, setAssets] = useState<EngineMeshAsset[]>([]);
  const [placements, setPlacements] = useState<Placement[]>([]);
  const [unit, setUnit] = useState<"mm" | "cm" | "m">("mm");
  const [error, setError] = useState("");
  const base = `/projects/${projectId}/engine`;
  const merge = (next: EngineMeshAsset[]) => {
    setAssets(next);
    setPlacements((previous) =>
      next.map(
        (asset) =>
          previous.find((p) => p.assetId === asset.id) ?? {
            assetId: asset.id,
            selected: true,
            unit: asset.unit,
            collisionMode: "surface",
            position: [0, 0, 0],
            rotation: [0, 0, 0],
          },
      ),
    );
  };
  useEffect(() => {
    let disposed = false;
    void api<EngineMeshAsset[]>(`${base}/meshes`)
      .then((value) => {
        if (!disposed) merge(value);
      })
      .catch((e) => {
        if (!disposed) setError(String(e));
      });
    return () => {
      disposed = true;
    };
  }, [base]);
  const change = (id: string, patch: Partial<Placement>) =>
    setPlacements((all) =>
      all.map((p) => (p.assetId === id ? { ...p, ...patch } : p)),
    );
  async function upload(files: File[]) {
    if (!files.length) return;
    onBusy(true);
    setError("");
    try {
      for (const file of files) {
        if (!/\.stl$/i.test(file.name) || file.size > 5_000_000)
          throw new Error(t("请选择不超过 5 MB 的 STL 文件"));
        const bytes = new Uint8Array(await file.arrayBuffer());
        const chunks = [];
        for (let i = 0; i < bytes.length; i += 32768)
          chunks.push(String.fromCharCode(...bytes.subarray(i, i + 32768)));
        await api(`${base}/meshes`, "POST", {
          name: file.name,
          unit,
          data: btoa(chunks.join("")),
        });
      }
    } catch (e) {
      setError(String(e));
    } finally {
      try {
        merge(await api<EngineMeshAsset[]>(`${base}/meshes`));
      } catch (e) {
        setError(String(e));
      }
      onBusy(false);
    }
  }
  async function build() {
    onBusy(true);
    setError("");
    try {
      const docs = await api<{
        bundle: EngineDocument;
        scenario: EngineDocument;
      }>(`${base}/mesh-model`, "POST", {
        contextKey,
        meshes: placements
          .filter((p) => p.selected)
          .map(({ selected, ...p }) => ({
            ...p,
            position: p.position.map((v) => v / 1000),
          })),
      });
      onDocuments(docs.bundle, docs.scenario);
    } catch (e) {
      setError(String(e));
    } finally {
      onBusy(false);
    }
  }
  return (
    <details className="engine-inputs mesh-importer">
      <summary>{t("导入 STL / 组装网格")}</summary>
      <p className="muted">
        {t(
          "STL 不含单位。保留原始坐标，位置单位为 mm，旋转为 XYZ 欧拉角（度）。",
        )}
      </p>
      <div className="engine-toolbar">
        <label>
          {t("文件单位")}{" "}
          <select
            aria-label={t("STL 文件单位")}
            value={unit}
            disabled={busy}
            onChange={(e) => setUnit(e.target.value as typeof unit)}
          >
            <option>mm</option>
            <option>cm</option>
            <option>m</option>
          </select>
        </label>
        <input
          type="file"
          aria-label={t("上传 STL")}
          multiple
          accept=".stl"
          disabled={busy || !contextKey}
          onChange={(e) => {
            void upload(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
      </div>
      {assets.map((asset) => {
        const p = placements.find((p) => p.assetId === asset.id);
        if (!p) return null;
        return (
          <article className="mesh-asset" key={asset.id}>
            <label>
              <input
                type="checkbox"
                checked={p.selected}
                disabled={busy}
                onChange={(e) =>
                  change(asset.id, { selected: e.target.checked })
                }
              />
              {asset.name}
            </label>
            <small>
              {asset.triangles} {t("三角面")} ·{" "}
              {asset.watertight ? t("闭合网格") : t("开放网格")} · {asset.bytes}{" "}
              B
            </small>
            <div className="mesh-placement">
              <label>
                {t("文件单位")}
                <select
                  aria-label={`${asset.name} ${t("文件单位")}`}
                  value={p.unit}
                  disabled={busy}
                  onChange={(e) =>
                    change(asset.id, {
                      unit: e.target.value as Placement["unit"],
                    })
                  }
                >
                  <option>mm</option>
                  <option>cm</option>
                  <option>m</option>
                </select>
              </label>
              <label>
                {t("碰撞模式")}
                <select
                  aria-label={`${asset.name} ${t("碰撞模式")}`}
                  value={p.collisionMode}
                  disabled={busy}
                  onChange={(e) =>
                    change(asset.id, {
                      collisionMode: e.target
                        .value as Placement["collisionMode"],
                    })
                  }
                >
                  <option value="surface">{t("表面")}</option>
                  <option value="solid" disabled={!asset.volume_candidate}>
                    {t("封闭实体")}
                  </option>
                </select>
              </label>
              {(["position", "rotation"] as const).map((kind) =>
                ["X", "Y", "Z"].map((axis, i) => (
                  <label key={kind + axis}>
                    {kind === "position" ? `${axis} mm` : `${axis} °`}
                    <input
                      aria-label={`${asset.name} ${kind} ${axis}`}
                      type="number"
                      step={kind === "position" ? "0.1" : "1"}
                      value={p[kind][i]}
                      disabled={busy}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        if (Number.isFinite(v)) {
                          const vector = [...p[kind]] as [
                            number,
                            number,
                            number,
                          ];
                          vector[i] = v;
                          change(asset.id, { [kind]: vector });
                        }
                      }}
                    />
                  </label>
                )),
              )}
            </div>
            {!!asset.warnings.length && (
              <small>
                {t("该网格只能进行表面检测，不能证明实体包含关系。")}
              </small>
            )}
          </article>
        );
      })}
      <p className="muted">
        {t(
          "表面模式检测网格相交；封闭实体模式额外检查完全包含。均为离散检测，不模拟反弹或摩擦。",
        )}
      </p>
      <button
        disabled={busy || !contextKey || !placements.some((p) => p.selected)}
        onClick={() => void build()}
      >
        {t("用所选 STL 创建装配")}
      </button>
      {error && (
        <p role="alert" className="engine-notice error">
          {error}
        </p>
      )}
    </details>
  );
}

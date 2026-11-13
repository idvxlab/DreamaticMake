import { api } from "./api";
import type { MeshLoader } from "./components/EngineScene";

/** Each cache is scoped to one project/selection; hashes disambiguate shared file names. */
export function createProjectMeshLoader(projectPath?: string, target?: string | null): MeshLoader {
  const loaded = new Map<string, ArrayBuffer>();
  const pending = new Map<string, { signal: AbortSignal; promise: Promise<ArrayBuffer> }>();
  return async (asset, signal, envelope) => {
    if (!projectPath) throw new Error("尚未打开项目");
    signal.throwIfAborted();
    const key = JSON.stringify([asset.relative_path, asset.sha256, asset.media_type]);
    const cached = loaded.get(key);
    if (cached) return cached;
    const existing = pending.get(key);
    if (existing && !existing.signal.aborted) return existing.promise;
    const owner = envelope.body_ref.split("/")[0];
    const entry = { signal, promise: Promise.resolve(new ArrayBuffer(0)) };
    entry.promise = api<{ sha256: string; media_type: string; data_base64: string }>({
      method: "mesh", project_path: projectPath, target: target ?? null,
      element_key: owner, asset_ref: asset,
    }, signal).then((result) => {
      if (result.sha256 !== asset.sha256 || result.media_type !== asset.media_type)
        throw new Error("网格响应与元件资产引用不一致");
      const buffer = Uint8Array.from(atob(result.data_base64), (c) => c.charCodeAt(0)).buffer;
      loaded.set(key, buffer);
      return buffer;
    }).finally(() => {
      if (pending.get(key) === entry) pending.delete(key);
    });
    pending.set(key, entry);
    return entry.promise;
  };
}

import { lazy, Suspense, useEffect, useState } from "react";
import type { CadResultFile } from "../../../packages/core/src/cad-results";
import type { StageRecord } from "../../../packages/core/src/project";
import { api } from "./api";

const CadViewport = lazy(() => import("./CadViewport"));
const formatNames = { "3dm": "Rhino 3DM", step: "STEP", stl: "STL" };

export function CadResults({ projectId, stage }: { projectId: string; stage: StageRecord }) {
  const [files, setFiles] = useState<CadResultFile[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [error, setError] = useState(false);
  const running = stage.state === "running";
  const path = `/projects/${projectId}/cad/${stage.id}`;
  const revision = stage.artifact?.pin.content_hash;

  useEffect(() => {
    const request = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const result = await api<CadResultFile[]>(path, { signal: request.signal, cache: "no-store" });
        if (!request.signal.aborted) {
          setFiles(result);
          setError(false);
        }
      } catch {
        if (!request.signal.aborted) setError(true);
      } finally {
        if (running && !request.signal.aborted) timer = setTimeout(() => void refresh(), 2500);
      }
    }
    void refresh();
    return () => { request.abort(); clearTimeout(timer); };
  }, [path, running, revision]);

  const meshes = files.filter((file) => file.previewable);
  const selected = meshes.find(({ id }) => id === selectedId) ?? meshes[0];
  if (!files.length && !error && !running) return null;

  return <section className="wf-cad-results" aria-label="CAD 成果">
    <div className="wf-cad-heading">
      <h3>CAD 成果</h3>
      {selected && <small>拖动旋转 · 滚轮缩放 · 右键拖动平移</small>}
    </div>
    {meshes.length > 1 && <label className="wf-cad-select">3D 模型
      <select value={selected?.id} onChange={(event) => setSelectedId(event.target.value)}>
        {meshes.map((file) => <option value={file.id} key={file.id}>{file.filename}</option>)}
      </select>
    </label>}
    {selected
      ? <Suspense fallback={<p role="status">正在准备 3D 预览…</p>}>
        <CadViewport key={selected.id} url={`/api${path}/${selected.id}`} />
      </Suspense>
      : <p role="status">{files.length ? "当前文件可下载。网页 3D 预览需要 STL 网格。" : running
        ? "等待 CAD 导出，文件写完后会显示在这里。" : "CAD 文件暂时无法读取。"}</p>}
    {!!files.length && <ul className="wf-cad-files">
      {files.map((file) => <li key={file.id}>
        <span>{formatNames[file.format]}</span>
        <a href={`/api${path}/${file.id}?download`} download={file.filename}>{file.filename}</a>
      </li>)}
    </ul>}
  </section>;
}

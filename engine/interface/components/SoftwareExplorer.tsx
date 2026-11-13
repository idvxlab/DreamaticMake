import { useEffect, useState } from "react";
import { api } from "../api";
import { Folder, tree } from "./SourceExplorer";

type SoftwareFile = { path: string; size: number };
type Software = {
  element_key: string; name: string; relative_path: string;
  language: string | null; entrypoint: string | null;
  files: SoftwareFile[]; error: string | null;
};
type Selection = { owner: string; path: string };

export function SoftwareExplorer({ projectPath, target }: { projectPath: string; target: string | null }) {
  const [projects, setProjects] = useState<Software[]>([]);
  const [selected, setSelected] = useState<Selection | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [listing, setListing] = useState(true);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setListing(true); setProjects([]); setSelected(null); setText(null); setError("");
    api<{ projects: Software[] }>({ method: "software", project_path: projectPath, target }, controller.signal)
      .then(({ projects }) => {
        setProjects(projects);
        const first = projects.find((p) => p.files.length);
        if (first) setSelected({ owner: first.element_key, path: first.files[0].path });
      }).catch((e) => { if (e.name !== "AbortError") setError(String(e.message)); })
      .finally(() => { if (!controller.signal.aborted) setListing(false); });
    return () => controller.abort();
  }, [projectPath, target]);
  useEffect(() => {
    setText(null);
    if (!selected) { setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true); setError("");
    api<{ text: string }>({ method: "software_preview", project_path: projectPath, target,
      element_key: selected.owner, path: selected.path }, controller.signal)
      .then(({ text }) => setText(text))
      .catch((e) => { if (e.name !== "AbortError") setError(String(e.message)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [projectPath, target, selected]);
  const active = projects.find((p) => p.element_key === selected?.owner);
  return <main className="source-workspace software-workspace">
    <aside className="source-tree" aria-label="软件工程目录">
      <h2>软件工程</h2><p className="muted">主控元件与关联代码</p>
      {listing && <p role="status">正在读取软件工程…</p>}
      {!listing && !projects.length && <p>当前范围没有关联的软件工程。在主控元件的 software 字段中填写 software/ 下的相对路径。</p>}
      {projects.map((project) => <details key={project.element_key} open className="software-project">
        <summary>{project.element_key} · {project.name}</summary>
        <p className="muted"><code>{project.relative_path}</code></p>
        {project.error && <p role="alert">{project.error}</p>}
        {!project.error && !project.files.length && <p>此工程还没有可预览的代码文件。</p>}
        <Folder node={tree(project.files.map((f) => ({ ...f, kind: "text", media_type: "text/plain" })))}
          selected={selected?.owner === project.element_key ? selected.path : ""}
          onSelect={(path) => { setText(null); setSelected({ owner: project.element_key, path }); }} />
      </details>)}
    </aside>
    <section className="source-preview" aria-label="软件代码内容" aria-busy={loading}>
      <div className="preview-heading"><code>{selected?.path ?? "选择代码文件"}</code><span>只读</span></div>
      {active && <p className="software-metadata">{active.element_key} · 语言：{active.language || "未指定"} · 主函数：<code>{active.entrypoint || "未指定"}</code></p>}
      {error && <p role="alert">{error}</p>}
      {loading && <p role="status" className="preview-empty">正在加载代码…</p>}
      {text !== null && <pre className="text-preview software-code"><code>{text}</code></pre>}
      {!selected && !listing && <p className="preview-empty">从左侧选择主控元件的软件文件。</p>}
    </section>
  </main>;
}

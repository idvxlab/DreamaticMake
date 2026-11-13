import { Fragment, useEffect, useState, type ReactNode } from "react";
import { api, type Preview, type SourceFile } from "../api";

type Tree = { folders: Record<string, Tree>; files: SourceFile[] };
const emptyTree = (): Tree => ({ folders: Object.create(null), files: [] });
export function tree(files: SourceFile[]): Tree {
  const root = emptyTree();
  for (const file of files) {
    const parts = file.path.split("/");
    let node = root;
    for (const part of parts.slice(0, -1)) node = node.folders[part] ??= emptyTree();
    node.files.push(file);
  }
  return root;
}
export function Folder({ node, selected, onSelect, depth = 0 }: {
  node: Tree; selected: string; onSelect: (path: string) => void; depth?: number;
}) {
  return <>
    {Object.entries(node.folders).map(([name, folder]) => <details className="source-folder" key={name} open={depth === 0}>
      <summary><span aria-hidden>▱ </span>{name}</summary>
      <div className="folder-children"><Folder node={folder} selected={selected} onSelect={onSelect} depth={depth + 1} /></div>
    </details>)}
    {node.files.map((file) => <button className="source-file" key={file.path} aria-label={`预览 ${file.path}`}
      title={file.path} aria-pressed={selected === file.path} onClick={() => onSelect(file.path)}>
      <span className="file-kind">{file.kind === "image" ? "IMG" : file.path.split(".").pop()?.toUpperCase()}</span>
      <span>{file.path.split("/").pop()}</span>
    </button>)}
  </>;
}
function inline(text: string): ReactNode[] {
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).map((part, index) => part.startsWith("`")
    ? <code key={index}>{part.slice(1, -1)}</code> : part.startsWith("**")
      ? <strong key={index}>{part.slice(2, -2)}</strong> : <Fragment key={index}>{part}</Fragment>);
}
function Markdown({ text }: { text: string }) {
  const nodes: ReactNode[] = [];
  const lines = text.split("\n");
  let code: string[] | null = null;
  let paragraph: string[] = [];
  const flush = () => { if (paragraph.length) nodes.push(<p key={nodes.length}>{inline(paragraph.join(" "))}</p>); paragraph = []; };
  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      flush();
      if (code !== null) { nodes.push(<pre key={nodes.length}><code>{code.join("\n")}</code></pre>); code = null; }
      else code = [];
    } else if (code !== null) code.push(line);
    else if (/^#{1,6} /.test(line)) {
      flush();
      const content = inline(line.replace(/^#+ /, ""));
      nodes.push(line.startsWith("# ") ? <h1 key={nodes.length}>{content}</h1>
        : line.startsWith("## ") ? <h2 key={nodes.length}>{content}</h2> : <h3 key={nodes.length}>{content}</h3>);
    } else if (/^\s*[-*] /.test(line)) { flush(); nodes.push(<p className="markdown-list" key={nodes.length}>• {inline(line.replace(/^\s*[-*] /, ""))}</p>); }
    else if (!line.trim()) flush();
    else paragraph.push(line);
  }
  flush();
  if (code !== null) nodes.push(<pre key={nodes.length}>{code.join("\n")}</pre>);
  return <article className="document-preview">{nodes}</article>;
}

export function SourceExplorer({ projectPath, target }: { projectPath: string; target: string | null }) {
  const [files, setFiles] = useState<SourceFile[]>([]);
  const [selected, setSelected] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [listing, setListing] = useState(true);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setListing(true); setError("");
    api<{ files: SourceFile[] }>({ method: "files", project_path: projectPath, target }, controller.signal)
      .then(({ files }) => {
        setFiles(files);
        setSelected(files.find((f) => f.path === "design/structure.json")?.path
          ?? files.find((f) => f.path === "component.json" || f.path === "element.json")?.path ?? files[0]?.path ?? "");
      }).catch((e) => { if (e.name !== "AbortError") setError(String(e.message)); })
      .finally(() => { if (!controller.signal.aborted) setListing(false); });
    return () => controller.abort();
  }, [projectPath, target]);
  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    setLoading(true); setPreview(null); setError("");
    api<Preview>({ method: "preview", project_path: projectPath, target, path: selected }, controller.signal)
      .then(setPreview).catch((e) => { if (e.name !== "AbortError") setError(String(e.message)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [projectPath, target, selected]);
  return <main className="source-workspace">
    <aside className="source-tree" aria-label="源文件目录">
      <h2>{target === null ? "项目源文件" : "元件源文件"}</h2>
      <p className="muted">{target === null ? "设计、文档与图像" : "定义、资料与图像"}</p>
      {listing ? <p role="status">正在读取目录…</p> : files.length
        ? <Folder node={tree(files)} selected={selected} onSelect={setSelected} /> : <p>当前目录没有可预览的文件。</p>}
    </aside>
    <section className="source-preview" aria-label="文件预览" aria-busy={loading}>
      <div className="preview-heading"><code>{selected || "选择文件"}</code>
        {preview && <span>{(preview.size / 1024).toFixed(1)} KB</span>}</div>
      {error && <p role="alert">{error}</p>}
      {loading && <p className="preview-empty" role="status">正在加载预览…</p>}
      {preview?.kind === "json" && <pre className="json-preview">{preview.text}</pre>}
      {preview?.kind === "markdown" && <Markdown text={preview.text ?? ""} />}
      {preview?.kind === "text" && <pre className="text-preview">{preview.text}</pre>}
      {preview?.kind === "image" && <div className="image-preview"><img src={preview.data_url} alt={preview.path} /></div>}
      {preview?.kind === "pdf" && <iframe className="pdf-preview" title={preview.path} src={preview.data_url} />}
      {!selected && !listing && <p className="preview-empty">从左侧选择文档、JSON 或图像。</p>}
    </section>
  </main>;
}

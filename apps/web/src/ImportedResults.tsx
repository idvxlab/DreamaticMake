import { useEffect, useId, useState } from "react";
import type { ImportedAsset, ImportedRun, ImportedWork } from "../../../packages/core/src/project";
import { MarkdownPreview } from "./MarkdownPreview";
import { Dialog } from "./WorkflowDialog";

export function ImportedResults({ projectId, run, node }: { projectId: string; run: ImportedRun; node: ImportedWork }) {
  const assets = node.assetIds.flatMap((id) => run.assets.find((asset) => asset.id === id) ?? []);
  const images = assets.filter((asset) => asset.kind === "image");
  const [selectedImage, setSelectedImage] = useState<string>();
  const [enlargedImage, setEnlargedImage] = useState<ImportedAsset>();
  const [expandedFile, setExpandedFile] = useState<string>();
  const previewId = useId();
  const image = images.find((asset) => asset.id === selectedImage) ?? images[0];
  const url = (asset: ImportedAsset) => `/api/projects/${projectId}/files/${asset.id}`;

  return <>
    <div className="wf-section-head">
      <div><small>当前工作 · {run.version}</small><h2>{node.title}</h2></div>
    </div>
    {image ? <section className="wf-visual-hero wf-imported-preview" aria-label="项目成果预览">
      <aside className="wf-prompt-box">
        <strong>{node.role} · {node.status}</strong>
        <p>{node.summary}</p>
      </aside>
      <div className="wf-visual-image">
        <button onClick={() => setEnlargedImage(image)} aria-label={`放大${image.title}`}><img key={image.id} src={url(image)} alt={image.title} /></button>
        {images.length > 1 && <nav className="wf-tabs" aria-label="切换预览视图">
          {images.map((asset) => <button key={asset.id} aria-pressed={image.id === asset.id} onClick={() => setSelectedImage(asset.id)}>
            {asset.title.replace(/^[^ ]+ /, "")}
          </button>)}
        </nav>}
      </div>
    </section> : <p className="wf-status">{node.summary}</p>}
    <details className="wf-output-files" open={!image}>
      <summary>文件与原始记录 · {assets.length}</summary>
      <div className="wf-cards wf-file-cards">
        {assets.map((asset) => {
          const expanded = expandedFile === asset.id;
          const id = `${previewId}-${asset.id}`;
          return <article className="wf-record" key={asset.id}>
            <strong>{asset.title}</strong>
            <small>{asset.filename}</small>
            <div className="wf-buttons">
              {asset.kind !== "download" && <button type="button" aria-expanded={expanded} aria-controls={id}
                onClick={() => setExpandedFile((current) => current === asset.id ? undefined : asset.id)}>
                {expanded ? "收起预览" : "预览"}
              </button>}
              <a href={`${url(asset)}?download=1`} download={asset.filename}>下载</a>
            </div>
            {asset.kind !== "download" && <div className="wf-inline-file-preview" id={id} hidden={!expanded}>
              {expanded && (asset.kind === "image"
                ? <img src={url(asset)} alt={asset.title} />
                : <DocumentPreview asset={asset} assets={run.assets} assetUrl={url} />)}
            </div>}
          </article>;
        })}
      </div>
    </details>
    {enlargedImage && <Dialog title={enlargedImage.title} close={() => setEnlargedImage(undefined)}>
      <img className="wf-imported-full-image" src={url(enlargedImage)} alt={enlargedImage.title} />
    </Dialog>}
  </>;
}

function DocumentPreview({ asset, assets, assetUrl }: {
  asset: ImportedAsset;
  assets: readonly ImportedAsset[];
  assetUrl: (asset: ImportedAsset) => string;
}) {
  const url = assetUrl(asset);
  const [result, setResult] = useState<{ text: string } | { error: string }>();

  useEffect(() => {
    const request = new AbortController();
    void fetch(url, { signal: request.signal })
      .then((response) => {
        if (!response.ok) throw new Error("无法读取该版本的文件。");
        return response.text();
      })
      .then((text) => { if (!request.signal.aborted) setResult({ text }); })
      .catch(() => {
        if (!request.signal.aborted) setResult({ error: "无法读取文件。收起后可重新预览。" });
      });
    return () => request.abort();
  }, [url]);

  if (!result) return <div role="status">正在读取文件…</div>;
  if ("error" in result) return <div role="alert">{result.error}</div>;
  if (!result.text.trim()) return <p>此文件没有内容。</p>;
  return /\.(md|markdown)$/i.test(asset.filename)
    ? <MarkdownPreview text={result.text} asset={asset} assets={assets} assetUrl={assetUrl} />
    : <pre tabIndex={0} aria-label="文件内容">{result.text}</pre>;
}

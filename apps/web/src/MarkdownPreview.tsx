import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ImportedAsset } from "../../../packages/core/src/project";

const previewRoot = "https://preview.invalid/";

export function MarkdownPreview({ text, asset, assets = [], assetUrl }: {
  text: string;
  asset?: ImportedAsset;
  assets?: readonly ImportedAsset[];
  assetUrl?: (asset: ImportedAsset) => string;
}) {
  function resolveAsset(reference?: string) {
    if (!reference || !asset?.sourcePath || /^(?:[a-z][a-z\d+.-]*:|\/|#)/i.test(reference)) return;
    try {
      const target = new URL(reference, new URL(asset.sourcePath, previewRoot));
      if (target.origin !== new URL(previewRoot).origin) return;
      const path = decodeURIComponent(target.pathname.slice(1));
      return assets.find((item) => item.sourcePath === path);
    } catch {
      return;
    }
  }

  return <div className="wf-rendered-markdown" tabIndex={0} aria-label="文件内容">
    <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={{
      a: ({ children, href }) => {
        const linkedAsset = resolveAsset(href);
        const target = linkedAsset && assetUrl ? assetUrl(linkedAsset) : /^(https?:\/\/|mailto:)/i.test(href ?? "") ? href : undefined;
        return target ? <a href={target} target="_blank" rel="noreferrer">{children}</a> : <span>{children}</span>;
      },
      img: ({ src, alt, title }) => {
        const image = resolveAsset(src);
        return image?.kind === "image" && assetUrl
          ? <img src={assetUrl(image)} alt={alt ?? ""} title={title} />
          : <span className="wf-markdown-image-label">图片：{alt || "未导入"}</span>;
      },
      table: ({ children }) => <div className="wf-markdown-table" tabIndex={0}><table>{children}</table></div>,
    }}>
      {text}
    </ReactMarkdown>
  </div>;
}

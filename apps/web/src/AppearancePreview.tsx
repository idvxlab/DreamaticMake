import { useEffect, useState } from "react";
import { api } from "./api";
import { Dialog } from "./WorkflowDialog";

type Preview = { id: string; filename: string };

export function AppearancePreview({ projectId, running }: { projectId: string; running: boolean }) {
  const [images, setImages] = useState<Preview[]>([]);
  const [selected, setSelected] = useState<string>();
  const [enlarged, setEnlarged] = useState<Preview>();
  const path = `/projects/${projectId}/appearance-previews`;
  const image = images.find(({ id }) => id === selected) ?? images[0];

  useEffect(() => {
    const request = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const result = await api<Preview[]>(path, { signal: request.signal, cache: "no-store" });
        if (!request.signal.aborted) setImages(result);
      } catch {
        // A preview can be temporarily unavailable as files are being written.
      } finally {
        if (running && !request.signal.aborted) timer = setTimeout(() => void refresh(), 2000);
      }
    }
    void refresh();
    return () => { request.abort(); clearTimeout(timer); };
  }, [path, running]);

  if (!image) return null;
  const source = ({ id }: Preview) => `/api${path}/${id}`;
  return <section className="wf-appearance-preview" aria-label="外观效果图">
    <div className="wf-visual-image">
      <button type="button" aria-label="放大外观效果图" onClick={() => setEnlarged(image)}>
        <img key={image.id} src={source(image)} alt="外观效果图" />
      </button>
    </div>
    {images.length > 1 && <nav className="wf-tabs" aria-label="切换外观效果图">
      {images.map((preview) => <button key={preview.id} type="button" aria-pressed={image.id === preview.id} onClick={() => setSelected(preview.id)}>{preview.filename}</button>)}
    </nav>}
    {enlarged && <Dialog title="外观效果图" close={() => setEnlarged(undefined)}>
      <img className="wf-imported-full-image" src={source(enlarged)} alt="外观效果图" />
    </Dialog>}
  </section>;
}

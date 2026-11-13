import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { Dialog } from "./WorkflowDialog";

type PurchaseLink = { supplier: string; url: string; source: string };
type Candidate = {
  ref: { library_id: string; element_id: string; revision: number; content_hash: string };
  name: string;
  category: string;
  selectable: boolean;
  blockers: string[];
  purchase_links?: PurchaseLink[];
  purchase_note?: string;
};
type SearchResult = { items: Candidate[]; total: number; next_offset: number | null; index_generation: string };
type Detail = Record<string, unknown> & { purchase_links?: PurchaseLink[] };

export function PurchaseLinks({ links }: { links: PurchaseLink[] }) {
  return <div className="wf-purchase-links">
    <span>购买链接</span>
    {links.map(({ supplier, url, source }) =>
      <a key={url} href={url} title={source} target="_blank" rel="noreferrer">{supplier}</a>)}
  </div>;
}

export function HardwareLibrary({ close }: { close: () => void }) {
  const [categories, setCategories] = useState<{ category: string; count: number }[]>([]);
  const [category, setCategory] = useState("");
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<SearchResult>();
  const [detail, setDetail] = useState<Detail>();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const sequence = useRef(0);
  const detailSequence = useRef(0);
  const searchCriteria = useRef({ query: "", category: "" });

  useEffect(() => {
    let alive = true;
    void api<{ categories: { category: string; count: number }[] }>("/library/categories")
      .then((value) => { if (alive) setCategories(value.categories); })
      .catch((failure) => { if (alive) setError(String(failure)); });
    return () => { alive = false; ++sequence.current; ++detailSequence.current; };
  }, []);

  async function search(offset = 0) {
    const current = ++sequence.current;
    if (offset === 0) searchCriteria.current = { query, category };
    const criteria = searchCriteria.current;
    setPending(true);
    setError("");
    try {
      const next = await api<SearchResult>("/library/search", {
        method: "POST",
        body: JSON.stringify({
          text: criteria.query.trim(),
          categories: criteria.category ? [criteria.category] : [],
          limit: 30, offset,
          ...(offset && result ? { expected_generation: result.index_generation } : {}),
        }),
      });
      if (current !== sequence.current) return;
      setResult((old) => ({ ...next, items: offset ? [...(old?.items ?? []), ...next.items] : next.items }));
      if (offset === 0) setDetail(undefined);
    } catch (failure) {
      if (current === sequence.current) setError(String(failure));
    } finally {
      if (current === sequence.current) setPending(false);
    }
  }

  async function open(candidate: Candidate) {
    const current = ++detailSequence.current;
    try {
      const record = await api<Detail>("/library/record", { method: "POST", body: JSON.stringify(candidate.ref) });
      if (current === detailSequence.current) setDetail(record);
    } catch (failure) {
      if (current === detailSequence.current) setError(String(failure));
    }
  }

  return <Dialog title="硬件资料库" close={close}>
    <div className="wf-library">
      <form className="wf-buttons" onSubmit={(event) => { event.preventDefault(); void search(); }}>
        <select aria-label="资料类别" value={category} onChange={(event) => setCategory(event.target.value)}>
          <option value="">全部类别</option>
          {categories.map((item) => <option key={item.category} value={item.category}>{item.category} ({item.count})</option>)}
        </select>
        <input aria-label="搜索硬件资料" placeholder="搜索器件、型号或参数" value={query} maxLength={2000} onChange={(event) => setQuery(event.target.value)} />
        <button disabled={pending}>{pending ? "搜索中…" : "搜索"}</button>
      </form>
      {error && <p role="alert">{error}</p>}
      {result && <p>{result.total} 条资料</p>}
      <div className="wf-cards">
        {result?.items.map((item) => <article className="wf-library-item" key={JSON.stringify(item.ref)}>
          <button type="button" onClick={() => void open(item)}>
            <strong>{item.name}</strong>
            <small>{item.ref.library_id === "procurement" ? "采购候选" : item.ref.library_id} · {item.category}</small>
          </button>
          {item.purchase_note && <small className="wf-purchase-note">{item.purchase_note}</small>}
          {!!item.purchase_links?.length && <PurchaseLinks links={item.purchase_links} />}
        </article>)}
      </div>
      {result?.next_offset != null && <button disabled={pending} onClick={() => void search(result.next_offset!)}>加载更多</button>}
      {detail && <article className="wf-record"><strong>{String(detail.name ?? "来源记录")}</strong>
        {!!detail.purchase_links?.length && <PurchaseLinks links={detail.purchase_links} />}
        <details open><summary>查看来源明细</summary><pre>{JSON.stringify(detail, null, 2)}</pre></details>
      </article>}
    </div>
  </Dialog>;
}

import { useEffect, useRef, useState } from "react";
import {
  X,
  Search,
  Database,
  ExternalLink,
  Download,
  LoaderCircle,
} from "lucide-react";
import {
  HARDWARE_VERSION,
  hardwareSourceNames,
  type HardwareSource,
  type HardwareHit,
  type HardwareRecord,
  type HardwareStatus,
  type HardwareGeometry,
} from "../../../packages/workbench/hardware-contracts";
import { HardwareMesh } from "./HardwareMesh";

async function api(path: string, body?: unknown) {
  const r = await fetch(`/workbench-api/library/${path}`, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json", "X-Workbench": "1" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const value = await r.json();
  if (!r.ok) throw new Error(value.error || "硬件库读取失败");
  return value;
}
export function HardwareLibrary({
  close,
  hasProject,
  busy,
  attached,
}: {
  close: () => void;
  hasProject: boolean;
  busy: boolean;
  attached: () => Promise<void>;
}) {
  const [status, setStatus] = useState<HardwareStatus>();
  const [source, setSource] = useState<HardwareSource | "">("");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<HardwareHit[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [record, setRecord] = useState<HardwareRecord>();
  const [geometry, setGeometry] = useState<HardwareGeometry>();
  const [document, setDocument] = useState<{
    title: string;
    text: string;
    id: string;
    totalCharacters: number;
    offset: number;
  }>();
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const request = useRef(0);
  const search = async (filter = source, page = 0, keyword = query) => {
    const epoch = ++request.current;
    setLoading(true);
    setError("");
    setOffset(page);
    try {
      const value = await api(
        `search?${new URLSearchParams({ query: keyword, ...(filter ? { source: filter } : {}), limit: "15", offset: String(page) })}`,
      );
      if (epoch === request.current) {
        setHits(value.items);
        setTotal(value.total);
      }
    } catch (e) {
      if (epoch === request.current) setError((e as Error).message);
    } finally {
      if (epoch === request.current) setLoading(false);
    }
  };
  useEffect(() => {
    void api("status")
      .then(setStatus)
      .catch((e) => setError(e.message));
    void search("", 0, "");
  }, []);
  const action = async (job: () => Promise<void>) => {
    setPending(true);
    setError("");
    setMessage("");
    try {
      await job();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  };
  const open = (hit: HardwareHit) =>
    action(async () => {
      setRecord(undefined);
      setGeometry(undefined);
      setDocument(undefined);
      setRecord(
        await api(
          `record?${new URLSearchParams({ source: hit.source, recordId: hit.recordId })}`,
        ),
      );
    });
  return (
    <div className="library-backdrop">
      <section
        role="dialog"
        aria-modal="true"
        aria-label="真实硬件库"
        className="library-dialog"
      >
        <header>
          <div>
            <Database size={21} />
            <strong>真实硬件库</strong>
            <span>{HARDWARE_VERSION}</span>
          </div>
          <button title="关闭硬件库" onClick={close}>
            <X size={20} />
          </button>
        </header>
        <p className="library-intro">
          查来源、参数、文档与模型。采购需求、商家描述、厂商图纸和实际STEP几何分别保留依据，缺失数据保持未知。
        </p>
        {error && (
          <p role="alert" className="library-error">
            {error}
          </p>
        )}
        {message && (
          <p role="status" className="library-message">
            {message}
          </p>
        )}
        <div className="library-body">
          <aside className="library-search">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void search();
              }}
            >
              <input
                aria-label="搜索真实硬件"
                placeholder="功能、型号或关键词，如 Nano ESP32"
                value={query}
                maxLength={120}
                onChange={(e) => setQuery(e.target.value)}
              />
              <button title="搜索硬件" type="submit">
                <Search size={17} />
              </button>
            </form>
            <select
              aria-label="硬件数据来源"
              value={source}
              onChange={(e) => {
                const value = e.target.value as HardwareSource | "";
                setSource(value);
                void search(value);
              }}
            >
              <option value="">全部来源</option>
              {status?.sources.map((s) => (
                <option key={s.source} value={s.source}>
                  {s.name} · {s.count.toLocaleString()}{" "}
                  {s.state === "empty"
                    ? "（空索引）"
                    : s.state !== "ready"
                      ? "（不可用）"
                      : ""}
                </option>
              ))}
            </select>
            <div className="library-count">
              {loading
                ? "正在检索…"
                : `${total.toLocaleString()} 条匹配 · ${offset + 1}–${Math.min(offset + 15, total)}`}
              <button
                disabled={pending || busy}
                onClick={() =>
                  action(async () => {
                    setStatus(await api("refresh", {}));
                    await search();
                  })
                }
              >
                刷新索引
              </button>
            </div>
            <div className="library-hits">
              {hits.map((hit) => (
                <button
                  key={hit.source + hit.recordId}
                  className={
                    record?.source === hit.source &&
                    record.recordId === hit.recordId
                      ? "active"
                      : ""
                  }
                  onClick={() => void open(hit)}
                >
                  <small>{hardwareSourceNames[hit.source]}</small>
                  <strong>{hit.title}</strong>
                  <span>{hit.summary}</span>
                </button>
              ))}
              {!loading && !hits.length && (
                <p>
                  没有匹配记录。试试更短的关键词或对应英文；库中没有的数据不会自动补成型号。
                </p>
              )}
            </div>
            <div className="library-pages">
              <button
                disabled={loading || offset === 0}
                onClick={() => search(source, Math.max(0, offset - 15))}
              >
                上一页
              </button>
              <button
                disabled={loading || offset + 15 >= total}
                onClick={() => search(source, offset + 15)}
              >
                下一页
              </button>
            </div>
            <details>
              <summary>来源状态</summary>
              {status?.sources.map((s) => (
                <p key={s.source}>
                  {s.name}：{s.count.toLocaleString()} · {s.state}
                  {s.message ? ` · ${s.message}` : ""}
                </p>
              ))}
            </details>
          </aside>
          <article className="library-detail">
            {pending && (
              <div className="library-progress">
                <LoaderCircle size={16} className="spin" />
                正在读取本地证据或检查几何…
              </div>
            )}
            {!record ? (
              <div className="library-welcome">
                <Database size={36} />
                <h2>选择一条记录，核对真实依据</h2>
                <p>
                  所有专家已接入同一套硬件检索工具。已有历史提案仍保留原样，需要重新选型后才会绑定到真实元件。
                </p>
              </div>
            ) : (
              <>
                <small>
                  {hardwareSourceNames[record.source]} · {record.kind}
                </small>
                <h2>{record.title}</h2>
                <p>{record.summary}</p>
                <div className="library-evidence">
                  <span>{record.evidence}</span>
                  <span>未实物核验 · 未做整机装配验证</span>
                </div>
                <div className="library-actions">
                  {record.url && (
                    <a href={record.url} target="_blank" rel="noreferrer">
                      <ExternalLink size={14} />
                      查看来源
                    </a>
                  )}
                  <button
                    className="primary"
                    disabled={pending || busy || !hasProject}
                    onClick={() =>
                      action(async () => {
                        await api("attach", {
                          source: record.source,
                          recordId: record.recordId,
                          revision: record.revision,
                          ...(geometry ? { assetId: geometry.assetId } : {}),
                        });
                        await attached();
                        setMessage(
                          "已加入项目资料；后续产品经理及专家将读取同一版本的证据。此次没有启动模型调用。",
                        );
                      })
                    }
                  >
                    加入项目资料
                  </button>
                </div>
                {!hasProject && <p>先创建产品探索，便可将元件证据加入项目。</p>}
                <div className="library-revision">
                  采集时间：{record.capturedAt || "来源未提供"}
                  <br />
                  证据版本：{record.revision}
                </div>
                <h3>参数与依据</h3>
                <div className="library-parameters">
                  {record.parameters.map((param, i) => (
                    <pre key={i}>{JSON.stringify(param, null, 2)}</pre>
                  ))}
                  {!record.parameters.length && (
                    <p>此记录未提供结构化参数，不能推测为已知。</p>
                  )}
                </div>
                {record.notes.length > 0 && (
                  <div className="library-notes">
                    <h3>限制与缺口</h3>
                    {record.notes.map((n, i) => (
                      <p key={i}>{n}</p>
                    ))}
                  </div>
                )}
                <h3>文件资产 · {record.assetCount}</h3>
                <p>
                  本地文件可下载；STEP检查会核验哈希并读取几何。系列参考不能替代具体型号。
                </p>
                <div className="library-assets">
                  {record.assets.map((a) => (
                    <div key={a.id}>
                      <strong>{a.label}</strong>
                      <small>
                        {a.coverage} · {a.state} ·{" "}
                        {a.available ? "本地文件存在" : "本地缺失"}
                      </small>
                      <span>
                        {a.available && (
                          <a href={a.downloadUrl}>
                            <Download size={13} />
                            下载原文件
                          </a>
                        )}
                        {a.available && a.role.includes("step") && (
                          <button
                            disabled={pending}
                            onClick={() =>
                              action(async () => {
                                setGeometry(
                                  await api("inspect", {
                                    source: record.source,
                                    recordId: record.recordId,
                                    assetId: a.id,
                                  }),
                                );
                              })
                            }
                          >
                            检查并预览STEP
                          </button>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
                {record.assetCount > record.assets.length && (
                  <p>
                    仅显示前{record.assets.length}
                    个优先资产，完整数量按源索引统计。
                  </p>
                )}
                {geometry && (
                  <section className="library-geometry">
                    <h3>实际STEP包络 / XYZ mm</h3>
                    <p>
                      {geometry.dimensionsMm
                        .map((n) => n.toFixed(3))
                        .join(" × ")}{" "}
                      · {geometry.solidCount} 个实体 · {geometry.coverage}
                    </p>
                    <HardwareMesh url={geometry.meshUrl} />
                    <p>
                      原始CAD坐标保留在证据中；视图仅居中显示。包络与网格读取不代表安装孔、插头余量或整机碰撞验证通过。
                    </p>
                  </section>
                )}
                <h3>关联文档 · {record.documentCount}</h3>
                {record.documents.map((d) => (
                  <button
                    className="library-document"
                    key={d.id}
                    disabled={pending}
                    onClick={() =>
                      action(async () =>
                        setDocument(
                          await api(
                            `document?${new URLSearchParams({ source: record.source, recordId: record.recordId, documentId: d.id })}`,
                          ),
                        ),
                      )
                    }
                  >
                    {d.title}
                  </button>
                ))}
                {document && (
                  <section>
                    <h4>{document.title}</h4>
                    <pre className="library-source">{document.text}</pre>
                    {document.offset + 12000 < document.totalCharacters && (
                      <button
                        onClick={() =>
                          action(async () =>
                            setDocument(
                              await api(
                                `document?${new URLSearchParams({ source: record.source, recordId: record.recordId, documentId: document.id, offset: String(document.offset + 12000) })}`,
                              ),
                            ),
                          )
                        }
                      >
                        下一段正文
                      </button>
                    )}
                  </section>
                )}
                <details>
                  <summary>查看来源正文摘录</summary>
                  <pre className="library-source">
                    {record.sourceText || "来源未提供正文"}
                  </pre>
                </details>
              </>
            )}
          </article>
        </div>
      </section>
    </div>
  );
}

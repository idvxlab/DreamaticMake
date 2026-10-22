import { useEffect, useRef, useState } from "react";
import { api } from "../api";

export function LocalLibrary() {
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const [data, setData] = useState<any>();
  const [error, setError] = useState("");
  const [record, setRecord] = useState<any>();
  const [recordFingerprint, setRecordFingerprint] = useState("");
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);
  const detailsRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (record)
      detailsRef.current?.scrollIntoView({
        block: "start",
        behavior: "smooth",
      });
  }, [record]);
  useEffect(() => {
    let disposed = false;
    const refresh = async () => {
      try {
        const next = await api(`/local-library?q=${encodeURIComponent(query)}`);
        if (!disposed) {
          setData(next);
          setError("");
        }
      } catch (e) {
        if (!disposed) setError((e as Error).message);
      }
    };
    setData(undefined);
    void refresh();
    const timer = setInterval(() => void refresh(), 30000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [query, tick]);
  return (
    <section className="local-library" aria-label="本地实时采购库">
      <h2>本地实时采购库</h2>
      <p>
        每 30 秒读取最新采集记录；AI
        每次检索读取源库。已确认设计保留原证据，不自动替换部件。
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setRecord(undefined);
          setQuery(text.trim());
          setTick((n) => n + 1);
        }}
      >
        <input
          aria-label="搜索本地采购参数"
          placeholder="例如：风扇 fan、PWM、USB、ASIN"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={200}
        />
        <button type="submit">搜索 / 刷新</button>
      </form>
      {error && <p role="alert">{error}。当前显示的旧结果不能视为最新状态。</p>}
      {!data && !error && <p role="status">正在读取采购库…</p>}
      {data?.enabled === false && <p>{data.notice}</p>}
      {data?.enabled && (
        <>
          <p role="status">
            可用采集记录 {data.totalCaptured} 条 · 已有参数提取{" "}
            {data.extractedRecords} 条
            {data.skippedUnreadable
              ? ` · ${data.skippedUnreadable} 条暂不可读`
              : ""}
          </p>
          {query && !data.candidates.length && (
            <p>未找到匹配的已采集商品。需求模板不是现货或已核验规格。</p>
          )}
          {data.candidates.map((item: any) => (
            <article key={item.candidateId}>
              <h3>{item.title}</h3>
              <p>
                {item.sourceName} · {item.asin} · 采集于 {item.capturedAt}
              </p>
              <p>
                {item.parameterCount} 项有原文依据的参数 ·{" "}
                {item.fit === "mismatch" ? "与原采购规格不匹配" : "适配待核验"}{" "}
                · 完整几何未核验
              </p>
              <button
                disabled={loading}
                onClick={async () => {
                  setLoading(true);
                  try {
                    const detail = await api(
                      `/local-library?candidateId=${item.candidateId}`,
                    );
                    setRecord(detail.record);
                    setRecordFingerprint(detail.fingerprint);
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setLoading(false);
                  }
                }}
              >
                查看参数与原文
              </button>
            </article>
          ))}
          {!!data.requirements.length && (
            <details>
              <summary>相关采购需求模板（不是商品参数）</summary>
              {data.requirements.map((r: any) => (
                <p key={r.variant_id}>
                  {r.name_zh}：{r.label_zh} · 未核验
                </p>
              ))}
            </details>
          )}
          {record && (
            <article ref={detailsRef} aria-label="采集参数详情">
              {recordFingerprint !== data.fingerprint && (
                <p role="status">
                  采购库已更新，重新打开详情可读取最新参数；下面仍为读取时的快照。
                </p>
              )}
              <h3>{record.title}</h3>
              <a href={record.url} target="_blank" rel="noreferrer">
                查看商品来源
              </a>
              <p>以下为读取时的来源快照；完整安装几何和系统适配仍待核验。</p>
              <table>
                <thead>
                  <tr>
                    <th>参数</th>
                    <th>原文值</th>
                    <th>原文依据</th>
                  </tr>
                </thead>
                <tbody>
                  {record.parameters.map((p: any, i: number) => (
                    <tr key={i}>
                      <td>{p.name}</td>
                      <td>{p.value}</td>
                      <td>{p.quote}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {record.reviewNotes.map((note: string, i: number) => (
                <p key={i}>{note}</p>
              ))}
            </article>
          )}
        </>
      )}
    </section>
  );
}

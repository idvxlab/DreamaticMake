import { useEffect, useRef, useState } from "react";
import { api } from "../api";

export function LocalLibrary({ projectId }: { projectId?: string } = {}) {
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const [data, setData] = useState<any>();
  const [error, setError] = useState("");
  const [record, setRecord] = useState<any>();
  const [recordFingerprint, setRecordFingerprint] = useState("");
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);
  const [geometry, setGeometry] = useState<any>();
  const [envelope, setEnvelope] = useState(["", "", ""]);
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
        同时搜索 Arduino 官方硬件、参数、手册和 STEP。每 30 秒刷新；AI
        每次检索读取源库。已确认设计保留原证据，不自动替换部件。
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setRecord(undefined);
          setGeometry(undefined);
          setQuery(text.trim());
          setTick((n) => n + 1);
        }}
      >
        <input
          aria-label="搜索本地采购参数"
          placeholder="例如：温湿度、Modulino、电机驱动、UNO、SKU"
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
            {data.officialHardware?.hardware
              ? ` · 官方硬件 ${data.officialHardware.hardware} 项 · STEP ${data.officialHardware.stepModels} 个`
              : ""}
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
                {item.sourceName} · {item.skus?.join(" / ") || item.asin} ·
                采集于 {item.capturedAt}
              </p>
              {item.sourceType === "official_hardware" && (
                <p>
                  STEP {item.modelCount} 个 · 文档 {item.documentCount} 篇 ·{" "}
                  {item.functionSummary || item.description}
                </p>
              )}
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
                    setGeometry(undefined);
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
                查看原始来源
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
              {!!record.documents?.length && (
                <details>
                  <summary>
                    官方手册与教程（{record.documents.length} 篇）
                  </summary>
                  {record.documents.map((doc: any) => (
                    <p key={doc.document_id}>
                      <button
                        disabled={loading}
                        onClick={async () => {
                          setLoading(true);
                          try {
                            const detail = await api(
                              `/local-library?candidateId=${record.candidateId}&documentId=${doc.document_id}`,
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
                        {doc.title}
                      </button>
                    </p>
                  ))}
                </details>
              )}
              {record.document && (
                <details open>
                  <summary>{record.document.title}</summary>
                  <pre className="library-source-text">
                    {record.document.sourceText}
                  </pre>
                  {record.document.nextOffset !== null && (
                    <button
                      disabled={loading}
                      onClick={async () => {
                        setLoading(true);
                        try {
                          const d = await api(
                            `/local-library?candidateId=${record.candidateId}&documentId=${record.document.documentId}&offset=${record.document.nextOffset}`,
                          );
                          setRecord(d.record);
                        } catch (e) {
                          setError((e as Error).message);
                        } finally {
                          setLoading(false);
                        }
                      }}
                    >
                      读取下一段
                    </button>
                  )}
                </details>
              )}
              {!!record.models?.length && (
                <section aria-label="官方 STEP 模型">
                  <h4>官方 STEP 模型与空间检查</h4>
                  <p>
                    可选：填写可用空间
                    XYZ（mm）。检查沿用模型原始坐标轴；不验证安装孔、线缆或电气适配。
                  </p>
                  <div className="button-row">
                    {["X", "Y", "Z"].map((axis, i) => (
                      <label key={axis}>
                        {axis}{" "}
                        <input
                          type="number"
                          aria-label={`可用空间 ${axis} mm`}
                          min="0.1"
                          max="2000"
                          value={envelope[i]}
                          onChange={(e) =>
                            setEnvelope((v) =>
                              v.map((x, j) => (j === i ? e.target.value : x)),
                            )
                          }
                        />
                      </label>
                    ))}
                  </div>
                  {record.models.map((model: any) => (
                    <p key={model.assetId}>
                      <a
                        href={`/api/local-library/asset?candidateId=${record.candidateId}&assetId=${model.assetId}`}
                      >
                        下载 {model.label}
                      </a>{" "}
                      <button
                        disabled={loading || !projectId}
                        onClick={async () => {
                          setLoading(true);
                          setGeometry(undefined);
                          try {
                            const available = envelope.some(Boolean)
                              ? envelope.map(Number)
                              : undefined;
                            if (
                              available &&
                              available.some(
                                (x) => !Number.isFinite(x) || x <= 0,
                              )
                            )
                              throw new Error(
                                "请填写完整且大于零的 XYZ 空间，或全部留空",
                              );
                            setGeometry(
                              await api(
                                `/projects/${projectId}/local-library/check`,
                                "POST",
                                {
                                  candidateId: record.candidateId,
                                  modelId: model.assetId,
                                  ...(available
                                    ? { availableEnvelopeMm: available }
                                    : {}),
                                },
                              ),
                            );
                          } catch (e) {
                            setError((e as Error).message);
                          } finally {
                            setLoading(false);
                          }
                        }}
                      >
                        检查 STEP 包络
                      </button>
                    </p>
                  ))}
                  {geometry && (
                    <div role="status">
                      <p>
                        模型包络 XYZ：
                        {Object.values(geometry.sizeMm)
                          .map((v) => Number(v).toFixed(3))
                          .join(" × ")}{" "}
                        mm · 实体 {geometry.solidCount} 个
                      </p>
                      <p>
                        BREP：{geometry.checks.brepValid ? "有效" : "需复查"}
                        {geometry.checks.axisAlignedEnvelopeFit === undefined
                          ? ""
                          : geometry.checks.axisAlignedEnvelopeFit
                            ? " · 所填轴对齐空间可容纳包络"
                            : " · 所填空间不能容纳该方向包络"}
                      </p>
                      <p>
                        检查报告及 STEP
                        已保存为本项目证据；完整安装几何和实物适配仍未核验。
                      </p>
                    </div>
                  )}
                </section>
              )}
              {!!record.assets?.length && (
                <details>
                  <summary>
                    原理图、Pinout、CAD 等文件（{record.assetCount} 项）
                  </summary>
                  {record.assets.map((asset: any) => (
                    <p key={asset.assetId}>
                      {asset.state === "downloaded" ? (
                        <a
                          href={`/api/local-library/asset?candidateId=${record.candidateId}&assetId=${asset.assetId}`}
                        >
                          {asset.role} · {asset.label}
                        </a>
                      ) : (
                        <span>
                          {asset.role} · {asset.label} · 未下载
                        </span>
                      )}
                    </p>
                  ))}
                </details>
              )}
            </article>
          )}
        </>
      )}
    </section>
  );
}

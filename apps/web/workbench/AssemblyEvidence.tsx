import type { Invocation } from "../../../packages/workbench/contracts";

const hash = /^[a-f0-9]{64}$/;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const filename =
  /^(?:(?:base|lid)(?:-assembly)?\.step|(?:base|lid)\.stl|report\.json)$/;
const object = (v: unknown): Record<string, unknown> | undefined =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;

/** Only application-owned execution evidence may provide download links. */
export function assemblyResults(node?: Invocation) {
  return (node?.assemblyEvidence || []).flatMap((packet) => {
    if (
      packet.evidence !== "executed" ||
      packet.execution?.tool !== "build_printable_assembly"
    )
      return [];
    return packet.data.structure.flatMap((item) => {
      const p = item.properties;
      if (
        item.kind !== "assembly-model" ||
        p.version !== "dreamatic.assembly-result/1" ||
        typeof p.id !== "string" ||
        !uuid.test(p.id) ||
        typeof p.revision !== "string" ||
        !hash.test(p.revision) ||
        packet.execution!.digest !== p.revision ||
        packet.execution!.artifact !== item.id ||
        typeof p.geometryChecksPassed !== "boolean"
      )
        return [];
      const assets = (Array.isArray(p.assets) ? p.assets : []).flatMap(
        (raw) => {
          const a = object(raw);
          if (
            !a ||
            typeof a.id !== "string" ||
            !filename.test(a.id) ||
            typeof a.sha256 !== "string" ||
            !hash.test(a.sha256) ||
            typeof a.bytes !== "number" ||
            !Number.isSafeInteger(a.bytes) ||
            a.bytes < 0
          )
            return [];
          const url = `/workbench-api/assembly/${p.id}/${a.id}?revision=${p.revision}&sha256=${a.sha256}`;
          return a.url === url ? [{ id: a.id, url, bytes: a.bytes }] : [];
        },
      );
      return [
        {
          id: item.id,
          label: item.label,
          revision: p.revision,
          source: p.sourceLayoutInvocationId,
          passed: p.geometryChecksPassed,
          report: object(p.report),
          assets,
        },
      ];
    });
  });
}

export function AssemblyEvidence({ node }: { node?: Invocation }) {
  const results = assemblyResults(node);
  if (!results.length) return null;
  return (
    <section className="assembly-evidence" aria-label="结构执行结果">
      <h3>结构执行结果与文件</h3>
      <p>
        几何检查仅针对本次分件及对应布局；实物打印、装配、公差与制造均未验证。
      </p>
      {results.map((r) => (
        <article key={`${r.id}:${r.revision}`}>
          <strong>{r.label}</strong>
          <p role={r.passed ? "status" : "alert"}>
            {r.passed
              ? "本次分件几何检查通过"
              : "本次分件几何检查存在缺口，需查看报告"}
          </p>
          <small>
            版本：{r.revision.slice(0, 12)} · 来源布局：
            {typeof r.source === "string" ? r.source : "未记录"}
          </small>
          {r.report?.gaps !== undefined && (
            <div>
              <h4>检查缺口</h4>
              <pre>{JSON.stringify(r.report.gaps, null, 2)}</pre>
            </div>
          )}
          {(
            [
              ["closure", "闭合检查"],
              ["parts", "分件检查"],
              ["checks", "几何检查明细"],
            ] as const
          ).map(
            ([key, label]) =>
              r.report?.[key] !== undefined && (
                <details key={key}>
                  <summary>{label}</summary>
                  <pre>{JSON.stringify(r.report[key], null, 2)}</pre>
                </details>
              ),
          )}
          <details>
            <summary>完整执行报告</summary>
            <pre>
              {r.report ? JSON.stringify(r.report, null, 2) : "报告字段未提供"}
            </pre>
          </details>
          <div className="assembly-downloads">
            {r.assets.map((a) => (
              <a key={a.id} href={a.url} download={a.id}>
                {a.id} · {a.bytes} B
              </a>
            ))}
          </div>
          {!r.assets.length && <p>无符合本次版本与固定下载路径的资产。</p>}
        </article>
      ))}
    </section>
  );
}

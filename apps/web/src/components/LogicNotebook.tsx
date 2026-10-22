import { useEffect, useRef, useState } from "react";
import {
  notebookSchema,
  type LayoutDraft,
  type NotebookDocument,
} from "../../../../packages/core/src/design-workspace";
import { t } from "../i18n";

export function LogicNotebook({
  document,
  onChange,
  draft,
  onOutputs,
  onHover,
}: {
  document: NotebookDocument;
  onChange: (doc: NotebookDocument) => void;
  draft: LayoutDraft;
  onOutputs: (outputs: Record<string, unknown>) => void;
  onHover: (refs: string[]) => void;
}) {
  const [busy, setBusy] = useState(false),
    [status, setStatus] = useState(""),
    [logs, setLogs] = useState<string[]>([]),
    [outputs, setOutputs] = useState<Record<string, unknown> | null>(null);
  const [auto, setAuto] = useState(false);
  const worker = useRef<Worker | null>(null),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    generation = useRef(0);
  const stop = () => {
    generation.current++;
    worker.current?.terminate();
    worker.current = null;
    clearTimeout(timer.current);
    setBusy(false);
  };
  const fingerprint = JSON.stringify({ document, draft });
  useEffect(() => {
    stop();
    setOutputs(null);
    setStatus(t("输入已变化，输出待运行"));
    onOutputs({});
  }, [fingerprint]);
  useEffect(
    () => () => {
      generation.current++;
      worker.current?.terminate();
      clearTimeout(timer.current);
    },
    [],
  );
  function run(last = document.cells.length - 1) {
    stop();
    setOutputs(null);
    onOutputs({});
    setLogs([]);
    setBusy(true);
    setStatus(t("正在加载本地 Python…"));
    const token = generation.current;
    try {
      notebookSchema.parse(document);
      const w = new Worker("/api/notebook/worker");
      worker.current = w;
      timer.current = setTimeout(() => {
        if (generation.current !== token) return;
        stop();
        setStatus(t("Python 超时，已终止"));
      }, 30000);
      w.onerror = (e) => {
        if (token !== generation.current) return;
        stop();
        setStatus(e.message || t("Python 运行时不可用"));
      };
      w.onmessage = ({ data }) => {
        if (token !== generation.current) return;
        if (data.type === "log")
          setLogs((old) =>
            [...old, String(data.text)].join("\n").slice(-50000).split("\n"),
          );
        if (data.type === "ready")
          setStatus(`Python · Pyodide ${data.version}`);
        if (data.type === "error") {
          stop();
          setStatus(String(data.message));
        }
        if (data.type === "result") {
          stop();
          if (
            !data.outputs ||
            typeof data.outputs !== "object" ||
            Array.isArray(data.outputs) ||
            JSON.stringify(data.outputs).length > 100000
          ) {
            setStatus(t("Python 输出格式无效"));
            return;
          }
          setOutputs(data.outputs);
          setStatus(`Python · ${data.version} · ${t("执行完成")}`);
          onOutputs(data.outputs);
        }
      };
      w.postMessage({
        cells: document.cells.slice(0, last + 1),
        inputs: Object.fromEntries(
          document.inputs.map((i) => [i.name, i.value]),
        ),
        snapshot: draft,
      });
    } catch (e) {
      stop();
      setStatus(String(e));
    }
  }
  useEffect(() => {
    if (!auto) return;
    const id = setTimeout(() => run(), 600);
    return () => clearTimeout(id);
  }, [fingerprint, auto]);
  return (
    <section className="logic-notebook" aria-label={t("Python 逻辑实验")}>
      <div className="engine-toolbar">
        <button disabled={busy} onClick={() => run()}>
          {t("从头运行")}
        </button>
        <button
          disabled={!busy}
          onClick={() => {
            stop();
            setStatus(t("已取消"));
          }}
        >
          {t("取消")}
        </button>
        <label>
          <input
            type="checkbox"
            checked={auto}
            onChange={(e) => setAuto(e.target.checked)}
          />
          {t("输入变化自动重算")}
        </label>
        <button
          onClick={() =>
            onChange({
              ...document,
              cells: [
                ...document.cells,
                { id: `cell_${Date.now()}`, code: "# 新的逻辑单元\n" },
              ],
            })
          }
        >
          {t("添加代码单元")}
        </button>
      </div>
      <p>{t("每次在独立 Python 上下文从头执行；输出仅驱动临时预览。")}</p>
      {document.inputs.map((input, index) => (
        <label className="notebook-input" key={input.name}>
          {input.name}
          <input
            aria-label={input.name}
            type="range"
            min={input.min}
            max={input.max}
            step={input.step}
            value={input.value}
            onChange={(e) =>
              onChange({
                ...document,
                inputs: document.inputs.map((v, i) =>
                  i === index ? { ...v, value: +e.target.value } : v,
                ),
              })
            }
          />
          <input
            aria-label={`${input.name} value`}
            type="number"
            min={input.min}
            max={input.max}
            step={input.step}
            value={input.value}
            onChange={(e) =>
              onChange({
                ...document,
                inputs: document.inputs.map((v, i) =>
                  i === index ? { ...v, value: +e.target.value } : v,
                ),
              })
            }
          />
        </label>
      ))}
      {document.cells.map((cell, index) => (
        <article className="notebook-cell" key={cell.id}>
          <header>
            {cell.id}
            <button disabled={busy} onClick={() => run(index)}>
              {t("运行到此单元")}
            </button>
            <button
              onClick={() =>
                onChange({
                  ...document,
                  cells: document.cells.filter((_, i) => i !== index),
                })
              }
            >
              {t("移除")}
            </button>
          </header>
          <textarea
            aria-label={`Python ${cell.id}`}
            spellCheck={false}
            value={cell.code}
            onChange={(e) =>
              onChange({
                ...document,
                cells: document.cells.map((v, i) =>
                  i === index ? { ...v, code: e.target.value } : v,
                ),
              })
            }
          />
        </article>
      ))}
      <details>
        <summary>{t("输入控件与输出绑定")}</summary>
        <p>{t("绑定关节时使用 rad/deg/m/mm；绑定信息端口使用 sample。")}</p>
        <NotebookConfig document={document} onChange={onChange} />
        {document.bindings.map((b, i) => (
          <button
            key={i}
            onMouseEnter={() => onHover([b.target])}
            onMouseLeave={() => onHover([])}
          >
            {b.output} → {b.target} ({b.unit})
          </button>
        ))}
      </details>
      <output role="status">{status}</output>
      {!!logs.length && (
        <pre className="notebook-output">{logs.join("\n")}</pre>
      )}
      {outputs && (
        <div className="notebook-output" data-testid="notebook-result">
          {Object.entries(outputs).map(([name, value]) => (
            <article key={name}>
              <strong>{name}</strong>
              {Array.isArray(value) &&
              value.length > 1 &&
              value.length <= 2000 &&
              value.every(
                (v) => typeof v === "number" && Number.isFinite(v),
              ) ? (
                <svg viewBox="0 0 500 120" aria-label={name}>
                  <polyline
                    fill="none"
                    stroke="#6d8051"
                    strokeWidth="2"
                    points={value
                      .map(
                        (v, i) =>
                          `${(i / (value.length - 1)) * 500},${110 - ((v - Math.min(...value)) / (Math.max(...value) - Math.min(...value) || 1)) * 100}`,
                      )
                      .join(" ")}
                  />
                </svg>
              ) : (
                <pre>{JSON.stringify(value, null, 2)}</pre>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
function NotebookConfig({
  document,
  onChange,
}: {
  document: NotebookDocument;
  onChange: (d: NotebookDocument) => void;
}) {
  const [text, setText] = useState(
      JSON.stringify(
        { inputs: document.inputs, bindings: document.bindings },
        null,
        2,
      ),
    ),
    [error, setError] = useState("");
  const configKey = JSON.stringify({
    inputs: document.inputs,
    bindings: document.bindings,
  });
  useEffect(() => {
    setText(JSON.stringify(JSON.parse(configKey), null, 2));
  }, [configKey]);
  return (
    <>
      <textarea
        aria-label={t("Notebook 控件 JSON")}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <button
        onClick={() => {
          try {
            const next = notebookSchema.parse({
              ...document,
              ...JSON.parse(text),
            });
            onChange(next);
            setError("");
          } catch (e) {
            setError(String(e));
          }
        }}
      >
        {t("应用控件")}
      </button>
      {error && <p role="alert">{error}</p>}
    </>
  );
}

import { useEffect, useState } from "react";
import { Check, LoaderCircle, RefreshCw, ShieldCheck, X } from "lucide-react";
import type { PublicConnection } from "../../../packages/workbench/connection";
// Type-only import: Node storage and SDK code never enter the browser bundle.
const BASE = "https://apicz.boyuerichdata.com/v1";
async function request(path: string, body?: unknown) {
  const res = await fetch(`/workbench-api/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", "X-Workbench": "1" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "请求失败");
  return data;
}
export function ConnectionSettings({
  close,
  busy,
}: {
  close: () => void;
  busy: boolean;
}) {
  const [config, setConfig] = useState<PublicConnection>({
    baseUrl: BASE,
    generalModel: "deepseek-flash",
    cadModel: "",
    hasKey: false,
  });
  const [key, setKey] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    request("connection")
      .then(setConfig)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  const change = (field: keyof PublicConnection, value: string) => {
    setConfig((c) => ({ ...c, [field]: value }));
    setSaved(false);
  };
  const catalog = async () => {
    setPending(true);
    setError("");
    setSaved(false);
    try {
      const data = await request("connection/models", {
        baseUrl: config.baseUrl,
        apiKey: key || undefined,
      });
      setModels(data.models);
      setConfig((c) => ({
        ...c,
        generalModel: data.models.includes(c.generalModel)
          ? c.generalModel
          : data.suggested.generalModel,
        cadModel: data.models.includes(c.cadModel)
          ? c.cadModel
          : data.suggested.cadModel,
        imageModel: data.imageModels?.includes(c.imageModel)
          ? c.imageModel
          : data.suggestedImageModel || "",
      }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  };
  const save = async () => {
    setPending(true);
    setError("");
    try {
      const data = await request("connection", {
        baseUrl: config.baseUrl,
        apiKey: key || undefined,
        generalModel: config.generalModel,
        cadModel: config.cadModel,
        imageModel: config.imageModel || "",
      });
      setConfig(data);
      setKey("");
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  };
  const choices = [
    ...new Set([...models, config.generalModel, config.cadModel]),
  ].filter(Boolean);
  const cadChoices = choices.filter((id) => /kimi|(?:^|\/)k\d/i.test(id));
  const generalChoices = choices.filter((id) => /deepseek.*flash/i.test(id));
  const imageChoices = [
    ...new Set([...models, config.imageModel || ""]),
  ].filter((id) =>
    /seedream|qwen-image|gpt-image|dall-e|imagen|flux/i.test(id),
  );
  return (
    <div className="connection-overlay">
      <section
        className="connection-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="connection-title"
      >
        <header>
          <div>
            <span className="eyebrow">MODEL CONNECTION</span>
            <h2 id="connection-title">模型设置</h2>
          </div>
          <button title="关闭模型设置" onClick={close}>
            <X size={18} />
          </button>
        </header>
        <p>
          结构 / CAD 使用 Kimi，文字规划使用 DeepSeek
          Flash。外观设计师通过专用生图模型生成实际图片，模型 ID
          从你的网关获取。
        </p>
        <label>
          API 地址
          <input
            aria-label="API 地址"
            type="url"
            value={config.baseUrl}
            onChange={(e) => {
              change("baseUrl", e.target.value);
              setModels([]);
            }}
            disabled={pending || loading || busy}
          />
        </label>
        <label>
          API Key{" "}
          <small>
            {config.hasKey
              ? "已保存在本机；留空保留"
              : "只在此处填写，不用发送到聊天"}
          </small>
          <input
            aria-label="API Key"
            type="password"
            autoComplete="new-password"
            value={key}
            onChange={(e) => {
              setKey(e.target.value);
              setSaved(false);
            }}
            placeholder={
              config.hasKey ? "留空保留现有 Key" : "粘贴此网关的 Key"
            }
            disabled={pending || loading || busy}
          />
        </label>
        <button
          className="outline fetch-models"
          disabled={pending || loading || busy || (!key && !config.hasKey)}
          onClick={catalog}
        >
          {pending ? (
            <LoaderCircle className="spin" size={14} />
          ) : (
            <RefreshCw size={14} />
          )}
          获取可用模型
        </button>
        {models.length > 0 && (
          <span className="catalog-count">已获取 {models.length} 个模型</span>
        )}
        <div className="model-route-card">
          <span className="eyebrow">STRUCTURE / CAD</span>
          <h3>结构工程师 → Kimi</h3>
          <select
            aria-label="CAD 模型"
            value={config.cadModel}
            onChange={(e) => change("cadModel", e.target.value)}
            disabled={pending || loading || busy}
          >
            <option value="">请选择网关提供的 Kimi 型号</option>
            {cadChoices.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
          <small>
            优先识别 K3.1 Pro；若网关别名不同，请从实际列表选择。保持推理开启。
          </small>
        </div>
        <div className="model-route-card">
          <span className="eyebrow">OTHER AGENTS</span>
          <h3>产品经理及其他专家 → DeepSeek Flash</h3>
          <select
            aria-label="其余 agent 模型"
            value={config.generalModel}
            onChange={(e) => change("generalModel", e.target.value)}
            disabled={pending || loading || busy}
          >
            <option value="">请选择 DeepSeek Flash 型号</option>
            {generalChoices.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
          <small>包含产品经理、调研、嵌入式、外观、软件和独立审查。</small>
        </div>
        <div className="model-route-card">
          <span className="eyebrow">IMAGE GENERATION</span>
          <h3>外观生图执行器</h3>
          <select
            aria-label="生图模型"
            value={config.imageModel || ""}
            onChange={(e) => change("imageModel", e.target.value)}
            disabled={pending || loading || busy}
          >
            <option value="">暂不启用生图</option>
            {imageChoices.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
          <small>
            生成并保存真实概念图；一次外观调用最多四个视图。效果图不代表工程尺寸已验证。
          </small>
        </div>
        {error && (
          <div className="connection-error" role="alert">
            {error}
          </div>
        )}
        {saved && (
          <div className="connection-success">
            <Check size={14} />
            配置已保存；后续调用将按角色选择模型。
          </div>
        )}
        <footer>
          <span>
            <ShieldCheck size={14} />
            Key 仅存本机，不进入项目导出
          </span>
          <button
            className="primary"
            disabled={
              pending ||
              loading ||
              busy ||
              !config.cadModel ||
              !config.generalModel ||
              (!key && !config.hasKey)
            }
            onClick={save}
          >
            保存配置
          </button>
        </footer>
      </section>
    </div>
  );
}

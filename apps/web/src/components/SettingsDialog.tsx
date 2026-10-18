import { t, useLanguage, setLanguage } from "../i18n";
import { useEffect, useState, useRef } from "react";
import {
  X,
  SlidersHorizontal,
  CheckCircle2,
  Save,
  Activity,
} from "lucide-react";
import { api, type SettingsView } from "../api";
export function SettingsDialog({ onClose }: { onClose: () => void }) {
  useLanguage();
  const [settings, setSettings] = useState<SettingsView>(),
    [values, setValues] = useState<Record<string, string>>({}),
    [module, setModule] = useState("reasoning"),
    [busy, setBusy] = useState(false),
    [checking, setChecking] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [diagnostics, setDiagnostics] = useState<{
      checks: { label: string; ok: boolean; detail: string }[];
      modelConfigured: boolean;
    }>();
  const dialog = useRef<HTMLDialogElement>(null),
    restoreFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    restoreFocus.current = document.activeElement as HTMLElement;
    dialog.current?.showModal();
    let live = true;
    void api<SettingsView>("/settings")
      .then((data) => {
        if (live) {
          setSettings(data);
          requestAnimationFrame(() =>
            dialog.current
              ?.querySelector<HTMLButtonElement>('[role="tab"]')
              ?.focus(),
          );
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
      restoreFocus.current?.focus();
    };
  }, []);
  async function save() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const saved = await api<SettingsView>("/settings", "PUT", values);
      setSettings((current) => ({
        ...saved,
        activeWorkspace: current?.activeWorkspace,
      }));
      setLanguage(
        saved.fields.find((field) => field.key === "MAKE_LANGUAGE")?.value ??
          "zh",
      );
      setValues({});
      setNotice(t("语言已保存，界面已切换；模型与工具配置在下次任务生效。"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function diagnose() {
    setChecking(true);
    setError("");
    try {
      setDiagnostics(await api("/diagnostics", "POST", {}));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setChecking(false);
    }
  }
  const fields = settings?.fields.filter((f) => f.module === module) ?? [],
    active = settings?.modules.find((m) => m.id === module);
  const renderFields = (list: SettingsView["fields"]) =>
    list.map((f) => (
      <label key={f.key}>
        <span>
          {t(f.label)}
          {f.restartRequired && (
            <em>{t("修改后需重启系统；原工作目录文件保留")}</em>
          )}
          {f.secret && (
            <em>
              {f.key in values
                ? values[f.key]
                  ? t("保存后替换密钥")
                  : t("保存后清除独立密钥")
                : f.configured
                  ? t("已配置；不修改则保留")
                  : f.module === "image"
                    ? t("未单独配置；沿用推理服务")
                    : t("尚未配置")}
            </em>
          )}
        </span>
        <code className="config-env-key">{f.key}</code>
        <div className="config-input-row">
          {f.type === "select" ? (
            <select
              aria-label={t(f.label)}
              disabled={busy}
              value={values[f.key] ?? f.value}
              onChange={(e) =>
                setValues({ ...values, [f.key]: e.target.value })
              }
            >
              {f.options?.map((o) => (
                <option key={o.value} value={o.value}>
                  {t(o.label)}
                </option>
              ))}
            </select>
          ) : (
            <input
              aria-label={t(f.label)}
              disabled={busy}
              type={
                f.secret ? "password" : f.type === "number" ? "number" : "text"
              }
              min={f.min}
              max={f.max}
              step={f.type === "number" ? 1 : undefined}
              autoComplete={f.secret ? "new-password" : "off"}
              value={values[f.key] ?? f.value}
              placeholder={
                f.secret
                  ? t("输入新密钥以替换；不修改则保留")
                  : f.module === "image"
                    ? t("留空沿用推理模型配置")
                    : t(f.example)
              }
              onChange={(e) =>
                setValues({ ...values, [f.key]: e.target.value })
              }
            />
          )}{" "}
          {f.secret && (f.configured || !!values[f.key]) && (
            <button
              type="button"
              className="config-clear"
              disabled={busy}
              onClick={() => setValues({ ...values, [f.key]: "" })}
            >
              {t("清除")}{" "}
            </button>
          )}
        </div>
        <small className="config-example">
          {t("示例：")} <code>{t(f.example)}</code>
        </small>
        <small className="config-help">{t(f.description)}</small>
      </label>
    ));
  return (
    <dialog
      className="settings-dialog config-modal"
      ref={dialog}
      aria-labelledby="settings-title"
      onCancel={(e) => {
        if (busy) {
          e.preventDefault();
          return;
        }
        onClose();
      }}
    >
      <header>
        <div className="settings-icon">
          <SlidersHorizontal size={17} />
        </div>
        <span>
          <strong id="settings-title">Settings</strong>
          <small>{t("读取并保存系统 .env 配置")}</small>
        </span>
        <button
          type="button"
          aria-label={t("关闭设置")}
          disabled={busy}
          onClick={onClose}
        >
          <X size={16} />
        </button>
      </header>
      <div className="config-source">
        <code title={settings?.path}>
          {settings?.path ?? t("正在读取配置…")}
        </code>
        <span>
          {t("模型及工具配置在下次任务生效；项目工作目录修改需重启系统。")}
        </span>
      </div>
      <div className="config-tabs" role="tablist" aria-label={t("配置模块")}>
        {settings?.modules.map((m, index) => (
          <button
            key={m.id}
            type="button"
            role="tab"
            id={`config-tab-${m.id}`}
            aria-selected={module === m.id}
            aria-controls={`config-panel-${m.id}`}
            tabIndex={module === m.id ? 0 : -1}
            onClick={() => setModule(m.id)}
            onKeyDown={(e) => {
              if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
                e.preventDefault();
                const next =
                  e.key === "Home"
                    ? 0
                    : e.key === "End"
                      ? settings.modules.length - 1
                      : (index +
                          (e.key === "ArrowRight" ? 1 : -1) +
                          settings.modules.length) %
                        settings.modules.length;
                const id = settings.modules[next].id;
                setModule(id);
                dialog.current
                  ?.querySelector<HTMLButtonElement>(`#config-tab-${id}`)
                  ?.focus();
              }
            }}
          >
            {t(m.title)}
          </button>
        ))}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div
          className="config-form"
          role="tabpanel"
          id={`config-panel-${module}`}
          aria-labelledby={`config-tab-${module}`}
        >
          <p className="config-module-description">
            {t(active?.description ?? "正在加载设置…")}
          </p>
          {module === "system" && settings?.activeWorkspace && (
            <p className="config-module-description">
              {t("当前使用的工作目录：")}{" "}
              <code>{settings.activeWorkspace}</code>
            </p>
          )}
          {renderFields(fields.filter((f) => !f.advanced))}
          {fields.some((f) => f.advanced) && (
            <details key={module} className="config-advanced">
              <summary>{t("高级配置")}</summary>
              <p className="config-help">
                {t("可选覆盖项，保持现有值即可使用默认配置。")}{" "}
              </p>
              <div className="config-advanced-fields">
                {renderFields(fields.filter((f) => f.advanced))}
              </div>
            </details>
          )}
          {module === "system" && (
            <section className="config-diagnostics">
              <button
                type="button"
                disabled={busy || checking}
                onClick={() => void diagnose()}
              >
                <Activity size={14} />
                {checking ? t("正在检查…") : t("检查工具链")}
              </button>
              <small className="config-help">
                {t("检查已保存的配置；修改后请先保存再运行诊断。")}{" "}
              </small>
              {diagnostics && (
                <div className="diagnostic-results" role="status">
                  {diagnostics.checks.map((c) => (
                    <p key={t(c.label)} className={c.ok ? "success" : "error"}>
                      {t(c.label)}：{c.ok ? t("可用") : t(c.detail)}
                    </p>
                  ))}
                  <p>
                    {t("推理服务密钥：")}{" "}
                    {diagnostics.modelConfigured
                      ? t("已配置（尚未测试远程连接）")
                      : t("未配置")}
                  </p>
                </div>
              )}
            </section>
          )}
        </div>
        {notice && (
          <p className="config-notice success" role="status">
            <CheckCircle2 size={14} />
            {notice}
          </p>
        )}
        {error && (
          <p className="config-error" role="alert">
            {t(error)}
          </p>
        )}
        <footer>
          <button type="button" disabled={busy} onClick={onClose}>
            {t("取消")}{" "}
          </button>
          <button className="primary" disabled={busy || !settings}>
            <Save size={14} />
            {busy ? t("保存中…") : t("保存配置")}
          </button>
        </footer>
      </form>
    </dialog>
  );
}

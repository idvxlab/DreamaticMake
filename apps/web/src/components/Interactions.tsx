import { ReviewReport } from "./ReviewReport";
import { ReviewCountdown } from "./ReviewCountdown";
import { choiceQuestions } from "../../../../packages/core/src/choice-questions";
import { MarkdownMessage } from "./MarkdownMessage";
import { t, useLanguage } from "../i18n";
import { useRef, useState } from "react";
import {
  Check,
  ChevronRight,
  FileDown,
  AlertTriangle,
  MessageSquare,
  RotateCcw,
} from "lucide-react";
import type {
  Interaction,
  Answers,
  Stage,
  Enclosure,
  Artifact,
} from "../../../../packages/core/src/contracts";
import { stageLabels } from "../../../../packages/core/src/contracts";
import { artifactURL } from "../api";
export function QuestionCard({
  card,
  onAnswer,
  disabled = false,
}: {
  card: Interaction;
  onAnswer: (answers: Answers) => Promise<void>;
  disabled?: boolean;
}) {
  useLanguage();
  const [answers, setAnswers] = useState<Answers>(card.answers ?? {});
  return (
    <form
      className="interaction-card"
      onSubmit={(e) => {
        e.preventDefault();
        void onAnswer(answers);
      }}
    >
      <div className="card-kicker">
        <MessageSquare size={14} />
        {t("需要你的判断")}{" "}
      </div>
      <MarkdownMessage text={t(card.title)} card />
      {card.questions.map((q) => (
        <fieldset key={q.id} disabled={disabled || !!card.answers}>
          <legend>
            <MarkdownMessage text={q.label} card inline />
            {q.required ? " *" : ""}
            {q.selection === "multiple" && (
              <small className="question-selection-hint">
                {t("可多选，可同时选择多个选项")}
              </small>
            )}
          </legend>
          <div className="option-list">
            {q.options.map((option) => (
              <button
                type="button"
                className={
                  (
                    Array.isArray(answers[q.id])
                      ? (answers[q.id] as string[]).includes(option)
                      : answers[q.id] === option
                  )
                    ? "selected"
                    : ""
                }
                aria-pressed={
                  Array.isArray(answers[q.id])
                    ? (answers[q.id] as string[]).includes(option)
                    : answers[q.id] === option
                }
                key={option}
                onClick={() =>
                  setAnswers((previous) => {
                    if (q.selection !== "multiple")
                      return { ...previous, [q.id]: option };
                    const selected = Array.isArray(previous[q.id])
                      ? (previous[q.id] as string[])
                      : [];
                    return {
                      ...previous,
                      [q.id]: selected.includes(option)
                        ? selected.filter((value) => value !== option)
                        : [...selected, option],
                    };
                  })
                }
              >
                <MarkdownMessage text={option} card inline links={false} />
              </button>
            ))}
          </div>
          <input
            aria-label={q.label}
            placeholder={t(
              q.selection === "multiple"
                ? "也可补充其他答案（与所选选项一起提交）"
                : "选择选项，或输入你的想法",
            )}
            required={
              q.required &&
              !(
                q.selection === "multiple" &&
                Array.isArray(answers[q.id]) &&
                answers[q.id].length
              )
            }
            value={
              q.selection === "multiple"
                ? Array.isArray(answers[q.id])
                  ? (answers[q.id] as string[])
                      .filter((value) => !q.options.includes(value))
                      .join("；")
                  : ""
                : typeof answers[q.id] === "string"
                  ? (answers[q.id] as string)
                  : ""
            }
            onChange={(e) => {
              const value = e.target.value;
              setAnswers((previous) => ({
                ...previous,
                [q.id]:
                  q.selection === "multiple"
                    ? [
                        ...(Array.isArray(previous[q.id])
                          ? (previous[q.id] as string[]).filter((item) =>
                              q.options.includes(item),
                            )
                          : []),
                        ...(value.trim() ? [value] : []),
                      ]
                    : value,
              }));
            }}
          />
        </fieldset>
      ))}
      <button className="primary" disabled={disabled || !!card.answers}>
        {card.answers ? t("已回答") : t("提交回答")}
        <ChevronRight size={14} />
      </button>
    </form>
  );
}
export function ChoiceCards({
  choices,
  selected,
  onSelect,
  disabled,
}: {
  choices: {
    id: string;
    label: string;
    description: string;
    parameters?: Enclosure;
  }[];
  selected?: string;
  onSelect: (id: string) => void;
  disabled: boolean;
}) {
  useLanguage();
  return (
    <div className="choice-cards" role="group" aria-label={t("设计方案")}>
      {choices.map((c, i) => (
        <button
          key={c.id}
          className={`choice-card ${selected === c.id ? "selected" : ""}`}
          disabled={disabled}
          onClick={() => onSelect(c.id)}
        >
          <span>
            {t("方案")} {String(i + 1).padStart(2, "0")}
          </span>
          <strong>
            <MarkdownMessage text={c.label} card inline links={false} />
          </strong>
          {c.parameters && (
            <div className="choice-dimensions">
              {c.parameters.width} × {c.parameters.depth} ×{" "}
              {c.parameters.height} mm
            </div>
          )}
          <MarkdownMessage text={c.description} card links={false} />
          {selected === c.id && <Check size={16} />}
        </button>
      ))}
    </div>
  );
}
export function ApprovalCard({
  stage,
  disabled,
  onDecision,
  onSelectChoice,
  onAnswerChoices,
  unverifiedParts = [],
  onInspectHardware,
  pendingQuestion = false,
  automaticRepairUsed = false,
  compact = false,
}: {
  stage: Stage;
  disabled: boolean;
  onDecision: (
    decision: "approved" | "changes_requested",
    comment?: string,
  ) => Promise<void>;
  onSelectChoice?: (id: string) => void;
  onAnswerChoices?: (answers: Answers) => Promise<void>;
  unverifiedParts?: string[];
  onInspectHardware?: () => void;
  pendingQuestion?: boolean;
  automaticRepairUsed?: boolean;
  compact?: boolean;
}) {
  useLanguage();
  const [editing, setEditing] = useState(false),
    [comment, setComment] = useState("");
  const questions = stage.draft
    ? choiceQuestions(stage.draft.choices)
    : undefined;
  const needsChoice =
    !!stage.draft?.choices.length && !stage.draft.selectedChoice;
  const blocked =
    !!stage.draft?.blockers.length || stage.review?.verdict !== "pass";
  const repairStarted = useRef(false);
  const repair = async () => {
    if (repairStarted.current || disabled) return;
    repairStarted.current = true;
    try {
      await onDecision("changes_requested", comment.trim() || undefined);
    } finally {
      repairStarted.current = false;
    }
  };
  const automaticRepair =
    !automaticRepairUsed &&
    !disabled &&
    !editing &&
    !pendingQuestion &&
    !questions &&
    !needsChoice &&
    stage.status === "awaiting_confirmation" &&
    stage.review?.verdict === "changes_requested" &&
    !!stage.draft &&
    unverifiedParts.length === 0;
  return (
    <div className="approval-card">
      <div className="card-kicker">
        {blocked ? <AlertTriangle size={14} /> : <Check size={14} />}
        {t("阶段审阅 · V")}
        {stage.revision}
      </div>
      <strong>
        {blocked ? t("需要完善后再确认") : t("预览已就绪，等待你确认")}
      </strong>
      {stage.review &&
        (compact ? (
          <details className="workflow-full-text">
            <summary>{t("展开审阅意见")}</summary>
            <ReviewReport review={stage.review} />
          </details>
        ) : (
          <ReviewReport review={stage.review} />
        ))}
      {questions ? (
        <QuestionCard
          card={{ ...questions, id: `legacy-${stage.id}-${stage.revision}` }}
          disabled={disabled || !onAnswerChoices}
          onAnswer={onAnswerChoices ?? (async () => {})}
        />
      ) : (
        !!stage.draft?.choices.length && (
          <section
            className="approval-choices"
            aria-label={t("选择本阶段方案")}
          >
            <strong>{t("选择本阶段方案")}</strong>
            {needsChoice && (
              <p className="warning">
                {t("请先选择方案，选择后将自动重新审阅，再确认并继续。")}
              </p>
            )}
            <ChoiceCards
              choices={stage.draft.choices}
              selected={stage.draft.selectedChoice}
              disabled={disabled || !onSelectChoice}
              onSelect={(id) => onSelectChoice?.(id)}
            />
          </section>
        )
      )}

      {!compact &&
        stage.draft?.blockers.map((b, i) => (
          <div className="warning" key={i}>
            <MarkdownMessage text={b} card />
          </div>
        ))}
      {!!stage.draft?.futureChecks?.length && (
        <details
          className="approval-followups"
          open={compact ? undefined : true}
        >
          <summary>{t("后续阶段待核验（不阻塞本阶段确认）")}</summary>
          {stage.draft.futureChecks.map((check, i) => (
            <div key={i}>
              <strong>{t(stageLabels[check.stage])}</strong>
              <MarkdownMessage text={check.description} card />
            </div>
          ))}
        </details>
      )}
      {blocked && (
        <p className="approval-guidance">
          {t(
            "系统将按审阅意见逐项完善并重新审阅；仅在需要你决策或补充信息时提问，通过后再请你确认。",
          )}
        </p>
      )}
      {blocked && unverifiedParts.length > 0 && (
        <section className="approval-followups">
          <strong>{t("需要真实几何核验，重复完善草稿无法解除")}</strong>
          <p>
            {t(
              "以下器件尚未核验安装包络。请在硬件页补充有依据的实测尺寸；系统不会将估计值标记为已验证。",
            )}
          </p>
          <ul>
            {unverifiedParts.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
        </section>
      )}
      {editing && (
        <textarea
          aria-label={t("修改意见")}
          placeholder={t(
            "可选：补充你的偏好或已知信息，具体完善工作由系统完成。",
          )}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
      )}
      {automaticRepair && <ReviewCountdown onContinue={repair} />}
      <div className="button-row">
        <button
          disabled={disabled}
          onClick={() =>
            editing
              ? void onDecision("changes_requested", comment)
              : setEditing(true)
          }
        >
          <RotateCcw size={14} />
          {editing ? t("提交补充并重新完善") : t("补充意见（可选）")}
        </button>
        {blocked && unverifiedParts.length > 0 && onInspectHardware ? (
          <button
            className="primary"
            disabled={disabled}
            onClick={onInspectHardware}
          >
            {t("查看待核验器件")} <ChevronRight size={14} />
          </button>
        ) : blocked ? (
          <button
            className="primary"
            disabled={disabled}
            onClick={() => void repair()}
          >
            <RotateCcw size={14} /> {t("按审阅意见自动完善")}
          </button>
        ) : (
          <button
            className="primary"
            disabled={
              disabled ||
              needsChoice ||
              !!questions ||
              stage.status !== "awaiting_confirmation"
            }
            onClick={() => void onDecision("approved")}
          >
            {t("确认并继续")} <ChevronRight size={14} />
          </button>
        )}
      </div>
    </div>
  );
}
export function ParameterEditor({
  value,
  onChange,
  disabled = false,
}: {
  value: Enclosure;
  onChange: (p: Enclosure) => void;
  disabled?: boolean;
}) {
  useLanguage();
  const labels: Record<string, string> = {
    width: t("宽度"),
    depth: t("深度"),
    height: t("高度"),
    wall: t("壁厚"),
    clearance: t("盖板间隙"),
    lid: t("盖板厚度"),
  };
  return (
    <div className="parameter-grid">
      {Object.entries(labels).map(([key, label]) => (
        <label key={key}>
          {label}
          <div>
            <input
              aria-label={label}
              disabled={disabled}
              type="number"
              step="0.1"
              value={value[key as keyof Enclosure] as number}
              onChange={(e) =>
                onChange({
                  ...value,
                  [key]: e.target.value === "" ? 0 : Number(e.target.value),
                })
              }
            />
            <span>mm</span>
          </div>
        </label>
      ))}
    </div>
  );
}
export function ArtifactList({
  projectId,
  artifacts,
}: {
  projectId: string;
  artifacts: Artifact[];
}) {
  useLanguage();
  return (
    <div className="artifact-list">
      {artifacts.length ? (
        artifacts.map((a) => (
          <a href={artifactURL(projectId, a.id) + "?download=1"} key={a.id}>
            <FileDown size={17} />
            <div>
              <strong>{a.name}</strong>
              <small>
                {(a.size / 1024).toFixed(1)} KB · SHA256 {a.hash.slice(0, 8)}
              </small>
            </div>
            <span>{t("下载")}</span>
          </a>
        ))
      ) : (
        <div className="muted empty-inline">
          {t("生成的工程文件会保存在这里。")}
        </div>
      )}
    </div>
  );
}
export function StructuralEditor({
  value,
  onChange,
  disabled = false,
  parts = [],
}: {
  value: Enclosure;
  onChange: (p: Enclosure) => void;
  disabled?: boolean;
  parts?: {
    id: string;
    name: string;
    dimensions: { width: number; depth: number; height: number | null };
  }[];
}) {
  useLanguage();
  return (
    <details className="structural-editor">
      <summary>{t("开孔、固定支柱与部件布局")}</summary>
      <div className="feature-list">
        <strong>{t("接口 / 显示开孔")}</strong>
        {(value.ports ?? []).map((port, i) => (
          <div key={i}>
            <select
              aria-label={t("开孔 {0} 位置", { 0: i + 1 })}
              value={port.face}
              disabled={disabled}
              onChange={(e) =>
                onChange({
                  ...value,
                  ports: value.ports.map((p, j) =>
                    i === j
                      ? { ...p, face: e.target.value as typeof port.face }
                      : p,
                  ),
                })
              }
            >
              {[
                ["front", t("前侧")],
                ["back", t("后侧")],
                ["left", t("左侧")],
                ["right", t("右侧")],
                ["lid", t("顶盖")],
              ].map(([v, l]) => (
                <option value={v} key={v}>
                  {l}
                </option>
              ))}
            </select>
            {(["x", "y", "width", "height"] as const).map((key) => (
              <label key={key}>
                {
                  {
                    x: t("水平中心"),
                    y: port.face === "lid" ? t("纵向中心") : t("离底高度"),
                    width: t("宽度"),
                    height: t("高度"),
                  }[key]
                }
                <input
                  aria-label={t("开孔 {0} {1}", { 0: i + 1, 1: key })}
                  type="number"
                  step="0.1"
                  disabled={disabled}
                  value={port[key]}
                  onChange={(e) =>
                    onChange({
                      ...value,
                      ports: value.ports.map((p, j) =>
                        i === j ? { ...p, [key]: +e.target.value } : p,
                      ),
                    })
                  }
                />
              </label>
            ))}
            <button
              type="button"
              disabled={disabled}
              onClick={() =>
                onChange({
                  ...value,
                  ports: value.ports.filter((_, j) => j !== i),
                })
              }
            >
              {t("移除")}{" "}
            </button>
          </div>
        ))}
        <button
          type="button"
          disabled={disabled}
          onClick={() =>
            onChange({
              ...value,
              ports: [
                ...(value.ports ?? []),
                { face: "front", x: 0, y: 12, width: 12, height: 7 },
              ],
            })
          }
        >
          {t("添加开孔")}{" "}
        </button>
      </div>
      <div className="feature-list">
        <strong>{t("板卡固定支柱")}</strong>
        {(value.mounts ?? []).map((mount, i) => (
          <div key={i}>
            {(
              ["x", "y", "height", "outerDiameter", "holeDiameter"] as const
            ).map((key) => (
              <label key={key}>
                {
                  {
                    x: "X",
                    y: "Y",
                    height: t("柱高"),
                    outerDiameter: t("外径"),
                    holeDiameter: t("孔径"),
                  }[key]
                }
                <input
                  type="number"
                  step="0.1"
                  disabled={disabled}
                  value={mount[key]}
                  onChange={(e) =>
                    onChange({
                      ...value,
                      mounts: value.mounts.map((m, j) =>
                        i === j ? { ...m, [key]: +e.target.value } : m,
                      ),
                    })
                  }
                />
              </label>
            ))}
            <button
              type="button"
              disabled={disabled}
              onClick={() =>
                onChange({
                  ...value,
                  mounts: value.mounts.filter((_, j) => j !== i),
                })
              }
            >
              {t("移除")}{" "}
            </button>
          </div>
        ))}
        <button
          type="button"
          disabled={disabled}
          onClick={() =>
            onChange({
              ...value,
              mounts: [
                ...(value.mounts ?? []),
                {
                  x: 10,
                  y: 10,
                  height: 4,
                  outerDiameter: 6,
                  holeDiameter: 2.5,
                },
              ],
            })
          }
        >
          {t("添加支柱")}{" "}
        </button>
      </div>
      <div className="feature-list">
        <strong>{t("部件安装包络")}</strong>
        {(value.components ?? []).map((component, i) => (
          <div key={i}>
            <span>
              {parts.find((p) => p.id === component.partId)?.name ??
                component.partId}
            </span>
            {(["x", "y", "z"] as const).map((key) => (
              <label key={key}>
                {key.toUpperCase()}
                <input
                  type="number"
                  step="0.1"
                  disabled={disabled}
                  value={component[key]}
                  onChange={(e) =>
                    onChange({
                      ...value,
                      components: value.components.map((c, j) =>
                        i === j ? { ...c, [key]: +e.target.value } : c,
                      ),
                    })
                  }
                />
              </label>
            ))}
            <button
              type="button"
              disabled={disabled}
              onClick={() =>
                onChange({
                  ...value,
                  components: value.components.filter((_, j) => j !== i),
                })
              }
            >
              {t("移除")}{" "}
            </button>
          </div>
        ))}
        {parts
          .filter(
            (p) =>
              p.dimensions.height &&
              !value.components?.some((c) => c.partId === p.id),
          )
          .map((p) => (
            <button
              type="button"
              disabled={disabled}
              key={p.id}
              onClick={() =>
                onChange({
                  ...value,
                  components: [
                    ...(value.components ?? []),
                    {
                      partId: p.id,
                      x: 0,
                      y: 0,
                      z: value.wall + 5,
                      ...p.dimensions,
                      height: p.dimensions.height!,
                    },
                  ],
                })
              }
            >
              {t("放置")} {p.name}
            </button>
          ))}
        <p className="muted">
          {t(
            "单位 mm，原点为壳体底面中心，Z 向上。部件尺寸来自目录，参考网格不作为打印零件。",
          )}{" "}
        </p>
      </div>
    </details>
  );
}
export function ArtifactPreview({
  projectId,
  artifacts,
}: {
  projectId: string;
  artifacts: Artifact[];
}) {
  useLanguage();
  const [selected, setSelected] = useState(""),
    [content, setContent] = useState(""),
    [error, setError] = useState("");
  const readable = artifacts.filter((a) =>
    /\.(cpp|h|ini|json|log|py|txt|md)$/.test(a.name),
  );
  async function read(id: string) {
    setSelected(id);
    setError("");
    try {
      const response = await fetch(artifactURL(projectId, id));
      if (!response.ok) throw new Error(t("文件已失效"));
      const text = await response.text();
      setContent(text.slice(0, 100000));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return readable.length ? (
    <div className="artifact-preview">
      <select
        aria-label={t("预览工程文件")}
        value={selected}
        onChange={(e) => void read(e.target.value)}
      >
        <option value="">{t("选择文本文件进行预览")}</option>
        {readable.map((a) => (
          <option key={a.id} value={a.id}>
            {a.stage}/{a.name}
          </option>
        ))}
      </select>
      {selected && <pre>{error || content || t("正在读取…")}</pre>}
    </div>
  ) : null;
}

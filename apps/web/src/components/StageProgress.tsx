import { useEffect, useRef } from "react";
import {
  Check,
  Clock3,
  LoaderCircle,
  CircleAlert,
  RotateCcw,
  MessageSquare,
  CircleDot,
} from "lucide-react";
import {
  stages,
  stageLabels,
  type Project,
  type StageId,
} from "../../../../packages/core/src/contracts";
import { t, useLanguage } from "../i18n";
export function StageProgress({
  project,
  selected,
  onSelect,
}: {
  project: Project;
  selected: StageId;
  onSelect: (stage: StageId) => void;
}) {
  useLanguage();
  const track = useRef<HTMLDivElement>(null);
  const active = stages.find(
    (stage) => project.stages[stage].status !== "approved",
  );
  const waiting = project.messages.some(
    (message) => message.interaction && !message.interaction.answers,
  );
  useEffect(() => {
    track.current
      ?.querySelector('[aria-current="step"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selected]);
  return (
    <div className="stage-track" ref={track} aria-label={t("项目进度")}>
      {stages.map((stage, index) => {
        const status = project.stages[stage].status;
        const running =
          (stage === active && project.running) || status === "running";
        const pending = stage === active && waiting && !running;
        const Icon = running
          ? LoaderCircle
          : pending
            ? MessageSquare
            : status === "approved"
              ? Check
              : status === "failed"
                ? CircleAlert
                : status === "stale"
                  ? RotateCcw
                  : status === "awaiting_confirmation"
                    ? Clock3
                    : CircleDot;
        const label = running
          ? "正在执行"
          : pending
            ? "等待回答"
            : {
                not_started: "尚未开始",
                running: "正在执行",
                approved: "已确认",
                failed: "执行失败",
                stale: "需要重新审阅",
                awaiting_confirmation: "等待确认",
              }[status];
        return (
          <button
            key={stage}
            className={`${status} ${running ? "is-running" : ""} ${selected === stage ? "selected" : ""}`}
            aria-current={selected === stage ? "step" : undefined}
            aria-label={`${t(stageLabels[stage])} · ${t(label)}`}
            onClick={() => onSelect(stage)}
          >
            <span className="stage-symbol" aria-hidden="true">
              {Icon ? (
                <Icon size={14} className={running ? "spin" : undefined} />
              ) : (
                <span>{String(index + 1).padStart(2, "0")}</span>
              )}
              <small className="stage-number">
                {String(index + 1).padStart(2, "0")}
              </small>
            </span>
            <span className="stage-details">
              <strong>{t(stageLabels[stage])}</strong>
              <small>{t(label)}</small>
            </span>
          </button>
        );
      })}
    </div>
  );
}

import { Box, LoaderCircle, Sparkles } from "lucide-react";
import { t, useLanguage } from "../i18n";
import {
  stageLabels,
  type StageId,
  type Interaction,
  type Answers,
} from "../../../../packages/core/src/contracts";
import { QuestionCard } from "./Interactions";
export function StageStart({
  stage,
  active,
  running,
  busy,
  archived,
  pending,
  onRun,
  onAnswer,
}: {
  stage: StageId;
  active: boolean;
  running: boolean;
  busy: boolean;
  archived: boolean;
  pending?: Interaction;
  onRun: () => void;
  onAnswer: (answers: Answers) => Promise<void>;
}) {
  useLanguage();
  if (active && pending)
    return (
      <div className="stage-question">
        <QuestionCard
          key={pending.id}
          card={pending}
          disabled={busy || archived}
          onAnswer={onAnswer}
        />
      </div>
    );
  return (
    <div className="stage-empty">
      <div className="orbit">
        {active && running ? (
          <LoaderCircle size={32} className="spin" />
        ) : (
          <Box size={32} />
        )}
      </div>
      <h2>
        {t(
          active
            ? running
              ? "当前阶段正在执行"
              : "准备好，把想法推进一步"
            : "设计将在这里逐步展开",
        )}
      </h2>
      <p>
        {t(
          active
            ? running
              ? "系统已自动启动当前阶段，请等待问题卡或审阅结果，无需重复开始。"
              : "运行当前阶段，系统将分析项目资料并准备可审阅的中间结果。"
            : "完成前面的阶段并确认后，系统会继续到这里。",
        )}
      </p>
      {active && !running && (
        <button className="primary" disabled={busy || archived} onClick={onRun}>
          <Sparkles size={15} />
          {t("开始")}
          {t(stageLabels[stage])}
        </button>
      )}
    </div>
  );
}

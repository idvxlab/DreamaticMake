import {
  stages,
  type Project,
  type StageId,
} from "../../../packages/core/src/contracts";

export function workflowState(
  project: Project & { currentStage?: StageId },
  id: StageId,
) {
  const active =
    project.currentStage ??
    stages.find((key) => project.stages[key].status !== "approved");
  const pending =
    id === active
      ? project.messages.find((m) => m.interaction && !m.interaction.answers)
          ?.interaction
      : undefined;
  const stage = project.stages[id];
  const running =
    !pending &&
    (stage.status === "running" || (id === active && project.running));
  const label = pending
    ? "等待回答"
    : running
      ? "正在执行"
      : {
          not_started: "尚未开始",
          running: "正在执行",
          approved: "已确认",
          awaiting_confirmation: "等待确认",
          failed: "执行失败",
          stale: "需要重新审阅",
        }[stage.status];
  return { pending, running, label, active: active === id };
}

/** Only confirmed upstream versions are presented as available stage inputs. */
export function workflowInputs(project: Project, id: StageId) {
  return stages
    .slice(0, stages.indexOf(id))
    .filter((key) => project.stages[key].status === "approved");
}

/** A display excerpt, never a generated replacement for the original content. */
export function workflowExcerpt(text: string, limit = 110) {
  const plain = text
    .replace(/[`#*_>\[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > limit ? plain.slice(0, limit) + "…" : plain;
}

import type { Answers, Interaction } from "./contracts";
import { HttpError } from "./store";
export function validateAnswers(
  card: Pick<Interaction, "questions">,
  answers: Answers,
) {
  if (
    Object.keys(answers).some(
      (id) => !card.questions.some((question) => question.id === id),
    )
  )
    throw new HttpError(400, "无效问题答案");
  for (const question of card.questions) {
    const value = answers[question.id];
    if (value === undefined) {
      if (question.required) throw new HttpError(400, "请回答必填问题");
      continue;
    }
    if (question.selection === "multiple") {
      if (!Array.isArray(value))
        throw new HttpError(400, "多选题答案必须是数组");
      if (
        value.some((item) => !item.trim()) ||
        new Set(value).size !== value.length
      )
        throw new HttpError(400, "多选答案不能为空或重复");
      if (question.required && !value.length)
        throw new HttpError(400, "请回答必填问题");
    } else {
      if (typeof value !== "string")
        throw new HttpError(400, "单选题答案必须是文本");
      if (question.required && !value.trim())
        throw new HttpError(400, "请回答必填问题");
    }
  }
}
export const answerText = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value.join("；") : (value ?? "");

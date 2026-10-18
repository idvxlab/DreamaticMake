import type { StageDraft, Interaction } from "./contracts";
/** Recognize legacy drafts that put several lettered answers inside each choice. */
export function choiceQuestions(
  choices: StageDraft["choices"],
): Omit<Interaction, "id" | "answers"> | undefined {
  if (!choices.length) return;
  const questions = choices.map((choice) => {
    const matches = [
      ...choice.description.matchAll(/(?:^|[\s：:；;。])([A-F])[)）.、]\s*/g),
    ];
    if (
      matches.length < 2 ||
      matches[0][1] !== "A" ||
      matches.some((match, i) => match[1] !== String.fromCharCode(65 + i))
    )
      return;
    const options = matches.map((match, i) =>
      choice.description
        .slice(
          match.index! + match[0].length,
          matches[i + 1]?.index ?? choice.description.length,
        )
        .trim()
        .replace(/[；;]\s*$/, ""),
    );
    if (options.some((option) => !option || option.length > 500)) return;
    return { id: choice.id, label: choice.label, options, required: true };
  });
  if (questions.some((question) => !question)) return;
  return {
    title: "请分别回答以下问题",
    questions: questions as Interaction["questions"],
  };
}

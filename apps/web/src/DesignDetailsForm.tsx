import { useState } from "react";
import type { DesignQuestion } from "../../../packages/core/src/project";

export function DesignDetailsForm({ questions, disabled, onConfirm }: {
  questions: DesignQuestion[];
  disabled: boolean;
  onConfirm: (answers: string[]) => void;
}) {
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [custom, setCustom] = useState<Record<number, boolean>>({});
  const answers = questions.map((_, index) => drafts[index]?.trim() ?? "");

  function setAnswer(index: number, answer: string) {
    setDrafts((previous) => ({ ...previous, [index]: answer }));
  }

  return <form className="wf-choices wf-design-details" onSubmit={(event) => {
    event.preventDefault();
    if (!disabled && answers.every(Boolean)) onConfirm(answers);
  }}>
    <h3>确认设计细节</h3>
    {questions.map((question, index) => {
      const answer = drafts[index] ?? "";
      const customSelected = custom[index] || (!!answer && !question.options?.includes(answer));
      return <fieldset key={index} disabled={disabled}>
        <legend>{question.prompt}</legend>
        {question.options && <div className="wf-detail-options">
          {question.options.map((option) => <button key={option} type="button" aria-pressed={!customSelected && answer === option} onClick={() => {
            setCustom((previous) => ({ ...previous, [index]: false }));
            setAnswer(index, option);
          }}>{option}</button>)}
          <button type="button" aria-pressed={!!customSelected} onClick={() => {
            setCustom((previous) => ({ ...previous, [index]: true }));
            if (!customSelected) setAnswer(index, "");
          }}>其他</button>
        </div>}
        {(!question.options || customSelected) && <label>
          <span>{question.options ? "填写其他方案" : "你的答案"}</span>
          <textarea value={answer} onChange={(event) => setAnswer(index, event.target.value)} rows={2} maxLength={1000} required />
        </label>}
      </fieldset>;
    })}
    <button className="wf-confirm-details" disabled={disabled || !answers.every(Boolean)}>确认并继续</button>
  </form>;
}

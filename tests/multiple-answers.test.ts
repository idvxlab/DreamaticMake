import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../packages/core/src/store";
import { Workflow } from "../packages/core/src/workflow";
import {
  answersSchema,
  type Interaction,
} from "../packages/core/src/contracts";
import { validateAnswers } from "../packages/core/src/answers";
const question: Omit<Interaction, "id" | "answers"> = {
  title: "功能选择",
  questions: [
    {
      id: "display",
      label: "显示内容",
      options: ["电量", "温度", "动画"],
      selection: "multiple",
      required: true,
    },
    {
      id: "power",
      label: "供电",
      options: ["USB", "电池"],
      selection: "single",
      required: true,
    },
  ],
};
test("混合单多选答案按数组保存，全部选择与补充原文进入后续上下文", async () => {
  const dir = await mkdtemp(join(tmpdir(), "make-multiple-"));
  try {
    const store = new Store(dir),
      workflow = new Workflow(store, []),
      project = await store.create("风扇", "功能可并存");
    await workflow.ask(project.id, question);
    const card = (await store.get(project.id)).messages.find(
      (message) => message.interaction,
    )!.interaction!;
    const answers = answersSchema.parse({
      display: ["电量", "温度", "自定义提醒"],
      power: "USB",
    });
    await workflow.answer(project.id, card.id, answers);
    const saved = await new Store(dir).get(project.id);
    assert.deepEqual(
      saved.messages.find((message) => message.interaction)?.interaction
        ?.answers,
      answers,
    );
    assert.match(saved.messages.at(-1)!.text, /电量；温度；自定义提醒/);
    assert.equal(
      saved.messages.find((message) => message.interaction)?.interaction
        ?.questions[0].selection,
      "multiple",
    );
    await assert.rejects(
      workflow.answer(project.id, card.id, answers),
      /已回答/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("必填多选、类型、空选项及重复值校验，旧单选卡兼容", () => {
  for (const display of [[], "电量", [""], ["电量", "电量"]])
    assert.throws(() => validateAnswers(question, { display, power: "USB" }));
  assert.throws(() =>
    validateAnswers(question, { display: ["温度"], power: ["USB", "电池"] }),
  );
  assert.doesNotThrow(() =>
    validateAnswers(
      {
        questions: [
          { id: "old", label: "旧问题", options: ["USB"], required: true },
        ],
      },
      { old: "自定义回答" },
    ),
  );
  assert.doesNotThrow(() =>
    validateAnswers(
      { questions: [{ ...question.questions[0], required: false }] },
      { display: [] },
    ),
  );
});

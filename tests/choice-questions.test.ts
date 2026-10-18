import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { choiceQuestions } from "../packages/core/src/choice-questions";
import { Store } from "../packages/core/src/store";
import { Workflow } from "../packages/core/src/workflow";
import { ApprovalCard } from "../apps/web/src/components/Interactions";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
const choices = [
  {
    id: "placement",
    label: "安装位置",
    description:
      "候选方案：A) 顶部外露；B) 内部通风；C) 手柄。建议硬件阶段确定。",
  },
  {
    id: "strategy",
    label: "调速策略",
    description: "两种思路：A) 温度阈值；B) 温度趋势。建议固件阶段选择。",
  },
];
test("嵌套字母选项转为两个可独立回答的问题，完整方案不误判", () => {
  const card = choiceQuestions(choices)!;
  assert.equal(card.questions.length, 2);
  assert.equal(card.questions[0].options.length, 3);
  assert.equal(card.questions[1].options.length, 2);
  assert.equal(card.questions[0].options[0], "顶部外露");
  assert.equal(
    choiceQuestions([
      { id: "usb", label: "USB方案", description: "USB供电，桌面使用。" },
    ]),
    undefined,
  );
  const html = renderToStaticMarkup(
    createElement(ApprovalCard, {
      stage: {
        id: "requirements",
        status: "awaiting_confirmation",
        revision: 1,
        artifacts: [],
        draft: {
          title: "需求",
          summary: "需求",
          facts: [],
          assumptions: [],
          blockers: [],
          choices,
          partIds: [],
        },
        review: { verdict: "pass", summary: "通过", inputHash: "x" },
      },
      disabled: false,
      onDecision: async () => {},
      onAnswerChoices: async () => {},
    }),
  );
  assert.equal((html.match(/<fieldset/g) ?? []).length, 2);
  assert.match(html, /提交回答/);
  assert.doesNotMatch(html, /choice-card /);
});
test("旧问题方案逐题保存答案并使草稿审阅失效，拒绝误选标题及重复提交", async () => {
  const dir = await mkdtemp(join(tmpdir(), "make-choice-questions-"));
  try {
    const store = new Store(dir),
      workflow = new Workflow(store, []),
      p = await store.create("测试", "风扇");
    const draft = {
      title: "需求",
      summary: "需求",
      facts: [],
      assumptions: [],
      blockers: [],
      choices,
      partIds: [],
    };
    await assert.rejects(
      workflow.submit(p.id, "requirements", 1, "analyst", draft),
      /ask_user/,
    );
    await store.update(p.id, (project) => {
      project.stages.requirements.draft = draft;
      project.stages.requirements.status = "awaiting_confirmation";
    });
    await assert.rejects(
      workflow.choose(p.id, "requirements", 1, "placement"),
      /独立问题/,
    );
    await assert.rejects(
      workflow.answerChoiceQuestions(p.id, "requirements", 1, {
        placement: "顶部外露",
      }),
      /必填/,
    );
    await workflow.answerChoiceQuestions(p.id, "requirements", 1, {
      placement: "顶部外露",
      strategy: "温度阈值",
    });
    const saved = await store.get(p.id);
    assert.equal(saved.stages.requirements.revision, 2);
    assert.equal(saved.stages.requirements.draft, undefined);
    assert.equal(
      saved.messages.at(-1)?.text,
      "安装位置: 顶部外露\n调速策略: 温度阈值",
    );
    assert.equal(saved.approvals.length, 0);
    assert.equal(
      saved.messages.find((message) => message.interaction)?.interaction
        ?.answers?.strategy,
      "温度阈值",
    );
    await assert.rejects(
      workflow.answerChoiceQuestions(p.id, "requirements", 1, {
        placement: "顶部外露",
        strategy: "温度阈值",
      }),
      /阶段/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

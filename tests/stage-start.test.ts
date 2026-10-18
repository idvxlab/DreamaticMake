import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StageStart } from "../apps/web/src/components/StageStart";
test("意图阶段运行中显示状态而非禁用开始按钮，等待问答时直接展示可操作问题", () => {
  const props = {
    stage: "intent" as const,
    active: true,
    running: true,
    busy: false,
    archived: false,
    onRun: () => {},
    onAnswer: async () => {},
  };
  const running = renderToStaticMarkup(createElement(StageStart, props));
  assert.match(running, /当前阶段正在执行/);
  assert.doesNotMatch(running, /<button/);
  const pending = renderToStaticMarkup(
    createElement(StageStart, {
      ...props,
      pending: {
        id: "question",
        title: "意图澄清",
        questions: [
          {
            id: "features",
            label: "学习模式",
            options: ["课程", "探索"],
            selection: "multiple",
            required: true,
          },
        ],
      },
    }),
  );
  assert.match(pending, /提交回答/);
  assert.doesNotMatch(pending, /disabled/);
  assert.doesNotMatch(pending, /开始意图理解/);
  const idle = renderToStaticMarkup(
    createElement(StageStart, { ...props, running: false }),
  );
  assert.match(idle, /开始.*意图理解/);
  assert.doesNotMatch(idle, /disabled/);
});

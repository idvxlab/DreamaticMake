import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { StageProgress } from "../apps/web/src/components/StageProgress";
import {
  stages,
  defaultEnclosure,
  type Project,
} from "../packages/core/src/contracts";
test("进度卡根据当前阶段显示运行、等待回答、确认与成功图标", () => {
  const project: Project = {
    id: "fixture",
    name: "测试",
    brief: "测试",
    version: 1,
    createdAt: "",
    updatedAt: "",
    archived: false,
    running: true,
    parameters: defaultEnclosure,
    selectedParts: [],
    approvals: [],
    messages: [],
    stages: Object.fromEntries(
      stages.map((id) => [
        id,
        {
          id,
          status: id === "requirements" ? "approved" : "not_started",
          revision: 1,
          artifacts: [],
        },
      ]),
    ) as unknown as Project["stages"],
  };
  const render = () =>
    renderToStaticMarkup(
      createElement(StageProgress, {
        project,
        selected: "intent",
        onSelect: () => {},
      }),
    );
  let html = render();
  assert.match(html, /lucide-check/);
  assert.match(html, /spin/);
  assert.match(html, /意图理解 · 正在执行/);
  assert.match(html, /aria-current="step"/);
  project.running = false;
  project.stages.intent.status = "awaiting_confirmation";
  html = render();
  assert.match(html, /lucide-clock/);
  assert.match(html, /意图理解 · 等待确认/);
  project.messages.push({
    id: "q",
    role: "assistant",
    text: "",
    createdAt: "",
    interaction: { id: "q", title: "问答", questions: [] },
  });
  html = render();
  assert.match(html, /lucide-message-square/);
  assert.match(html, /意图理解 · 等待回答/);
  project.messages = [];
  project.stages.intent.status = "failed";
  html = render();
  assert.match(html, /lucide-circle-alert/);
  assert.match(html, /意图理解 · 执行失败/);
});

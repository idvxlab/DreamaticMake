import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ApprovalCard } from "../apps/web/src/components/Interactions";
import type { Stage } from "../packages/core/src/contracts";

test("120 秒计时只用于审阅完善，不代替确认、选方案、回答问题或几何核验", () => {
  const stage: Stage = {
    id: "requirements",
    status: "awaiting_confirmation",
    revision: 1,
    artifacts: [],
    draft: {
      title: "草稿",
      summary: "待完善",
      facts: [],
      assumptions: [],
      blockers: ["完善说明"],
      choices: [],
      partIds: [],
    },
    review: {
      verdict: "changes_requested",
      summary: "完善说明",
      inputHash: "fixture",
    },
  };
  const render = (patch = {}, extra = {}) =>
    renderToStaticMarkup(
      createElement(ApprovalCard, {
        stage: { ...stage, ...patch },
        disabled: false,
        onDecision: async () => {},
        ...extra,
      }),
    );
  assert.match(render(), /120 秒后自动按审阅意见完善/);
  assert.doesNotMatch(render({}, { disabled: true }), /role="timer"/);
  assert.doesNotMatch(render({}, { automaticRepairUsed: true }), /role="timer"/);
  assert.doesNotMatch(render({}, { pendingQuestion: true }), /role="timer"/);
  assert.doesNotMatch(
    render({}, { unverifiedParts: ["Pico"] }),
    /role="timer"/,
  );
  assert.doesNotMatch(render({ status: "running" }), /role="timer"/);
  assert.doesNotMatch(
    render({ review: { ...stage.review, verdict: "pass" } }),
    /role="timer"/,
  );
  assert.doesNotMatch(
    render({
      draft: {
        ...stage.draft,
        choices: [{ id: "usb", label: "USB", description: "方案" }],
      },
    }),
    /role="timer"/,
  );
});

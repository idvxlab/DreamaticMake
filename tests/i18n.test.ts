import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { t, setLanguage, getLanguage } from "../apps/web/src/i18n";
import {
  ApprovalCard,
  ParameterEditor,
} from "../apps/web/src/components/Interactions";
import { stageLabels, defaultEnclosure } from "../packages/core/src/contracts";
import { fields, modules } from "../packages/core/src/settings";
import { agentLanguageInstruction } from "../packages/agent-runtime/src/runtime";

test("中英文切换覆盖阶段、设置元数据、交互卡并保留用户原文", () => {
  try {
    setLanguage("en");
    assert.equal(getLanguage(), "en");
    assert.equal(t("工作台"), "Workbench");
    assert.equal(t("开孔 {0} 位置", { 0: 2 }), "Opening 2 face");
    for (const label of Object.values(stageLabels))
      assert.doesNotMatch(t(label), /[\u3400-\u9fff]/, label);
    for (const label of [
      ...modules.flatMap((m) => [m.title, m.description]),
      ...fields.flatMap((f) => [f.label, f.description]),
    ])
      assert.doesNotMatch(t(label), /[\u3400-\u9fff]/, label);
    const parameters = renderToStaticMarkup(
      createElement(ParameterEditor, {
        value: defaultEnclosure,
        onChange: () => {},
      }),
    );
    assert.match(parameters, /Wall thickness/);
    assert.doesNotMatch(parameters, /壁厚/);
    const card = renderToStaticMarkup(
      createElement(ApprovalCard, {
        stage: {
          id: "hardware",
          status: "awaiting_confirmation",
          revision: 1,
          artifacts: [],
          review: {
            verdict: "pass",
            summary: "用户原文保留",
            inputHash: "fixture",
          },
        },
        disabled: false,
        onDecision: async () => {},
      }),
    );
    assert.match(card, /Confirm and continue/);
    assert.match(card, /用户原文保留/);
    assert.match(
      agentLanguageInstruction({ MAKE_LANGUAGE: "en" }),
      /Reply in English/,
    );
    setLanguage("zh");
    assert.equal(t("工作台"), "工作台");
    assert.equal(t("开孔 {0} 位置", { 0: 2 }), "开孔 2 位置");
  } finally {
    setLanguage("zh");
  }
});

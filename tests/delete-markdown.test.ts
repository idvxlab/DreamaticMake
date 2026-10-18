import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../packages/core/src/store";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { MarkdownMessage } from "../apps/web/src/components/MarkdownMessage";
test("彻底删除需要正确名称且停止运行，只删除指定项目", async () => {
  const root = await mkdtemp(join(tmpdir(), "make-delete-"));
  try {
    const store = new Store(root),
      a = await store.create("A", "删除 A"),
      b = await store.create("B", "保留 B");
    await assert.rejects(() => store.delete(a.id, "wrong"), /名称/);
    await store.update(a.id, (p) => {
      p.running = true;
    });
    await assert.rejects(() => store.delete(a.id, "A"), /停止/);
    await store.update(a.id, (p) => {
      p.running = false;
    });
    await store.artifact(
      a.id,
      "requirements",
      1,
      "x.txt",
      "data",
      "text/plain",
    );
    await store.delete(a.id, "A");
    await assert.rejects(() => access(store.dir(a.id)));
    assert.equal((await store.list())[0].id, b.id);
    assert.equal((await store.list()).length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("Markdown 渲染强调、列表、表格、代码；不执行 HTML 或危险链接", () => {
  const html = renderToStaticMarkup(
    createElement(MarkdownMessage, {
      text: "# 标题\n\n**加粗**\n\n- 列表\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n```js\nconst x = 1\n```\n\n<script>alert(1)</script>\n\n[危险](javascript:alert(1))",
    }),
  );
  assert.match(html, /<strong>加粗<\/strong>/);
  assert.match(html, /<table>/);
  assert.match(html, /<pre>/);
  assert.match(html, /<li>列表/);
  assert(!html.includes("<script>"));
  assert(!html.includes('href="javascript:'));
});

test("信息卡 Markdown 支持表格、列表与代码，方案按钮不嵌套链接", async () => {
  const { ApprovalCard, QuestionCard, ChoiceCards } = await import(
    "../apps/web/src/components/Interactions"
  );
  const summary =
    "## 审阅\n\n**重点**\n\n- 检查供电\n\n| 项目 | 结果 |\n|---|---|\n| 电压 | 5V |\n\n```cpp\nint pin = 1;\n```\n\n<script>alert(1)</script>";
  const review = renderToStaticMarkup(
    createElement(ApprovalCard, {
      stage: {
        id: "requirements",
        status: "awaiting_confirmation",
        revision: 1,
        artifacts: [],
        review: { verdict: "pass", summary, inputHash: "fixture" },
      },
      disabled: false,
      onDecision: async () => {},
    }),
  );
  assert.match(review, /<h2>审阅<\/h2>/);
  assert.match(review, /<strong>重点<\/strong>/);
  assert.match(review, /<table>/);
  assert.match(review, /<li>检查供电/);
  assert.match(review, /<pre>/);
  assert.doesNotMatch(review, /<script>/);
  assert.doesNotMatch(review, /<p><div/);
  const question = renderToStaticMarkup(
    createElement(QuestionCard, {
      card: {
        id: "q",
        title: "**需求澄清**",
        questions: [
          {
            id: "power",
            label: "选择 **供电**",
            options: ["**USB**"],
            required: true,
          },
        ],
      },
      onAnswer: async () => {},
    }),
  );
  assert.match(question, /<strong>需求澄清<\/strong>/);
  assert.match(question, /<strong>供电<\/strong>/);
  assert.match(question, /<strong>USB<\/strong>/);
  const choices = renderToStaticMarkup(
    createElement(ChoiceCards, {
      choices: [
        {
          id: "usb",
          label: "**方案**",
          description: "**优点**\n\n- 可打印\n\n[来源](https://example.com)",
        },
      ],
      onSelect: () => {},
      disabled: false,
    }),
  );
  assert.match(choices, /<strong>优点<\/strong>/);
  assert.match(choices, /<li>可打印/);
  assert.doesNotMatch(choices, /<a /);
});

test("阶段审阅内展示方案，未选择时禁止确认，已选择且审阅通过时可确认", async () => {
  const { ApprovalCard } = await import(
    "../apps/web/src/components/Interactions"
  );
  const draft = {
    title: "需求方案",
    summary: "测试",
    facts: [],
    assumptions: [],
    blockers: [],
    choices: [
      { id: "a", label: "方案 A", description: "USB 供电" },
      { id: "b", label: "方案 B", description: "电池供电" },
    ],
    partIds: [],
  };
  const stage = {
    id: "requirements" as const,
    status: "awaiting_confirmation" as const,
    revision: 1,
    artifacts: [],
    draft,
    review: { verdict: "pass" as const, summary: "通过", inputHash: "fixture" },
  };
  const render = (selectedChoice?: string) =>
    renderToStaticMarkup(
      createElement(ApprovalCard, {
        stage: { ...stage, draft: { ...draft, selectedChoice } },
        disabled: false,
        onDecision: async () => {},
        onSelectChoice: () => {},
      }),
    );
  const missing = render();
  assert.match(missing, /方案 A/);
  assert.match(missing, /方案 B/);
  assert.match(missing, /选择本阶段方案/);
  assert.match(missing, /class="primary" disabled=""/);
  const selected = render("a");
  assert.match(selected, /choice-card selected/);
  assert.doesNotMatch(selected, /class="primary" disabled=""/);
});

test("审阅未通过提供可操作的自动完善按钮，报告支持统一 Markdown 展示", async () => {
  const { ApprovalCard } = await import(
    "../apps/web/src/components/Interactions"
  );
  const html = renderToStaticMarkup(
    createElement(ApprovalCard, {
      stage: {
        id: "requirements",
        status: "awaiting_confirmation",
        revision: 1,
        artifacts: [],
        draft: {
          title: "草稿",
          summary: "待完善",
          facts: [],
          assumptions: [],
          blockers: ["需要核验"],
          choices: [],
          partIds: [],
        },
        review: {
          verdict: "changes_requested",
          summary: "### 核验\n\n- **检查供电**",
          inputHash: "fixture",
        },
      },
      disabled: false,
      onDecision: async () => {},
    }),
  );
  assert.match(html, /class="review-report changes_requested"/);
  assert.match(html, /<h3>核验<\/h3>/);
  assert.match(html, /<strong>检查供电<\/strong>/);
  assert.match(html, /按审阅意见自动完善/);
  assert.doesNotMatch(html, /class="primary" disabled/);
  assert.doesNotMatch(html, /<textarea/);
  assert.match(html, /补充意见（可选）/);
});

test("硬件真实几何缺口提供核验入口而不是反复自动完善", async () => {
  const { ApprovalCard } = await import(
    "../apps/web/src/components/Interactions"
  );
  const html = renderToStaticMarkup(
    createElement(ApprovalCard, {
      stage: {
        id: "hardware",
        status: "awaiting_confirmation",
        revision: 4,
        artifacts: [],
        draft: {
          title: "选型",
          summary: "待核验",
          facts: [],
          assumptions: [],
          blockers: ["Pico 的完整安装几何尚未核验"],
          choices: [],
          partIds: ["pico"],
        },
        review: {
          verdict: "changes_requested",
          summary: "需要几何核验",
          inputHash: "fixture",
        },
      },
      disabled: false,
      onDecision: async () => {},
      unverifiedParts: ["Pico"],
      onInspectHardware: () => {},
    }),
  );
  assert.match(html, /查看待核验器件/);
  assert.doesNotMatch(html, /按审阅意见自动完善/);
  assert.doesNotMatch(html, /class="primary" disabled/);
});

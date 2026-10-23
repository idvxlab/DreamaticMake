import { chromium } from "playwright-core";
import { Settings } from "../packages/core/src/settings";
import { createApp } from "../apps/server/src/index";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import assert from "node:assert/strict";
import {
  requirementDraft,
  functionDraft,
  hardwareDraft,
  productParts,
  routing,
} from "../tests/fixtures/product-flow";

// Only isolated fixtures; all browser writes are intercepted, so no model runs.
const workspace = await mkdtemp(join(tmpdir(), "make-port-ui-"));
const config = join(workspace, "config");
await mkdir(config);
const settings = new Settings(config);
await settings.save({
  MAKE_API_KEY: "",
  MAKE_IMAGE_API_KEY: "",
  MAKE_LANGUAGE: "zh",
  MAKE_LOCAL_LIBRARY: "",
});
const app = await createApp(join(workspace, "projects"), settings),
  p = await app.store.create("节点界面测试", "办公鼠标，右手使用");
await app.store.saveCatalog(p.id, productParts);
await app.store.update(p.id, (project) => {
  project.stages.requirements.status = "approved";
  project.stages.requirements.draft = structuredClone(requirementDraft);
  project.stages.intent.status = "approved";
  project.stages.intent.draft = structuredClone(functionDraft);
  project.stages.hardware.status = "running";
  project.stages.hardware.draft = structuredClone(hardwareDraft);
  project.selectedParts = hardwareDraft.partIds;
});
await app.workflow.routeFunctions(p.id, "hardware", 1, routing);
await app.workflow.review(p.id, "hardware", 1, "pass", "fixture review");
app.server.listen(0, "127.0.0.1");
await once(app.server, "listening");
const base = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
const browser = await chromium.launch({
  headless: true,
  executablePath:
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
});
const errors: string[] = [],
  mutations: string[] = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1720, height: 1100 },
  });
  page.setDefaultTimeout(10000);
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/api/**", (route) => {
    if (route.request().method() !== "GET") {
      mutations.push(route.request().method());
      return route.abort();
    }
    return route.continue();
  });
  const open = async () => {
    await page.goto(base);
    await page.locator(".project-row").first().click();
    await page
      .locator('.react-flow__node[data-id="requirements"] .react-flow__handle')
      .first()
      .waitFor();
  };
  await open();
  await page
    .getByRole("heading", { name: "用户原始需求", exact: true })
    .waitFor();
  assert.equal(await page.locator(".react-flow__node").count(), 11);
  assert.equal(await page.locator(".chat-panel").count(), 0);
  await mkdir("test-results", { recursive: true });
  await page.screenshot({
    path: "test-results/product-flow-start.png",
    fullPage: true,
  });
  await page
    .locator(".product-flow-stages")
    .getByRole("button", { name: "功能拆解", exact: true })
    .click();
  await page
    .locator('.react-flow__node[data-id="intent"] .product-flow-outputs')
    .getByRole("button", { name: "指针移动", exact: true })
    .click();
  assert.equal(
    await page.locator(".product-preview .product-function-card").count(),
    1,
  );
  await page
    .locator(".product-preview")
    .getByText("X/Y 位移增量", { exact: false })
    .waitFor();
  await page.getByRole("button", { name: "查看全部节点", exact: true }).click();
  await page
    .locator(
      '.react-flow__node[data-id="coordinator"] .product-flow-node-header',
    )
    .click();
  assert.equal(
    await page.locator(".product-preview .product-relation").count(),
    4,
  );
  await page.screenshot({
    path: "test-results/product-flow-connections.png",
    fullPage: true,
  });
  await page
    .locator(
      '.react-flow__node[data-id="part:controller"] .product-flow-node-header',
    )
    .click();
  assert.equal(
    await page
      .locator(".product-evidence")
      .getByRole("link", { name: "打开商品 / 官方来源" })
      .getAttribute("href"),
    "https://example.com/controller",
  );
  await page
    .locator(".product-preview-tabs")
    .getByRole("button", { name: "模型", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "还没有 CAD 模型", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "后续草案", exact: true }).click();
  await page
    .locator(
      '.react-flow__node[data-id="proposal:appearance"] .product-flow-node-header',
    )
    .click();
  await page.getByText("后续分工草案 · 待确认", { exact: true }).waitFor();
  await page.getByRole("button", { name: "从头开始", exact: true }).click();
  await page.waitForFunction(() => {
    const viewport = document.querySelector(".react-flow__viewport");
    if (!viewport) return false;
    const matrix = new DOMMatrixReadOnly(getComputedStyle(viewport).transform);
    return (
      Math.abs(matrix.e - 40) < 1 &&
      Math.abs(matrix.f - 70) < 1 &&
      Math.abs(matrix.a - 0.85) < 0.01
    );
  });
  const header = page.locator(
      '.react-flow__node[data-id="raw"] .product-flow-node-header',
    ),
    box = await header.boundingBox();
  assert(box);
  await page.mouse.move(box.x + 60, box.y + 25);
  await page.mouse.down();
  await page.mouse.move(box.x + 130, box.y + 65, { steps: 6 });
  await page.mouse.up();
  const position = await page.evaluate(
    (id) =>
      JSON.parse(localStorage.getItem(`make-port-flow-v1:${id}`)!).positions
        .raw,
    p.id,
  );
  assert(position.x > 0);
  await open();
  assert.deepEqual(
    await page.evaluate(
      (id) =>
        JSON.parse(localStorage.getItem(`make-port-flow-v1:${id}`)!).positions
          .raw,
      p.id,
    ),
    position,
  );
  await page.getByRole("button", { name: "定位当前任务", exact: true }).click();
  assert.equal(await page.locator(".approval-card").count(), 1);
  await page.getByRole("button", { name: "展开对话", exact: true }).click();
  assert.equal(await page.locator(".approval-card").count(), 1);
  await page.getByRole("button", { name: "收起对话", exact: true }).click();
  for (const width of [760, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(
      await page
        .locator(".workspace-body")
        .evaluate((el) => el.scrollWidth > el.clientWidth),
      false,
      `overflow at ${width}`,
    );
  }
  await app.store.update(p.id, (project) => {
    delete project.stages.intent.draft!.functionModules;
  });
  await open();
  await page
    .locator(".product-flow-stages")
    .getByRole("button", { name: "功能拆解", exact: true })
    .click();
  await page
    .getByText("旧版结果还没有结构化功能模块", { exact: true })
    .waitFor();
  assert.equal(await page.locator(".product-function-card").count(), 0);
  await app.store.update(p.id, (project) => {
    project.stages.intent.status = "not_started";
    delete project.stages.intent.draft;
    delete project.stages.intent.review;
    project.messages.push({
      id: "ui-question",
      role: "assistant",
      text: "",
      createdAt: new Date().toISOString(),
      interaction: {
        id: "ui-question",
        title: "连接偏好",
        questions: [
          {
            id: "connection",
            label: "如何连接电脑？",
            options: ["蓝牙", "接收器"],
            selection: "single",
            required: true,
          },
        ],
      },
    });
  });
  await open();
  await page.getByRole("button", { name: "定位当前任务", exact: true }).click();
  assert.equal(
    await page.locator(".product-actions .interaction-card").count(),
    1,
  );
  await page.getByRole("button", { name: "展开对话", exact: true }).click();
  assert.equal(await page.locator(".interaction-card").count(), 1);
  assert.deepEqual(mutations, []);
  assert.deepEqual(errors, []);
  console.log(
    "Port canvas UI passed: data ports, multi-to-multi edges, previews, drag persistence, blueprint scope, one approval/question, mobile layout, no writes.",
  );
} finally {
  await browser.close();
  app.server.closeAllConnections();
  await new Promise<void>((r) => app.server.close(() => r()));
  await rm(workspace, { recursive: true, force: true });
}

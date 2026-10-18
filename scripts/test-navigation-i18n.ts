import { chromium } from "playwright-core";
import { Settings } from "../packages/core/src/settings";
import { createApp } from "../apps/server/src/index";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import assert from "node:assert/strict";

const workspace = await mkdtemp(join(tmpdir(), "make-language-ui-"));
const configRoot = join(workspace, ".test-config");
await mkdir(configRoot, { recursive: true });
const settings = new Settings(configRoot);
await settings.save({
  MAKE_API_KEY: "",
  MAKE_IMAGE_API_KEY: "",
  MAKE_LANGUAGE: "zh",
});
const app = await createApp(workspace, settings);
app.server.listen(0, "127.0.0.1");
await once(app.server, "listening");
const url = `http://127.0.0.1:${(app.server.address() as any).port}`;
const browser = await chromium.launch({
  executablePath:
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const context = await browser.newContext({
  viewport: { width: 1512, height: 982 },
});
const page = await context.newPage();
page.setDefaultTimeout(10000);
const errors: string[] = [];
page.on("pageerror", (error) => errors.push(error.message));
let abortRequests = 0;
page.on("request", (request) => {
  if (request.url().endsWith("/abort")) abortRequests++;
});
await mkdir("test-results", { recursive: true });
try {
  await page.goto(url);
  await page.getByRole("heading", { name: /让想法/ }).waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "工作台", exact: true })
      .getAttribute("aria-current"),
    "page",
  );
  const chatPanel = page.locator(".chat-panel");
  const originalChat = await chatPanel.boundingBox();
  const divider = page.getByRole("separator", { name: "调整聊天助手宽度" });
  const edge = await divider.boundingBox();
  assert(originalChat && edge);
  await page.mouse.move(edge.x + edge.width / 2, edge.y + 100);
  await page.mouse.down();
  await page.mouse.move(edge.x + edge.width / 2 - 100, edge.y + 100, {
    steps: 10,
  });
  await page.mouse.up();
  const resizedChat = await chatPanel.boundingBox();
  assert(
    resizedChat && Math.abs(resizedChat.width - originalChat.width - 100) < 3,
  );
  await page.reload();
  await page.getByRole("heading", { name: /让想法/ }).waitFor();
  assert(
    Math.abs((await chatPanel.boundingBox())!.width - resizedChat.width) < 3,
  );
  await divider.focus();
  await page.keyboard.press("ArrowRight");
  assert(
    Math.abs((await chatPanel.boundingBox())!.width - resizedChat.width + 20) <
      3,
  );
  await page.getByRole("button", { name: "DreamaticMake 菜单" }).click();
  const menu = page.getByRole("menu", { name: "DreamaticMake 菜单" });
  await menu.getByText("Dreamatic·Make", { exact: true }).waitFor();
  await menu.getByText("v0.1.0", { exact: true }).waitFor();
  assert.equal(await menu.getByRole("menuitem").count(), 2);
  await page.screenshot({
    path: "test-results/brand-menu.png",
    fullPage: true,
  });
  await page.keyboard.press("End");
  assert.equal(
    await menu
      .getByRole("menuitem", { name: "系统设置", exact: true })
      .evaluate((element) => document.activeElement === element),
    true,
  );
  await page.keyboard.press("Escape");
  assert.equal(
    await page
      .getByRole("button", { name: "DreamaticMake 菜单" })
      .evaluate((element) => document.activeElement === element),
    true,
  );
  const search = await page.getByLabel("搜索项目").boundingBox();
  const workbench = await page
    .getByRole("button", { name: "工作台", exact: true })
    .boundingBox();
  assert(search && workbench && workbench.y > search.y + search.height);
  await page.getByRole("button", { name: /新建项目/ }).click();
  await page.getByLabel("项目名称", { exact: true }).fill("保留原文项目");
  await page
    .getByLabel("你想做什么？", { exact: true })
    .fill("保留这段原始需求。");
  await page.getByRole("button", { name: "创建项目", exact: true }).click();
  await page.getByRole("button", { name: "CAD 工作台", exact: true }).waitFor();
  const project = (await app.store.list())[0];
  const version = project.version;
  // Returning home must not cancel an active project or mutate project data.
  await app.store.update(project.id, (p) => {
    p.running = true;
  });
  await page.getByRole("button", { name: "DreamaticMake 菜单" }).click();
  await page.getByRole("menuitem", { name: "工作台", exact: true }).click();
  await page.getByRole("heading", { name: /让想法/ }).waitFor();
  assert.equal((await app.store.get(project.id)).running, true);
  assert.equal(abortRequests, 0);
  assert.equal((await app.store.get(project.id)).version, version + 1);
  await app.store.update(project.id, (p) => {
    p.running = false;
  });
  await page
    .locator(".project-row")
    .filter({ hasText: "保留原文项目" })
    .click();
  await page.getByRole("button", { name: "CAD 工作台", exact: true }).waitFor();
  await app.workflow.ask(project.id, {
    title: "需求测试问题",
    questions: [
      {
        id: "display",
        label: "显示哪些内容",
        options: ["电量", "温度", "动画"],
        selection: "multiple",
        required: true,
      },
      {
        id: "power",
        label: "测试供电方式",
        options: ["USB", "电池"],
        required: true,
      },
    ],
  });
  await app.store.update(project.id, (p) => {
    p.running = true;
  });
  await page.getByLabel("测试供电方式", { exact: true }).waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "提交回答", exact: true })
      .isEnabled(),
    true,
  );
  await page.getByRole("button", { name: "电量", exact: true }).click();
  await page.getByRole("button", { name: "温度", exact: true }).click();
  assert.equal(
    await page
      .getByRole("button", { name: "电量", exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
  await page.getByRole("button", { name: "温度", exact: true }).click();
  assert.equal(
    await page
      .getByRole("button", { name: "温度", exact: true })
      .getAttribute("aria-pressed"),
    "false",
  );
  await page.getByRole("button", { name: "动画", exact: true }).click();
  await page.getByLabel("显示哪些内容", { exact: true }).fill("自定义提醒");
  await page.getByRole("button", { name: "USB", exact: true }).click();
  assert.equal(
    await page.getByLabel("测试供电方式", { exact: true }).inputValue(),
    "USB",
  );
  await page.screenshot({
    path: "test-results/question-ready.png",
    fullPage: true,
  });
  // Simulate the worker finishing; the streaming race itself is covered by questions.test.ts.
  await app.store.update(project.id, (p) => {
    p.running = false;
  });
  await page.getByRole("button", { name: "提交回答", exact: true }).click();
  await page.getByRole("button", { name: "已回答", exact: true }).waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "已回答", exact: true })
      .isDisabled(),
    true,
  );
  assert.deepEqual(
    (await app.store.get(project.id)).messages.find(
      (message) => message.interaction,
    )?.interaction?.answers,
    { power: "USB", display: ["电量", "动画", "自定义提醒"] },
  );
  // This fixture has no model key: the answer is saved, then the next run reports configuration is needed.
  await page.getByRole("alert").filter({ hasText: "Settings" }).waitFor();
  await page.getByRole("button", { name: "关闭提示", exact: true }).click();
  await app.workflow.submit(project.id, "requirements", 1, "analyst", {
    title: "准备时机回归",
    summary:
      "## 设计目标\n\n以 **清晰易用** 的交互为核心，结合开源硬件与可打印外壳，逐步验证从需求到原型的完整流程。\n\n### 功能与约束\n\n- 温度与电量可同时显示，保留手动操作入口。\n- 所有关键尺寸需要核验，假设与执行结果分别记录。\n\n> 在确认当前阶段前，先核对设计依据与待验证事项。\n\n| 项目 | 设计依据 |\n| --- | --- |\n| 供电 | USB 低压供电 |\n| 外壳 | 参数化分体结构 |",
    facts: [],
    blockers: [],
    choices: [],
    partIds: [],
  });
  await app.store.update(project.id, (p) => {
    p.running = true;
  });
  await app.workflow.review(project.id, "requirements", 1, "pass", "可以确认");
  await page.getByText("可以确认", { exact: true }).waitFor();
  assert.equal(
    await page.locator(".approval-card").count(),
    0,
    "任务收尾期间不展示禁用的审阅卡",
  );
  await app.store.update(project.id, (p) => {
    p.running = false;
  });
  await page.locator(".approval-card").waitFor();
  await app.workflow.review(
    project.id,
    "requirements",
    1,
    "changes_requested",
    "### 待完善\n\n- **检查供电需求**\n- 明确验收条件",
  );
  const improve = page.getByRole("button", {
    name: "按审阅意见自动完善",
    exact: true,
  });
  await improve.waitFor();
  assert.equal(await improve.isEnabled(), true);
  assert.equal(await page.locator(".approval-card textarea").count(), 0);
  await page.screenshot({
    path: "test-results/review-improvements.png",
    fullPage: true,
  });
  await app.workflow.review(project.id, "requirements", 1, "pass", "可以确认");
  await page.getByRole("button", { name: "确认并继续", exact: true }).waitFor();
  await page.screenshot({
    path: "test-results/design-notes.png",
    fullPage: true,
  });
  assert.equal(
    await page
      .getByRole("button", { name: "确认并继续", exact: true })
      .isEnabled(),
    true,
  );
  assert.equal(
    await page
      .getByRole("button", { name: "补充意见（可选）", exact: true })
      .isEnabled(),
    true,
  );
  await page.getByRole("button", { name: "工作台", exact: true }).click();
  await page.getByRole("button", { name: "DreamaticMake 菜单" }).click();
  await page
    .getByRole("menuitem", { name: /系统设置|System settings/ })
    .click();
  await page.getByRole("tab", { name: "系统设置", exact: true }).click();
  await page.getByLabel("界面语言", { exact: true }).selectOption("en");
  await page.getByRole("button", { name: "保存配置", exact: true }).click();
  await page
    .getByRole("tab", { name: "System settings", exact: true })
    .waitFor();
  assert.equal(
    await page.getByLabel("Language", { exact: true }).inputValue(),
    "en",
  );
  assert.equal(await page.locator("html").getAttribute("lang"), "en");
  await page.screenshot({
    path: "test-results/settings-english.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Close settings", exact: true })
    .click();
  await page.getByRole("heading", { name: /Turn ideas/ }).waitFor();
  const visibleEnglish = (await page.locator("body").innerText()).replaceAll(
    "保留原文项目",
    "",
  );
  assert.doesNotMatch(visibleEnglish, /[\u3400-\u9fff]/);
  await page.screenshot({
    path: "test-results/workbench-english.png",
    fullPage: true,
  });
  await page
    .locator(".project-row")
    .filter({ hasText: "保留原文项目" })
    .click();
  await page
    .getByRole("button", { name: "Stage overview", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "CAD workbench", exact: true })
    .click();
  await page.getByLabel("Wall thickness", { exact: true }).waitFor();
  await page.getByLabel("CAD design description", { exact: true }).waitFor();
  assert.equal((await app.store.get(project.id)).brief, "保留这段原始需求。");
  await page.getByRole("button", { name: "Workbench", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: "Workbench", exact: true }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "Hide conversation", exact: true })
    .click();
  await page.getByRole("button", { name: "Workbench", exact: true }).click();
  await page.screenshot({
    path: "test-results/workbench-mobile-english.png",
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.getByRole("button", { name: "DreamaticMake menu" }).click();
  await page
    .getByRole("menuitem", { name: /系统设置|System settings/ })
    .click();
  await page.getByRole("tab", { name: "System settings", exact: true }).click();
  await page.screenshot({
    path: "test-results/settings-mobile-english.png",
    fullPage: true,
  });
  assert.equal(
    await page
      .locator("dialog")
      .evaluate((element) => element.scrollWidth > element.clientWidth),
    false,
  );
  await page.getByLabel("Language", { exact: true }).selectOption("zh");
  await page
    .getByRole("button", { name: "Save settings", exact: true })
    .click();
  await page.getByRole("tab", { name: "系统设置", exact: true }).waitFor();
  await page.getByRole("button", { name: "关闭设置", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  if (await page.getByRole("button", { name: "收起对话", exact: true }).count())
    await page.getByRole("button", { name: "收起对话", exact: true }).click();
  await page.getByRole("button", { name: "工作台", exact: true }).click();
  await page.getByRole("heading", { name: /让想法/ }).waitFor();
  await page.screenshot({
    path: "test-results/workbench-mobile.png",
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  assert.equal((await settings.snapshot()).MAKE_LANGUAGE, "zh");
  assert.deepEqual(errors, []);
  console.log(
    "UI PASS: 工作台导航、中英文即时切换与刷新持久化、原文保留、移动端入口、返回工作台不取消任务",
  );
} finally {
  await browser.close();
  app.server.closeAllConnections();
  await new Promise<void>((done) => app.server.close(() => done()));
  await rm(workspace, { recursive: true, force: true });
}

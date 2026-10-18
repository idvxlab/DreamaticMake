import { chromium } from "playwright-core";
import { Settings } from "../packages/core/src/settings";
import { createApp } from "../apps/server/src/index";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import assert from "node:assert/strict";
const workspace = await mkdtemp(join(tmpdir(), "make-ui-"));
const configRoot = join(workspace, ".test-config");
await mkdir(configRoot, { recursive: true });
const settings = new Settings(configRoot);
await settings.save({ MAKE_API_KEY: "", MAKE_IMAGE_API_KEY: "" });
const app = await createApp(workspace, settings);
app.server.listen(0, "127.0.0.1");
await once(app.server, "listening");
const url = `http://127.0.0.1:${(app.server.address() as any).port}`;
const browser = await chromium.launch({
  executablePath:
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const page = await browser.newPage({
  viewport: { width: 1512, height: 982 },
  deviceScaleFactor: 1,
});
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
await mkdir("test-results", { recursive: true });
try {
  await page.goto(url);
  await page.getByRole("heading", { name: /让想法/ }).waitFor();
  await page.screenshot({ path: "test-results/welcome.png", fullPage: true });
  await page
    .getByRole("button", { name: /新建项目/ })
    .first()
    .click();
  await page.getByLabel("项目名称").fill("桌面环境终端");
  await page.getByLabel("你想做什么？").fill("USB 供电、可打印外壳的桌面原型");
  await page.getByRole("button", { name: "创建项目" }).click();
  await page
    .getByRole("button", { name: "桌面环境终端", exact: false })
    .first()
    .waitFor();
  const p = (await app.store.list())[0];
  await app.workflow.submit(p.id, "requirements", 1, "analyst", {
    title: "用一块开源主控开始",
    summary: "USB 供电，桌面使用。先验证主控、外壳与交互的最小闭环。",
    facts: [
      { label: "创作方案", value: "开源硬件 + 3D 打印" },
      { label: "验收目标", value: "可重建 CAD 与可编译固件" },
    ],
    assumptions: ["首版采用桌面低压供电"],
    blockers: [],
    choices: [
      {
        id: "usb",
        label: "USB 桌面方案",
        description: "供电简单，优先验证功能。",
      },
    ],
    selectedChoice: "usb",
    partIds: [],
  });
  await app.workflow.review(
    p.id,
    "requirements",
    1,
    "pass",
    "需求与验收目标一致，可以提交用户确认。",
  );
  await app.store.emit(p.id, "tool.completed", {
    name: "context_read",
    object: "桌面环境终端 / project.json：需求与已确认上游",
    operationId: "ui-activity",
  });
  await page.getByText("USB 桌面方案", { exact: true }).waitFor();
  await page.getByText("预览已就绪，等待你确认").waitFor();
  await page.locator(".activity-log summary").click();
  await page
    .getByText("context_read：桌面环境终端 / project.json：需求与已确认上游", {
      exact: true,
    })
    .waitFor();
  await page.screenshot({ path: "test-results/workspace.png", fullPage: true });
  await page.getByRole("button", { name: "CAD 工作台", exact: true }).click();
  await page.getByRole("textbox", { name: "CAD 设计描述" }).fill("90×65×35");
  await page.getByRole("button", { name: "从描述提取参数" }).click();
  await page.getByRole("heading", { name: "候选参数 · 等待你确认" }).waitFor();
  await page.getByRole("button", { name: "采用为待编辑参数" }).click();
  await page.getByRole("button", { name: "生成 CAD", exact: true }).click();
  await page
    .getByText("assembly.step", { exact: true })
    .waitFor({ timeout: 120000 });
  await page.locator(".workspace-body").evaluate((e) => e.scrollTo({ top: 0 }));
  await page.evaluate(
    () =>
      new Promise<void>((done) =>
        requestAnimationFrame(() => requestAnimationFrame(() => done())),
      ),
  );
  await page.screenshot({ path: "test-results/cad.png", fullPage: true });
  assert(
    (await app.store.get(p.id)).stages.cad.artifacts.some(
      (a) => a.name === "assembly.step",
    ),
  );
  await page
    .getByRole("button", { name: "DreamaticMake 菜单", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: /系统设置|System settings/ })
    .click();
  await page
    .getByText("API 地址（Chat Completions）", { exact: true })
    .waitFor();
  await page.screenshot({ path: "test-results/settings.png", fullPage: true });
  await page
    .getByRole("textbox", { name: "推理模型", exact: true })
    .fill("reasoning-ui-draft");
  await page.getByRole("tab", { name: "图像模型", exact: true }).click();
  await page
    .getByLabel("图像 API 地址", { exact: true })
    .fill("https://vision.example/v1");
  await page
    .getByRole("textbox", { name: "图像模型", exact: true })
    .fill("vision-ui-draft");
  await page.getByRole("tab", { name: "CAD 设置", exact: true }).click();
  await page.getByLabel("CAD Python 路径", { exact: true }).waitFor();
  await page.getByRole("tab", { name: "系统设置", exact: true }).click();
  await page.getByLabel("界面语言", { exact: true }).waitFor();
  await page.getByLabel("项目工作目录", { exact: true }).waitFor();
  assert.equal(
    await page.getByLabel("项目工作目录", { exact: true }).inputValue(),
    "workspace",
  );
  await page.getByRole("tab", { name: "推理模型", exact: true }).click();
  assert.equal(
    await page
      .getByRole("textbox", { name: "推理模型", exact: true })
      .inputValue(),
    "reasoning-ui-draft",
  );
  await page.getByRole("tab", { name: "图像模型", exact: true }).click();
  assert.equal(
    await page
      .getByRole("textbox", { name: "图像模型", exact: true })
      .inputValue(),
    "vision-ui-draft",
  );
  await page.screenshot({
    path: "test-results/settings-image.png",
    fullPage: true,
  });

  await page.getByRole("button", { name: "关闭设置" }).click();
  await page.getByRole("button", { name: "硬件", exact: true }).click();
  await page.getByRole("button", { name: "补充实测尺寸" }).click();
  await page
    .getByLabel("测量依据与安装限制")
    .fill("UI 测试夹具：包络值仅用于回归测试，不是实物测量证据。");
  await page.getByRole("button", { name: "保存实测数据" }).click();
  await page.getByText("实测包络已记录", { exact: true }).waitFor();
  await page.getByRole("button", { name: "确认并继续", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Settings" }).waitFor();
  assert.equal(
    (await app.store.get(p.id)).stages.requirements.status,
    "approved",
  );
  await page.getByRole("button", { name: "关闭提示" }).click();
  await page.getByRole("button", { name: "历史", exact: true }).click();
  await page.getByRole("heading", { name: "保留每一步决策" }).waitFor();
  assert((await app.store.versions(p.id)).length > 0);
  await page.getByRole("button", { name: "阶段概览", exact: true }).click();
  await app.store.update(p.id, (p) => {
    p.messages.push({
      id: "markdown-ui",
      role: "assistant",
      text: "**Markdown 加粗**\n\n- 列表项目\n\n```js\nconst x = 1\n```",
      createdAt: new Date().toISOString(),
    });
  });
  await page
    .locator(".markdown-content strong")
    .filter({ hasText: "Markdown 加粗" })
    .waitFor();
  await page.getByRole("button", { name: "彻底删除项目", exact: true }).click();
  assert(
    await page
      .getByRole("button", { name: "永久删除", exact: true })
      .isDisabled(),
  );
  await page.getByLabel("确认删除项目名称").fill("桌面环境终端");
  await page.getByRole("button", { name: "永久删除", exact: true }).click();
  await page.getByRole("heading", { name: /让想法/ }).waitFor();
  assert.equal((await app.store.list()).length, 0);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "收起对话" }).click();
  await page.screenshot({ path: "test-results/mobile.png", fullPage: true });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page
    .getByRole("button", { name: "DreamaticMake 菜单", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: /系统设置|System settings/ })
    .click();
  await page.getByRole("tab", { name: "图像模型", exact: true }).click();
  await page.screenshot({
    path: "test-results/settings-mobile.png",
    fullPage: true,
  });
  assert.equal(
    await page.locator("dialog").evaluate((e) => e.scrollWidth > e.clientWidth),
    false,
  );
  await page.keyboard.press("Escape");
  assert.deepEqual(errors, []);
  console.log(
    "UI PASS: 创建项目、阶段预览、方案卡、审批卡、文生参数、真实 CAD 生成、设置与移动布局",
  );
} finally {
  await browser.close();
  app.server.closeAllConnections();
  await new Promise<void>((done) => app.server.close(() => done()));
  await rm(workspace, { recursive: true, force: true });
}

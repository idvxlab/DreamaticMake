import { chromium } from "playwright-core";
import { Settings } from "../packages/core/src/settings";
import { createApp } from "../apps/server/src/index";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import assert from "node:assert/strict";

const folder = await mkdtemp(join(tmpdir(), "make-review-timer-"));
const configRoot = join(folder, "config");
await mkdir(configRoot);
const settings = new Settings(configRoot);
await settings.save({
  MAKE_API_KEY: "",
  MAKE_LOCAL_LIBRARY: "",
  MAKE_LANGUAGE: "zh",
});
const app = await createApp(join(folder, "workspace"), settings);
app.server.listen(0, "127.0.0.1");
await once(app.server, "listening");
const project = await app.store.create("倒计时回归", "USB 桌面原型");
await app.workflow.submit(project.id, "requirements", 1, "analyst", {
  title: "等待完善",
  summary: "补充验收说明",
  facts: [],
  assumptions: [],
  blockers: [],
  choices: [],
  partIds: [],
});
await app.workflow.review(
  project.id,
  "requirements",
  1,
  "changes_requested",
  "请补充验收说明",
);
const browser = await chromium.launch({
  executablePath:
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
try {
  const page = await browser.newPage();
  await page.clock.install();
  let requests = 0;
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().endsWith("/approvals")) requests++;
  });
  await page.goto(`http://127.0.0.1:${(app.server.address() as any).port}`);
  await page.locator(".project-row").filter({ hasText: "倒计时回归" }).click();
  await page.getByRole("timer").waitFor();
  await page.clock.fastForward(60000);
  await page.getByRole("timer").filter({ hasText: "60 秒" }).waitFor();
  assert.equal(requests, 0);
  await page.getByRole("button", { name: "暂停自动继续", exact: true }).click();
  await page.clock.fastForward(180000);
  assert.equal(requests, 0);
  await page
    .getByRole("button", { name: "重新计时 120 秒", exact: true })
    .click();
  await page
    .getByRole("button", { name: "补充意见（可选）", exact: true })
    .click();
  assert.equal(await page.getByRole("timer").count(), 0);
  await page.clock.fastForward(180000);
  assert.equal(requests, 0);
  // Reload a review to begin a fresh countdown; never call a real model.
  await page.reload();
  await page.locator(".project-row").filter({ hasText: "倒计时回归" }).click();
  await page.getByRole("timer").waitFor();
  await page.clock.fastForward(119000);
  assert.equal(requests, 0);
  const approval = page.waitForResponse(
    (r) => r.url().endsWith("/approvals") && r.request().method() === "POST",
  );
  await page.clock.fastForward(1000);
  assert.equal((await approval).status(), 200);
  await page.getByRole("alert").filter({ hasText: "Settings" }).waitFor();
  await page.clock.fastForward(240000);
  assert.equal(requests, 1);
  const saved = await app.store.get(project.id);
  assert.equal(saved.approvals.length, 1);
  assert.equal(saved.approvals[0].decision, "changes_requested");
  assert.notEqual(saved.stages.requirements.status, "approved");
  console.log("PASS: 120 秒触发一次完善；暂停、编辑停止计时；不会代替用户批准");
} finally {
  await browser.close();
  app.server.closeAllConnections();
  await new Promise<void>((resolve) => app.server.close(() => resolve()));
  await rm(folder, { recursive: true, force: true });
}

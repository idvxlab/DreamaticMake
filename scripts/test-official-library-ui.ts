import { chromium } from "playwright-core";
import { once } from "node:events";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import { createApp } from "../apps/server/src/index";
import { Settings } from "../packages/core/src/settings";

const folder = await mkdtemp(join(tmpdir(), "make-official-ui-"));
const config = join(folder, "config");
await mkdir(config);
const settings = new Settings(config);
await settings.save({
  MAKE_LOCAL_LIBRARY: resolve(process.argv[2] || "../小家电元件库"),
  MAKE_PYTHON: resolve(".venv/bin/python"),
  MAKE_API_KEY: "",
  MAKE_IMAGE_API_KEY: "",
});
const app = await createApp(join(folder, "workspace"), settings);
const project = await app.store.create(
  "Arduino 集成验证",
  "温湿度传感器及 STEP 空间检查",
);
app.server.listen(0, "127.0.0.1");
await once(app.server, "listening");
const origin = `http://127.0.0.1:${(app.server.address() as any).port}`;
const browser = await chromium.launch({
  executablePath:
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1512, height: 982 } });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.route("**/*", async (route) => {
  const url = route.request().url();
  if (
    url.startsWith(origin) ||
    url.startsWith("blob:") ||
    url.startsWith("data:")
  )
    await route.continue();
  else await route.abort();
});
await mkdir("test-results/official-library", { recursive: true });
try {
  await page.goto(origin);
  await page
    .getByRole("button", { name: "Arduino 集成验证", exact: false })
    .first()
    .click();
  await page.getByRole("button", { name: "硬件", exact: true }).click();
  await page.getByLabel("搜索本地采购参数").fill("温湿度");
  await page.getByRole("button", { name: "搜索 / 刷新", exact: true }).click();
  const candidate = page
    .locator(".local-library article")
    .filter({
      has: page.getByRole("heading", { name: "Modulino Thermo", exact: true }),
    })
    .first();
  await candidate.getByRole("button", { name: "查看参数与原文" }).click();
  const details = page.locator('article[aria-label="采集参数详情"]');
  await details
    .getByRole("heading", { name: "Modulino Thermo", exact: true })
    .waitFor();
  for (const axis of ["X", "Y", "Z"])
    await details.getByLabel(`可用空间 ${axis} mm`).fill("1");
  await details
    .getByRole("button", { name: "检查 STEP 包络", exact: true })
    .first()
    .click();
  await details.getByText(/模型包络 XYZ/).waitFor({ timeout: 120000 });
  await details.getByText(/所填空间不能容纳/).waitFor();
  await details.getByText(/模型包络 XYZ/).scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "test-results/official-library/hardware-step-check.png",
  });
  const p = await app.store.get(project.id);
  assert.deepEqual(p.approvals, []);
  assert.deepEqual(p.selectedParts, []);
  assert.equal(p.stages.hardware.artifacts.length, 2);
  await page.getByRole("button", { name: "CAD 工作台", exact: true }).click();
  await page.locator("details.library-cad-panel > summary").click();
  await page.getByLabel("搜索本地采购参数").fill("Modulino Thermo");
  await page.getByRole("button", { name: "搜索 / 刷新", exact: true }).click();
  await page
    .locator(".library-cad-panel")
    .getByRole("heading", { name: "Modulino Thermo", exact: true })
    .waitFor();
  await page.locator(".library-cad-panel").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "test-results/official-library/cad-hardware-search.png",
  });
  assert.deepEqual(errors, []);
  const report = {
    projectId: project.id,
    source: "actual Arduino Modulino Thermo STEP",
    checks: [
      "Chinese hardware search",
      "official source/detail",
      "actual STEP kernel inspection",
      "insufficient envelope detected",
      "CAD stage search UI",
      "immutable project artifacts",
      "no approval or BOM mutation",
    ],
    pageErrors: errors,
  };
  await writeFile(
    "test-results/official-library/ui-report.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
} finally {
  await browser.close();
  app.server.closeAllConnections();
  await new Promise<void>((r) => app.server.close(() => r()));
  await rm(folder, { recursive: true, force: true });
}

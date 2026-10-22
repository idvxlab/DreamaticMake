import { chromium } from "playwright-core";
import { Settings, fields } from "../packages/core/src/settings";
import { createApp } from "../apps/server/src/index";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import assert from "node:assert/strict";

if (!process.env.MAKE_ENGINE_TEST_PYTHON || !process.env.MAKE_TEST_BROWSER)
  throw new Error(
    "Set MAKE_ENGINE_TEST_PYTHON and MAKE_TEST_BROWSER; local projects/ cases must exist",
  );
class TestSettings extends Settings {
  override async snapshot() {
    return {
      ...Object.fromEntries(fields.map((f) => [f.key, f.default])),
      MAKE_ENGINE_PYTHON: process.env.MAKE_ENGINE_TEST_PYTHON!,
      MAKE_API_KEY: "",
      MAKE_IMAGE_API_KEY: "",
    };
  }
}
const folder = await mkdtemp(join(tmpdir(), "design-cases-ui-"));
const app = await createApp(folder, new TestSettings(folder));
app.server.listen(0, "127.0.0.1");
await once(app.server, "listening");
const url = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
const browser = await chromium.launch({
  executablePath: process.env.MAKE_TEST_BROWSER,
  headless: true,
  args: [
    "--enable-webgl",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
const page = await browser.newPage({ viewport: { width: 1760, height: 1450 } });
page.setDefaultTimeout(30000);
const errors: string[] = [];
page.on("pageerror", (error) => errors.push(error.message));
await mkdir("test-results", { recursive: true });
try {
  await page.goto(url);
  await page
    .getByRole("button", { name: /新建项目/ })
    .first()
    .click();
  await page.getByLabel("项目名称").fill("分层案例验证");
  await page.getByLabel("你想做什么？").fill("验证机械臂和感温闹钟");
  await page.getByRole("button", { name: "创建项目", exact: true }).click();
  await page.getByRole("button", { name: "CAD 工作台", exact: true }).click();
  const bench = page.getByRole("region", { name: "产品设计工作台" });
  await bench.getByRole("button", { name: /迷你机械臂/ }).click();
  await bench
    .locator(".workspace-tree button")
    .filter({ hasText: "肩关节舵机" })
    .waitFor();
  await bench.locator('.engine-scene[data-body-count="14"]').waitFor();
  await page.waitForFunction(
    () =>
      !document
        .querySelector(".layout-workbench")
        ?.textContent?.includes("更新视图…"),
  );
  await bench.getByRole("button", { name: "运动", exact: true }).click();
  const shoulder = bench.getByRole("slider", {
    name: "shoulder/joints/axis",
    exact: true,
  });
  await shoulder.fill("35");
  await page.waitForTimeout(700);
  assert.equal(
    await bench
      .getByLabel("shoulder/joints/axis value", { exact: true })
      .inputValue(),
    "35",
  );
  await page.screenshot({ path: "test-results/design-case-arm.png" });
  await bench.getByRole("button", { name: "电路与能源", exact: true }).click();
  await bench.locator('[data-entity-ref="shoulder"]').hover();
  await page.waitForFunction(() =>
    document
      .querySelector(".engine-scene")
      ?.getAttribute("data-highlighted-bodies")
      ?.includes("shoulder/bodies/case"),
  );
  await bench
    .getByRole("button", { name: "检查连通关系", exact: true })
    .click();
  await bench.getByText("connectivity · completed", { exact: true }).waitFor();
  await bench.getByRole("button", { name: "代码与逻辑", exact: true }).click();
  await bench.getByRole("button", { name: "从头运行", exact: true }).click();
  await bench.getByTestId("notebook-result").waitFor({ timeout: 60000 });
  assert.match(
    await bench.getByTestId("notebook-result").innerText(),
    /jaw_opening_mm\s+34/,
  );
  await bench.getByRole("button", { name: "运动", exact: true }).click();
  assert.equal(
    await bench
      .getByLabel("shoulder/joints/axis value", { exact: true })
      .inputValue(),
    "25",
  );
  assert.equal(
    await bench
      .getByLabel("gripper/joints/right value", { exact: true })
      .inputValue(),
    "-20",
  );

  await bench.getByRole("button", { name: /感温闹钟/ }).click();
  await bench
    .locator(".workspace-tree button")
    .filter({ hasText: "闹钟外壳框架" })
    .waitFor();
  await bench.locator('.engine-scene[data-body-count="7"]').waitFor();
  await bench
    .getByRole("button", { name: "检查当前姿态碰撞", exact: true })
    .click();
  await bench.getByText("collision · completed", { exact: true }).waitFor();
  await page.screenshot({ path: "test-results/design-case-alarm.png" });
  await bench
    .getByRole("button", { name: "物料与信息流动", exact: true })
    .click();
  await bench.locator('[data-entity-ref="temperature"]').hover();
  await page.waitForFunction(() =>
    document
      .querySelector(".engine-scene")
      ?.getAttribute("data-highlighted-bodies")
      ?.includes("temperature/bodies/body"),
  );
  await bench.getByRole("button", { name: "代码与逻辑", exact: true }).click();
  const run = async () => {
    await bench.getByRole("button", { name: "从头运行", exact: true }).click();
    await bench.getByTestId("notebook-result").waitFor({ timeout: 60000 });
    return bench.getByTestId("notebook-result").innerText();
  };
  assert.match(await run(), /buzzer_hz\s+2000/);
  await bench
    .getByRole("slider", { name: "now_minutes", exact: true })
    .fill("481");
  assert.match(await run(), /buzzer_hz\s+0/);
  await bench
    .getByRole("slider", { name: "temperature_c", exact: true })
    .fill("35");
  assert.match(await run(), /高温提醒/);
  await bench.getByRole("slider", { name: "enabled", exact: true }).fill("0");
  assert.match(await run(), /alarm_on\s+false/);
  await bench
    .getByRole("button", { name: "保存设计草稿", exact: true })
    .click();
  await bench.getByText(/草稿版本 1/).waitFor();
  await bench
    .getByRole("button", { name: "重新加载项目设计", exact: true })
    .click();
  await page.waitForTimeout(500);
  assert.match(
    await bench.getByLabel("Python control").inputValue(),
    /temperature_limit_c/,
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: local layered cases, arm motion and Python bindings, alarm time/temperature controls, 3D graph mapping, saved notebook",
  );
} catch (error) {
  await page.screenshot({
    path: "test-results/design-cases-failure.png",
    fullPage: true,
  });
  console.log((await page.locator("body").innerText()).slice(-12000));
  throw error;
} finally {
  await browser.close();
  app.server.close();
  await once(app.server, "close");
  await rm(folder, { recursive: true, force: true });
}

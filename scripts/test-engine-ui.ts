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
    "Set MAKE_ENGINE_TEST_PYTHON and MAKE_TEST_BROWSER to local executable paths",
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
const workspace = await mkdtemp(join(tmpdir(), "make-engine-ui-"));
const app = await createApp(workspace, new TestSettings(workspace));
app.server.listen(0, "127.0.0.1");
await once(app.server, "listening");
const url = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
const browser = await chromium.launch({
  executablePath: process.env.MAKE_TEST_BROWSER,
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1512, height: 1100 } });
page.setDefaultTimeout(15000);
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
await mkdir("test-results", { recursive: true });
try {
  await page.goto(url);
  await page
    .getByRole("button", { name: /新建项目/ })
    .first()
    .click();
  await page.getByLabel("项目名称").fill("引擎集成验证");
  await page
    .getByLabel("你想做什么？")
    .fill("验证执行器、风扇和温度指示灯的模型仿真");
  await page.getByRole("button", { name: "创建项目", exact: true }).click();
  await page.getByRole("button", { name: "CAD 工作台", exact: true }).click();
  const bench = page.getByRole("region", { name: "产品设计引擎" });
  await bench.getByRole("button", { name: "舵机连杆", exact: true }).click();
  await bench
    .getByRole("button", { name: "加载初始场景", exact: true })
    .click();
  await bench
    .locator(".engine-run-status")
    .filter({ hasText: "completed" })
    .waitFor();
  await bench.locator(".engine-scene canvas").waitFor();
  assert.equal(await bench.getByRole("slider").count(), 0);
  await bench.getByRole("button", { name: "运行仿真", exact: true }).click();
  const slider = bench.getByRole("slider", { name: "仿真时间轴" });
  await slider.waitFor();
  const maximum = await slider.getAttribute("max");
  assert(Number(maximum) > 1);
  await slider.fill(maximum!);
  await bench
    .getByRole("button", { name: "servo/bodies/shaft", exact: true })
    .click();
  await bench.getByText("1.000 / 1.000 s", { exact: true }).waitFor();
  assert.equal(await bench.locator(".viewer-error").count(), 0);
  await bench.screenshot({ path: "test-results/design-engine-scene.png" });
  await bench.getByRole("button", { name: "电路与信号", exact: true }).click();
  await bench.getByRole("heading", { name: "网络连接与采样" }).waitFor();
  await bench.screenshot({ path: "test-results/design-engine-circuit.png" });
  await bench.getByRole("button", { name: "连续风扇", exact: true }).click();
  await bench.getByRole("button", { name: "运行仿真", exact: true }).click();
  await slider.waitFor();
  await bench.getByRole("button", { name: "物料流", exact: true }).click();
  await bench.getByText("fan/material_paths/air", { exact: true }).waitFor();
  await bench.screenshot({ path: "test-results/design-engine-flow.png" });
  await bench.getByRole("button", { name: "温控指示灯", exact: true }).click();
  await bench.getByRole("button", { name: "运行仿真", exact: true }).click();
  await slider.waitFor();
  await slider.fill((await slider.getAttribute("max"))!);
  await bench.getByRole("button", { name: "电路与信号", exact: true }).click();
  await bench.getByText("effects/indicator", { exact: true }).waitFor();
  assert.match(await bench.innerText(), /1 · valid · simulated/);
  await bench.getByRole("button", { name: "外壳 CAD", exact: true }).click();
  await bench.locator(".model-stage canvas").waitFor();
  await bench.locator("summary").click();
  await bench
    .getByRole("textbox", { name: "模型快照", exact: true })
    .fill("{}");
  assert.equal(await slider.count(), 0);
  await bench.getByRole("button", { name: "校验模型", exact: true }).click();
  await bench.locator(".engine-diagnostic.error").first().waitFor();
  await bench.getByRole("button", { name: "舵机连杆", exact: true }).click();
  await bench.getByRole("button", { name: "运行仿真", exact: true }).click();
  await slider.waitFor();
  await page.reload();
  await page
    .getByRole("button", { name: "引擎集成验证", exact: false })
    .first()
    .click();
  await page.getByRole("button", { name: "CAD 工作台", exact: true }).click();
  await slider.waitFor();
  const project = (await app.store.list())[0];
  await app.store.update(project.id, (p) => {
    p.parameters.width++;
  });
  await bench.getByText(/项目输入已变化，保存的引擎结果已过期/).waitFor();
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.getByRole("button", { name: "收起对话", exact: true }).click();
  await bench.screenshot({ path: "test-results/design-engine-narrow.png" });
  assert.deepEqual(errors, []);
  console.log(
    "Engine UI: preview, 3D, replay, circuit signals, material flow, CAD, invalid input, persistence and stale Context passed",
  );
} finally {
  await browser.close();
  app.server.closeAllConnections();
  await new Promise<void>((r) => app.server.close(() => r()));
  await rm(workspace, { recursive: true, force: true });
}

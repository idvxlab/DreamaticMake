import { chromium } from "playwright-core";
import { Settings, fields } from "../packages/core/src/settings";
import { createApp } from "../apps/server/src/index";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import assert from "node:assert/strict";
import { cubeStl } from "../tests/fixtures/stl";
if (!process.env.MAKE_ENGINE_TEST_PYTHON || !process.env.MAKE_TEST_BROWSER)
  throw new Error("Set MAKE_ENGINE_TEST_PYTHON and MAKE_TEST_BROWSER");
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
const workspace = await mkdtemp(join(tmpdir(), "make-design-ui-"));
const app = await createApp(workspace, new TestSettings(workspace));
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
const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
page.setDefaultTimeout(30000);
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
await mkdir("test-results", { recursive: true });
try {
  await page.goto(url);
  await page
    .getByRole("button", { name: /新建项目/ })
    .first()
    .click();
  await page.getByLabel("项目名称").fill("布局工作台验证");
  await page
    .getByLabel("你想做什么？")
    .fill("验证布局、运动、连通和 Python 逻辑实验");
  await page.getByRole("button", { name: "创建项目", exact: true }).click();
  await page.getByRole("button", { name: "CAD 工作台", exact: true }).click();
  const bench = page.getByRole("region", { name: "产品设计工作台" });
  await bench.getByRole("button", { name: "舵机连杆", exact: true }).click();
  await bench.locator(".workspace-tree button").first().waitFor();
  await page.waitForFunction(
    () =>
      !document
        .querySelector(".layout-workbench")
        ?.textContent?.includes("更新视图…"),
  );
  await bench.locator(".engine-scene canvas").waitFor();
  await bench.getByRole("button", { name: "运动", exact: true }).click();
  const slider = bench.getByRole("slider", {
    name: "servo/joints/axis",
    exact: true,
  });
  await slider.fill("30");
  await page.waitForTimeout(1000);
  assert.equal(
    await bench
      .getByLabel("servo/joints/axis value", { exact: true })
      .inputValue(),
    "30",
  );
  await bench
    .getByRole("button", { name: "检查当前姿态碰撞", exact: true })
    .click();
  await bench.getByText(/collision ·/).waitFor();
  await bench.screenshot({ path: "test-results/design-workspace-motion.png" });
  await bench.getByRole("button", { name: "电路与能源", exact: true }).click();
  const node = bench.locator('[data-entity-ref="servo"]');
  await node.hover();
  await page.waitForFunction(() =>
    (
      document
        .querySelector(".engine-scene")
        ?.getAttribute("data-highlighted-bodies") ?? ""
    ).includes("servo/bodies"),
  );
  await bench.screenshot({ path: "test-results/design-workspace-circuit.png" });
  await bench
    .getByRole("button", { name: "物料与信息流动", exact: true })
    .click();
  assert.equal(await bench.getByRole("img", { name: "实体关系图" }).count(), 1);
  await bench.getByRole("button", { name: "代码与逻辑", exact: true }).click();
  await bench
    .locator("summary")
    .filter({ hasText: "输入控件与输出绑定" })
    .click();
  await bench.getByLabel("Notebook 控件 JSON").fill(
    JSON.stringify({
      inputs: [{ name: "angle_deg", value: 0, min: -90, max: 90, step: 1 }],
      bindings: [{ output: "angle", target: "servo/joints/axis", unit: "deg" }],
    }),
  );
  await bench.getByRole("button", { name: "应用控件", exact: true }).click();
  await bench
    .getByRole("slider", { name: "angle_deg", exact: true })
    .fill("35");
  await bench.getByRole("button", { name: "从头运行", exact: true }).click();
  await bench.getByTestId("notebook-result").waitFor({ timeout: 60000 });
  assert.match(await bench.getByTestId("notebook-result").innerText(), /35/);
  await bench.screenshot({
    path: "test-results/design-workspace-notebook.png",
  });
  await bench.getByRole("button", { name: "运动", exact: true }).click();
  await page.waitForFunction(
    () =>
      (
        document.querySelector(
          'input[aria-label="servo/joints/axis value"]',
        ) as HTMLInputElement
      )?.value === "35",
  );
  await bench.getByRole("button", { name: "代码与逻辑", exact: true }).click();
  // Real Python attempting app API access must be blocked by the worker's CSP.
  await bench
    .getByLabel("Python control")
    .fill('import js\nawait js.fetch("/api/projects")\noutputs["bad"] = True');
  await bench.getByRole("button", { name: "从头运行", exact: true }).click();
  await bench
    .locator('output[role="status"]')
    .filter({ hasText: /Failed to fetch|Content Security|NetworkError/ })
    .waitFor({ timeout: 60000 });
  assert.equal(await bench.getByTestId("notebook-result").count(), 0);
  await bench.getByLabel("Python control").fill("while True:\n    pass");
  await bench.getByRole("button", { name: "从头运行", exact: true }).click();
  await bench.getByRole("button", { name: "取消", exact: true }).click();
  await bench
    .locator('output[role="status"]')
    .filter({ hasText: "已取消" })
    .waitFor();
  await bench
    .getByLabel("Python control")
    .fill('outputs["angle"] = inputs["angle_deg"]');
  await bench
    .getByRole("button", { name: "保存设计草稿", exact: true })
    .click();
  await bench.getByText(/草稿版本 1/).waitFor();
  await bench
    .getByRole("button", { name: "重新加载项目设计", exact: true })
    .click();
  assert.equal(
    await bench.getByLabel("Python control").inputValue(),
    'outputs["angle"] = inputs["angle_deg"]',
  );
  await bench.getByRole("button", { name: "结构", exact: true }).click();
  await bench.getByRole("button", { name: "添加元件", exact: true }).click();
  await bench.getByLabel("X mm", { exact: true }).fill("0");
  await page.waitForTimeout(500);
  await bench
    .getByRole("button", { name: "检查当前姿态碰撞", exact: true })
    .click();
  await bench.getByText(/collision ·/).waitFor();
  if (process.env.MAKE_ENGINE_TEST_MESH === "1") {
    const count = await bench.locator(".workspace-tree button").count();
    await bench
      .locator("summary")
      .filter({ hasText: "CAD 几何与构件映射" })
      .click();
    await bench
      .locator("summary")
      .filter({ hasText: "导入 STL / 组装网格" })
      .click();
    await bench
      .getByLabel("上传 STL", { exact: true })
      .setInputFiles({
        name: "cube.stl",
        mimeType: "model/stl",
        buffer: cubeStl(),
      });
    await bench
      .getByRole("button", { name: "用所选 STL 创建装配", exact: true })
      .click();
    await page.waitForFunction(
      (count) =>
        document.querySelectorAll(".workspace-tree button").length ===
        count + 1,
      count,
    );
    await bench
      .getByRole("button", { name: "检查当前姿态碰撞", exact: true })
      .click();
    await bench.getByText(/collision ·/).waitFor();
    await bench.screenshot({ path: "test-results/design-workspace-stl.png" });
  }
  await bench
    .locator("summary")
    .filter({ hasText: "布局 JSON 与导入" })
    .click();
  const source = JSON.parse(
    await bench.getByLabel("布局源 JSON", { exact: true }).inputValue(),
  );
  source.entities.virtual = { name: "无几何控制器" };
  await bench
    .getByLabel("布局源 JSON", { exact: true })
    .fill(JSON.stringify(source));
  await bench.getByRole("button", { name: "应用布局", exact: true }).click();
  await bench
    .locator(".workspace-tree button")
    .filter({ hasText: "无几何控制器" })
    .click();
  await bench
    .getByRole("button", { name: "检查当前姿态碰撞", exact: true })
    .click();
  await bench.getByText(/未检查对象.*virtual/).waitFor();
  assert.equal(
    await bench.getByRole("button", { name: "外壳 CAD", exact: true }).count(),
    0,
  );
  assert.equal(await bench.locator(".viewer-error").count(), 0);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: real Python, layout, motion, graph/3D highlight, persistence, CSP and cancellation",
  );
} catch (error) {
  await page.screenshot({
    path: "test-results/design-workspace-failure.png",
    fullPage: true,
  });
  console.log((await page.locator("body").innerText()).slice(-14000));
  throw error;
} finally {
  await browser.close();
  app.server.close();
  await once(app.server, "close");
  await rm(workspace, { recursive: true, force: true });
}

import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { resolve } from "node:path";
const interfaceRoot =
  process.env.MAKE_ENGINE_UI_ROOT || resolve("engine/interface");
const server = spawn(
  process.execPath,
  [
    "node_modules/vite/bin/vite.js",
    ...(process.env.MAKE_ENGINE_UI_PREVIEW === "1" ? ["preview"] : []),
    "--config",
    resolve(interfaceRoot, "vite.config.ts"),
    "--port",
    "4323",
  ],
  { windowsHide: true, stdio: "pipe" },
);
let logs = "";
server.stdout.on("data", (d) => (logs += d));
server.stderr.on("data", (d) => (logs += d));
let browser;
try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch("http://127.0.0.1:4323")).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
    if (i === 99) throw new Error(logs);
  }
  browser = await chromium.launch({
    executablePath: process.env.MAKE_TEST_BROWSER,
    args: [
      "--enable-webgl",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
    ],
    headless: true,
  });
  const page = await browser.newPage({
    viewport: { width: 1500, height: 950 },
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:4323");
  await page.locator('.engine-scene[data-body-count="3"]').waitFor();
  await page.getByRole("button", { name: "运动机构", exact: true }).click();
  const joint = page.locator(".joint input").first();
  await joint.fill("0.015");
  await joint.dispatchEvent("change");
  await page.waitForFunction(
    () =>
      document.querySelector(".viewport")?.getAttribute("aria-busy") ===
      "false",
  );
  assert.equal(await page.locator(".viewer canvas").count(), 1);
  await page.getByRole("button", { name: "电路与能量", exact: true }).click();
  await page.locator(".topology-panel").waitFor();
  await page.getByRole("button", { name: "设计源文件", exact: true }).click();
  assert.match(await page.locator("pre").innerText(), /layout_project/);
  await page.getByRole("button", { name: "元件库", exact: true }).click();
  await page.getByLabel("搜索元件").fill("servo");
  await page.waitForFunction(
    () =>
      document.querySelectorAll(".cards article").length > 0 &&
      !document.querySelector(".library")?.textContent?.includes("检索中"),
  );
  assert.match(await page.locator(".cards").innerText(), /servo/i);
  await page.getByLabel("搜索元件").fill("不存在的元件xyz");
  await page.getByText("0 个匹配元件", { exact: true }).waitFor();
  await page.getByRole("button", { name: "结构 / 3D", exact: true }).click();
  await page.getByLabel("设计方案").selectOption("project_1");
  await page.locator(".engine-scene").waitFor();
  assert.ok(
    Number(
      await page.locator(".engine-scene").getAttribute("data-body-count"),
    ) > 3,
  );
  await mkdir("test-results", { recursive: true });
  for (const [name, image] of [
    ["电路与能量", "circuit"],
    ["物质与信息", "flow"],
  ]) {
    await page.getByRole("button", { name, exact: true }).click();
    const node = page.locator(".graph-node").first();
    await node.waitFor();
    const styles = await node.evaluate((element) => ({
      fill: getComputedStyle(element.querySelector("rect")!).fill,
      text: getComputedStyle(element.querySelector("text")!).fill,
      stroke: getComputedStyle(element.querySelector("rect")!).stroke,
    }));
    assert.ok(
      ["rgb(255, 255, 255)", "rgb(245, 249, 237)"].includes(styles.fill),
    );
    assert.notEqual(styles.fill, styles.text);
    assert.notEqual(styles.stroke, "none");
    assert.ok((await page.locator(".graph-port-label").count()) > 0);
    await node.focus();
    await node.press("Enter");
    assert.ok((await node.getAttribute("class"))?.includes("selected"));
    assert.equal(
      await node
        .locator("rect")
        .evaluate((el) => getComputedStyle(el).strokeWidth),
      "3px",
    );
    await page.screenshot({
      path: `test-results/standalone-${image}.png`,
      fullPage: true,
    });
  }
  await page.getByRole("button", { name: "结构 / 3D", exact: true }).click();
  await page.getByLabel("设计方案").selectOption("gripper");
  await page.locator('.engine-scene[data-body-count="3"]').waitFor();
  await mkdir("test-results", { recursive: true });
  await page.screenshot({
    path: "test-results/standalone-engine.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "深化设计 — 定制化模型", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "定制化模型", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "运行建模", exact: true }).click();
  await page
    .getByText(/条命令已执行/)
    .waitFor()
    .catch(async (error) => {
      throw new Error(
        `${error}\n${await page.locator(".custom-model").innerText()}\n${errors.join("\n")}`,
      );
    });
  await page
    .locator('.custom-preview .engine-scene[data-body-count="4"]')
    .waitFor();
  await page
    .locator('.custom-preview .engine-scene[data-loaded-meshes="1"]')
    .waitFor();
  await page.getByLabel("模型材料").selectOption("PETG");
  const condition = {
    record_kind: "custom_model_conditions",
    schema_version: "0.1.0-draft",
    condition_id: "fixture_support",
    revision: 1,
    title: "控制板承托",
    requirements: { support: "底面承托，焊点避让" },
    references: { style: "圆角外壳" },
  };
  await page.getByLabel("导入条件包或模型项目").setInputFiles({
    name: "support.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(condition)),
  });
  await page
    .getByRole("heading", { name: "控制板承托", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "编辑条件包", exact: true }).click();
  await page
    .getByLabel("条件包 JSON")
    .fill(JSON.stringify({ ...condition, title: "控制板承托修订" }));
  await page.getByRole("button", { name: "保存条件包", exact: true }).click();
  await page
    .getByRole("heading", { name: "控制板承托修订", exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "导出 STL", exact: true })
      .isDisabled(),
    true,
  );
  await page.getByRole("button", { name: "运行建模", exact: true }).click();
  await page.getByRole("button", { name: "导出 STL", exact: true }).waitFor();
  await page.waitForFunction(
    () =>
      !Array.from(document.querySelectorAll("button")).find(
        (b) => b.textContent === "导出 STL",
      )?.disabled,
  );
  const stlDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 STL", exact: true }).click();
  const stl = await stlDownload;
  const stlBytes = await readFile((await stl.path())!);
  assert.equal(stl.suggestedFilename(), "housing.mm.stl");
  assert.equal(stlBytes.length, 84 + stlBytes.readUInt32LE(80) * 50);
  const projectDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载模型项目", exact: true }).click();
  const project = JSON.parse(
    await readFile((await (await projectDownload).path())!, "utf-8"),
  );
  assert.equal(project.material, "PETG");
  assert.equal(project.conditions[0].revision, 2);
  assert.equal(
    project.context_snapshot.source_design.snapshot_id,
    project.source_snapshot_id,
  );
  const goodCommands = await page.getByLabel("CAD 建模命令").inputValue();
  await page.getByLabel("CAD 建模命令").fill("box bad NaN 2 3");
  await page.getByRole("button", { name: "运行建模", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "第 1 行" }).waitFor();
  await page.getByLabel("CAD 建模命令").fill(goodCommands);
  await page.reload();
  await page.locator('.engine-scene[data-body-count="3"]').waitFor();
  await page
    .getByRole("button", { name: "深化设计 — 定制化模型", exact: true })
    .click();
  assert.equal(await page.getByLabel("模型材料").inputValue(), "PETG");
  assert.equal(
    await page.getByLabel("CAD 建模命令").inputValue(),
    goodCommands,
  );
  await page.getByRole("button", { name: /控制板承托修订/ }).click();
  await page
    .getByRole("heading", { name: "控制板承托修订", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "运行建模", exact: true }).click();
  await page.getByText(/条命令已执行/).waitFor();
  await page.getByRole("button", { name: "运行建模", exact: true }).click();
  await page.getByRole("button", { name: "停止", exact: true }).click();
  assert.equal(
    await page
      .getByRole("button", { name: "运行建模", exact: true })
      .isEnabled(),
    true,
  );
  await page.evaluate(() => {
    const key = "dreamatic.custom-model.v1.gripper";
    const saved = JSON.parse(localStorage.getItem(key)!);
    saved.source_snapshot_id = "old-snapshot";
    localStorage.setItem(key, JSON.stringify(saved));
  });
  await page.reload();
  await page.locator('.engine-scene[data-body-count="3"]').waitFor();
  await page
    .getByRole("button", { name: "深化设计 — 定制化模型", exact: true })
    .click();
  await page.getByText(/本地草稿来自旧快照/).waitFor();
  await page.getByRole("button", { name: "运行建模", exact: true }).click();
  await page.getByText(/条命令已执行/).waitFor();
  assert.equal(await page.getByText(/本地草稿来自旧快照/).count(), 0);
  await page.screenshot({
    path: "test-results/standalone-custom-model.png",
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    "PASS: engine views, library, real CAD worker, conditions, materials, persistence, cancellation, stale inputs and STL export",
  );
} finally {
  await browser?.close();
  server.kill();
}

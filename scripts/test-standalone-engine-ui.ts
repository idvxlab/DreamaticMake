import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
import { resolve } from "node:path";
const interfaceRoot =
  process.env.MAKE_ENGINE_UI_ROOT || resolve("engine/interface");
const server = spawn(
  process.execPath,
  [
    "node_modules/vite/bin/vite.js",
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
  assert.deepEqual(errors, []);
  console.log(
    "PASS: independent engine, gripper, motion, layers, project and library search",
  );
} finally {
  await browser?.close();
  server.kill();
}

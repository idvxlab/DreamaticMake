import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";

const interfaceRoot = process.env.MAKE_ENGINE_UI_ROOT || resolve("engine/interface");
const server = spawn(process.execPath, ["node_modules/vite/bin/vite.js",
  ...(process.env.MAKE_ENGINE_UI_PREVIEW === "1" ? ["preview"] : []),
  "--config", resolve(interfaceRoot, "vite.config.ts"), "--port", "4323"],
{ windowsHide: true, stdio: "pipe" });
let logs = "";
server.stdout.on("data", (data) => logs += data);
server.stderr.on("data", (data) => logs += data);
let browser;
try {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch("http://127.0.0.1:4323")).ok) break; } catch { /* Server is starting. */ }
    await new Promise((r) => setTimeout(r, 100));
    if (i === 99) throw new Error(logs);
  }
  await mkdir(".runtime/tmp", { recursive: true });
  const folder = await mkdtemp(resolve(".runtime/tmp/workbench-project-"));
  await cp(resolve("examples/project_1"), folder, { recursive: true });
  const manifestPath = join(folder, "project.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.title = "浏览器测试项目";
  await writeFile(manifestPath, JSON.stringify(manifest), "utf8");
  const boardPath = join(folder, "element/controller/component.json");
  const board = JSON.parse(await readFile(boardPath, "utf8"));
  for (let pin = 1; pin <= 40; pin++) board.wiring.terminals[`io_${pin}`] = {
    physical_pin_number: `T${pin}`, label: `IO${pin}`, electrical_role: "bidirectional", body_ref: "body",
  };
  await writeFile(boardPath, JSON.stringify(board), "utf8");
  // Build software fixtures here so the regression does not depend on published examples.
  const elementIndexPath = join(folder, "element/index.json");
  const elementIndex = JSON.parse(await readFile(elementIndexPath, "utf8"));
  elementIndex.elements.controller.software = {
    schema_version: "1", relative_path: "software/controller_1", language: "cpp", entrypoint: "main",
  };
  await writeFile(elementIndexPath, JSON.stringify(elementIndex), "utf8");
  await mkdir(join(folder, "software/controller_1/src"), { recursive: true });
  await writeFile(join(folder, "software/controller_1/src/main.cpp"), "int main() { return 0; }\n", "utf8");
  // Different packages intentionally use the same relative mesh filename.
  for (const [owner, size] of [["base", 20], ["controller", 10]] as const) {
    const packageRoot = join(folder, "element", owner);
    const path = join(packageRoot, "component.json");
    const component = JSON.parse(await readFile(path, "utf8"));
    const vertices = [[0, 0, 0], [size, 0, 0], [0, size, 0], [0, 0, size]];
    const facets = [[0, 2, 1], [0, 1, 3], [0, 3, 2], [1, 2, 3]].map((face) =>
      `facet normal 0 0 0\nouter loop\n${face.map((i) => `vertex ${vertices[i].join(" ")}`).join("\n")}\nendloop\nendfacet`).join("\n");
    const data = Buffer.from(`solid ${owner}\n${facets}\nendsolid ${owner}\n`);
    await mkdir(join(packageRoot, "assets"), { recursive: true });
    await writeFile(join(packageRoot, "assets/part.stl"), data);
    Object.values(component.geometry.envelopes).forEach((envelope: any) => {
      envelope.shape = { kind: "triangle_mesh", unit: "mm", asset_ref: {
        relative_path: "assets/part.stl", sha256: createHash("sha256").update(data).digest("hex"), media_type: "model/stl",
      } };
    });
    await writeFile(path, JSON.stringify(component), "utf8");
  }
  const imageName = "doc/appearance/preview.png";
  await writeFile(join(folder, imageName), Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64"));
  browser = await chromium.launch({ executablePath: process.env.MAKE_TEST_BROWSER,
    args: ["--enable-webgl", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"], headless: true });
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("http://127.0.0.1:4323");
  await page.locator('.engine-scene[data-body-count="14"]').waitFor();
  assert.equal(await page.getByRole("navigation", { name: "设计视图" }).getByRole("button").count(), 5);
  assert.equal(await page.getByRole("button", { name: "元件库", exact: true }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "深化设计 — 定制化模型", exact: true }).count(), 0);
  assert.equal(await page.locator(".joint input").count(), 0);
  assert.equal(await page.getByLabel("查看范围").locator("option").count(), 10);
  await page.getByRole("button", { name: "运动视图", exact: true }).click();
  await page.locator(".joint input").first().waitFor();
  assert.equal(await page.locator(".joint input").count(), 5);
  const moved = page.waitForResponse((response) => response.url().endsWith("/engine-api")
    && response.request().postDataJSON()?.method === "view" && response.request().postDataJSON()?.joint_inputs?.["yaw/joints/axis"] === 0.3);
  await page.getByLabel("yaw/joints/axis", { exact: true }).fill("0.3");
  const movedView = await (await moved).json();
  assert.equal(movedView.motion.status, "completed");
  const structure = page.waitForResponse((response) => response.url().endsWith("/engine-api")
    && response.request().postDataJSON()?.mode === "structure");
  await page.getByRole("button", { name: "结构 / 3D", exact: true }).click();
  const structureView = await (await structure).json();
  assert.notDeepEqual(movedView.scene.bodies, structureView.scene.bodies);
  assert.equal(await page.locator(".joint input").count(), 0);
  await page.getByRole("button", { name: "电路逻辑", exact: true }).click();
  await page.locator(".graph-node").first().waitFor();
  await page.locator('.viewport[aria-busy="false"]').waitFor();
  assert.equal(await page.locator(".graph-port").count(), 16);
  const controllerPin = page.locator('[data-port-ref="controller/terminals/yaw_pwm"]');
  await controllerPin.scrollIntoViewIfNeeded();
  assert.equal(await controllerPin.getAttribute("data-connected"), "true");
  await controllerPin.locator(".graph-port-label").click();
  await page.getByRole("region", { name: "接口详情" }).getByText("yaw/pwm", { exact: true }).waitFor();
  await mkdir("test-results", { recursive: true });
  await page.screenshot({ path: "test-results/workbench-project-ports.png", fullPage: true });
  await page.getByLabel("查看范围").selectOption("controller");
  await page.waitForFunction(() => document.querySelectorAll(".graph-node").length === 1 && document.querySelectorAll(".graph-port").length === 5);
  assert.equal(await page.locator('.graph-port[data-side="left"]').count(), 2);
  assert.equal(await page.locator('.graph-port[data-side="right"]').count(), 3);
  const isolatedPin = page.locator('[data-port-ref="controller/terminals/yaw_pwm"]');
  await isolatedPin.focus();
  await isolatedPin.press("Enter");
  await page.getByRole("region", { name: "接口详情" }).getByText("物理脚号：3", { exact: true }).waitFor();
  await page.getByRole("region", { name: "接口详情" }).getByText("yaw/pwm", { exact: true }).waitFor();
  await page.screenshot({ path: "test-results/workbench-element-ports.png", fullPage: true });
  await page.getByLabel("查看范围").selectOption("");
  await page.waitForFunction(() => document.querySelectorAll(".graph-node").length === 9);

  await page.getByRole("button", { name: "设计源文件", exact: true }).click();
  await page.getByRole("button", { name: "预览 design/structure.json", exact: true }).waitFor();
  await page.locator(".json-preview").filter({ hasText: "placements" }).waitFor();
  assert.equal(await page.getByRole("button", { name: /预览 element\// }).count(), 0);
  await page.locator("summary").filter({ hasText: /^▱\s*requirements$/ }).click();
  await page.getByRole("button", { name: "预览 doc/requirements/README.md", exact: true }).click();
  await page.locator(".document-preview h1").filter({ hasText: "需求与功能" }).waitFor();

  await page.getByLabel("查看范围").selectOption("yaw");
  await page.getByRole("button", { name: "预览 component.json", exact: true }).waitFor();
  await page.locator(".json-preview").filter({ hasText: "demo.micro_servo" }).waitFor();
  assert.equal(await page.getByRole("button", { name: "预览 design/structure.json", exact: true }).count(), 0);
  await page.getByRole("button", { name: "结构 / 3D", exact: true }).click();
  await page.locator('.engine-scene[data-body-count="2"]').waitFor();
  assert.equal(await page.locator(".joint input").count(), 0);
  await page.getByRole("button", { name: "运动视图", exact: true }).click();
  await page.getByLabel("yaw/joints/axis", { exact: true }).waitFor();
  await page.getByLabel("查看范围").selectOption("gripper");
  await page.locator('.engine-scene[data-body-count="3"]').waitFor();
  assert.equal(await page.locator(".joint input").count(), 2);
  await page.getByRole("button", { name: "设计源文件", exact: true }).click();
  await page.locator(".json-preview").filter({ hasText: "demo.gripper" }).waitFor();

  await page.getByLabel("项目文件夹", { exact: true }).fill(folder);
  await page.getByRole("button", { name: "打开项目", exact: true }).click();
  await page.locator("header strong").filter({ hasText: "浏览器测试项目" }).waitFor();
  assert.equal(await page.getByLabel("查看范围").inputValue(), "");
  await page.locator("summary").filter({ hasText: /^▱\s*appearance$/ }).click();
  await page.getByRole("button", { name: `预览 ${imageName}`, exact: true }).click();
  await page.waitForFunction(() => (document.querySelector(".image-preview img") as HTMLImageElement | null)?.naturalWidth === 1);
  await page.getByLabel("查看范围").selectOption("controller");
  await page.getByRole("button", { name: "电路逻辑", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll(".graph-port").length === 45);
  assert.equal(await page.locator('.graph-port[data-connected="false"]').count(), 40);
  const spare = page.locator('[data-port-ref="controller/terminals/io_40"]');
  await spare.scrollIntoViewIfNeeded();
  await spare.locator(".graph-port-label").click();
  await page.getByRole("region", { name: "接口详情" }).getByText("未声明项目接线", { exact: true }).waitFor();
  await page.getByRole("region", { name: "接口详情" }).getByText("物理脚号：T40", { exact: true }).waitFor();
  await page.screenshot({ path: "test-results/workbench-many-ports.png", fullPage: true });
  await page.getByRole("button", { name: "结构 / 3D", exact: true }).click();
  await page.locator('.engine-scene[data-loaded-meshes="1"]').waitFor();
  await page.getByRole("button", { name: "运动视图", exact: true }).click();
  await page.locator('.engine-scene[data-loaded-meshes="1"]').waitFor();
  await page.getByLabel("查看范围").selectOption("");
  await page.getByRole("button", { name: "结构 / 3D", exact: true }).click();
  await page.locator('.engine-scene[data-body-count="14"]').waitFor();
  await page.locator('.engine-scene[data-loaded-meshes="2"]').waitFor();
  await mkdir("test-results", { recursive: true });
  await page.screenshot({ path: "test-results/workbench-structure.png", fullPage: true });
  await page.getByLabel("项目文件夹", { exact: true }).fill(join(folder, "missing"));
  await page.getByRole("button", { name: "打开项目", exact: true }).click();
  await page.getByRole("alert").waitFor();
  assert.equal(await page.locator('.engine-scene[data-body-count="14"]').count(), 1);
  await page.reload();
  await page.locator('.engine-scene[data-body-count="14"]').waitFor();
  assert.equal(await page.getByLabel("项目文件夹", { exact: true }).inputValue(), folder);
  await page.getByRole("button", { name: "设计源文件", exact: true }).click();
  await page.locator("summary").filter({ hasText: /^▱\s*requirements$/ }).click();
  await page.getByRole("button", { name: "预览 doc/requirements/README.md", exact: true }).click();
  await page.locator(".document-preview h1").waitFor();
  await page.screenshot({ path: "test-results/workbench-source.png", fullPage: true });
  await page.getByRole("button", { name: "软件工程", exact: true }).click();
  await page.getByLabel("软件工程目录").getByText("controller · 控制板（概念接口）", { exact: true }).waitFor();
  await page.getByLabel("软件工程目录").locator("summary").filter({ hasText: /^▱\s*controller_1$/ }).click();
  await page.getByLabel("软件工程目录").locator("summary").filter({ hasText: /^▱\s*src$/ }).click();
  await page.getByRole("button", { name: "预览 software/controller_1/src/main.cpp", exact: true }).click();
  await page.locator(".software-code").filter({ hasText: "int main()" }).waitFor();
  await page.screenshot({ path: "test-results/workbench-software.png", fullPage: true });
  await page.getByLabel("查看范围").selectOption("base");
  await page.getByText("当前范围没有关联的软件工程。", { exact: false }).waitFor();
  assert.equal(await page.locator(".software-code").count(), 0);
  await page.getByLabel("查看范围").selectOption("controller");
  await page.getByLabel("软件工程目录").getByText("controller · 控制板（概念接口）", { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log("PASS: five views, software files and scope isolation, project/element STL meshes, ports, motion, scoped previews and folder selection");
} catch (error) {
  console.error(logs);
  throw error;
} finally {
  await browser?.close();
  server.kill();
}

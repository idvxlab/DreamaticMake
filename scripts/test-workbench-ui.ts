/** Isolated UI fixtures; this script never calls a model or changes real workspace data. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { Workbench, type Caller } from "../packages/workbench/runtime";
import { makeServer } from "../apps/workbench/server";
const directory = await mkdtemp(join(tmpdir(), "dreamatic-ui-"));
import { fixtureCaller as caller } from "../tests/workbench-fixtures";
import { ConnectionStore } from "../packages/workbench/connection";
import { hardwareFixture } from "../tests/workbench-hardware-fixtures";
const library = await hardwareFixture(join(directory, "library"));
const connections = new ConnectionStore(
  join(directory, "settings"),
  (async () =>
    Response.json({
      data: [{ id: "deepseek-flash" }, { id: "kimi-k3.1-pro" }],
    })) as typeof fetch,
);
const workbench = new Workbench(caller, directory, {
  visualContract: "legacy",
});
const { server, token } = makeServer(
  workbench,
  undefined,
  connections,
  undefined,
  library,
);
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const address = server.address();
assert(address && typeof address === "object");
const browser = await chromium.launch({
  executablePath:
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
try {
  const page = await browser.newPage({
    viewport: { width: 1512, height: 982 },
    deviceScaleFactor: 1,
  });
  const errors: string[] = [];
  page.setDefaultTimeout(15_000);
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${address.port}/workbench/`);
  await page.getByRole("heading", { name: "连接后查看已有项目" }).waitFor();
  assert.equal(await page.locator(".graph-pane").count(), 0);
  assert.equal(
    await page.getByRole("textbox", { name: "产品需求" }).count(),
    0,
  );
  assert.equal(
    await page.getByText("等待你的第一个想法", { exact: true }).count(),
    0,
  );
  await page.goto(`http://127.0.0.1:${address.port}/workbench/#token=${token}`);
  await page.getByText("本地工作台已连接").waitFor();
  await page.reload();
  await page.getByText("本地工作台已连接").waitFor();
  await page.getByRole("button", { name: /^硬件库/ }).click();
  await page.getByRole("dialog", { name: "真实硬件库" }).waitFor();
  await page.getByLabel("搜索真实硬件").fill("温度");
  await page.getByTitle("搜索硬件").click();
  await page.getByRole("button", { name: /Fixture Nano board/ }).click();
  await page
    .getByRole("heading", { name: "Fixture Nano board", exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "加入项目资料", exact: true })
      .isEnabled(),
    false,
  );
  await page
    .getByRole("button", { name: "Fixture pinout manual", exact: true })
    .click();
  await page
    .getByText("Pin 1 = GND; tolerance unknown", { exact: true })
    .waitFor();
  await page.getByTitle("关闭硬件库").click();
  await page.getByRole("button", { name: "模型设置", exact: true }).click();
  await page.getByRole("dialog").waitFor();
  await page
    .getByLabel("API Key", { exact: true })
    .fill("test-only-fixture-key");
  await page.getByRole("button", { name: "获取可用模型" }).click();
  await page.getByText("已获取 2 个模型", { exact: true }).waitFor();
  assert.equal(
    await page.getByLabel("CAD 模型", { exact: true }).inputValue(),
    "kimi-k3.1-pro",
  );
  assert.equal(
    await page.getByLabel("其余 agent 模型", { exact: true }).inputValue(),
    "deepseek-flash",
  );
  await page.getByRole("button", { name: "保存配置", exact: true }).click();
  await page
    .getByText("配置已保存；后续调用将按角色选择模型。", { exact: true })
    .waitFor();
  assert.equal(
    await page.getByLabel("API Key", { exact: true }).inputValue(),
    "",
  );
  await page.screenshot({
    path: "/tmp/dreamatic-model-settings.png",
    fullPage: true,
  });
  await page.getByTitle("关闭模型设置").click();
  assert.equal(await page.locator(".agent-node").count(), 0);
  assert.equal(await page.locator(".three-host").count(), 0);
  await page.screenshot({
    path: "/tmp/dreamatic-workbench.png",
    fullPage: true,
  });
  await page
    .getByRole("textbox", { name: "产品需求" })
    .fill("UI TEST 一个办公无线鼠标");
  await page.getByRole("button", { name: "开始探索" }).click();
  await page.getByRole("button", { name: "办公", exact: true }).click();
  await page.getByRole("button", { name: "无线", exact: true }).click();
  await page.getByRole("button", { name: "确认选择，交回产品经理" }).click();
  await page.getByText("本轮完成", { exact: true }).waitFor();
  assert(
    (await page.locator(".agent-node").count()) < 14,
    "Overview folds management history",
  );
  await page
    .getByRole("button", { name: "展开管理与重试", exact: true })
    .click();
  assert.equal(await page.locator(".agent-node").count(), 14);
  assert.equal(await page.locator(".port.in").count(), 14);
  assert.equal(await page.locator(".port.out").count(), 14);
  const overviewWires = await page.locator(".wires path").count();
  await page.getByRole("button", { name: /^主要依赖/ }).click();
  assert((await page.locator(".wires path").count()) > overviewWires);
  await page.getByRole("button", { name: /^全部连线/ }).click();
  assert.equal(await page.locator(".wires path").count(), overviewWires);
  // Dragging must not select; a click selects, and a double click opens details.
  await page.getByTitle("适应画布").click();
  const card = page.locator(".agent-node").last();
  const beforeSelection = await page.getByLabel("预览调用结果").inputValue();
  const cardBox = await card.boundingBox();
  assert(cardBox);
  await page.mouse.move(cardBox.x + 20, cardBox.y + 20);
  await page.mouse.down();
  await page.mouse.move(cardBox.x + 50, cardBox.y + 40, { steps: 5 });
  await page.mouse.up();
  assert.equal(
    await page.getByLabel("预览调用结果").inputValue(),
    beforeSelection,
  );
  const movedBox = await card.boundingBox();
  assert(movedBox && movedBox.x > cardBox.x + 20);
  await card.click();
  assert.notEqual(
    await page.getByLabel("预览调用结果").inputValue(),
    beforeSelection,
  );
  await card.dblclick();
  await page.locator(".inspector").waitFor();
  await page.getByTitle("关闭详情").click();
  const canvasBox = await page.locator(".canvas").boundingBox();
  assert(canvasBox);
  const beforePan = await page.locator(".graph-world").getAttribute("style");
  await page.mouse.move(canvasBox.x + 8, canvasBox.y + canvasBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    canvasBox.x + 28,
    canvasBox.y + canvasBox.height / 2 + 20,
    { steps: 5 },
  );
  await page.mouse.up();
  assert.notEqual(
    await page.locator(".graph-world").getAttribute("style"),
    beforePan,
  );
  for (const [dx, dy] of [
    [80, 0],
    [0, 60],
  ]) {
    const before = await page.locator(".graph-world").getAttribute("style");
    await page.mouse.wheel(dx, dy);
    await page.waitForFunction(
      (previous) =>
        document.querySelector(".graph-world")?.getAttribute("style") !==
        previous,
      before,
    );
  }
  const beforeZoom = await page.locator(".graph-world").getAttribute("style");
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -30);
  await page.keyboard.up("Control");
  await page.waitForFunction(
    (previous) =>
      document.querySelector(".graph-world")?.getAttribute("style") !==
      previous,
    beforeZoom,
  );
  assert.equal(
    await page.evaluate(() => window.visualViewport?.scale ?? 1),
    1,
    "Pinch changes graph, not page scale",
  );
  await page.getByTitle("重置画布").click();
  await page.getByRole("button", { name: /^硬件库/ }).click();
  await page.getByRole("button", { name: /Fixture Nano board/ }).click();
  await page.getByRole("button", { name: "加入项目资料", exact: true }).click();
  await page.getByText(/已加入项目资料/).waitFor();
  await page.getByTitle("关闭硬件库").click();
  assert.equal(await page.locator(".agent-node").count(), 14);
  const state = await page.evaluate(async () => {
    const r = await fetch("/workbench-api/project");
    return r.json();
  });
  assert.equal(state.project.nodes[0].role, "coordinator");
  await page
    .getByLabel("预览调用结果")
    .selectOption(
      state.project.nodes.find((n: any) => n.role === "embedded").id,
    );
  await page.getByText("候选方案与元器件", { exact: false }).waitFor();
  assert.equal(await page.locator(".hardware-option").count(), 2);
  assert.equal(await page.locator(".three-host").count(), 0);
  await page.screenshot({
    path: "/tmp/dreamatic-hardware.png",
    fullPage: true,
  });
  await page
    .getByLabel("预览调用结果")
    .selectOption(
      state.project.nodes.find((n: any) => n.role === "designer").id,
    );
  assert.equal(await page.locator(".image-asset").count(), 4);
  assert.equal(await page.locator(".three-host").count(), 0);
  await page.screenshot({
    path: "/tmp/dreamatic-appearance.png",
    fullPage: true,
  });
  await page
    .getByLabel("预览调用结果")
    .selectOption(
      state.project.nodes.find((n: any) => n.role === "mechanical").id,
    );
  await page.locator(".three-host canvas").waitFor();
  await page.getByText(/^逐件尺寸与证据/).waitFor();
  await page.locator(".mesh-status summary").click();
  await page
    .getByText(/当前显示尺寸包络/)
    .first()
    .waitFor();
  await page.getByTitle("查看调用详情").click();
  await page.getByLabel("执行证据范围").waitFor();
  assert.equal(
    await page
      .getByText(
        "所有生成结果均为设计提案；没有实际 CAD、编译或制造执行证据。",
        { exact: true },
      )
      .count(),
    0,
  );
  await page.getByTitle("关闭详情").click();

  await page
    .getByLabel("预览调用结果")
    .selectOption(
      state.project.nodes.find((n: any) => n.role === "coordinator").id,
    );
  assert.equal(await page.locator(".three-host").count(), 0);
  await page.getByTitle("查看调用详情").click();
  await page.getByRole("button", { name: "输入 / 输出协议" }).click();
  await page
    .getByRole("heading", { name: "输出 · dreamatic.workbench/1" })
    .waitFor();
  await page.getByLabel("补充指令").fill("请独立补充审查");
  await page.getByRole("button", { name: "提交产品经理", exact: true }).click();
  await page.getByTitle("关闭详情").click();
  await page.waitForFunction(
    () => document.querySelectorAll(".agent-node").length === 17,
  );
  await page.getByText("本轮完成", { exact: true }).waitFor();
  await page.screenshot({
    path: "/tmp/dreamatic-workbench-test-result.png",
    fullPage: true,
  });
  workbench.project!.phase = "blocked";
  workbench.project!.error = "缺少测试传感器资料";
  await workbench.save();
  await page.reload();
  await page.getByText("缺少测试传感器资料", { exact: true }).waitFor();
  await page.getByRole("button", { name: "带着这些缺口继续" }).click();
  await page.getByRole("button", { name: "确认继续" }).waitFor();
  assert.equal(workbench.project!.gapOverrides?.length || 0, 0);
  await page.getByRole("button", { name: "取消", exact: true }).click();
  assert.equal(workbench.project!.phase, "blocked");
  await page.getByRole("button", { name: "带着这些缺口继续" }).click();
  await page.getByRole("button", { name: "确认继续" }).click();
  await page.getByText("本轮完成 · 有未解决缺口", { exact: true }).waitFor();
  assert.equal(
    workbench.project!.gapOverrides?.[0].reason,
    "缺少测试传感器资料",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "/tmp/dreamatic-workbench-mobile-test.png",
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
    false,
    "Mobile must not overflow horizontally",
  );
  assert.deepEqual(errors, []);
  const validStructure = [...workbench.project!.nodes]
    .reverse()
    .find((n) => n.role === "mechanical" && n.status === "done")!;
  workbench.project!.nodes.push({
    id: "failed-structure-inspection",
    role: "mechanical",
    title: "失败的后续核对",
    status: "error",
    inputs: [validStructure.id],
    error: "测试：后续核对失败",
  });
  await workbench.save();
  await page.reload();
  await page
    .getByRole("navigation", { name: "工作内容类别" })
    .getByRole("button", { name: "结构", exact: true })
    .click();
  assert.equal(
    await page.getByLabel("预览调用结果").inputValue(),
    validStructure.id,
  );
  await page.locator(".three-host canvas").waitFor();
  assert.equal(
    await page
      .getByLabel("预览调用结果")
      .locator('option[value="failed-structure-inspection"]')
      .count(),
    1,
  );

  await page.setViewportSize({ width: 1512, height: 982 });
  const dimsItem = validStructure.packet!.data.structure.find((i) =>
    Array.isArray(i.properties.dimensionsMm),
  )!;
  dimsItem.properties.dimensionsEvidence = "step_file_bounds";
  dimsItem.properties.meshUrl = "/workbench-api/library/mesh?fixture=failure";
  await workbench.save();
  await page.route("**/workbench-api/library/mesh?fixture=failure", (route) =>
    route.fulfill({ status: 503, body: "unavailable" }),
  );
  await page.reload();
  await page
    .getByRole("navigation", { name: "工作内容类别" })
    .getByRole("button", { name: "结构", exact: true })
    .click();
  await page.getByText(/真实网格加载失败，当前保留尺寸包络/).waitFor();
  await page.unroute("**/workbench-api/library/mesh?fixture=failure");
  await page.route("**/workbench-api/library/mesh?fixture=failure", (route) =>
    route.fulfill({
      status: 200,
      contentType: "model/stl",
      body: "solid fixture\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid fixture",
    }),
  );
  await page.getByRole("button", { name: "重新加载网格", exact: true }).click();
  await page
    .locator(".mesh-status summary")
    .filter({ hasText: "1 网格已加载" })
    .waitFor();
  assert.equal(
    await page.locator(".mesh-status").getAttribute("open"),
    null,
    "Successful retry collapses detailed status",
  );
  assert.equal(await page.getByText(/真实网格加载失败/).count(), 0);
  await page.getByTitle("适应画布").click();
  await page.getByTitle("重置画布").click();
  await page.screenshot({
    path: "/tmp/dreamatic-frontend-evidence.png",
    fullPage: true,
  });
  if (process.argv.includes("--history")) {
    // Read-only real snapshot, served by this isolated instance; never dispatch.
    const snapshotPath = "workspace/workbench/current.json";
    const saved = await readFile(snapshotPath);
    const digest = createHash("sha256").update(saved).digest("hex");
    workbench.project = JSON.parse(saved.toString("utf8"));
    await page.reload();
    await page.getByText("本地工作台已连接").waitFor();
    const total = workbench.project!.nodes.length;
    const compact = await page.locator(".agent-node").count();
    assert((await page.locator(".agent-node.coordinator").count()) > 0);
    assert((await page.locator(".agent-node.analyst").count()) > 0);
    assert((await page.locator(".agent-node.designer").count()) <= 3);
    assert(compact > 0 && compact < total);
    await page.getByTitle("适应画布").click();
    const fitStyle = await page.locator(".graph-world").getAttribute("style");
    const fitScale = Number(fitStyle?.match(/scale\(([^)]+)\)/)?.[1]);
    assert(
      fitScale >= 0.35,
      `Management observations must not stretch history to 18%: ${fitScale}`,
    );
    console.log(
      `UX003 fit scale ${Math.round(fitScale * 100)}%; PM ${await page.locator(".agent-node.coordinator").count()}, analyst ${await page.locator(".agent-node.analyst").count()}, designer ${await page.locator(".agent-node.designer").count()}`,
    );
    await page.screenshot({
      path: "/tmp/dreamatic-frontend-ux003-resume-overview.png",
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "效果图 · 展开阶段历史", exact: true })
      .click();
    assert.equal(await page.locator(".graph-history").getAttribute("open"), "");
    assert(
      (await page.locator(".graph-history button").count()) > 0,
      "Artifact stage history remains accessible",
    );
    await page.locator(".graph-history button").first().click();
    await page.locator(".inspector").waitFor();
    await page.getByTitle("关闭详情").click();
    await page
      .getByRole("button", { name: "查看全部历史", exact: true })
      .click();
    await page
      .getByRole("button", { name: "展开管理与重试", exact: true })
      .click();
    assert.equal(await page.locator(".agent-node").count(), total);
    await page.screenshot({
      path: "/tmp/dreamatic-frontend-history-expanded.png",
      fullPage: true,
    });
    await page.getByRole("button", { name: "收拢历史", exact: true }).click();
    await page.getByTitle("重置画布").click();
    await page.screenshot({
      path: "/tmp/dreamatic-frontend-ux003-resume-readable.png",
      fullPage: true,
    });
    await page
      .getByRole("navigation", { name: "工作内容类别" })
      .getByRole("button", { name: "结构", exact: true })
      .click();
    await page.getByText(/^逐件尺寸与证据/).waitFor();
    await page
      .getByText("设计假设 / 估计预留，非来源 CAD", { exact: true })
      .waitFor();
    await page.screenshot({
      path: "/tmp/dreamatic-frontend-ux003-evidence.png",
      fullPage: true,
    });
    await page
      .getByText("设计假设 / 估计预留，非来源 CAD", { exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: "/tmp/dreamatic-frontend-history-oled.png",
      fullPage: true,
    });
    assert.equal(
      createHash("sha256")
        .update(await readFile(snapshotPath))
        .digest("hex"),
      digest,
      "Original project must remain unchanged",
    );
    console.log(
      `Real history snapshot: ${total} calls, ${compact} overview cards; full expansion and OLED assumption verified; original SHA256 ${digest} unchanged.`,
    );
  }
  assert.deepEqual(errors, []);
  console.log(
    "Workbench UI passed: authentication, cards, workflow, one-port fan-in, inspector, new invocation, 3D envelope, mobile layout, valid stage result after later failure.",
  );
} finally {
  await browser.close();
  await new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r())));
  library.close();
  await rm(directory, { recursive: true, force: true });
}

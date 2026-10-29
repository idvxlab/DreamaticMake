/** Isolated application-owned assembly report fixtures; never dispatch a model. */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { Workbench } from "../packages/workbench/runtime";
import { makeServer } from "../apps/workbench/server";
import type { Invocation, Packet } from "../packages/workbench/contracts";
const directory = await mkdtemp(join(tmpdir(), "dreamatic-assembly-ui-"));
const workbench = new Workbench(async () => {
  throw new Error("No model calls allowed");
}, directory);
const id = "11111111-1111-4111-8111-111111111111",
  revision = "a".repeat(64),
  sha = "b".repeat(64);
const url = `/workbench-api/assembly/${id}/base.stl?revision=${revision}&sha256=${sha}`;
const packet: Packet = {
  version: "dreamatic.workbench/1",
  id: "proof",
  invocationId: "assembly",
  inputs: [],
  summary: "fixture",
  evidence: "executed",
  execution: {
    tool: "build_printable_assembly",
    artifact: `assembly:${id}`,
    digest: revision,
  },
  data: {
    structure: [
      {
        id: `assembly:${id}`,
        kind: "assembly-model",
        label: "测试结构分件",
        references: [],
        properties: {
          version: "dreamatic.assembly-result/1",
          id,
          revision,
          geometryChecksPassed: false,
          sourceLayoutInvocationId: "layout-fixture",
          report: {
            gaps: ["闭合缺口fixture"],
            closure: { passed: false },
            parts: ["base", "lid"],
            checks: { closed: false },
          },
          assets: [
            { id: "base.stl", sha256: sha, bytes: 7, url },
            {
              id: "lid.stl",
              sha256: sha,
              bytes: 7,
              url: "https://untrusted.invalid/file.stl",
            },
          ],
        },
      },
    ],
    motion: [],
    circuit_energy: [],
    flow: [],
    logic: [],
  },
};
const failed: Invocation = {
  id: "failed-assembly",
  role: "mechanical",
  title: "装配执行失败报告",
  status: "error",
  inputs: [],
  error: "fixture几何检查有缺口",
  assemblyEvidence: [packet],
};
workbench.project = {
  version: "dreamatic.workbench/1",
  id: "isolated-assembly-ui",
  brief: "隔离分件报告预览",
  phase: "error",
  questions: [],
  answers: {},
  plan: [],
  nodes: [
    {
      id: "old",
      role: "mechanical",
      title: "历史提案",
      status: "done",
      inputs: [],
    },
    failed,
  ],
  createdAt: new Date().toISOString(),
};
const { server, token } = makeServer(workbench);
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
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${address.port}/workbench/#token=${token}`);
  await page.getByText("本地工作台已连接").waitFor();
  await page.getByLabel("预览调用结果").selectOption(failed.id);
  await page.getByRole("region", { name: "结构执行结果" }).waitFor();
  await page.getByText(/本次分件几何检查存在缺口/).waitFor();
  await page
    .getByText(/闭合缺口fixture/)
    .first()
    .waitFor();
  const links = page.locator(".assembly-downloads a");
  assert.equal(await links.count(), 1);
  assert.equal(await links.first().getAttribute("href"), url);
  await page.route("**/workbench-api/assembly/**", (route) =>
    route.fulfill({
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": "attachment; filename=base.stl",
      },
      body: "fixture",
    }),
  );
  const downloadEvent = page.waitForEvent("download");
  await links.first().click();
  assert.equal((await downloadEvent).suggestedFilename(), "base.stl");
  await page.getByTitle("查看调用详情").click();
  await page
    .getByLabel("执行证据范围")
    .getByText(/存在检查缺口/)
    .waitFor();
  await page.screenshot({
    path: "/tmp/dreamatic-frontend-assembly-failed.png",
    fullPage: true,
  });
  await page.getByTitle("关闭详情").click();
  packet.data.structure[0].properties.geometryChecksPassed = true;
  packet.data.structure[0].properties.report = {
    gaps: [],
    closure: { passed: true },
    checks: { closed: true },
  };
  await page.reload();
  await page.getByLabel("预览调用结果").selectOption(failed.id);
  await page.getByText("本次分件几何检查通过", { exact: true }).waitFor();
  await page.getByText(/实物打印、装配、公差与制造均未验证/).waitFor();
  await page.screenshot({
    path: "/tmp/dreamatic-frontend-assembly-passed.png",
    fullPage: true,
  });
  await page.getByLabel("预览调用结果").selectOption("old");
  assert.equal(await page.locator(".assembly-downloads a").count(), 0);
  assert.deepEqual(errors, []);
  console.log(
    "Assembly UI passed: failed invocation report selectable, safe download, inspector evidence, geometry success distinct from physical verification, legacy node unchanged. Fixture only; no CAD/model executed.",
  );
} finally {
  await browser.close();
  await new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r())));
  await rm(directory, { recursive: true, force: true });
}

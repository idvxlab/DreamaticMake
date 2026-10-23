import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, appendFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { once } from "node:events";
import { createServer } from "node:http";
import { createApp } from "../apps/server/src/index";
import { Settings } from "../packages/core/src/settings";
import { loadRole } from "../packages/agent-runtime/src/roles";

test("硬件、结构、CAD 和审阅角色可搜索、读资料及检查 STEP，不获得用户审批工具", async () => {
  for (const role of [
    "hardware-engineer",
    "mechanical-engineer",
    "cad-engineer",
    "reviewer",
  ]) {
    const definition = await loadRole(resolve("."), role);
    for (const tool of [
      "catalog_search",
      "local_library_read",
      "local_library_check",
    ])
      assert.ok(definition.allowed_tools.includes(tool));
    assert.ok(!definition.allowed_tools.includes("approve"));
  }
});

test(
  "真实 CAD 内核 + HTTP：官方搜索、文档、STEP 下载、包络不适配及证据版本",
  { skip: process.platform !== "darwin" || !existsSync(".venv/bin/python") },
  async () => {
    const folder = await mkdtemp(join(tmpdir(), "make-official-"));
    const python = resolve(".venv/bin/python");
    const source = join(folder, "source"),
      cube = join(folder, "cube.step"),
      config = join(folder, "config");
    await mkdir(config);
    execFileSync(python, [
      "-c",
      "from build123d import Box,export_step;import sys;export_step(Box(20,10,2),sys.argv[1])",
      cube,
    ]);
    execFileSync(python, [
      "-c",
      "import sys;from pathlib import Path;sys.path.insert(0,'workers/library');from test_official import fixture;from import_official import build;fixture(Path(sys.argv[1]),sys.argv[2]);build(Path(sys.argv[1]))",
      source,
      cube,
    ]);
    const settings = new Settings(config);
    await settings.save({ MAKE_LOCAL_LIBRARY: source, MAKE_PYTHON: python });
    const app = await createApp(join(folder, "workspace"), settings);
    app.server.listen(0, "127.0.0.1");
    await once(app.server, "listening");
    const base = `http://127.0.0.1:${(app.server.address() as any).port}`;
    try {
      const p = await app.store.create("温湿度仪", "官方硬件与空间检查");
      const first = await (
        await fetch(
          base + "/api/local-library?q=" + encodeURIComponent("温湿度"),
        )
      ).json();
      assert.equal(first.candidates[0].title, "Modulino Thermo");
      const cid = first.candidates[0].candidateId;
      const detail = await (
        await fetch(base + "/api/local-library?candidateId=" + cid)
      ).json();
      assert.equal(detail.record.geometryVerified, false);
      const mid = detail.record.models[0].assetId;
      const response = await fetch(
        base + `/api/local-library/asset?candidateId=${cid}&assetId=${mid}`,
      );
      assert.equal(response.status, 200);
      assert.match(await response.text(), /ISO-10303-21/);
      assert.equal(
        (
          await fetch(
            base +
              `/api/local-library/asset?candidateId=${cid}&assetId=${"f".repeat(64)}`,
          )
        ).status,
        404,
      );
      const url = base + `/api/projects/${p.id}/local-library/check`;
      const checked = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidateId: cid,
          modelId: mid,
          availableEnvelopeMm: [1, 1, 1],
        }),
      });
      const report = await checked.json();
      assert.equal(checked.status, 200, JSON.stringify(report));
      assert.ok(Math.abs(report.sizeMm.x - 20) < 0.001);
      assert.ok(Math.abs(report.sizeMm.y - 10) < 0.001);
      assert.ok(Math.abs(report.sizeMm.z - 2) < 0.001);
      assert.equal(report.checks.brepValid, true);
      assert.equal(report.checks.axisAlignedEnvelopeFit, false);
      assert.equal(report.geometryVerified, false);
      assert.equal(report.electricalCompatibilityVerified, false);
      const after = await app.store.get(p.id);
      assert.deepEqual(after.selectedParts, []);
      assert.deepEqual(after.approvals, []);
      assert.equal(after.stages.hardware.artifacts.length, 2);
      assert.deepEqual(after.parameters, p.parameters);
      const calls: string[] = [];
      const advertisedTools = new Set<string>();
      const toolReplies = new Map<string, string>();
      const modelServer = createServer(async (req, res) => {
        let input = "";
        for await (const chunk of req) input += chunk;
        const body = JSON.parse(input);
        const tools = body.tools.map((t: any) => t.function.name);
        for (const name of tools) advertisedTools.add(name);
        const messages = body.messages.filter((m: any) => m.role === "tool");
        for (const message of messages)
          toolReplies.set(
            message.tool_call_id,
            typeof message.content === "string"
              ? message.content
              : JSON.stringify(message.content),
          );
        let call: any;
        if (!messages.length) call = { name: "context_read", args: {} };
        else if (tools.includes("agent_dispatch") && messages.length === 1)
          call = {
            name: "agent_dispatch",
            args: { objective: "核对官方硬件与 STEP" },
          };
        else if (tools.includes("catalog_add")) {
          if (messages.length === 1)
            call = { name: "catalog_search", args: { query: "温湿度" } };
          if (messages.length === 2)
            call = { name: "local_library_read", args: { candidateId: cid } };
          if (messages.length === 3)
            call = {
              name: "local_library_check",
              args: { candidateId: cid, modelId: mid },
            };
          if (messages.length === 4)
            call = {
              name: "stage_submit",
              args: {
                title: "官方硬件检查",
                summary: "已读来源与模型；安装适配仍待核验。",
                facts: [],
                assumptions: [],
                blockers: ["安装孔与线缆未核验"],
                choices: [],
                partIds: [],
              },
            };
        } else if (tools.includes("review_submit") && messages.length === 1)
          call = {
            name: "review_submit",
            args: { verdict: "changes_requested", summary: "安装适配待核验" },
          };
        if (call) calls.push(call.name);
        const delta = call
          ? {
              role: "assistant",
              tool_calls: [
                {
                  index: 0,
                  id: "call-" + calls.length,
                  type: "function",
                  function: {
                    name: call.name,
                    arguments: JSON.stringify(call.args),
                  },
                },
              ],
            }
          : { role: "assistant", content: "完成" };
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        for (const [d, finish] of [
          [delta, null],
          [{}, call ? "tool_calls" : "stop"],
        ])
          res.write(
            `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 0, model: "fixture", choices: [{ index: 0, delta: d, finish_reason: finish }] })}\n\n`,
          );
        res.end("data: [DONE]\n\n");
      });
      modelServer.listen(0, "127.0.0.1");
      await once(modelServer, "listening");
      try {
        await settings.save({
          MAKE_API_KEY: "fixture-only",
          MAKE_MODEL: "fixture",
          MAKE_BASE_URL: `http://127.0.0.1:${(modelServer.address() as any).port}/v1`,
        });
        await app.store.update(p.id, (x) => {
          x.stages.requirements.status = "approved";
          x.stages.intent.status = "approved";
        });
        await app.runtime.run(p.id);
        for (let i = 0; i < 200 && (await app.store.get(p.id)).running; i++)
          await new Promise((r) => setTimeout(r, 100));
        for (const name of [
          "catalog_search",
          "local_library_read",
          "local_library_check",
        ]) {
          assert.ok(
            advertisedTools.has(name),
            "Runtime did not register " + name,
          );
          assert.ok(calls.includes(name), "SDK did not request " + name);
        }
        const ai = await app.store.get(p.id);
        assert.ok(
          ai.stages.hardware.artifacts.some((a) =>
            a.name.startsWith("source-local"),
          ),
        );
        const checkReply = toolReplies.get(
          "call-" + (calls.indexOf("local_library_check") + 1),
        );
        const sdkEvidence = ai.stages.hardware.artifacts.find(
          (a) =>
            a.name.startsWith("source-geometry") && a.id !== report.artifactId,
        );
        assert.ok(
          sdkEvidence,
          "SDK must produce its own STEP evidence: " + checkReply,
        );
        assert.ok(
          checkReply?.includes(sdkEvidence.id),
          "SDK must return its persisted evidence ID: " + checkReply,
        );
        const sdkReport = JSON.parse(
          await readFile(join(app.store.dir(p.id), sdkEvidence.path), "utf8"),
        );
        assert.equal(sdkReport.candidateId, cid);
        assert.equal(sdkReport.modelId, mid);
        assert.equal(sdkReport.sha256, report.sha256);
        assert.equal(sdkReport.checks.brepValid, true);
        assert.deepEqual(ai.approvals, []);
      } finally {
        await app.runtime.abort(p.id);
        modelServer.closeAllConnections();
        await new Promise<void>((r) => modelServer.close(() => r()));
      }
      const original = join(
        source,
        "official_catalog/runs/all/step_inventory/models/thermo.step",
      );
      await appendFile(original, "changed");
      assert.equal(
        (
          await fetch(
            base + `/api/local-library/asset?candidateId=${cid}&assetId=${mid}`,
          )
        ).status,
        409,
      );
      const evidence = after.stages.hardware.artifacts.find((a) =>
        a.name.startsWith("source-geometry"),
      )!;
      assert.equal(
        JSON.parse(
          await readFile(join(app.store.dir(p.id), evidence.path), "utf8"),
        ).sha256,
        report.sha256,
      );
      assert.equal(
        (
          await fetch(url, {
            method: "POST",
            headers: {
              Origin: "https://evil.example",
              "Content-Type": "application/json",
            },
            body: "{}",
          })
        ).status,
        403,
      );
    } finally {
      app.server.closeAllConnections();
      await new Promise<void>((r) => app.server.close(() => r()));
      await rm(folder, { recursive: true, force: true });
    }
  },
);

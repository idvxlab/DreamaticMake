import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Store } from "../packages/core/src/store";
import { Settings } from "../packages/core/src/settings";
import { Workflow } from "../packages/core/src/workflow";
import { Runtime } from "../packages/agent-runtime/src/runtime";
import { loadRole, roleIds } from "../packages/agent-runtime/src/roles";
test("Pi 1.3.0 SDK 实际工具调用：协调 → 作者 → 独立审阅 → 停在用户确认", async () => {
  const seen: string[][] = [];
  const prompts: string[] = [];
  const server = createServer(async (req, res) => {
    let text = "";
    for await (const chunk of req) text += chunk;
    const body = JSON.parse(text);
    prompts.push(
      JSON.stringify(body.messages.filter((m: any) => m.role === "system")),
    );
    const tools = (body.tools ?? []).map(
      (t: any) => t.function.name,
    ) as string[];
    seen.push(tools);
    const toolMessages = body.messages.filter(
      (m: any) => m.role === "tool",
    ).length;
    let call: undefined | { name: string; args: unknown };
    if (toolMessages === 0) call = { name: "context_read", args: {} };
    else if (toolMessages === 1) {
      if (tools.includes("agent_dispatch"))
        call = { name: "agent_dispatch", args: { objective: "澄清需求" } };
      else if (tools.includes("review_submit"))
        call = {
          name: "review_submit",
          args: {
            verdict: "pass",
            summary: "有明确供电、使用场景及验收目标。",
          },
        };
      else
        call = {
          name: "stage_submit",
          args: {
            title: "桌面终端需求",
            summary: "USB 供电；桌面使用。",
            facts: [{ label: "验收", value: "可打印和编译" }],
            assumptions: [],
            blockers: [],
            choices: [],
            partIds: [],
          },
        };
    }
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const chunk = (delta: any, finish_reason: any = null) =>
      res.write(
        "data: " +
          JSON.stringify({
            id: "fixture",
            object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1000),
            model: "fixture",
            choices: [{ index: 0, delta, finish_reason }],
          }) +
          "\n\n",
      );
    if (call) {
      chunk({
        role: "assistant",
        tool_calls: [
          {
            index: 0,
            id: "call_" + seen.length,
            type: "function",
            function: { name: call.name, arguments: JSON.stringify(call.args) },
          },
        ],
      });
      chunk({}, "tool_calls");
    } else {
      chunk({ role: "assistant", content: "本阶段已提交，请在预览中确认。" });
      chunk({}, "stop");
    }
    res.end("data: [DONE]\n\n");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const dir = await mkdtemp(join(tmpdir(), "make-runtime-"));
  const settings = new Settings(dir),
    store = new Store(join(dir, "data")),
    workflow = new Workflow(store, []);
  try {
    await settings.save({
      MAKE_API_KEY: "fixture-only",
      MAKE_MODEL: "fixture",
      MAKE_LANGUAGE: "en",
      MAKE_BASE_URL: `http://127.0.0.1:${(server.address() as any).port}/v1`,
    });
    const runtime = new Runtime(resolve("."), store, workflow, settings, {
      cad: async () => {
        throw new Error("unexpected");
      },
      firmware: async () => {
        throw new Error("unexpected");
      },
    });
    const p = await store.create("SDK 测试", "USB 桌面终端");
    await runtime.run(p.id);
    for (let i = 0; i < 200; i++) {
      if (!(await store.get(p.id)).running) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    const fresh = await store.get(p.id);
    assert.equal(
      fresh.stages.requirements.status,
      "awaiting_confirmation",
      fresh.stages.requirements.error,
    );
    assert.equal(fresh.stages.requirements.review?.verdict, "pass");
    const activities = (await store.history(p.id)).filter((e) =>
      e.type.startsWith("tool."),
    );
    assert(activities.length > 0);
    for (const event of activities) {
      const data = event.payload as { object: string; operationId: string };
      assert(data.object?.includes("SDK 测试"));
      assert(data.operationId);
    }
    const reads = activities.filter(
      (e) => (e.payload as any).name === "context_read",
    );
    assert(
      reads.every((e) => (e.payload as any).object.includes("project.json")),
    );
    for (const event of activities.filter((e) => e.type === "tool.started")) {
      const data = event.payload as any;
      const completion = activities.find(
        (e) =>
          e.type === "tool.completed" &&
          (e.payload as any).operationId === data.operationId,
      );
      assert(completion);
      assert.equal((completion.payload as any).object, data.object);
    }
    assert(prompts.length >= 3);
    assert(prompts.every((prompt) => prompt.includes("Reply in English.")));
    assert.equal(fresh.approvals.length, 0);
    assert.equal(fresh.stages.intent.status, "not_started");
    assert(seen.some((t) => t.includes("agent_dispatch")));
    assert(seen.some((t) => t.includes("stage_submit")));
    for (const tools of seen) {
      assert(!tools.includes("bash"));
      assert(!tools.includes("write"));
      assert(!tools.includes("approve"));
    }
    const roles = await Promise.all(
      roleIds.map((id) => loadRole(resolve("."), id)),
    );
    assert.equal(roles.length, 8);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
    await rm(dir, { recursive: true, force: true });
  }
});

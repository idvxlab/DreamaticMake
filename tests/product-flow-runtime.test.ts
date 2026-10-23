import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { inputHash } from "../packages/core/src/workflow";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Settings } from "../packages/core/src/settings";
import { createApp } from "../apps/server/src/index";
import {
  requirementDraft,
  functionDraft,
  hardwareDraft,
  productParts,
  routing,
} from "./fixtures/product-flow";

async function fixture(returnUpstream = false) {
  let count = 0,
    authorSubmitted = false,
    returned = false;
  const calls: string[] = [];
  const provider = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw),
      tools = body.tools.map((tool: any) => tool.function.name),
      messages = body.messages.filter(
        (message: any) => message.role === "tool",
      );
    let call: { name: string; args: unknown } | undefined;
    if (!messages.length) call = { name: "context_read", args: {} };
    else if (messages.length === 1) {
      if (tools.includes("agent_dispatch"))
        call = authorSubmitted
          ? { name: "workflow_route", args: routing }
          : {
              name: "agent_dispatch",
              args: { objective: returned ? "补充功能输入" : "按功能选择硬件" },
            };
      else if (tools.includes("review_submit"))
        call = {
          name: "review_submit",
          args: { verdict: "pass", summary: "真实功能与器件连接已覆盖。" },
        };
      else if (tools.includes("catalog_add")) {
        if (returnUpstream) {
          returned = true;
          call = {
            name: "workflow_request_upstream",
            args: {
              target: "intent",
              reason: "位移功能的输出频率未定义",
              needed: ["明确采样率或验收方式"],
            },
          };
        } else {
          authorSubmitted = true;
          call = { name: "stage_submit", args: hardwareDraft };
        }
      } else
        call = {
          name: "ask_user",
          args: {
            title: "需要明确功能输入",
            questions: [
              {
                id: "rate",
                label: "你希望如何检查位移响应？",
                options: ["按实际体验检查", "提供目标频率"],
                selection: "single",
                required: true,
              },
            ],
          },
        };
    }
    if (call) calls.push(call.name);
    const delta = call
      ? {
          role: "assistant",
          tool_calls: [
            {
              index: 0,
              id: `flow-${++count}`,
              type: "function",
              function: {
                name: call.name,
                arguments: JSON.stringify(call.args),
              },
            },
          ],
        }
      : { role: "assistant", content: "本轮处理完成。" };
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
  provider.listen(0, "127.0.0.1");
  await once(provider, "listening");
  const folder = await mkdtemp(join(tmpdir(), "make-flow-sdk-"));
  await mkdir(join(folder, "config"));
  const settings = new Settings(join(folder, "config"));
  await settings.save({
    MAKE_API_KEY: "fixture-only",
    MAKE_MODEL: "fixture",
    MAKE_BASE_URL: `http://127.0.0.1:${(provider.address() as any).port}/v1`,
    MAKE_LOCAL_LIBRARY: "",
  });
  const app = await createApp(join(folder, "workspace"), settings),
    p = await app.store.create("鼠标", "位移与按键");
  await app.store.saveCatalog(p.id, productParts);
  await app.store.update(p.id, (project) => {
    project.stages.requirements.status = "approved";
    project.stages.requirements.draft = structuredClone(requirementDraft);
    project.stages.intent.status = "approved";
    project.stages.intent.draft = structuredClone(functionDraft);
  });
  return {
    app,
    p,
    calls,
    async close() {
      await app.runtime.abort(p.id);
      provider.closeAllConnections();
      await new Promise<void>((r) => provider.close(() => r()));
      await rm(folder, { recursive: true, force: true });
    },
  };
}
async function wait(predicate: () => Promise<boolean>) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 30));
  }
  throw new Error("SDK flow timed out");
}

test("SDK 实际作者交接→管理者保存多对多连接→独立审阅，不代用户确认", async () => {
  const f = await fixture();
  try {
    await f.app.runtime.run(f.p.id);
    await wait(async () => !(await f.app.store.get(f.p.id)).running);
    const p = await f.app.store.get(f.p.id);
    assert.equal(
      p.stages.hardware.status,
      "awaiting_confirmation",
      JSON.stringify(p.stages.hardware.failureSummary),
    );
    assert.equal(p.productFlow?.routing?.links.length, 4);
    assert.ok(
      f.calls.indexOf("workflow_route") > f.calls.indexOf("stage_submit"),
    );
    assert.ok(
      f.calls.indexOf("review_submit") > f.calls.indexOf("workflow_route"),
    );
    assert.equal(p.approvals.length, 0);
    await f.app.workflow.approve(p.id, {
      stage: "hardware",
      revision: 1,
      inputHash: inputHash(p, "hardware"),
      decision: "approved",
      key: randomUUID(),
    });
    await assert.rejects(() => f.app.runtime.run(p.id), /待确认草案/);
  } finally {
    await f.close();
  }
});
test("SDK 上游补充真正中止当前链并重新调度意图节点，随后等待用户回答", async () => {
  const f = await fixture(true);
  try {
    await f.app.runtime.run(f.p.id);
    await wait(async () => {
      const p = await f.app.store.get(f.p.id);
      return (
        !p.running &&
        p.messages.some((m) => m.interaction && !m.interaction.answers)
      );
    });
    const p = await f.app.store.get(f.p.id);
    assert.equal(p.productFlow?.requests[0].target, "intent");
    assert.equal(p.productFlow?.requests[0].status, "open");
    assert.equal(p.stages.intent.revision, 2);
    assert.equal(p.stages.hardware.status, "not_started");
    assert.equal(p.stages.hardware.error, undefined);
    assert.ok(f.calls.includes("workflow_request_upstream"));
    assert.ok(f.calls.includes("ask_user"));
    assert.equal(p.approvals.length, 0);
  } finally {
    await f.close();
  }
});

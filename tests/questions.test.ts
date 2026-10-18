import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { Settings } from "../packages/core/src/settings";
import { createApp } from "../apps/server/src/index";

type Call = { name: string; args: unknown };
async function fixture(
  reply: (tools: string[], messages: any[]) => Call | "hold" | undefined,
) {
  let count = 0;
  const provider = createServer(async (req, res) => {
    let text = "";
    for await (const chunk of req) text += chunk;
    const body = JSON.parse(text);
    const call = reply(
      body.tools.map((tool: any) => tool.function.name),
      body.messages.filter((message: any) => message.role === "tool"),
    );
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    if (call === "hold") {
      res.flushHeaders();
      return;
    }
    const delta = call
      ? {
          role: "assistant",
          tool_calls: [
            {
              index: 0,
              id: `q${++count}`,
              type: "function",
              function: {
                name: call.name,
                arguments: JSON.stringify(call.args),
              },
            },
          ],
        }
      : { role: "assistant", content: "Done" };
    for (const [content, finish] of [
      [delta, null],
      [{}, call ? "tool_calls" : "stop"],
    ])
      res.write(
        `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 0, model: "fixture", choices: [{ index: 0, delta: content, finish_reason: finish }] })}\n\n`,
      );
    res.end("data: [DONE]\n\n");
  });
  provider.listen(0, "127.0.0.1");
  await once(provider, "listening");
  const dir = await mkdtemp(join(tmpdir(), "make-questions-"));
  const configRoot = join(dir, "config");
  await mkdir(configRoot);
  const settings = new Settings(configRoot);
  await settings.save({
    MAKE_API_KEY: "fixture-only",
    MAKE_MODEL: "fixture",
    MAKE_BASE_URL: `http://127.0.0.1:${(provider.address() as any).port}/v1`,
  });
  const app = await createApp(join(dir, "data"), settings);
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  const project = await app.store.create("需求问答", "便携小风扇");
  const url = `http://127.0.0.1:${(app.server.address() as any).port}/api/projects/${project.id}`;
  return {
    app,
    project,
    post: (path: string, data: unknown) =>
      fetch(url + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }),
    wait: async (predicate: () => Promise<boolean>) => {
      for (let i = 0; i < 200; i++) {
        if (await predicate()) return;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error("Timed out");
    },
    close: async () => {
      await app.runtime.abort(project.id);
      app.server.closeAllConnections();
      provider.closeAllConnections();
      await Promise.all([
        new Promise<void>((resolve) => app.server.close(() => resolve())),
        new Promise<void>((resolve) => provider.close(() => resolve())),
      ]);
      await rm(dir, { recursive: true, force: true });
    },
  };
}
const question = {
  title: "需求澄清",
  questions: [
    {
      id: "power",
      label: "供电方式？",
      options: ["USB", "电池"],
      selection: "single" as const,
      required: true,
    },
  ],
};

test("需求问题卡发布即停止整个 Pi 执行链，回答后能重新运行并审阅", async () => {
  let phase = 1,
    postQuestionRequests = 0;
  const f = await fixture((tools, messages) => {
    if (phase === 1 && messages.length > 1) postQuestionRequests++;
    if (!messages.length) return { name: "context_read", args: {} };
    if (messages.length > 1) return;
    if (tools.includes("agent_dispatch"))
      return { name: "agent_dispatch", args: { objective: "需求分析" } };
    if (tools.includes("review_submit"))
      return {
        name: "review_submit",
        args: { verdict: "pass", summary: "回答已纳入需求" },
      };
    return phase === 1
      ? { name: "ask_user", args: question }
      : {
          name: "stage_submit",
          args: {
            title: "需求",
            summary: "使用 USB 供电",
            facts: [{ label: "供电", value: "USB" }],
            blockers: [],
            choices: [],
            partIds: [],
          },
        };
  });
  try {
    assert.equal((await f.post("/run", {})).status, 202);
    await f.wait(async () => !(await f.app.store.get(f.project.id)).running);
    const paused = await f.app.store.get(f.project.id);
    const card = paused.messages.find(
      (message) => message.interaction,
    )?.interaction;
    assert(card);
    assert.equal(paused.stages.requirements.status, "not_started");
    assert.equal(paused.stages.requirements.error, undefined);
    assert.equal(paused.stages.requirements.failureSummary, undefined);
    assert.equal(
      postQuestionRequests,
      0,
      "publishing a question must not request more model text",
    );
    assert.equal((await f.post("/run", {})).status, 409);
    assert.equal(
      (
        await f.post("/answers", {
          interactionId: card.id,
          answers: { power: "USB" },
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await f.post("/answers", {
          interactionId: card.id,
          answers: { power: "USB" },
        })
      ).status,
      409,
    );
    phase = 2;
    assert.equal((await f.post("/run", {})).status, 202);
    await f.wait(async () => !(await f.app.store.get(f.project.id)).running);
    const completed = await f.app.store.get(f.project.id);
    assert.equal(
      completed.stages.requirements.status,
      "awaiting_confirmation",
      completed.stages.requirements.error,
    );
    assert.equal(completed.approvals.length, 0);
  } finally {
    await f.close();
  }
});

test("回答接口先校验问题与必填答案，再结束未收尾的模型流；正常等待不记作失败", async () => {
  let streaming = false;
  const f = await fixture(() => {
    streaming = true;
    return "hold";
  });
  try {
    await f.post("/run", {});
    await f.wait(async () => streaming);
    await f.app.workflow.ask(f.project.id, question);
    const card = (await f.app.store.get(f.project.id)).messages.find(
      (message) => message.interaction,
    )!.interaction!;
    assert.equal(
      (
        await f.post("/answers", {
          interactionId: randomUUID(),
          answers: { power: "USB" },
        })
      ).status,
      409,
    );
    assert.equal((await f.app.store.get(f.project.id)).running, true);
    assert.equal(
      (await f.post("/answers", { interactionId: card.id, answers: {} }))
        .status,
      400,
    );
    assert.equal((await f.app.store.get(f.project.id)).running, true);
    assert.equal(
      (
        await f.post("/answers", {
          interactionId: card.id,
          answers: { power: "电池" },
        })
      ).status,
      200,
    );
    const saved = await f.app.store.get(f.project.id);
    assert.equal(saved.running, false);
    assert.equal(saved.stages.requirements.status, "not_started");
    assert.equal(saved.stages.requirements.error, undefined);
    assert.deepEqual(
      saved.messages.find((message) => message.interaction)?.interaction
        ?.answers,
      { power: "电池" },
    );
  } finally {
    await f.close();
  }
});

test("意图阶段 ask_user 接受 selection multiple，无参数失败且立即进入等待回答", async () => {
  const f = await fixture((_tools, messages) =>
    !messages.length
      ? {
          name: "ask_user",
          args: {
            title: "学习模式",
            questions: [
              {
                id: "learning",
                label: "可并存的学习方式",
                options: ["课程", "任务", "探索"],
                selection: "multiple",
                required: true,
              },
            ],
          },
        }
      : undefined,
  );
  try {
    await f.app.store.update(f.project.id, (project) => {
      project.stages.requirements.status = "approved";
    });
    assert.equal((await f.post("/run", {})).status, 202);
    await f.wait(async () => !(await f.app.store.get(f.project.id)).running);
    const project = await f.app.store.get(f.project.id);
    const card = project.messages.find(
      (message) => message.interaction,
    )?.interaction;
    assert.equal(card?.questions[0].selection, "multiple");
    assert.equal(
      project.stages.intent.status,
      "not_started",
      project.stages.intent.error,
    );
    assert.equal(
      (await f.app.store.history(project.id)).filter(
        (event) => event.type === "tool.failed",
      ).length,
      0,
    );
    assert.equal(
      (
        await f.post("/answers", {
          interactionId: card!.id,
          answers: { learning: ["课程", "探索"] },
        })
      ).status,
      200,
    );
  } finally {
    await f.close();
  }
});

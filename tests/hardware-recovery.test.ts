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
import {
  stageSubmissionSchema,
  defaultEnclosure,
} from "../packages/core/src/contracts";
import { z } from "zod";

type Call = { name: string; args: unknown; streamSlowly?: boolean };
async function fixture(
  reply: (
    body: any,
    tools: string[],
    toolMessages: any[],
  ) => Call | "hold" | undefined,
  language = "zh",
  hardwareSourceGraceMs = 60000,
) {
  let sequence = 0;
  const server = createServer(async (req, res) => {
    let data = "";
    for await (const chunk of req) data += chunk;
    const body = JSON.parse(data);
    const tools = (body.tools ?? []).map((t: any) => t.function.name);
    const call = reply(
      body,
      tools,
      body.messages.filter((m: any) => m.role === "tool"),
    );
    if (call === "hold") {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.flushHeaders();
      return;
    }
    if (call?.streamSlowly) {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      const send = (delta: unknown, finish: string | null = null) =>
        res.write(
          `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 0, model: "fixture", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`,
        );
      send({
        role: "assistant",
        tool_calls: [
          {
            index: 0,
            id: `call_${++sequence}`,
            type: "function",
            function: { name: call.name, arguments: "" },
          },
        ],
      });
      const args = JSON.stringify(call.args);
      for (let i = 0; i < args.length; i += 20) {
        await new Promise((resolve) => setTimeout(resolve, 40));
        if (res.destroyed) return;
        send({
          tool_calls: [
            { index: 0, function: { arguments: args.slice(i, i + 20) } },
          ],
        });
      }
      send({}, "tool_calls");
      res.end("data: [DONE]\n\n");
      return;
    }
    const delta = call
      ? {
          role: "assistant",
          tool_calls: [
            {
              index: 0,
              id: `call_${++sequence}`,
              type: "function",
              function: {
                name: call.name,
                arguments: JSON.stringify(call.args),
              },
            },
          ],
        }
      : { role: "assistant", content: "已完成本轮。" };
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
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const dir = await mkdtemp(join(tmpdir(), "make-recovery-"));
  const settings = new Settings(dir),
    store = new Store(join(dir, "data")),
    workflow = new Workflow(store, []);
  await settings.save({
    MAKE_API_KEY: "fixture-only",
    MAKE_MODEL: "fixture",
    MAKE_LANGUAGE: language,
    MAKE_BASE_URL: `http://127.0.0.1:${(server.address() as any).port}/v1`,
  });
  const runtime = new Runtime(
    resolve("."),
    store,
    workflow,
    settings,
    {
      cad: async () => {
        throw new Error("unexpected");
      },
      firmware: async () => {
        throw new Error("unexpected");
      },
    },
    { hardwareSourceGraceMs },
  );
  const p = await store.create("硬件测试", "风扇硬件");
  await store.update(p.id, (project) => {
    project.stages.requirements.status = "approved";
    project.stages.intent.status = "approved";
  });
  return {
    store,
    runtime,
    p,
    run: async () => {
      await runtime.run(p.id);
      for (let i = 0; i < 200; i++) {
        if (!(await store.get(p.id)).running) return store.get(p.id);
        await new Promise((r) => setTimeout(r, 25));
      }
      throw new Error("fixture run did not complete");
    },
    close: async () => {
      await runtime.abort(p.id);
      server.closeAllConnections();
      await new Promise<void>((done) => server.close(() => done()));
      await rm(dir, { recursive: true, force: true });
    },
  };
}
const draft = {
  title: "硬件方案",
  summary: "器件待确认",
  facts: [],
  blockers: [],
  choices: [],
  partIds: [],
};

test("Pi 硬件会话缺少器件时发布问题卡，并提供可用抓取能力和受限提交字段", async () => {
  let exposed: any;
  const f = await fixture((body, tools, messages) => {
    if (!messages.length) return { name: "context_read", args: {} };
    if (tools.includes("agent_dispatch") && messages.length === 1)
      return { name: "agent_dispatch", args: { objective: "硬件选型" } };
    if (tools.includes("catalog_search")) {
      assert(tools.includes("ask_user"));
      assert(tools.includes("research_crawl"));
      const submit = body.tools.find(
        (t: any) => t.function.name === "stage_submit",
      );
      assert.equal(submit.function.parameters.properties.parameters, undefined);
      exposed = JSON.parse(messages[0].content);
      if (messages.length === 1)
        return { name: "catalog_search", args: { query: "motor battery" } };
      if (messages.length === 2) return { name: "stage_submit", args: draft };
    }
  });
  try {
    const p = await f.run();
    assert.equal(p.running, false);
    assert.equal(
      p.stages.hardware.status,
      "not_started",
      p.stages.hardware.error,
    );
    assert.equal(p.stages.hardware.draft, undefined);
    assert.equal(p.approvals.length, 0);
    const questionMessage = p.messages.find((m) => m.interaction);
    assert.equal(questionMessage?.agent, "hardware-engineer");
    const question = questionMessage?.interaction;
    assert.match(question!.questions[0].label, /motor battery/);
    assert.equal(
      exposed.research.seeds[0],
      "https://www.raspberrypi.com/products/",
    );
    assert.equal(exposed.submission.geometryAllowed, false);
  } finally {
    await f.close();
  }
});

test("Pi 重试继承上一轮工具失败摘要，不因清除 error 丢失诊断", async () => {
  let attempt = 1,
    previous: any;
  const f = await fixture((_body, tools, messages) => {
    if (!messages.length) return { name: "context_read", args: {} };
    if (tools.includes("agent_dispatch") && messages.length === 1)
      return { name: "agent_dispatch", args: { objective: "硬件选型" } };
    if (tools.includes("catalog_search")) {
      if (attempt === 1 && messages.length === 1)
        return {
          name: "stage_submit",
          args: { ...draft, parameters: defaultEnclosure },
        };
      if (attempt === 2) {
        previous = JSON.parse(messages[0].content).previousFailure;
        if (messages.length === 1)
          return {
            name: "ask_user",
            args: {
              title: "补充器件资料",
              questions: [
                {
                  id: "source",
                  label: "请提供器件官方链接",
                  options: [],
                  selection: "single" as const,
                  required: true,
                },
              ],
            },
          };
      }
    }
  });
  try {
    const failed = await f.run();
    assert.equal(failed.stages.hardware.status, "failed");
    assert(failed.stages.hardware.failureSummary);
    assert(
      failed.stages.hardware.failureSummary!.tools.some(
        (t) => t.name === "stage_submit" && /parameters/.test(t.error),
      ),
    );
    attempt = 2;
    const retried = await f.run();
    assert.equal(
      retried.stages.hardware.status,
      "not_started",
      retried.stages.hardware.error,
    );
    assert.equal(retried.stages.hardware.error, undefined);
    assert.equal(previous.stage, "hardware");
    assert(previous.tools.some((t: any) => /parameters/.test(t.error)));
  } finally {
    await f.close();
  }
});

test("工具 JSON Schema 与服务端阶段字段限制一致", () => {
  for (const stage of [
    "hardware",
    "requirements",
    "intent",
    "cad",
    "firmware",
    "delivery",
  ] as const) {
    const schema = stageSubmissionSchema(stage);
    const json = z.toJSONSchema(schema, { io: "input" });
    assert.equal(json.properties?.parameters, undefined);
    assert.equal(
      schema.safeParse({
        ...draft,
        choices: [
          {
            id: "a",
            label: "A",
            description: "候选",
            parameters: defaultEnclosure,
          },
        ],
      }).success,
      false,
    );
  }
  assert.equal(
    stageSubmissionSchema("structure").safeParse({
      ...draft,
      parameters: defaultEnclosure,
    }).success,
    true,
  );
});

test("英文模式下自动生成的硬件资料问题卡使用英文", async () => {
  const f = await fixture((_body, tools, messages) => {
    if (!messages.length) return { name: "context_read", args: {} };
    if (tools.includes("agent_dispatch") && messages.length === 1)
      return { name: "agent_dispatch", args: { objective: "Select hardware" } };
    if (tools.includes("catalog_search")) {
      if (messages.length === 1)
        return { name: "catalog_search", args: { query: "battery" } };
      if (messages.length === 2) return { name: "stage_submit", args: draft };
    }
  }, "en");
  try {
    const project = await f.run();
    assert.equal(
      project.stages.hardware.status,
      "not_started",
      project.stages.hardware.error,
    );
    const card = project.messages.find((m) => m.interaction)?.interaction;
    assert(card);
    assert.doesNotMatch(
      card.title + card.questions[0].label,
      /[\u3400-\u9fff]/,
    );
    assert.match(card.questions[0].label, /battery/);
  } finally {
    await f.close();
  }
});

test("无抓取证据的 catalog_add 转为问题卡，不把用户确认和估计尺寸录入目录", async () => {
  const f = await fixture((_body, tools, messages) => {
    if (!messages.length) return { name: "context_read", args: {} };
    if (tools.includes("agent_dispatch") && messages.length === 1)
      return { name: "agent_dispatch", args: { objective: "选型" } };
    if (tools.includes("catalog_add") && messages.length === 1)
      return {
        name: "catalog_add",
        args: {
          id: "aht20-module",
          name: "AHT20",
          manufacturer: "ASAIR",
          revision: "AHT20",
          source: "用户确认选型 — I2C",
          width: 15,
          depth: 12,
          height: 4,
          voltage: "3.3V",
          logic: "3.3V",
          interfaces: ["I2C"],
          notes: "尺寸为估计值",
        },
      };
  });
  try {
    const p = await f.run();
    assert.equal(
      p.stages.hardware.status,
      "not_started",
      p.stages.hardware.error,
    );
    assert.equal(p.stages.hardware.error, undefined);
    assert.equal((await f.store.projectCatalog(p.id)).length, 0);
    assert.match(
      p.messages.find((message) => message.interaction)?.interaction
        ?.questions[0].label ?? "",
      /AHT20/,
    );
    assert.equal(
      (await f.store.history(p.id)).filter(
        (event) => event.type === "tool.failed",
      ).length,
      0,
    );
  } finally {
    await f.close();
  }
});

test("空目录后模型长时间不取证，主动暂停发资料问题卡而非等整体超时", async () => {
  let result: any;
  const f = await fixture(
    (_body, tools, messages) => {
      if (!messages.length) return { name: "context_read", args: {} };
      if (tools.includes("agent_dispatch") && messages.length === 1)
        return { name: "agent_dispatch", args: { objective: "选型" } };
      if (tools.includes("catalog_search")) {
        if (messages.length === 1)
          return { name: "catalog_search", args: { query: "AHT20" } };
        result = JSON.parse(messages.at(-1).content);
        return "hold";
      }
    },
    "zh",
    150,
  );
  try {
    const project = await f.run();
    assert.equal(result.found, false);
    assert.match(result.nextAction, /research_fetch/);
    assert.equal(project.running, false);
    assert.equal(
      project.stages.hardware.status,
      "not_started",
      project.stages.hardware.error,
    );
    assert.equal(project.stages.hardware.error, undefined);
    assert(
      project.messages.some((message) =>
        message.interaction?.questions[0].label.includes("AHT20"),
      ),
    );
  } finally {
    await f.close();
  }
});

test("硬件读取上下文后模型不再输出工具，60 秒保护也会生效且不伪造资料问题", async () => {
  const f = await fixture(
    (_body, tools, messages) => {
      if (!messages.length) return { name: "context_read", args: {} };
      if (tools.includes("agent_dispatch") && messages.length === 1)
        return { name: "agent_dispatch", args: { objective: "选型" } };
      if (tools.includes("catalog_search")) return "hold";
    },
    "zh",
    150,
  );
  try {
    const project = await f.run();
    assert.equal(project.running, false);
    assert.equal(project.stages.hardware.status, "failed");
    assert.match(project.stages.hardware.error ?? "", /未返回有效操作/);
    assert.equal(
      project.messages.some((message) => message.interaction),
      false,
    );
    assert.equal((await f.store.projectCatalog(project.id)).length, 0);
  } finally {
    await f.close();
  }
});

test("用户已回答资料问题，缺口转成明确 blocker 而不是再次索要相同来源", async () => {
  const f = await fixture((_body, tools, messages) => {
    if (!messages.length) return { name: "context_read", args: {} };
    if (tools.includes("agent_dispatch") && messages.length === 1)
      return { name: "agent_dispatch", args: { objective: "选型" } };
    if (tools.includes("catalog_search")) {
      if (messages.length === 1)
        return { name: "catalog_search", args: { query: "battery" } };
      if (messages.length === 2) return { name: "stage_submit", args: draft };
    }
    if (tools.includes("review_submit") && messages.length === 1)
      return {
        name: "review_submit",
        args: {
          verdict: "changes_requested",
          summary: "来源仍待核验，已记录暂缓要求",
        },
      };
  });
  try {
    await f.store.update(f.p.id, (project) => {
      project.messages.push({
        id: "source-card",
        role: "assistant",
        text: "来源",
        createdAt: "",
        interaction: {
          id: "source-card",
          title: "来源",
          questions: [
            {
              id: "hardware_sources",
              label: "来源",
              options: [],
              required: true,
            },
          ],
          answers: { hardware_sources: "我也找不到，先忽略" },
        },
      });
    });
    const project = await f.run();
    assert.equal(
      project.messages.filter((message) => message.interaction).length,
      1,
    );
    assert.equal(
      project.stages.hardware.status,
      "awaiting_confirmation",
      project.stages.hardware.error,
    );
    assert.match(
      project.stages.hardware.draft?.blockers.join(" ") ?? "",
      /battery/,
    );
    assert.equal(project.stages.hardware.review?.verdict, "changes_requested");
  } finally {
    await f.close();
  }
});

test("硬件持续流式生成工具参数超过空闲时限时不被误中断", async () => {
  const f = await fixture(
    (_body, tools, messages) => {
      if (!messages.length) return { name: "context_read", args: {} };
      if (tools.includes("agent_dispatch") && messages.length === 1)
        return { name: "agent_dispatch", args: { objective: "核验硬件" } };
      if (tools.includes("catalog_search"))
        return {
          name: "ask_user",
          streamSlowly: true,
          args: {
            title: "需要具体器件信息",
            questions: [
              {
                id: "exact_model",
                label: "请确认实际使用的精确型号",
                selection: "single",
                options: ["Pico", "Pico W"],
                required: true,
              },
            ],
          },
        };
    },
    "zh",
    150,
  );
  try {
    const project = await f.run();
    assert.equal(project.running, false);
    assert.notEqual(project.stages.hardware.status, "failed");
    assert.equal(project.stages.hardware.error, undefined);
    assert(
      project.messages.some((message) =>
        message.interaction?.questions.some((q) => q.id === "exact_model"),
      ),
    );
  } finally {
    await f.close();
  }
});

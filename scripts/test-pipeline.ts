/** Real Pi sessions and real engineering workers; deterministic local LLM fixture. No external model is used. */
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { Store } from "../packages/core/src/store";
import { Settings } from "../packages/core/src/settings";
import {
  Workflow,
  inputHash,
  currentStage,
} from "../packages/core/src/workflow";
import {
  stages,
  stageLabels,
  defaultEnclosure,
  type StageId,
  type Part,
} from "../packages/core/src/contracts";
import { Runtime } from "../packages/agent-runtime/src/runtime";
import { Engineering } from "../apps/server/src/engineering";
import { firmwareSource } from "../packages/core/src/worker";
let stage: StageId = "requirements";
const parameters = {
  ...defaultEnclosure,
  ports: [{ face: "front" as const, x: 0, y: 12, width: 12, height: 7 }],
  components: [
    { partId: "rpi-pico", x: 0, y: 0, z: 7, width: 21, depth: 51, height: 5 },
  ],
};
const model = createServer(async (req, res) => {
  let raw = "";
  for await (const c of req) raw += c;
  const b = JSON.parse(raw),
    tools = (b.tools ?? []).map((t: any) => t.function.name),
    count = b.messages.filter((m: any) => m.role === "tool").length;
  let call: { name: string; args: unknown } | undefined;
  if (count === 0) call = { name: "context_read", args: {} };
  else if (count === 1 && tools.includes("agent_dispatch"))
    call = { name: "agent_dispatch", args: { objective: stage } };
  else if (count === 1 && tools.includes("review_submit"))
    call = {
      name: "review_submit",
      args: {
        verdict: "pass",
        summary: "测试审阅：检查版本、结构化输入和工程产物。",
      },
    };
  else if (count === 1 && stage === "cad")
    call = { name: "text_to_cad", args: { parameters } };
  else if (count === 1 && stage === "firmware")
    call = { name: "firmware_build", args: { source: firmwareSource } };
  else if (
    (count === 1 || (count === 2 && ["cad", "firmware"].includes(stage))) &&
    tools.includes("stage_submit")
  )
    call = {
      name: "stage_submit",
      args: {
        title: stageLabels[stage] + "集成验收",
        summary:
          "仅用于执行链验证的确定性测试内容，不代表外部模型设计质量或实物可制造性。",
        facts: [{ label: "来源", value: "集成测试夹具" }],
        assumptions: ["部件高度 5mm 为测试夹具值"],
        blockers: [],
        choices: [],
        partIds: stage === "hardware" ? ["rpi-pico"] : [],
        ...(["appearance", "structure"].includes(stage) ? { parameters } : {}),
      },
    };
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  const send = (delta: unknown, finish_reason: string | null = null) =>
    res.write(
      "data: " +
        JSON.stringify({
          id: "pipeline-fixture",
          object: "chat.completion.chunk",
          created: 1,
          model: "fixture",
          choices: [{ index: 0, delta, finish_reason }],
        }) +
        "\n\n",
    );
  if (call) {
    send({
      role: "assistant",
      tool_calls: [
        {
          index: 0,
          id: "call_" + randomUUID(),
          type: "function",
          function: { name: call.name, arguments: JSON.stringify(call.args) },
        },
      ],
    });
    send({}, "tool_calls");
  } else {
    send({ role: "assistant", content: "已提交当前阶段。" });
    send({}, "stop");
  }
  res.end("data: [DONE]\n\n");
});
model.listen(0, "127.0.0.1");
await once(model, "listening");
const temp = await mkdtemp(join(tmpdir(), "make-pipeline-"));
const store = new Store(join(temp, "data")),
  settings = new Settings(temp);
await settings.save({
  MAKE_API_KEY: "fixture",
  MAKE_MODEL: "fixture",
  MAKE_BASE_URL: `http://127.0.0.1:${(model.address() as any).port}/v1`,
  MAKE_WORKER_TIMEOUT: "600",
});
const catalog: Part[] = JSON.parse(
  await readFile("catalog/parts.json", "utf8"),
);
catalog[0].geometryVerified = true;
catalog[0].dimensions.height = 5;
const workflow = new Workflow(store, catalog),
  engineering = new Engineering(resolve("."), store, settings, catalog),
  runtime = new Runtime(resolve("."), store, workflow, settings, engineering);
const project = await store.create(
  "完整执行链验证",
  "USB 桌面终端；确定性模型夹具，真实 CAD 和固件工具。",
);
try {
  for (stage of stages) {
    await runtime.run(project.id);
    for (let i = 0; i < 12000; i++) {
      if (!(await store.get(project.id)).running) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    const p = await store.get(project.id),
      s = p.stages[stage];
    assert.equal(s.status, "awaiting_confirmation", s.error);
    assert.equal(currentStage(p), stage);
    assert.equal(p.approvals.length, stages.indexOf(stage));
    await workflow.approve(p.id, {
      stage,
      revision: s.revision,
      inputHash: inputHash(p, stage),
      decision: "approved",
      key: randomUUID(),
    });
    console.log("PASS", stageLabels[stage], s.artifacts.length + " artifacts");
  }
  const p = await store.get(project.id);
  assert.equal(p.approvals.length, 8);
  assert.equal(currentStage(p), undefined);
  await mkdir("workspace/validation", { recursive: true });
  await writeFile(
    "workspace/validation/pipeline-report.json",
    JSON.stringify(
      {
        ok: true,
        model: "deterministic-local-fixture",
        engineering: "real CAD and PlatformIO workers",
        physicalTested: false,
        stages: p.stages,
        approvals: p.approvals,
      },
      null,
      2,
    ),
  );
  console.log(
    "Pipeline PASS: 八阶段 + 八次独立审阅 + 用户确认门 + 真实 CAD/固件",
  );
} finally {
  model.closeAllConnections();
  await new Promise<void>((done) => model.close(() => done()));
  await rm(temp, { recursive: true, force: true });
}

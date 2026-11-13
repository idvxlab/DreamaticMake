import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentExecutor, AgentRunEvent, StageExecutionRequest } from "../packages/orchestrator/src/contracts";
import { ProjectStore } from "../packages/core/src/store";
import { ProjectPipeline } from "../packages/core/src/pipeline";
import { historicalGuideSource } from "../packages/core/src/procurement-guide";
import { workflowNodes } from "../apps/web/src/workflow-model";
import { DesignEngineBridge } from "../packages/design-engine/src/bridge";

class FakeExecutor implements AgentExecutor {
  requests: StageExecutionRequest[] = [];

  async *execute(request: StageExecutionRequest): AsyncIterable<AgentRunEvent> {
    this.requests.push(request);
    const question = request.agent === "coordinator" && !request.objective.includes('"answer":"USB-C"');
    const text = "# 需求\n明确目标与约束。" + (question ? '\n```design-questions\n[{"prompt":"采用哪种供电方式？","options":["USB-C","电池"]}]\n```' : "");
    yield { runId: request.runId, type: "started", at: new Date().toISOString(), payload: { agent: request.agent } };
    yield { runId: request.runId, type: "delta", at: new Date().toISOString(), payload: { delta: text } };
    yield { runId: request.runId, type: "completed", at: new Date().toISOString(), payload: { status: "completed" } };
  }
}

test("startup pauses an interrupted stage, closes orphaned calls and releases its attempt lock", async () => {
  const root = await mkdtemp(join(tmpdir(), "dreamatic-recovery-"));
  const store = new ProjectStore(root);
  const project = await store.create("Recovery", "Build a product");
  const completed = project.stages[0];
  completed.state = "completed";
  completed.revision = 1;
  completed.artifact = {
    markdown: "Saved requirements",
    pin: { artifact_id: "requirements", revision: 1, content_hash: "existing" },
    createdAt: project.createdAt,
  };
  project.activeStage = "appearance";
  project.stages[1].state = "running";
  project.events = [
    { runId: "old", type: "completed", stage: "requirements", at: project.createdAt, payload: {} },
    { runId: "turn", type: "started", stage: "appearance", at: project.createdAt, payload: { threadId: "author" } },
    { runId: "message", type: "message", at: project.createdAt, payload: { threadId: "other" } },
  ];
  await store.save(project);
  const dir = join(root, project.id, "contracts", "runs", "appearance-attempt");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "state.json"), JSON.stringify({ attempt_id: "attempt-1", state: "running" }));
  await writeFile(join(dir, "writer.lock"), "");
  const executor = new FakeExecutor();
  const pipeline = new ProjectPipeline(store, executor, () => {});
  await pipeline.recoverInterruptedRuns();
  await pipeline.recoverInterruptedRuns();
  const recovered = await store.get(project.id);
  assert.equal(recovered.activeStage, "appearance");
  assert.equal(recovered.stages[1].state, "paused");
  assert.equal(recovered.stages[1].pauseReason, "interrupted");
  assert.deepEqual(recovered.stages[0].artifact, completed.artifact);
  assert.deepEqual(recovered.events.filter(({ type }) => type === "stopped").map(({ runId }) => runId), ["turn", "message"]);
  assert.equal(JSON.parse(await readFile(join(dir, "state.json"), "utf8")).state, "cancelled");
  assert.equal(existsSync(join(dir, "writer.lock")), false);
  assert.equal(executor.requests.length, 0);
  await pipeline.runCurrent(project.id, { resume: true });
  assert.equal((await store.get(project.id)).stages[1].state, "completed");
  assert.deepEqual(executor.requests.map(({ stage }) => stage), ["appearance"]);
});

test("the stage pauses for actual design choices and applies the user's answers without review", async () => {
  const root = await mkdtemp(join(tmpdir(), "dreamatic-pipeline-"));
  const store = new ProjectStore(root);
  const project = await store.create("Test", "Build a product");
  const executor = new FakeExecutor();
  const pipeline = new ProjectPipeline(store, executor, () => {});
  await pipeline.runCurrent(project.id);
  let current = await store.get(project.id);
  const stage = current.stages.find((item) => item.id === "requirements")!;
  assert.equal(stage.state, "awaiting_details");
  assert.deepEqual(stage.questions, [{ prompt: "采用哪种供电方式？", options: ["USB-C", "电池"] }]);
  assert.equal(stage.artifact?.markdown, "# 需求\n明确目标与约束。");
  assert.equal(stage.revision, 1);
  assert.ok(current.events.every((event) => event.stage === "requirements"));
  await assert.rejects(() => pipeline.runCurrent(project.id), /not runnable/);
  assert.equal((await store.get(project.id)).stages[0].state, "awaiting_details");
  const submitted = await pipeline.confirmDetails(project.id, "requirements", 1, ["USB-C"]);
  assert.equal(submitted.stages[0].state, "ready");
  await pipeline.runCurrent(project.id);
  current = await store.get(project.id);
  assert.equal(current.activeStage, "appearance");
  assert.equal(current.stages[0].state, "completed");
  assert.deepEqual(current.stages[0].confirmedDetails, [{ question: "采用哪种供电方式？", answer: "USB-C" }]);
  assert.deepEqual(executor.requests.map(({ agent }) => agent), ["research", "coordinator", "coordinator"]);
  assert.match(executor.requests.at(-1)!.objective, /"answer":"USB-C"/);
});

test("invalid, stale, and duplicate submissions cannot change design answers", async () => {
  const root = await mkdtemp(join(tmpdir(), "dreamatic-pipeline-"));
  const store = new ProjectStore(root);
  const project = await store.create("Test", "Build a product");
  const pipeline = new ProjectPipeline(store, new FakeExecutor(), () => {});
  await pipeline.runCurrent(project.id);
  await assert.rejects(() => pipeline.confirmDetails(project.id, "requirements", 0, ["USB-C"]), /已更新/);
  await assert.rejects(() => pipeline.confirmDetails(project.id, "appearance", 1, ["USB-C"]), /已更新/);
  await assert.rejects(() => pipeline.confirmDetails(project.id, "requirements", 1, [" "]), /有效答案/);
  const results = await Promise.allSettled([pipeline.confirmDetails(project.id, "requirements", 1, ["USB-C"]), pipeline.confirmDetails(project.id, "requirements", 1, ["电池"])]);
  assert.deepEqual(results.map(({ status }) => status), ["fulfilled", "rejected"]);
  await assert.rejects(() => pipeline.confirmDetails(project.id, "requirements", 1, ["电池"]), /已更新/);
});

test("canvas shows stages when called, not when completing the prior stage", async () => {
  const root = await mkdtemp(join(tmpdir(), "dreamatic-canvas-"));
  const store = new ProjectStore(root);
  const project = await store.create("Test", "Build a product");
  const duringCall: string[][] = [];
  const pipeline = new ProjectPipeline(store, new FakeExecutor(), (snapshot, event) => {
    if (event.type === "started") duringCall.push(workflowNodes(snapshot).map((node) => node.id));
  });
  assert.deepEqual(workflowNodes(project), []);
  await pipeline.runCurrent(project.id);
  assert.deepEqual(duringCall[0], ["requirements"]);

  await pipeline.confirmDetails(project.id, "requirements", 1, ["USB-C"]);
  await pipeline.runCurrent(project.id);
  const advanced = await store.get(project.id);
  assert.equal(advanced.activeStage, "appearance");
  assert.deepEqual(workflowNodes(advanced).map((node) => node.id), ["requirements"]);

  duringCall.length = 0;
  await pipeline.runCurrent(project.id);
  assert.deepEqual(duringCall[0], ["requirements", "appearance"]);
});

test("preconfigured breakpoints pause before an agent call and resume once per stage", async () => {
  const store = new ProjectStore(await mkdtemp(join(tmpdir(), "dreamatic-breakpoints-")));
  const project = await store.create("Test", "Build a product", ["requirements", "appearance", "hardware_selection"]);
  const executor = new FakeExecutor();
  const pipeline = new ProjectPipeline(store, executor, () => {});
  await pipeline.runCurrent(project.id, { continueWorkflow: true });
  const atStart = await store.get(project.id);
  assert.equal(atStart.stages[0].pauseReason, "breakpoint");
  assert.deepEqual(workflowNodes(atStart), []);
  assert.equal(executor.requests.length, 0);

  await pipeline.runCurrent(project.id, { continueWorkflow: true, resume: true });
  assert.equal((await store.get(project.id)).stages[0].state, "awaiting_details");
  await pipeline.confirmDetails(project.id, "requirements", 1, ["USB-C"]);
  await pipeline.runCurrent(project.id, { continueWorkflow: true });
  const atAppearance = await store.get(project.id);
  assert.equal(atAppearance.activeStage, "appearance");
  assert.equal(atAppearance.stages[1].pauseReason, "breakpoint");
  assert.deepEqual(workflowNodes(atAppearance).map(({ id }) => id), ["requirements"]);
  assert.ok(!executor.requests.some(({ stage }) => stage === "appearance"));

  await pipeline.runCurrent(project.id, { continueWorkflow: true, resume: true });
  const atHardware = await store.get(project.id);
  assert.equal(atHardware.stages[1].state, "completed");
  assert.equal(atHardware.stages[2].pauseReason, "breakpoint");
});

test("stopping an active turn keeps the stage card and prevents the next stage from running", async () => {
  const store = new ProjectStore(await mkdtemp(join(tmpdir(), "dreamatic-stop-")));
  const project = await store.create("Test", "Build a product");
  const executor: AgentExecutor = {
    async *execute({ runId, agent }, signal) {
      const at = new Date().toISOString();
      yield { runId, type: "started", at, payload: { agent } };
      assert.equal(signal?.aborted, true);
      yield { runId, type: "stopped", at, payload: {} };
    },
  };
  const pipeline = new ProjectPipeline(store, executor, (_, event) => {
    if (event.type === "started") assert.equal(pipeline.stop(project.id), true);
  });
  await pipeline.runCurrent(project.id, { continueWorkflow: true });
  const stopped = await store.get(project.id);
  assert.equal(stopped.stages[0].state, "paused");
  assert.equal(stopped.stages[0].pauseReason, "stopped");
  assert.equal(stopped.stages[1].state, "pending");
  assert.equal(pipeline.isRunning(project.id), false);
  assert.deepEqual(workflowNodes(stopped).map(({ id }) => id), ["requirements"]);
});

test("deleting a project removes it from history and undo restores its saved state", async () => {
  const store = new ProjectStore(await mkdtemp(join(tmpdir(), "dreamatic-trash-")));
  const project = await store.create("Test", "Build a product", ["appearance"]);
  await store.moveToTrash(project.id);
  assert.deepEqual(await store.list(), []);
  await assert.rejects(() => store.get(project.id), { code: "ENOENT" });
  await store.restore(project.id);
  assert.deepEqual((await store.get(project.id)).breakpoints, ["appearance"]);
});

test("the production contract bridge retries malformed deliverables and passes normalized upstream data", async () => {
  const store = new ProjectStore(await mkdtemp(join(tmpdir(), "dreamatic-contracts-")));
  const project = await store.create("Test device", "Show a status light");
  const localPython = join(process.cwd(), ".runtime/python/bin/python");
  const python = process.env.MAKE_ENGINE_PYTHON || (existsSync(localPython) ? localPython : "python3");
  const bridge = new DesignEngineBridge(process.cwd(), python);
  let requirementsAttempts = 0;
  let appearanceContext: unknown;
  const executor: AgentExecutor = {
    async *execute(request) {
      let text = "Research memo";
      if (request.agent === "coordinator") {
        requirementsAttempts++;
        const documents = requirementsAttempts === 1 ? [] : [
          { document_id: "requirements", role: "requirements", title: "Scope", body: { text: "Show temperature" } },
          { document_id: "functions", role: "functions", title: "Functions", body: { text: "Measure and display" } },
        ];
        text = `# Requirements\n\n\`\`\`design-output\n${JSON.stringify({ kind: "requirements", documents })}\n\`\`\``;
      } else if (request.agent === "industrial-design") {
        appearanceContext = request.processRequest;
        text = `# Appearance\n\n\`\`\`design-output\n${JSON.stringify({ kind: "appearance", images: [{ image_id: "front", view: "front", asset: { artifact_id: "fixture_image", sha256: "0".repeat(64), media_type: "image/png" } }] })}\n\`\`\``;
      }
      const event = { runId: request.runId, at: new Date().toISOString() };
      yield { ...event, type: "started", payload: { agent: request.agent } };
      yield { ...event, type: "delta", payload: { delta: text } };
      yield { ...event, type: "completed", payload: { turn: { status: "completed", items: [{ type: "agentMessage", text }] } } };
    },
  };
  const pipeline = new ProjectPipeline(store, executor, () => {}, bridge);
  await pipeline.runCurrent(project.id);
  const requirements = (await store.get(project.id)).stages[0];
  assert.equal(requirementsAttempts, 2);
  assert.equal(requirements.state, "completed");
  assert.equal(requirements.artifact?.structured?.attemptId, "attempt-2");
  assert.equal(requirements.artifact?.structured?.deliverable.kind, "requirements");
  const path = join(store.root, project.id, "contracts", "runs", requirements.artifact!.structured!.taskId, "events.jsonl");
  const states = (await readFile(path, "utf8")).trim().split("\n").map((line) => JSON.parse(line).state);
  assert.deepEqual(states, ["running", "failed", "running", "validated"]);

  await pipeline.runCurrent(project.id);
  const appearance = (await store.get(project.id)).stages[1];
  assert.equal(appearance.state, "completed");
  assert.deepEqual(appearance.artifact?.structured?.upstream, { requirements: requirements.artifact!.pin });
  assert.deepEqual((appearanceContext as { upstream: unknown }).upstream, [{ stage: "requirements", pin: requirements.artifact!.pin, deliverable: requirements.artifact!.structured!.deliverable }]);

  const missing = await store.create("Missing input", "A project with an incomplete dependency");
  missing.activeStage = "appearance";
  await store.save(missing);
  await assert.rejects(() => pipeline.runCurrent(missing.id), /上游阶段缺少已完成的产物/);
  assert.equal((await store.get(missing.id)).stages[1].state, "pending");

  const contract = await bridge.materialize("hardware_selection", join(store.root, project.id));
  const library = JSON.parse(await readFile(join(store.root, project.id, contract.elementLibrary!.path), "utf8"));
  const [entry] = library.elements;
  const choice = { selection_record_id: "choice", element_ref: entry.element_ref, instances: ["one"] };
  const validated = await bridge.validateOutput("hardware_selection", { kind: "hardware_selection", choices: [choice] });
  assert.equal(validated.deliverable.kind, "hardware_selection");
  assert.equal(validated.mechanical_evidence?.[0].mechanical_evidence.kind, "step");
  assert.deepEqual(validated.mechanical_evidence?.[0].instances, ["one"]);
  const analog = library.elements.find((row: { model: string }) => row.model === "TMP36GT9Z / TO-92");
  assert.ok(analog);
  const sensor = await bridge.validateOutput("hardware_selection", { kind: "hardware_selection", choices: [{
    ...choice, element_ref: analog.element_ref, instances: ["temperature_sensor"],
  }] });
  assert.equal(sensor.mechanical_evidence?.[0].mechanical_evidence.kind, "drawing");
  assert.deepEqual(sensor.mechanical_evidence?.[0].sampling_to_define_in_firmware, ["temperature"]);
  await assert.rejects(() => bridge.validateOutput("hardware_selection", { kind: "hardware_selection", choices: [{
    ...choice, element_ref: { ...choice.element_ref, content_hash: "0".repeat(64) },
  }] }), /choices\[0\]\.element_ref/);
  await assert.rejects(() => bridge.validateOutput("hardware_selection", { kind: "hardware_selection", choices: [{
    ...choice, element_ref: { library_id: "templates", element_id: "example.temperature", revision: 1,
      content_hash: "cd436a03964b3f770e695974ff7100612d2229ecb2f626040ce21b893dbe7be3" },
  }] }), /小零件库中缺少可核验/);
});

test("missing hardware evidence is handed to the coordinator without starting downstream work", async () => {
  const store = new ProjectStore(await mkdtemp(join(tmpdir(), "dreamatic-hardware-blocker-")));
  const project = await store.create("Thermometer", "Measure and display temperature");
  project.activeStage = "hardware_selection";
  const requirements = project.stages[0];
  requirements.state = "completed";
  requirements.artifact = { markdown: "Measure and display", createdAt: project.createdAt,
    pin: { artifact_id: "requirements", revision: 1, content_hash: "0".repeat(64) } };
  await store.save(project);
  const localPython = join(process.cwd(), ".runtime/python/bin/python");
  const bridge = new DesignEngineBridge(process.cwd(), process.env.MAKE_ENGINE_PYTHON || (existsSync(localPython) ? localPython : "python3"));
  const calls: StageExecutionRequest[] = [];
  const executor: AgentExecutor = {
    async *execute(request) {
      calls.push(request);
      const text = request.agent === "embedded" ? '```hardware-blockers\n["温度传感器缺少 STEP 和二维尺寸图"]\n```' : "收到缺件报告";
      const event = { runId: request.runId, at: new Date().toISOString() };
      yield { ...event, type: "started", payload: { agent: request.agent, threadId: request.agent } };
      yield { ...event, type: "completed", payload: { turn: { items: [{ type: "agentMessage", text }] } } };
    },
  };
  const pipeline = new ProjectPipeline(store, executor, () => {}, bridge);
  await pipeline.runCurrent(project.id, { continueWorkflow: true });
  const saved = await store.get(project.id);
  const hardware = saved.stages.find(({ id }) => id === "hardware_selection")!;
  assert.equal(saved.activeStage, "hardware_selection");
  assert.equal(hardware.state, "blocked");
  assert.equal(hardware.artifact, undefined);
  assert.deepEqual(hardware.hardwareBlocker, { reason: "温度传感器缺少 STEP 和二维尺寸图", reportedToCoordinator: true, coordinatorThreadId: "coordinator" });
  assert.deepEqual(calls.map(({ stage, agent }) => [stage, agent]), [
    ["hardware_selection", "research"], ["hardware_selection", "embedded"], ["hardware_selection", "coordinator"],
  ]);
  assert.match(JSON.stringify(calls.at(-1)?.processRequest), /温度传感器缺少 STEP/);
  hardware.hardwareBlocker!.reason += "\n器件：USB-C 供电线；库中找不到匹配料号。";
  await store.save(saved);
  await pipeline.recoverInterruptedRuns();
  const pending = (await store.get(project.id)).stages.find(({ id }) => id === "hardware_selection")!;
  assert.equal(pending.state, "awaiting_details");
  assert.equal(pending.questions?.[0].options?.[0], "已有标准 USB-C 供电线");
  const confirmed = await pipeline.confirmDetails(project.id, pending.id, pending.revision, ["已有标准 USB-C 供电线"]);
  assert.equal(confirmed.stages.find(({ id }) => id === "hardware_selection")?.state, "ready");
});

test("hardware resumes with prior node feedback and hands off ordinary prototype wiring without a library part", async () => {
  const store = new ProjectStore(await mkdtemp(join(tmpdir(), "dreamatic-prototype-wiring-")));
  const project = await store.create("Thermometer", "Measure temperature");
  project.activeStage = "hardware_selection";
  const requirements = project.stages[0];
  requirements.state = "completed";
  requirements.artifact = { markdown: "Measure temperature", createdAt: project.createdAt,
    pin: { artifact_id: "requirements", revision: 1, content_hash: "0".repeat(64) } };
  const hardware = project.stages.find(({ id }) => id === "hardware_selection")!;
  hardware.state = "blocked";
  hardware.authorThreadId = "previous-author";
  hardware.hardwareBlocker = { reason: "杜邦线缺少 STEP", reportedToCoordinator: true };
  hardware.confirmedDetails = [{ question: "采样周期何时确定？", answer: "采样周期留到固件阶段" }];
  const feedback = "那就直接用杜邦线，你继续做";
  project.events.push({ runId: "previous-message", type: "message", stage: hardware.id, at: project.createdAt,
    payload: { threadId: "previous-author", message: feedback } });
  await store.save(project);

  const localPython = join(process.cwd(), ".runtime/python/bin/python");
  const bridge = new DesignEngineBridge(process.cwd(), process.env.MAKE_ENGINE_PYTHON || (existsSync(localPython) ? localPython : "python3"));
  const workspace = join(store.root, project.id);
  const contract = await bridge.materialize(hardware.id, workspace);
  const { elements } = JSON.parse(await readFile(join(workspace, contract.elementLibrary!.path), "utf8"));
  const sensor = elements.find((row: { model: string }) => row.model === "TMP36GT9Z / TO-92");
  const controller = elements.find((row: { model: string }) => /UNO R4 WiFi/i.test(row.model));
  assert.ok(sensor && controller);
  const wiring = [{ description: "2.54 mm 公对母杜邦线", quantity: 3,
    connections: ["5V → +VS", "A0 → VOUT", "GND → GND"],
    assembly_notes: { text: "线长和固定方式留到装配。", format: "markdown", attachments: [] } }];
  const executor: AgentExecutor = {
    async *execute(request) {
      assert.equal(request.agent, "embedded");
      let deliverable;
      if (request.stage === "hardware_selection") {
        assert.ok(request.objective.includes(feedback));
        deliverable = { kind: request.stage, prototype_wiring: wiring, choices: [
          { selection_record_id: "sensor", element_ref: sensor.element_ref, instances: ["sensor"] },
          { selection_record_id: "controller", element_ref: controller.element_ref, instances: ["controller"] },
        ] };
      } else {
        assert.equal(request.stage, "logical_layout");
        const { upstream } = request.processRequest as { upstream: { stage: string; deliverable?: { prototype_wiring?: unknown } }[] };
        assert.deepEqual(upstream.find(({ stage }) => stage === "hardware_selection")?.deliverable?.prototype_wiring, wiring);
        deliverable = { kind: request.stage };
      }
      const event = { runId: request.runId, at: new Date().toISOString() };
      yield { ...event, type: "started", payload: { threadId: request.runId } };
      const text = "原型连接\n```design-output\n" + JSON.stringify(deliverable) + "\n```";
      yield { ...event, type: "completed", payload: { turn: { items: [{ type: "agentMessage", text }] } } };
    },
  };
  const pipeline = new ProjectPipeline(store, executor, () => {}, bridge);
  await pipeline.runCurrent(project.id, { resume: true });
  const saved = await store.get(project.id);
  const completed = saved.stages.find(({ id }) => id === hardware.id)!;
  assert.equal(completed.state, "completed");
  assert.equal(completed.hardwareBlocker, undefined);
  assert.deepEqual(completed.authorFeedback?.map(({ message }) => message), [feedback]);
  assert.deepEqual(completed.artifact?.structured?.deliverable.prototype_wiring, wiring);
  assert.equal(completed.artifact?.structured?.mechanicalEvidence?.length, 2);
  saved.activeStage = "logical_layout";
  await store.save(saved);
  await pipeline.runCurrent(project.id);
  assert.equal((await store.get(project.id)).stages.find(({ id }) => id === "logical_layout")?.state, "completed");
});

test("requirements accept user specifications and recover pending library-only questions", async () => {
  const store = new ProjectStore(await mkdtemp(join(tmpdir(), "dreamatic-requirements-")));
  const project = await store.create("低温温度计", "做一个桌面温度计，−30～50 °C，整机误差 ±1 °C");
  const requirements = project.stages[0];
  requirements.state = "awaiting_details";
  requirements.revision = 2;
  requirements.confirmedDetails = [{ question: "使用环境？", answer: "室内" }];
  const legacy = { prompt: "确认测温范围", options: ["0～50 °C"], library: { scope: "temperature" } };
  requirements.questions = [legacy];
  await store.save(project);

  const localPython = join(process.cwd(), ".runtime/python/bin/python");
  const bridge = new DesignEngineBridge(process.cwd(), process.env.MAKE_ENGINE_PYTHON || (existsSync(localPython) ? localPython : "python3"));
  const calls: StageExecutionRequest[] = [];
  const executor: AgentExecutor = {
    async *execute(request) {
      calls.push(request);
      assert.equal(request.stage, "requirements");
      const context = request.processRequest as { brief: string; processContract: Record<string, unknown> };
      assert.equal("elementLibrary" in context.processContract, false);
      assert.equal("libraryCapabilities" in context, false);
      assert.match(context.brief, /−30～50 °C/);
      const text = '# 需求定义\n```design-questions\n[{"prompt":"需要显示湿度吗？","options":["只显示温度","显示温湿度"]}]\n```';
      yield { runId: request.runId, at: new Date().toISOString(), type: "completed",
        payload: { turn: { items: [{ type: "agentMessage", text }] } } };
    },
  };
  const pipeline = new ProjectPipeline(store, executor, () => {}, bridge);
  await pipeline.recoverInterruptedRuns();
  const recovered = (await store.get(project.id)).stages[0];
  assert.equal(recovered.state, "ready");
  assert.equal(recovered.questions, undefined);
  assert.deepEqual(recovered.confirmedDetails, requirements.confirmedDetails);
  assert.equal(calls.length, 0);

  await pipeline.runCurrent(project.id);
  const stage = (await store.get(project.id)).stages[0];
  assert.equal(stage.questions?.[0].prompt, "需要显示湿度吗？");
  const confirmed = await pipeline.confirmDetails(project.id, "requirements", stage.revision, ["显示温度和日期"]);
  assert.equal(confirmed.stages[0].state, "ready");
  assert.equal(confirmed.stages[0].confirmedDetails?.at(-1)?.answer, "显示温度和日期");
});

test("previously completed projects can generate a pinned guide without rerunning earlier stages", async () => {
  const store = new ProjectStore(await mkdtemp(join(tmpdir(), "dreamatic-guide-")));
  const project = await store.create("Test device", "Build a product");
  project.activeStage = "print_optimization";
  project.stages = project.stages.filter(({ id }) => id !== "procurement_assembly_guide");
  for (const stage of project.stages) {
    stage.state = "completed";
    stage.revision = 1;
    stage.artifact = {
      markdown: stage.id === "hardware_selection" ? "TMP117 and SSD1306 are candidates." : `Evidence for ${stage.id}`,
      createdAt: project.createdAt,
      pin: { artifact_id: stage.id, revision: 1, content_hash: "0".repeat(64) },
    };
  }
  await store.save(project);
  assert.equal((await store.get(project.id)).activeStage, "procurement_assembly_guide");
  const localPython = join(process.cwd(), ".runtime/python/bin/python");
  const bridge = new DesignEngineBridge(process.cwd(), process.env.MAKE_ENGINE_PYTHON || (existsSync(localPython) ? localPython : "python3"));
  const output = {
    kind: "procurement_assembly_guide",
    title: "Prototype guide",
    procurement: "Check the connector before ordering.",
    assembly: "Dry fit the cover.",
    verification: "Verify the final clearance.",
  };
  await assert.rejects(() => bridge.validateOutput("procurement_assembly_guide", { ...output, assembly: " " }), /assembly/);
  let calls = 0;
  const executor: AgentExecutor = {
    async *execute(request) {
      calls++;
      assert.equal(request.stage, "procurement_assembly_guide");
      assert.equal(request.agent, "coordinator");
      assert.ok(request.upstream.some((pin) => pin.artifact_id === "print_optimization"));
      const text = `\`\`\`design-output\n${JSON.stringify(output)}\n\`\`\``;
      const event = { runId: request.runId, at: new Date().toISOString() };
      yield { ...event, type: "started", payload: { agent: request.agent } };
      yield { ...event, type: "completed", payload: { turn: { items: [{ type: "agentMessage", text }] } } };
    },
  };
  const pipeline = new ProjectPipeline(store, executor, () => {}, bridge);
  await pipeline.runCurrent(project.id, { continueWorkflow: true });
  const saved = await store.get(project.id);
  const guide = saved.stages.at(-1)!;
  assert.equal(calls, 1);
  assert.equal(guide.state, "completed");
  assert.deepEqual(guide.artifact?.structured?.deliverable, output);
  assert.match(guide.artifact!.markdown, /采购清单\n\nCheck the connector/);
  assert.match(guide.artifact!.markdown, /TMP117AIDRVR.*候选.*DigiKey/);
  assert.doesNotMatch(guide.artifact!.markdown, /https?:\/\/[^\s>]*TMP117MAIDRVR/i);
  assert.match(guide.artifact!.markdown, /SSD1315.*备选.*Waveshare/);
  assert.match(guide.artifact!.markdown, /装配说明\n\nDry fit the cover/);
  assert.match(historicalGuideSource(saved, guide.artifact!), /TMP117/);
  const hardware = saved.stages.find(({ id }) => id === "hardware_selection")!.artifact!;
  assert.equal(historicalGuideSource({
    ...saved, stages: saved.stages.map((stage) => stage.id === "hardware_selection"
      ? { ...stage, artifact: { ...hardware, pin: { ...hardware.pin, revision: 2 } } } : stage),
  }, guide.artifact!), "");
  assert.equal(workflowNodes(saved).at(-1)?.title, "采购与装配说明");
  assert.deepEqual(saved.stages.slice(0, -1), project.stages);
});

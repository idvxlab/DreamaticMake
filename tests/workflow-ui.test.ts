import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { ProjectStore } from "../packages/core/src/store";
import { CodexServerExecutor } from "../packages/codex-server/src/executor";
import { runText, stageRuns } from "../apps/web/src/workflow-model";
import type { AgentRunEvent } from "../packages/orchestrator/src/contracts";
import { isSameOriginRequest } from "../apps/server/src/request-origin";
import { serveAppearancePreview } from "../apps/server/src/appearance-previews";
import { serveCadResults } from "../apps/server/src/cad-results";

test("the live appearance preview serves a finished image before the agent submits its artifact", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "dreamatic-appearance-"));
  const project = await new ProjectStore(workspace).create("Appearance", "Show the image before the turn finishes");
  const directory = join(workspace, project.id, "workspace", "appearance");
  await mkdir(directory, { recursive: true });
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/ahsAAAAASUVORK5CYII=", "base64");
  const path = `/api/projects/${project.id}/appearance-previews`;
  async function get(url: string) {
    let status: number | undefined;
    let body: Buffer | string | undefined;
    const response = {
      writeHead(code: number) { status = code; return this; },
      end(data?: Buffer | string) { body = data; },
    };
    assert.equal(await serveAppearancePreview(workspace, { method: "GET", url } as IncomingMessage, response as unknown as ServerResponse), true);
    return { status, body };
  }
  await writeFile(join(directory, "render.png"), png.subarray(0, -12));
  await writeFile(join(workspace, "outside.png"), png);
  await symlink(join(workspace, "outside.png"), join(directory, "external.png"));
  assert.deepEqual(await get(path), { status: 200, body: "[]" });

  await writeFile(join(directory, "render.png"), png);
  const result = await get(path);
  const [preview] = JSON.parse(String(result.body));
  assert.equal(preview.filename, "render.png");
  assert.deepEqual(await get(`${path}/${preview.id}`), { status: 200, body: png });
});

test("CAD previews wait for complete exports and respect the selected stage and artifact hash", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "dreamatic-cad-preview-"));
  const store = new ProjectStore(workspace);
  const project = await store.create("CAD", "Show stage results");
  const stage = project.stages.find(({ id }) => id === "spatial_layout")!;
  stage.state = "running";
  await store.save(project);
  const relativePath = "workspace/spatial_layout/scene.stl";
  const projectRoot = join(workspace, project.id);
  const folder = join(projectRoot, "workspace", "spatial_layout");
  await mkdir(folder, { recursive: true });
  const stl = Buffer.alloc(84 + 50);
  stl.writeUInt32LE(1, 80);
  stl.writeFloatLE(1, 108);
  const path = `/api/projects/${project.id}/cad/spatial_layout`;
  async function get(url: string) {
    const chunks: Buffer[] = [];
    const response = Object.assign(new PassThrough(), {
      status: 0,
      writeHead(code: number) { this.status = code; return this; },
    });
    response.on("data", (chunk) => chunks.push(chunk));
    assert.equal(await serveCadResults(store, { method: "GET", url } as IncomingMessage, response as unknown as ServerResponse), true);
    return { status: response.status, body: Buffer.concat(chunks) };
  }
  await writeFile(join(folder, "scene.stl"), stl.subarray(0, -1));
  await writeFile(join(workspace, "outside.stl"), stl);
  await symlink(join(workspace, "outside.stl"), join(folder, "outside.stl"));
  assert.deepEqual(JSON.parse((await get(path)).body.toString()), []);
  await writeFile(join(folder, "scene.stl"), stl);
  const [preview] = JSON.parse((await get(path)).body.toString());
  assert.equal(preview.filename, "scene.stl");
  assert.equal(preview.previewable, true);
  assert.deepEqual(await get(`${path}/${preview.id}`), { status: 200, body: stl });
  assert.equal((await get(`${path.replace("spatial_layout", "assembly_detail")}/${preview.id}`)).status, 404);

  stage.state = "completed";
  stage.artifact = {
    createdAt: project.createdAt,
    markdown: "Output",
    pin: { artifact_id: "layout", revision: 1, content_hash: "0".repeat(64) },
    structured: {
      schemaSha256: "", contextManifestId: "", taskId: "", attemptId: "", upstream: {},
      deliverable: { mesh: { relative_path: relativePath, sha256: createHash("sha256").update(stl).digest("hex") } },
    },
  };
  await store.save(project);
  await writeFile(join(folder, "draft.stl"), stl);
  let [pinned, unpinned] = JSON.parse((await get(path)).body.toString());
  assert.equal(pinned.filename, "scene.stl");
  assert.equal(unpinned, undefined);
  assert.equal((await get(`${path}/${pinned.id}`)).status, 200);
  stl.writeFloatLE(2, 108);
  await writeFile(join(folder, "scene.stl"), stl);
  [pinned] = JSON.parse((await get(path)).body.toString());
  assert.equal((await get(`${path}/${pinned.id}`)).status, 409);
});

test("project actions accept same-origin browser requests through a local proxy", () => {
  const backend = "http://127.0.0.1:4323";
  const browser = "http://127.0.0.1:4322";
  assert.equal(isSameOriginRequest({ "sec-fetch-site": "same-origin", origin: browser }, backend), true);
  assert.equal(isSameOriginRequest({ "sec-fetch-site": "same-origin" }, backend), true);
  assert.equal(isSameOriginRequest({ origin: backend }, backend), true);
  assert.equal(isSameOriginRequest({ referer: `${backend}/?project=example` }, backend), true);
  assert.equal(isSameOriginRequest({ "sec-fetch-site": "cross-site", origin: backend }, backend), false);
  assert.equal(isSameOriginRequest({ "sec-fetch-site": "same-site", origin: browser }, backend), false);
  assert.equal(isSameOriginRequest({ origin: "null", referer: `${backend}/` }, backend), false);
  assert.equal(isSameOriginRequest({ referer: "https://example.test/" }, backend), false);
  assert.equal(isSameOriginRequest({}, backend), false);
});

test("stream retention preserves conversation headers and complete replies", async () => {
  const store = new ProjectStore(await mkdtemp(join(tmpdir(), "dreamatic-ui-")));
  const project = await store.create("Test", "Test message routing");
  const started: AgentRunEvent = {
    runId: "author-run", type: "started", at: new Date().toISOString(),
    stage: "requirements", payload: { agent: "coordinator", threadId: "author-thread" },
  };
  project.events = [
    started,
    ...Array.from({ length: 700 }, (_, index): AgentRunEvent => ({
      runId: started.runId, stage: "requirements", type: "delta", at: started.at, payload: { delta: String(index) },
    })),
    { ...started, type: "completed", payload: { threadId: "author-thread", turn: { items: [{ type: "agentMessage", text: "Full reply" }] } } },
  ];
  await store.save(project);
  const restored = await store.get(project.id);
  assert.equal(restored.events.filter((event) => event.type === "delta").length, 500);
  assert.equal(restored.events[0].type, "started");
  const runs = stageRuns(restored, "requirements");
  assert.equal(runs.length, 1);
  assert.equal(runText(runs[0]), "Full reply");
  assert.deepEqual(stageRuns(restored, "appearance"), []);
});

test("legacy thread recovery matches the exact stage output without crossing projects or roles", async () => {
  const store = new ProjectStore(await mkdtemp(join(tmpdir(), "dreamatic-ui-")));
  const project = await store.create("Legacy", "Existing project");
  const review = "结论：退回\n" + "The exact independently reviewed requirements. ".repeat(3);
  const stage = project.stages[0];
  stage.review = { markdown: review, passed: false, createdAt: project.createdAt };
  project.events = [{
    runId: "legacy-review", type: "completed", at: project.updatedAt,
    payload: { threadId: "legacy-reviewer", turn: { items: [{ type: "agentMessage", text: review }] } },
  }];
  await store.save(project);
  const restored = await store.get(project.id);
  assert.equal(restored.stages[0].reviewerThreadId, "legacy-reviewer");
  assert.equal(restored.stages[0].authorThreadId, undefined);
  assert.equal(restored.stages[1].reviewerThreadId, undefined);
  assert.equal(stageRuns(restored, "requirements").length, 1);
  assert.equal(stageRuns(restored, "appearance").length, 0);
});

test("a follow-up resumes and streams only the selected stored thread", { timeout: 5000 }, async () => {
  const fakeServer = `
    import { createInterface } from "node:readline";
    const lines = createInterface({ input: process.stdin });
    let loaded;
    const send = (value) => process.stdout.write(JSON.stringify(value) + "\\n");
    const finish = () => process.stdout.write("", () => process.exit(0));
    lines.on("line", (line) => {
      const { id, method, params } = JSON.parse(line);
      if (method === "initialize") return send({ id, result: {} });
      if (method === "thread/resume") {
        loaded = params.threadId;
        return send({ id, result: { thread: { id: loaded } } });
      }
      if (method !== "turn/start") return;
      if (loaded !== "selected-review" || params.threadId !== loaded || params.input[0].text !== "follow-up") {
        send({ id, error: { message: "Wrong thread or message" } });
        return finish();
      }
      send({ id, result: { turn: { id: "turn" } } });
      send({ method: "item/agentMessage/delta", params: { threadId: "other-thread", delta: "wrong" } });
      send({ method: "item/agentMessage/delta", params: { threadId: loaded, delta: "right" } });
      send({ method: "turn/completed", params: { threadId: loaded, turn: { status: "completed" } } });
      finish();
    });
  `;
  const executor = new CodexServerExecutor({
    command: process.execPath, cwd: process.cwd(), args: ["--input-type=module", "-e", fakeServer],
  });
  const events: AgentRunEvent[] = [];
  for await (const event of executor.continueThread("selected-review", "follow-up", "run")) events.push(event);
  assert.deepEqual(events.map((event) => event.type), ["started", "delta", "completed"]);
  assert.equal(runText(events), "right");
});

test("the stop signal interrupts the exact thread and turn before the executor finishes", { timeout: 5000 }, async () => {
  const fakeServer = `
    import { createInterface } from "node:readline";
    const lines = createInterface({ input: process.stdin });
    const send = (value) => process.stdout.write(JSON.stringify(value) + "\\n");
    lines.on("line", (line) => {
      const { id, method, params } = JSON.parse(line);
      if (method === "initialize") return send({ id, result: {} });
      if (method === "thread/resume") return send({ id, result: { thread: { id: "selected" } } });
      if (method === "turn/start") {
        send({ id, result: { turn: { id: "active-turn" } } });
        send({ method: "item/agentMessage/delta", params: { threadId: "selected", turnId: "active-turn", delta: "working" } });
      }
      if (method === "turn/interrupt") {
        if (params.threadId !== "selected" || params.turnId !== "active-turn") {
          send({ id, error: { message: "Wrong turn" } });
        } else {
          send({ id, result: {} });
          send({ method: "turn/completed", params: { threadId: "selected", turn: { id: "active-turn", status: "interrupted" } } });
        }
        process.stdout.write("", () => process.exit(0));
      }
    });
  `;
  const executor = new CodexServerExecutor({ command: process.execPath, cwd: process.cwd(), args: ["--input-type=module", "-e", fakeServer] });
  const controller = new AbortController();
  const events: AgentRunEvent[] = [];
  for await (const event of executor.continueThread("selected", "follow-up", "run", controller.signal)) {
    events.push(event);
    if (event.type === "delta") controller.abort();
  }
  assert.deepEqual(events.map(({ type }) => type), ["started", "delta", "stopped"]);
});

test("a missing terminal notification is recovered from the inactive thread's exact turn", { timeout: 5000 }, async () => {
  const fakeServer = `
    import { createInterface } from "node:readline";
    const lines = createInterface({ input: process.stdin });
    const send = (value) => process.stdout.write(JSON.stringify(value) + "\\n");
    let reads = 0;
    lines.on("line", (line) => {
      const { id, method, params } = JSON.parse(line);
      if (method === "initialize") return send({ id, result: {} });
      if (method === "thread/resume") return send({ id, result: { thread: { id: params.threadId } } });
      if (method === "turn/start") return send({ id, result: { turn: { id: "current" } } });
      if (method === "thread/read") {
        reads++;
        return send({ id, result: { thread: { id: "selected", status: { type: reads === 1 ? "active" : "idle" } } } });
      }
      if (method === "thread/turns/list") {
        const status = reads === 1 ? "completed" : "interrupted";
        send({ id, result: { data: [{ id: "previous", status: "completed" }, { id: "current", status }] } });
        setTimeout(() => process.exit(0), 50);
      }
    });
  `;
  const executor = new CodexServerExecutor({ command: process.execPath, cwd: process.cwd(), args: ["--input-type=module", "-e", fakeServer], turnStatusPollMs: 20 });
  const events: AgentRunEvent[] = [];
  for await (const event of executor.continueThread("selected", "follow-up", "run")) events.push(event);
  assert.deepEqual(events.map(({ type }) => type), ["started", "stopped"]);
  assert.deepEqual(events.at(-1)?.payload, { threadId: "selected", turn: { id: "current", status: "interrupted" } });
});

test("a tool approval waits for the matching project's one-time decision", { timeout: 5000 }, async () => {
  const fakeServer = `
    import { createInterface } from "node:readline";
    const send = (value) => process.stdout.write(JSON.stringify(value) + "\\n");
    createInterface({ input: process.stdin }).on("line", (line) => {
      const { id, method, params, result } = JSON.parse(line);
      if (method === "initialize") return send({ id, result: {} });
      if (method === "thread/resume") return send({ id, result: { thread: { id: params.threadId } } });
      if (method === "turn/start") {
        send({ id, result: { turn: { id: "current" } } });
        return send({ id: "tool-request", method: "mcpServer/elicitation/request", params: {
          threadId: "selected", turnId: "current", serverName: "rhino", mode: "form",
          message: "Run Rhino script?", requestedSchema: { type: "object", properties: {} },
        } });
      }
      if (id === "tool-request") {
        const status = result?.action === "accept" && result.content ? "completed" : "failed";
        send({ method: "turn/completed", params: { threadId: "selected", turn: { id: "current", status } } });
        process.stdout.write("", () => process.exit(0));
      }
    });
  `;
  let approvalChanged!: () => void;
  const approvalReceived = new Promise<void>((resolve) => { approvalChanged = resolve; });
  const executor = new CodexServerExecutor({
    command: process.execPath, cwd: process.cwd(), args: ["--input-type=module", "-e", fakeServer],
    onToolApprovalsChanged: approvalChanged,
  });
  const events: AgentRunEvent[] = [];
  const run = (async () => {
    for await (const event of executor.continueThread("selected", "follow-up", "run", undefined, "project")) events.push(event);
  })();
  await approvalReceived;
  const [approval] = executor.pendingToolApprovals("project");
  assert.equal(approval.message, "Run Rhino script?");
  assert.deepEqual(executor.pendingToolApprovals("another-project"), []);
  assert.equal(executor.decideToolApproval("another-project", approval.token, "accept"), false);
  assert.deepEqual(events.map(({ type }) => type), ["started"]);
  assert.equal(executor.decideToolApproval("project", approval.token, "accept"), true);
  assert.equal(executor.decideToolApproval("project", approval.token, "accept"), false);
  await run;
  assert.deepEqual(events.map(({ type }) => type), ["started", "completed"]);
  assert.deepEqual(executor.pendingToolApprovals("project"), []);
});

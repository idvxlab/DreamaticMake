import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  channels,
  packetSchema,
  decisionSchema,
  VERSION,
  validateAnswers,
} from "../packages/workbench/contracts";
import { Workbench, type Caller } from "../packages/workbench/runtime";
import { makeServer } from "../apps/workbench/server";
const data = () => ({
  structure: [],
  motion: [],
  circuit_energy: [],
  flow: [],
  logic: [],
});
const questions = [
  { id: "use", title: "用途", options: ["办公", "游戏"] },
  { id: "power", title: "供电", options: ["有线", "无线"] },
];
import { fixtureCaller as fake } from "./workbench-fixtures";
test("protocol requires all five categories and execution evidence", () => {
  const packet = {
    version: VERSION,
    id: "packet",
    invocationId: "node",
    inputs: [],
    summary: "proposal",
    evidence: "proposal",
    data: data(),
  };
  assert.equal(packetSchema.safeParse(packet).success, true);
  assert.equal(
    packetSchema.safeParse({ ...packet, evidence: "executed" }).success,
    false,
  );
  assert.equal(
    packetSchema.safeParse({ ...packet, data: { structure: [] } }).success,
    false,
  );
});
test("manager decisions contain only the next batch, never recursive calls or future references", () => {
  const task = {
    key: "analysis",
    role: "analyst",
    title: "分析",
    instruction: "分析用户需求",
    dependsOn: [],
  };
  assert.equal(
    decisionSchema.safeParse({
      action: "dispatch",
      reason: "先澄清需求",
      tasks: [task],
    }).success,
    true,
  );
  assert.equal(
    decisionSchema.safeParse({
      action: "dispatch",
      reason: "空调用",
      tasks: [],
    }).success,
    false,
  );
  assert.equal(
    decisionSchema.safeParse({
      action: "finish",
      reason: "错误结束",
      tasks: [task],
    }).success,
    false,
  );
  assert.equal(
    decisionSchema.safeParse({
      action: "dispatch",
      reason: "递归",
      tasks: [{ ...task, role: "coordinator" }],
    }).success,
    false,
  );
  assert.equal(
    decisionSchema.safeParse({
      action: "dispatch",
      reason: "重复",
      tasks: [task, task],
    }).success,
    false,
  );
});
test("all question selections must be valid, without additional invented answers", () => {
  assert.equal(
    validateAnswers(questions, { use: "办公", power: "无线" }),
    true,
  );
  assert.equal(validateAnswers(questions, { use: "办公" }), false);
  assert.equal(
    validateAnswers(questions, { use: "anything", power: "无线" }),
    false,
  );
  assert.equal(
    validateAnswers(questions, { use: "办公", power: "无线", approval: "yes" }),
    false,
  );
});
test("full workflow has independent invocations, bounded parallelism, persisted packets and non-blocking review advice", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dreamatic-workbench-"));
  let concurrent = 0,
    maxConcurrent = 0;
  const caller: Caller = async (role, input) => {
    concurrent++;
    maxConcurrent = Math.max(maxConcurrent, concurrent);
    await new Promise((r) => setTimeout(r, 5));
    concurrent--;
    assert(
      input.packets.some((p) =>
        p.data.logic.some((i) => i.id === "user-brief"),
      ),
    );
    return fake(role, input);
  };
  try {
    const w = new Workbench(caller, dir, { visualContract: "legacy" });
    await w.start("一个鼠标");
    assert.equal(w.project?.phase, "choices");
    await assert.rejects(() => w.answer({ use: "办公" }));
    await w.answer(
      Object.fromEntries(w.project!.questions.map((q) => [q.id, q.options[0]])),
    );
    assert.equal(w.project?.phase, "complete");
    assert.equal(w.project?.nodes.length, 14);
    assert.equal(w.project?.nodes[0].role, "coordinator");
    assert.equal(
      w.project?.nodes.filter((n) => n.role === "coordinator").length,
      6,
    );
    assert.equal(
      w.project?.nodes.filter((n) => n.role === "embedded").length,
      2,
    );
    assert.equal(new Set(w.project?.nodes.map((n) => n.id)).size, 14);
    assert(maxConcurrent > 1 && maxConcurrent <= 3);
    w.project?.nodes.forEach((n) => {
      assert.equal(n.status, "done");
      assert.deepEqual(Object.keys(n.packet!.data), [...channels]);
      assert.equal(n.packet!.evidence, "proposal");
    });
    const restored = new Workbench(fake, dir, { visualContract: "legacy" });
    await restored.restore();
    assert.equal(restored.project?.id, w.project?.id);
    await restored.request("再次独立审查", [
      restored.project!.nodes.at(-1)!.id,
    ]);
    assert.equal(restored.project!.nodes.length, 17);
    assert.equal(restored.project!.nodes.at(-3)!.role, "coordinator");
    assert.equal(restored.project!.nodes.at(-2)!.role, "reviewer");
    assert.equal(restored.project!.nodes.at(-1)!.role, "coordinator");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("invalid output and overlapping runs never become success", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dreamatic-workbench-"));
  let release!: () => void;
  let calls = 0;
  const w = new Workbench(async () => {
    if (calls++ === 0) await new Promise<void>((r) => (release = r));
    return { summary: "bad", data: {} };
  }, dir);
  try {
    const job = w.start("test");
    await new Promise((r) => setTimeout(r, 20));
    await assert.rejects(() => w.start("other"), /正在运行/);
    release();
    await assert.rejects(() => job);
    assert.equal(w.project?.phase, "error");
    assert.equal(w.project?.nodes[0].status, "error");
    assert.equal(w.project?.nodes[0].packet, undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("application route requires session, same origin and explicit JSON client header", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dreamatic-workbench-"));
  const { server } = makeServer(
    new Workbench(fake, dir, { visualContract: "legacy" }),
    "test-token",
  );
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const address = server.address();
  assert(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}`;
  try {
    assert.equal((await fetch(base + "/workbench-api/project")).status, 401);
    const headers = { "Content-Type": "application/json", "X-Workbench": "1" };
    assert.equal(
      (
        await fetch(base + "/workbench-api/session", {
          method: "POST",
          headers: { ...headers, Origin: "https://evil.example" },
          body: JSON.stringify({ token: "test-token" }),
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(base + "/workbench-api/session", {
          method: "POST",
          headers,
          body: JSON.stringify({ token: "wrong" }),
        })
      ).status,
      401,
    );
    const auth = await fetch(base + "/workbench-api/session", {
      method: "POST",
      headers,
      body: JSON.stringify({ token: "test-token" }),
    });
    assert.equal(auth.status, 200);
    const cookie = auth.headers.get("set-cookie")!.split(";")[0];
    assert.equal(
      (
        await fetch(base + "/workbench-api/project", {
          headers: { Cookie: cookie },
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await fetch(base + "/workbench-api/answers", {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: cookie },
          body: "{}",
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(base + "/workbench-api/start", {
          method: "POST",
          headers: { ...headers, Cookie: cookie },
          body: JSON.stringify({ brief: "" }),
        })
      ).status,
      400,
    );
  } finally {
    await new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r())));
    await rm(dir, { recursive: true, force: true });
  }
});

test("specialist failures are returned to the manager for a fresh decision and rework", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dreamatic-replan-"));
  let failed = false,
    sawFailure = false;
  const caller: Caller = async (role, input) => {
    if (role === "embedded" && input.instruction === "power" && !failed) {
      failed = true;
      throw new Error("test power failure");
    }
    if (
      role === "coordinator" &&
      input.state?.invocations.some((n) => n.status === "error")
    ) {
      sawFailure = true;
      if (
        !input.state.invocations.some(
          (n) => n.title === "返工供电" && n.status === "done",
        )
      )
        return {
          summary: "观察到了失败，重新委派",
          data: data(),
          decision: {
            action: "dispatch",
            reason: "原供电调用失败，需要独立重试",
            tasks: [
              {
                key: "rework",
                role: "embedded",
                title: "返工供电",
                instruction: "power-rework",
                dependsOn: [],
              },
            ],
          },
        };
    }
    return fake(role, input);
  };
  try {
    const w = new Workbench(caller, dir, { visualContract: "legacy" });
    await w.start("鼠标");
    await w.answer(
      Object.fromEntries(w.project!.questions.map((q) => [q.id, q.options[0]])),
    );
    assert(sawFailure);
    assert.equal(w.project!.phase, "complete");
    assert(
      w.project!.nodes.some(
        (n) => n.title === "返工供电" && n.status === "done",
      ),
    );
    assert.equal(
      w.project!.nodes.filter((n) => n.role === "embedded").length,
      3,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("manager may stop at a real capability gap instead of claiming a finished product", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dreamatic-blocked-"));
  const caller: Caller = async (role, input) =>
    role === "coordinator" &&
    input.state?.invocations.some(
      (n) => n.role === "analyst" && n.status === "done",
    )
      ? {
          summary: "缺少真实生图能力",
          data: data(),
          decision: {
            action: "blocked",
            reason: "未连接图像执行工具，需要接入后再继续",
            tasks: [],
          },
        }
      : fake(role, input);
  try {
    const w = new Workbench(caller, dir, { visualContract: "legacy" });
    await w.start("鼠标");
    await w.answer(
      Object.fromEntries(w.project!.questions.map((q) => [q.id, q.options[0]])),
    );
    assert.equal(w.project!.phase, "blocked");
    assert.match(w.project!.error!, /未连接图像/);
    assert.equal(w.project!.nodes.at(-1)!.role, "coordinator");
    assert.equal(w.project!.nodes.at(-1)!.decision!.action, "blocked");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a manager cannot start structural work before hardware and appearance results exist", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dreamatic-deps-"));
  const caller: Caller = async (role, input) =>
    role === "coordinator" &&
    input.state?.invocations.some(
      (n) => n.role === "analyst" && n.status === "done",
    )
      ? {
          summary: "invalid dispatch",
          data: data(),
          decision: {
            action: "dispatch",
            reason: "非法依赖",
            tasks: [
              {
                key: "bad-cad",
                role: "mechanical",
                title: "过早结构设计",
                instruction: "cad",
                dependsOn: [],
              },
            ],
          },
        }
      : fake(role, input);
  try {
    const w = new Workbench(caller, dir, { visualContract: "legacy" });
    await w.start("鼠标");
    await w.answer(
      Object.fromEntries(w.project!.questions.map((q) => [q.id, q.options[0]])),
    );
    assert.equal(w.project!.phase, "blocked");
    assert.match(w.project!.error!, /缺少必要前置结果/);
    assert(!w.project!.nodes.some((n) => n.role === "mechanical"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("invalid manager JSON/schema gets a bounded independent correction call without losing confirmed inputs", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dreamatic-json-correction-"));
  let invalid = true;
  const caller: Caller = async (role, input) => {
    if (role === "coordinator" && invalid) {
      invalid = false;
      return {
        summary: "bad schema",
        data: { ...data(), process: [] },
        decision: {
          action: "invalid-dispatch",
          reason: "clarify",
          tasks: [
            {
              key: "clarify",
              role: "analyst",
              title: "需求澄清",
              instruction: "clarify",
              dependsOn: [],
            },
          ],
        },
      };
    }
    return fake(role, input);
  };
  try {
    const w = new Workbench(caller, dir, { visualContract: "legacy" });
    await w.start("办公无线鼠标");
    assert.equal(w.project!.phase, "choices");
    assert.equal(w.project!.nodes[0].status, "error");
    assert.equal(w.project!.nodes[1].role, "coordinator");
    assert.equal(w.project!.nodes[1].status, "done");
    assert.equal(w.project!.nodes[2].role, "analyst");
    assert.equal(w.project!.brief, "办公无线鼠标");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("manager sees missing prerequisites and repairs the plan before structural dispatch", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dreamatic-dependency-correction-"));
  let invalid = true;
  let sawReadiness = false;
  const caller: Caller = async (role, input) => {
    if (
      role === "coordinator" &&
      input.state?.stageReadiness?.gaps.some((g) => g.includes("必要前置"))
    )
      sawReadiness = true;
    if (
      role === "coordinator" &&
      invalid &&
      input.state?.invocations.some(
        (n) => n.role === "analyst" && n.status === "done",
      )
    ) {
      invalid = false;
      return {
        summary: "premature cad",
        data: data(),
        decision: {
          action: "dispatch",
          reason: "wrongly use research as design",
          tasks: [
            {
              key: "premature",
              role: "mechanical",
              title: "错误的过早结构任务",
              instruction: "cad",
              dependsOn: input.state.invocations
                .filter((n) => n.role === "analyst" && n.status === "done")
                .map((n) => n.id),
            },
          ],
        },
      };
    }
    return fake(role, input);
  };
  try {
    const w = new Workbench(caller, dir, { visualContract: "legacy" });
    await w.start("办公无线鼠标");
    await w.answer(
      Object.fromEntries(w.project!.questions.map((q) => [q.id, q.options[0]])),
    );
    assert.equal(w.project!.phase, "complete");
    assert(sawReadiness);
    const nodes = w.project!.nodes;
    assert(!nodes.some((n) => n.title === "错误的过早结构任务"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("manager packets are built from validated decisions, never from model-invented engineering channels", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dreamatic-manager-packet-"));
  const caller: Caller = async (role, input) => {
    const result = await fake(role, input);
    return role === "coordinator"
      ? {
          ...(result as object),
          data: {
            process: ["untrusted"],
            references: ["nonexistent"],
            structure: [{ id: "invented-geometry" }],
          },
        }
      : result;
  };
  try {
    const w = new Workbench(caller, dir, { visualContract: "legacy" });
    await w.start("办公无线鼠标");
    assert.equal(w.project!.phase, "choices");
    const packet = w.project!.nodes[0].packet!;
    assert.deepEqual(Object.keys(packet.data), [...channels]);
    assert.equal(packet.data.structure.length, 0);
    assert.equal(packet.data.logic.length, 1);
    assert.equal(packet.data.logic[0].kind, "coordination-decision");
    assert(packetSchema.safeParse(packet).success);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("authenticated work can accept feedback during a running call without starting a second coordinator loop", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dreamatic-live-feedback-"));
  let release!: () => void;
  let first = true;
  const caller: Caller = async (role, input) => {
    if (first) {
      first = false;
      await new Promise<void>((r) => (release = r));
    }
    return fake(role, input);
  };
  try {
    const w = new Workbench(caller, dir, { visualContract: "legacy" });
    const job = w.start("办公无线鼠标");
    while (!release) await new Promise((r) => setTimeout(r, 1));
    await w.request("静音优先，不添加侧键", []);
    assert.equal(w.busy, true);
    assert.equal(w.project!.requests!.length, 1);
    assert.equal(w.project!.nodes.length, 1);
    release();
    await job;
    assert.equal(w.project!.phase, "choices");
    assert.equal(w.project!.nodes.length, 2);
    assert.equal(w.project!.requests![0].summary, "静音优先，不添加侧键");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("latest user feedback is explicit and specialists do not inherit unrelated history through a manager", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dreamatic-focused-context-"));
  let sawFocused = false,
    sawLatest = false;
  const caller: Caller = async (role, input) => {
    if (role === "embedded" && input.instruction === "power") {
      const initialAnalyst = input.state!.invocations.find(
        (n) => n.role === "analyst" && n.status === "done",
      )!.id;
      assert(!input.packets.some((p) => p.invocationId === initialAnalyst));
      sawFocused = true;
    }
    if (
      role === "coordinator" &&
      input.state?.latestUserFeedback === "请重新独立审查"
    ) {
      assert(input.instruction.includes("请重新独立审查"));
      assert.equal(input.packets.at(-1)!.summary, "请重新独立审查");
      sawLatest = true;
    }
    return fake(role, input);
  };
  try {
    const w = new Workbench(caller, dir, { visualContract: "legacy" });
    await w.start("办公无线鼠标");
    await w.answer(
      Object.fromEntries(w.project!.questions.map((q) => [q.id, q.options[0]])),
    );
    await w.request("请重新独立审查", []);
    assert(sawFocused && sawLatest);
    assert.equal(w.project!.phase, "complete");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("review opinions use a bounded role-specific response and canonical advisory-only logic packets", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dreamatic-review-packet-"));
  const caller: Caller = async (role, input) =>
    role === "reviewer"
      ? {
          summary: "建议性检查",
          findings: [
            {
              id: "review-" + input.instruction,
              label: "核对约束",
              finding: "这是未验证提案，尚无真实几何证据",
              suggestion: "后续执行真实几何检查",
              references: [],
            },
          ],
          data: { references: ["not-a-channel"] },
        }
      : fake(role, input);
  try {
    const w = new Workbench(caller, dir, { visualContract: "legacy" });
    await w.start("办公无线鼠标");
    await w.answer(
      Object.fromEntries(w.project!.questions.map((q) => [q.id, q.options[0]])),
    );
    assert.equal(w.project!.phase, "complete");
    for (const n of w.project!.nodes.filter((n) => n.role === "reviewer")) {
      assert.equal(n.status, "done");
      assert(packetSchema.safeParse(n.packet).success);
      assert.equal(n.packet!.data.logic[0].kind, "review-finding");
      assert.equal(n.packet!.data.logic[0].properties.advisory, true);
      assert.equal(n.packet!.evidence, "proposal");
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

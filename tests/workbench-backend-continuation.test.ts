import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  VERSION,
  type Invocation,
  type Packet,
} from "../packages/workbench/contracts";
import { Workbench, type Caller } from "../packages/workbench/runtime";
import { engineeringDependencies } from "../packages/workbench/engineering-dependencies";
import { stageGaps } from "../packages/workbench/stage-gaps";
import {
  parseWorkflowPlan,
  readyWorkflowTasks,
} from "../packages/workbench/workflow-plan";
import { prepareModelPrompt } from "../packages/workbench/prompt-budget";
import { readWorkResult } from "../packages/workbench/work-result-tools";
import { normalizeModelOutput } from "../packages/workbench/model-output";
import { engineeringRoleInstructions } from "../packages/workbench/engineering-prompts";
import { validateEngineeringPacket } from "../packages/workbench/engineering-protocol";

const data = () => ({
  structure: [],
  motion: [],
  circuit_energy: [],
  flow: [],
  logic: [],
});
const packet = (id: string): Packet => ({
  version: VERSION,
  id,
  invocationId: id,
  inputs: [],
  summary: id,
  evidence: "proposal",
  data: data(),
});
const node = (
  id: string,
  role: Invocation["role"],
  inputs: string[] = [],
): Invocation => ({ id, role, title: id, status: "done", inputs });
const step = (key: string, dependsOn = ["$source"], role = "embedded") => ({
  key,
  dependsOn,
  role,
  title: key,
  instruction: `Investigate only ${key}, preserving unknown fields and actual sources`,
});
const planItem = (steps: unknown[]) => ({
  channel: "logic",
  id: "plan",
  kind: "workflow-plan",
  label: "Functional handoff",
  properties: { version: "dreamatic.workflow-plan/1", steps },
  references: [],
});
const handoff = (steps: unknown[]) => {
  const p = packet("analysis");
  const { channel: _, ...item } = planItem(steps);
  p.data.logic.push(item);
  return p;
};

test("preflight and consumed engineering dependencies stop at coordinator observation edges, including cycles and errors", () => {
  const nodes = [
    node("old", "mechanical"),
    node("manager", "coordinator", ["old"]),
    node("current", "embedded", ["manager", "current", "failed"]),
    { ...node("failed", "mechanical", ["old"]), status: "error" as const },
  ];
  assert.deepEqual(
    engineeringDependencies(["manager", "current", "missing"], nodes).map(
      (n) => n.id,
    ),
    ["current"],
  );
  assert.deepEqual(
    stageGaps(
      {
        key: "sw",
        role: "software",
        title: "firmware",
        instruction: "implement",
        dependsOn: ["manager", "current"],
      },
      nodes,
    ),
    ["缺少必要前置结果：结构方案"],
  );
  assert.deepEqual(
    stageGaps(
      {
        key: "sw",
        role: "software",
        title: "firmware",
        instruction: "implement",
        dependsOn: ["old"],
      },
      nodes,
    ),
    [],
  );
});

test("bounded plans reject future/cyclic/unknown dependencies, duplicate IDs, coordinator roles and oversized batches", () => {
  for (const steps of [
    [step("a", ["b"]), step("b", ["a"])],
    [step("a", ["missing"])],
    [step("a"), step("a")],
    [step("a", ["$source"], "coordinator")],
    Array.from({ length: 13 }, (_, i) => step(`s${i}`)),
    [
      step("a", ["$source"], "reviewer"),
      step("b", ["$source"], "reviewer"),
      step("c", ["$source"], "reviewer"),
    ],
  ])
    assert.throws(() => parseWorkflowPlan(handoff(steps), []));
  const p = parseWorkflowPlan(
    handoff([
      step("a"),
      step("b"),
      step("c"),
      step("d"),
      step("merge", ["a", "b", "c", "d"]),
    ]),
    [],
  )!;
  assert.equal(readyWorkflowTasks(p, [node("analysis", "analyst")]).length, 3);
});

test("channel normalization rejects malformed protocols while retaining unspecified channels as traceable gaps", async () => {
  assert.throws(
    () =>
      normalizeModelOutput(
        { summary: "invalid", data: { hardwareOptions: [] } },
        "embedded",
        [],
      ),
    /Unknown channel/,
  );
  assert.throws(
    () =>
      normalizeModelOutput(
        { summary: "invalid", data: { structure: "pretend array" } },
        "embedded",
        [],
      ),
    /Channel must be an array/,
  );
  const normalized = normalizeModelOutput(
    { summary: "partial", data: { logic: [] } },
    "analyst",
    [],
  );
  assert.equal(
    normalized.engineeringIssues.filter((i) => i.severity === "gap").length,
    4,
  );
  const dir = await mkdtemp(join(tmpdir(), "dreamatic-backend-diagnostic-"));
  let calls = 0;
  let diagnostics: Packet["data"]["logic"] = [];
  const caller: Caller = async (role, input) => {
    if (role === "analyst")
      return {
        summary: "Incomplete channels remain unknown",
        data: { logic: [] },
      };
    diagnostics = input.packets
      .flatMap((p) => p.data.logic)
      .filter((i) => i.kind === "engineering-diagnostic");
    return {
      summary: "plan",
      decision:
        ++calls === 1
          ? {
              action: "dispatch",
              reason: "analyze",
              tasks: [
                {
                  key: "analysis",
                  role: "analyst",
                  title: "analysis",
                  instruction: "analyze",
                  dependsOn: [],
                },
              ],
            }
          : {
              action: "blocked",
              reason: "Review incomplete engineering evidence",
              tasks: [],
            },
    };
  };
  try {
    const w = new Workbench(caller, dir);
    await w.start("test");
    assert.equal(diagnostics.length, 4);
    assert(
      diagnostics.every(
        (i) =>
          i.properties.severity === "gap" &&
          i.properties.verificationStatus === "unverified",
      ),
    );
    assert.equal(
      w.project!.nodes.find((n) => n.role === "analyst")!.status,
      "done",
      "A gap is not automatically a protocol error or approval",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test(
  "functional fan-out and fan-in run without intervening PM models and preserve real dependency inputs",
  { timeout: 5000 },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "dreamatic-backend-batch-"));
    let pmCalls = 0,
      running = 0,
      peak = 0;
    const consumed: Record<string, string[]> = {};
    const firstWave: (() => void)[] = [];
    const caller: Caller = async (role, input) => {
      if (role === "coordinator") {
        pmCalls++;
        return {
          summary: "milestone",
          decision:
            pmCalls === 1
              ? {
                  action: "dispatch",
                  reason: "Analyze explicit requirements",
                  tasks: [
                    {
                      key: "analyze",
                      role: "analyst",
                      title: "Functional decomposition",
                      instruction: "Analyze explicit requirements",
                      dependsOn: [],
                    },
                  ],
                }
              : {
                  action: "blocked",
                  reason:
                    "Research proposals delivered; physical execution remains unverified",
                  tasks: [],
                },
        };
      }
      if (role === "analyst")
        return {
          summary: "Explicit functional requirements",
          items: [
            planItem([
              step("power"),
              step("sensing"),
              step("control"),
              step("interaction"),
              step("merge", ["power", "sensing", "control", "interaction"]),
              step("appearance", ["merge"], "designer"),
            ]),
          ],
        };
      running++;
      peak = Math.max(peak, running);
      const key = input.instruction.match(/only (\w+)/)![1];
      if (["power", "sensing", "control"].includes(key)) {
        await new Promise<void>((resolve) => {
          firstWave.push(resolve);
          if (firstWave.length === 3) firstWave.forEach((release) => release());
        });
      }
      running--;
      consumed[key] = input.packets.flatMap((p) =>
        p.data.logic.map((i) => i.id),
      );
      return {
        summary: "Research proposal; not manufactured or physically verified",
        items: [
          {
            channel: "logic",
            id: `result-${key}`,
            kind: "research-note",
            label: key,
            properties: { unverified: ["physical assembly"] },
            references: [],
          },
        ],
      };
    };
    try {
      const w = new Workbench(caller, dir);
      await w.start("Explicit functional requirements for a test device");
      assert.equal(
        pmCalls,
        2,
        "Only initial planning and final milestone call the PM",
      );
      assert.equal(
        w.project!.nodes.filter((n) => n.role === "embedded").length,
        5,
      );
      assert.equal(
        w.project!.nodes.filter((n) => n.role === "reviewer").length,
        0,
      );
      assert.equal(peak, 3);
      for (const name of ["power", "sensing", "control", "interaction"])
        assert(consumed.merge.includes(`result-${name}`));
      assert(consumed.appearance.includes("result-merge"));
      assert.equal(
        w.project!.phase,
        "blocked",
        "Proposal-only test never claims manufactured success",
      );
      assert.equal(w.project!.plan.length, 7);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);

test("automatic continuation stops on expert failure and never consumes failed results", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dreamatic-backend-failure-"));
  let pmCalls = 0,
    downstream = false;
  const caller: Caller = async (role) => {
    if (role === "coordinator")
      return {
        summary: "plan",
        decision:
          ++pmCalls === 1
            ? {
                action: "dispatch",
                reason: "analyze",
                tasks: [
                  {
                    key: "analysis",
                    role: "analyst",
                    title: "analysis",
                    instruction: "analyze",
                    dependsOn: [],
                  },
                ],
              }
            : {
                action: "blocked",
                reason: "Actual failed research requires new evidence",
                tasks: [],
              },
      };
    if (role === "analyst")
      return {
        summary: "handoff",
        items: [
          planItem([step("power"), step("appearance", ["power"], "designer")]),
        ],
      };
    if (role === "embedded") throw new Error("Real research unavailable");
    downstream = true;
    return { summary: "unexpected", items: [] };
  };
  try {
    const w = new Workbench(caller, dir);
    await w.start("test");
    assert.equal(pmCalls, 2);
    assert.equal(downstream, false);
    assert.equal(
      w.project!.nodes.find((n) => n.role === "embedded")!.status,
      "error",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("automatic plan cannot bypass structural prerequisites or silently approve a missing mechanical result", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dreamatic-backend-gate-"));
  let pmCalls = 0,
    softwareCalled = false,
    reportedGaps: string[] = [];
  const caller: Caller = async (role, input) => {
    if (role === "coordinator") {
      reportedGaps = input.state?.stageReadiness?.gaps || [];
      return {
        summary: "plan",
        decision:
          ++pmCalls === 1
            ? {
                action: "dispatch",
                reason: "analyze",
                tasks: [
                  {
                    key: "analysis",
                    role: "analyst",
                    title: "analysis",
                    instruction: "analyze",
                    dependsOn: [],
                  },
                ],
              }
            : {
                action: "blocked",
                reason: "Mechanical result required",
                tasks: [],
              },
      };
    }
    if (role === "analyst")
      return {
        summary: "handoff",
        items: [planItem([step("firmware", ["$source"], "software")])],
      };
    softwareCalled = true;
    return { summary: "unexpected", items: [] };
  };
  try {
    const w = new Workbench(caller, dir);
    await w.start("test");
    assert.equal(softwareCalled, false);
    assert.equal(pmCalls, 2);
    assert(reportedGaps.includes("缺少必要前置结果：结构方案"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("historical-sized OLED/USB-C research context becomes a retrievable bounded view without rewriting evidence", () => {
  const packets = Array.from({ length: 8 }, (_, n) => {
    const p = packet(`upstream-${n}`);
    p.data.structure.push({
      id: `hw-${n}`,
      kind: "hardware-record",
      label: `Part ${n}`,
      properties: {
        source: "arduino",
        recordId: `r${n}`,
        revision: "a".repeat(64),
        sourceText: "source facts unknown ".repeat(2500),
        parameters: [{ unknown: true }],
        physicalVerified: false,
      },
      references: [],
    });
    p.data.logic.push({
      id: `engineering-${n}`,
      kind: "research-note",
      label: "Evidence",
      properties: {
        source: "manufacturer",
        code: "inert text ".repeat(3000),
        unverified: ["physical fit"],
      },
      references: [`hw-${n}`],
    });
    return p;
  });
  const requirement = packet("user");
  requirement.invocationId = "user";
  requirement.data.logic.push({
    id: "constraint",
    kind: "requirement",
    label: "User constraint",
    properties: {
      text: "Use USB-C 5V and 0.96 inch I2C OLED; do not assume verified fit",
    },
    references: [],
  });
  packets.unshift(requirement);
  const before = JSON.stringify(packets);
  assert(before.length > 111208);
  for (const instruction of [
    "0.96英寸I2C OLED实型调研",
    "USB-C 5V受电入口调研",
  ]) {
    const prompt = prepareModelPrompt("embedded", {
      instruction,
      packets,
      state: { invocations: [] },
    });
    assert(prompt.length < 32000);
    const view = JSON.parse(prompt);
    assert.match(prompt, /do not assume verified fit/);
    const item = view.packets
      .flatMap((p: Packet) => p.data.logic)
      .find((i: { id: string }) => i.id === "engineering-0");
    assert.equal(item.properties.fullResult.itemId, "engineering-0");
    assert.deepEqual(item.properties.unverified, ["physical fit"]);
    const result = readWorkResult(packets, {
      itemId: item.id,
      invocationId: item.properties.fullResult.invocationId,
    });
    assert.match(result.text, /inert text/);
    assert(result.nextOffset !== null);
  }
  assert.equal(JSON.stringify(packets), before);
});

test("deterministic context budget failure blocks without PM retry expansion", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dreamatic-backend-budget-"));
  let pmCalls = 0;
  const caller: Caller = async (role) => {
    if (role === "coordinator")
      return {
        summary: "plan",
        decision: {
          action: "dispatch",
          reason: "analyze",
          tasks: [
            {
              key: "analysis",
              role: "analyst",
              title: "analysis",
              instruction: "analyze",
              dependsOn: [],
            },
          ],
        },
        observed: ++pmCalls,
      };
    throw new Error(
      "任务上下文超出安全预算（111208字符，上限98000）；请缩小任务依赖或补充资料后继续",
    );
  };
  try {
    const w = new Workbench(caller, dir);
    await w.start("test");
    assert.equal(pmCalls, 1);
    assert.equal(w.project!.phase, "blocked");
    assert.equal(w.project!.nodes.at(-1)!.status, "error");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("new user feedback invalidates an in-flight automatic continuation before downstream dispatch", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dreamatic-backend-feedback-"));
  let release!: () => void;
  let pmCalls = 0,
    downstream = false;
  const caller: Caller = async (role, input) => {
    if (role === "coordinator")
      return {
        summary: "milestone",
        decision:
          ++pmCalls === 1
            ? {
                action: "dispatch",
                reason: "analysis",
                tasks: [
                  {
                    key: "analysis",
                    role: "analyst",
                    title: "analysis",
                    instruction: "analyze",
                    dependsOn: [],
                  },
                ],
              }
            : {
                action: "blocked",
                reason: input.state!.latestUserFeedback!,
                tasks: [],
              },
      };
    if (role === "analyst")
      return {
        summary: "handoff",
        items: [
          planItem([step("power"), step("appearance", ["power"], "designer")]),
        ],
      };
    if (role === "embedded")
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    if (role === "designer") downstream = true;
    return { summary: "proposal", items: [] };
  };
  try {
    const w = new Workbench(caller, dir);
    const job = w.start("explicit test requirements");
    while (!release) await new Promise((resolve) => setTimeout(resolve, 1));
    await w.request("Change the power requirements before appearance work", []);
    release();
    await job;
    assert.equal(pmCalls, 2);
    assert.equal(downstream, false);
    assert.match(w.project!.error!, /Change the power/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("foreign and unsuccessful workflow dependencies are rejected by actual runtime validation", async () => {
  for (const id of ["foreign-project-node", "failed-in-this-project"]) {
    const dir = await mkdtemp(
      join(tmpdir(), "dreamatic-backend-invalid-plan-"),
    );
    let pmCalls = 0,
      downstream = false;
    const caller: Caller = async (role) => {
      if (role === "coordinator")
        return {
          summary: "plan",
          decision:
            ++pmCalls === 1
              ? {
                  action: "dispatch",
                  reason: "analysis",
                  tasks: [
                    {
                      key: "analysis",
                      role: "analyst",
                      title: "analysis",
                      instruction: "analyze",
                      dependsOn: [],
                    },
                  ],
                }
              : {
                  action: "blocked",
                  reason: "Invalid handoff dependency",
                  tasks: [],
                },
        };
      if (role === "analyst")
        return {
          summary: "invalid handoff",
          items: [planItem([step("power", [id])])],
        };
      downstream = true;
      return { summary: "unexpected", items: [] };
    };
    try {
      const w = new Workbench(caller, dir);
      await w.start("test");
      assert.equal(downstream, false);
      assert.equal(
        w.project!.nodes.find((n) => n.role === "analyst")!.status,
        "error",
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

test("normalization and semantic rejection persist both error and gap reports on failed nodes", async () => {
  for (const mode of ["normalization", "semantic"] as const) {
    const dir = await mkdtemp(join(tmpdir(), "dreamatic-backend-report-"));
    let calls = 0;
    const caller: Caller = async (role) => {
      if (role === "coordinator")
        return {
          summary: "plan",
          decision:
            ++calls === 1
              ? {
                  action: "dispatch",
                  reason: "analysis",
                  tasks: [
                    {
                      key: "analysis",
                      role: "analyst",
                      title: "analysis",
                      instruction: "analyze",
                      dependsOn: [],
                    },
                  ],
                }
              : {
                  action: "blocked",
                  reason: "Protocol error with unresolved evidence",
                  tasks: [],
                },
        };
      return mode === "normalization"
        ? {
            summary: "malformed with unspecified channels",
            data: { logic: "not an array" },
          }
        : {
            summary: "semantic errors and explicit unknowns",
            items: [
              {
                channel: "circuit_energy",
                id: "bad",
                kind: "terminal",
                label: "invalid terminal role",
                properties: {
                  engineeringProtocol: "dreamatic.engineering/1",
                  role: "invalid",
                  voltageRange: null,
                },
                references: [],
              },
              {
                channel: "logic",
                id: "unknown",
                kind: "logic-port",
                label: "unknown input type",
                properties: {
                  engineeringProtocol: "dreamatic.engineering/1",
                  direction: "in",
                  valueType: null,
                },
                references: [],
              },
            ],
          };
    };
    try {
      const w = new Workbench(caller, dir);
      await w.start("test");
      const saved = JSON.parse(
        await readFile(join(dir, "current.json"), "utf8"),
      );
      const failed = saved.nodes.find((n: Invocation) => n.role === "analyst");
      assert.equal(failed.status, "error");
      assert.equal(failed.packet, undefined);
      assert(failed.engineeringReport.errors.length > 0);
      assert(failed.engineeringReport.gaps.length > 0);
      assert.equal(failed.engineeringReport.invocationId, failed.id);
      assert.equal(
        failed.toolActivity.filter(
          (a: { tool: string }) => a.tool === "engineering_protocol",
        ).length,
        1,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

test("successful repair updates current report, retaining one failure audit without double-parse duplicates", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dreamatic-backend-repair-report-"));
  let calls = 0;
  const caller: Caller = async (role, input) => {
    if (role === "coordinator")
      return {
        summary: "plan",
        decision:
          ++calls === 1
            ? {
                action: "dispatch",
                reason: "analysis",
                tasks: [
                  {
                    key: "analysis",
                    role: "analyst",
                    title: "analysis",
                    instruction: "analyze",
                    dependsOn: [],
                  },
                ],
              }
            : {
                action: "blocked",
                reason: "Unverified but protocol-correct proposal",
                tasks: [],
              },
      };
    const invalid = { summary: "bad channel", data: { flow: 123 } };
    assert.throws(() => input.validateOutput!(invalid));
    await input.onRepair!();
    const saved = JSON.parse(await readFile(join(dir, "current.json"), "utf8"));
    const running = saved.nodes.at(-1);
    assert(running.engineeringReport.errors.length);
    assert(running.engineeringReport.gaps.length);
    const valid = {
      summary: "unknown type preserved",
      items: [
        {
          channel: "logic",
          id: "unknown",
          kind: "logic-port",
          label: "unknown",
          properties: {
            engineeringProtocol: "dreamatic.engineering/1",
            direction: "in",
            valueType: null,
          },
          references: [],
        },
      ],
    };
    input.validateOutput!(valid);
    return valid;
  };
  try {
    const w = new Workbench(caller, dir);
    await w.start("test");
    const n = w.project!.nodes.find((n) => n.role === "analyst")!;
    assert.equal(n.status, "done");
    assert.equal(n.engineeringReport!.errors.length, 0);
    assert.equal(n.engineeringReport!.gaps.length, 1);
    assert.equal(
      n.packet!.data.logic.filter((i) => i.kind === "engineering-diagnostic")
        .length,
      1,
    );
    assert.equal(
      n.toolActivity!.filter((a) => a.tool === "engineering_protocol").length,
      1,
    );
    assert.equal(n.protocolRepairs, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("role-scoped protocol instructions include valid explicit-unknown examples without forcing irrelevant channels", () => {
  for (const role of ["embedded", "software"] as const) {
    const prompt = engineeringRoleInstructions(role);
    assert.match(prompt, /dreamatic.engineering\/1/);
    const example = JSON.parse(
      prompt.match(/(\{"channel".*?"references":\[\]\})/)![1],
    );
    const { channel, ...item } = example;
    const p = packet(role);
    p.data[channel as keyof Packet["data"]].push(item);
    const issues = validateEngineeringPacket(p);
    assert.equal(issues.filter((i) => i.severity === "error").length, 0);
    assert(issues.some((i) => i.severity === "gap"));
  }
  assert.match(
    engineeringRoleInstructions("mechanical"),
    /structure-connection/,
  );
  assert.equal(engineeringRoleInstructions("coordinator"), "");
  assert.equal(engineeringRoleInstructions("designer"), "");
});

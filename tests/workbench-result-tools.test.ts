import test from "node:test";
import assert from "node:assert/strict";
import { VERSION, type Packet } from "../packages/workbench/contracts";
import type { Role } from "../packages/workbench/contracts";
import {
  readWorkResult,
  workResultTools,
} from "../packages/workbench/work-result-tools";
import { prepareModelPrompt } from "../packages/workbench/prompt-budget";

function packet(
  id: string,
  properties: Record<string, unknown>,
  kind = "firmware-spec",
): Packet {
  return {
    version: VERSION,
    id,
    invocationId: id,
    inputs: [],
    summary: id,
    evidence: "proposal",
    data: {
      structure: [],
      motion: [],
      circuit_energy: [],
      flow: [],
      logic: [
        { id: "result", kind, label: "Result", properties, references: [] },
      ],
    },
  };
}

test("engineering result lookup is scoped, versioned, bounded and non-mutating", () => {
  const inputs = [
    packet("old", { stateMachine: "old" }),
    packet("new", { stateMachine: "x".repeat(15000), compiled: false }),
  ];
  const before = JSON.stringify(inputs);
  const first = readWorkResult(inputs, {
    itemId: "result",
    maxCharacters: 8000,
  });
  assert.equal(first.invocationId, "new");
  assert.equal(first.text.length, 8000);
  const second = readWorkResult(inputs, {
    itemId: "result",
    invocationId: "new",
    offset: first.nextOffset,
  });
  assert.equal(second.sha256, first.sha256);
  assert.deepEqual(
    JSON.parse(first.text + second.text),
    inputs[1].data.logic[0],
  );
  assert.match(
    readWorkResult(inputs, { itemId: "result", invocationId: "old" }).text,
    /old/,
  );
  assert.throws(
    () => readWorkResult(inputs, { itemId: "outside-project" }),
    /不在本次/,
  );
  assert.throws(() =>
    readWorkResult(inputs, { itemId: "result", maxCharacters: 12001 }),
  );
  assert.throws(
    () => readWorkResult(inputs, { itemId: "result", offset: 999999 }),
    /超出/,
  );
  assert.equal(JSON.stringify(inputs), before);
});

test("coordinator fallback indexes unfamiliar large result properties but preserves user constraints and read access", () => {
  const engineering = packet("new", {
    stateMachine: Array.from({ length: 80 }, (_, i) => ({
      state: i,
      transitions: "next".repeat(80),
    })),
    compiled: false,
    designAssumptions: ["OLED thickness is provisional"],
  });
  const user = packet(
    "user",
    { instruction: "Keep 12mm provisional OLED thickness; use SPI" },
    "user-feedback",
  );
  const input: any = {
    instruction: "Continue",
    packets: [engineering, user],
    state: { invocations: [] },
  };
  const before = JSON.stringify(input);
  const view = JSON.parse(prepareModelPrompt("coordinator", input, 6000));
  const result = view.packets[0].data.logic[0];
  assert.equal(result.properties.fullResult.tool, "workbench_read_result");
  assert.equal(result.properties.compiled, false);
  assert.deepEqual(result.properties.designAssumptions, [
    "OLED thickness is provisional",
  ]);
  assert.equal(
    view.packets[1].data.logic[0].properties.instruction,
    user.data.logic[0].properties.instruction,
  );
  assert.match(
    readWorkResult(input.packets, { itemId: "result", invocationId: "new" })
      .text,
    /stateMachine/,
  );
  assert.equal(JSON.stringify(input), before);
});

test("read-only result tool has a bounded call budget and auditable failures", async () => {
  const audit: any[] = [];
  const tool = workResultTools(
    [packet("new", { status: "proposal" })],
    async (e) => {
      audit.push(e);
    },
  )[0];
  const execute = tool.execute as (id: string, args: any) => Promise<unknown>;
  for (let i = 0; i < 8; i++) await execute(String(i), { itemId: "result" });
  await assert.rejects(() => execute("over", { itemId: "result" }), /8次/);
  assert.equal(audit.filter((e) => e.success).length, 8);
  assert.equal(audit.at(-1).success, false);
});

test("coordinator removes repeated dispatch transport and duplicate user summaries while retaining full user input", () => {
  const user = packet(
    "user",
    {
      instruction:
        "OLED thickness is a user-authorized 12mm prototype assumption",
    },
    "user-feedback",
  );
  user.invocationId = "user";
  user.summary = String(user.data.logic[0].properties.instruction);
  const decisions = Array.from({ length: 30 }, (_, i) =>
    packet(
      `dispatch-${i}`,
      { action: "dispatch", tasks: [] },
      "coordination-decision",
    ),
  );
  const prompt = JSON.parse(
    prepareModelPrompt("coordinator", {
      instruction: "continue",
      packets: [user, ...decisions],
      state: { invocations: [] },
    }),
  );
  assert.equal(prompt.packets.length, 2);
  assert.equal(
    prompt.packets[0].data.logic[0].properties.instruction,
    user.summary,
  );
  assert.equal(prompt.packets[1].invocationId, "dispatch-29");
  assert.equal(user.summary, user.data.logic[0].properties.instruction);
});

test("specialists can use a bounded engineering index and retrieve complete details without losing constraints", () => {
  const engineering = packet("source", {
    stateMachine: "x".repeat(20000),
    compiled: false,
    unknownFields: ["prototype clearance"],
  });
  const user = packet(
    "user",
    { instruction: "Use 12mm as a provisional value, not a measurement" },
    "user-feedback",
  );
  const input: any = {
    instruction: "Continue",
    packets: [engineering, user],
    state: { invocations: [] },
  };
  for (const role of [
    "designer",
    "mechanical",
    "software",
    "embedded",
  ] as Role[]) {
    const view = JSON.parse(prepareModelPrompt(role, input, 6000));
    assert.equal(
      view.packets[0].data.logic[0].properties.fullResult.tool,
      "workbench_read_result",
    );
    assert.deepEqual(view.packets[0].data.logic[0].properties.unknownFields, [
      "prototype clearance",
    ]);
    assert.equal(
      view.packets[1].data.logic[0].properties.instruction,
      user.data.logic[0].properties.instruction,
    );
    assert.match(
      readWorkResult(input.packets, {
        itemId: "result",
        invocationId: "source",
      }).text,
      /stateMachine/,
    );
  }
});

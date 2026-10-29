import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  VERSION,
  type Packet,
  type Invocation,
} from "../packages/workbench/contracts";
import { hardwareFixture } from "./workbench-hardware-fixtures";
import {
  hardwarePacket,
  validateHardwareReferences,
} from "../packages/workbench/hardware-evidence";
import { normalizeModelOutput } from "../packages/workbench/model-output";
import { validateVisualExecution } from "../packages/workbench/execution-evidence";
import { prepareModelPrompt } from "../packages/workbench/prompt-budget";
import { Workbench, type Caller } from "../packages/workbench/runtime";
import { makeServer } from "../apps/workbench/server";
import { WorkbenchAuth } from "../packages/workbench/auth";
import { connectionStore } from "../packages/workbench/connection";
import { stageGaps } from "../packages/workbench/stage-gaps";
import { bomBaselineSchema } from "../packages/workbench/hardware-contracts";

const data = () => ({
  structure: [],
  motion: [],
  circuit_energy: [],
  flow: [],
  logic: [],
});
const packet = (items: any[] = []): Packet => ({
  version: VERSION,
  id: "p",
  invocationId: "n",
  inputs: [],
  summary: "proposal",
  evidence: "proposal",
  data: { ...data(), structure: items },
});
const node = (role: Invocation["role"]): Invocation => ({
  id: "n",
  role,
  title: "test",
  status: "running",
  inputs: [],
});

test("structured BOM explanations retain their content while material quantities remain strict", () => {
  const baseline = {
    contractVersion: "dreamatic.bom/1",
    scope: "product",
    rows: [
      {
        itemId: "mcu",
        name: "MCU",
        partNumber: "board",
        quantity: 1,
        unit: "pcs",
        selectionStatus: "candidate",
      },
    ],
    excluded: [{ itemId: "usb-breakout", reason: "integrated in MCU" }],
    procedures: [{ text: "route cable" }],
    openChecks: ["connector clearance"],
  };
  const parsed = bomBaselineSchema.parse(baseline);
  assert.match(parsed.excluded[0], /integrated in MCU/);
  assert.match(parsed.procedures[0], /route cable/);
  assert(
    !bomBaselineSchema.safeParse({
      ...baseline,
      rows: [{ ...baseline.rows[0], quantity: 0 }],
    }).success,
  );
});

test("backend assembles five channels and resolves hardware versions only from observed evidence", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dreamatic-normalize-"));
  const lib = await hardwareFixture(dir);
  try {
    const record = await lib.get("arduino", "board");
    const evidence = hardwarePacket(record);
    const item = {
      channel: "circuit_energy",
      id: "choice",
      kind: "hardware-option",
      label: "Board",
      references: [],
      properties: {
        bomVersion: "dreamatic.bom/1",
        function: "control",
        manufacturer: "Fixture",
        partNumber: "board",
        quantity: 1,
        unit: "pcs",
        scope: "product",
        selectionStatus: "selected",
        interfaces: "GPIO",
        unverified: ["not tested"],
        hardwareItemIds: [record.itemId],
      },
    };
    const output: any = normalizeModelOutput(
      { summary: "proposal", items: [item] },
      "embedded",
      [evidence],
    );
    assert.deepEqual(Object.keys(output.data), [
      "structure",
      "motion",
      "circuit_energy",
      "flow",
      "logic",
    ]);
    assert.equal(
      output.data.circuit_energy[0].properties.hardwareRefs[0].revision,
      record.revision,
    );
    assert(!("hardwareItemIds" in output.data.circuit_energy[0].properties));
    validateHardwareReferences({ ...packet(), data: output.data }, [evidence]);
    const legacy: any = data();
    const { channel: _channel, ...legacyItem } = item;
    legacy.circuit_energy.push(legacyItem);
    const normalizedLegacy: any = normalizeModelOutput(
      { summary: "proposal", data: legacy },
      "embedded",
      [evidence],
    );
    assert.equal(
      normalizedLegacy.data.circuit_energy[0].properties.hardwareRefs[0]
        .revision,
      record.revision,
    );
    assert.doesNotThrow(() =>
      normalizeModelOutput(
        {
          summary: "x",
          items: [
            { ...item, properties: { ...item.properties, hardwareRefs: [] } },
          ],
        },
        "embedded",
        [evidence],
      ),
    );
    assert.throws(
      () =>
        normalizeModelOutput(
          {
            summary: "x",
            items: [
              {
                ...item,
                properties: {
                  ...item.properties,
                  hardwareRefs: [
                    {
                      source: record.source,
                      recordId: record.recordId,
                      revision: "0".repeat(64),
                    },
                  ],
                },
              },
            ],
          },
          "embedded",
          [evidence],
        ),
      /不一致/,
    );
    const stable = {
      ...item,
      properties: {
        ...item.properties,
        hardwareItemIds: [`hw:${record.source}:${record.recordId}`],
      },
    };
    const stableOutput: any = normalizeModelOutput(
      { summary: "x", items: [stable] },
      "embedded",
      [evidence],
    );
    assert.equal(
      stableOutput.data.circuit_energy[0].properties.hardwareRefs[0].revision,
      record.revision,
    );
    const abbreviated = {
      ...item,
      properties: {
        ...item.properties,
        hardwareItemIds: [
          `hw:${record.source}:${record.recordId}:${record.revision.slice(0, 12)}`,
        ],
      },
    };
    assert.doesNotThrow(() =>
      normalizeModelOutput({ summary: "x", items: [abbreviated] }, "embedded", [
        evidence,
      ]),
    );
    const geometry = {
      id: "geom",
      kind: "hardware-geometry",
      label: "fixture",
      properties: {
        reference: {
          source: record.source,
          recordId: record.recordId,
          revision: record.revision,
        },
        assetId: "model",
        sha256: "a".repeat(64),
        dimensionsMm: [10, 20, 3],
        minMm: [0, 0, 0],
        maxMm: [10, 20, 3],
        meshUrl: "/fixture.stl",
        coverage: "configured_model",
      },
      references: [record.itemId],
    };
    const component = {
      channel: "structure",
      id: "placed",
      kind: "component-instance",
      label: "placed board",
      properties: {
        geometryItemId: "geom",
        positionMm: [0, 0, 10],
        rotationDeg: [0, 0, 90],
      },
      references: [],
    };
    const bound: any = normalizeModelOutput(
      { summary: "placed", items: [component] },
      "mechanical",
      [evidence, packet([geometry])],
    );
    const boundPacket = { ...packet(), data: bound.data };
    validateHardwareReferences(boundPacket, [evidence, packet([geometry])]);
    assert.deepEqual(
      boundPacket.data.structure[0].properties.dimensionsMm,
      [10, 20, 3],
    );
    assert.equal(
      boundPacket.data.structure[0].properties.geometryRef.assetId,
      "model",
    );
    assert.throws(
      () =>
        normalizeModelOutput(
          {
            summary: "x",
            items: [
              {
                ...component,
                properties: {
                  ...component.properties,
                  geometryItemId: "invented",
                },
              },
            ],
          },
          "mechanical",
          [evidence],
        ),
      /不在本次/,
    );
    const conflicting = hardwarePacket({
      ...record,
      revision: "0".repeat(64),
      itemId: record.itemId + "-other",
    });
    assert.throws(
      () =>
        normalizeModelOutput({ summary: "x", items: [stable] }, "embedded", [
          evidence,
          conflicting,
        ]),
      /不在本次/,
    );
    assert.throws(
      () =>
        normalizeModelOutput(
          {
            summary: "x",
            items: [
              {
                ...item,
                properties: {
                  ...item.properties,
                  hardwareItemIds: ["invented"],
                },
              },
            ],
          },
          "embedded",
          [evidence],
        ),
      /不在本次/,
    );
    assert.throws(
      () =>
        normalizeModelOutput(
          { summary: "x", items: [item], data: data() },
          "embedded",
          [evidence],
        ),
      /不能同时/,
    );
  } finally {
    lib.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("image claims and explicit execution require matching tool artifacts; planning requests remain valid", () => {
  const designer = node("designer");
  const pending = packet([
    {
      id: "r",
      kind: "image-request",
      label: "front",
      properties: {
        imageSet: "appearance",
        view: "front",
        status: "pending",
        prompt: "case",
      },
      references: [],
    },
  ]);
  pending.summary = "已生成四条外观图像请求，等待执行";
  assert.doesNotThrow(() =>
    validateVisualExecution(designer, pending, [], "整理图像请求"),
  );
  pending.summary = "已生成四条效果图请求，尚未执行";
  assert.doesNotThrow(() =>
    validateVisualExecution(designer, pending, [], "整理图像请求"),
  );
  const claim = packet([
    {
      id: "fake",
      kind: "render-result",
      label: "layout",
      properties: { renderer: "render_component_views" },
      references: [],
    },
  ]);
  claim.summary = "已执行轮廓渲染并生成三视图";
  assert.throws(
    () => validateVisualExecution(designer, claim, [], "绘制轮廓"),
    /没有实际工具图片证据/,
  );
  assert.throws(
    () => validateVisualExecution(designer, pending, [], "执行四条外观生图"),
    /没有生成实际产物/,
  );
  const proof = packet([
    {
      id: "img",
      kind: "generated-image",
      label: "front",
      properties: { imageSet: "appearance", view: "front" },
      references: [],
    },
  ]);
  designer.imageEvidence = [proof];
  const partial = packet();
  partial.summary = "已生成外观图，零件轮廓图尚未生成";
  assert.doesNotThrow(() =>
    validateVisualExecution(designer, partial, [], "生成外观图"),
  );
  assert.throws(
    () =>
      validateVisualExecution(
        node("designer"),
        pending,
        [],
        "调用 generate_product_images 生成侧视图，不生成零件轮廓图，不调用render_component_views。",
      ),
    /没有生成实际产物/,
  );
  assert.doesNotThrow(() =>
    validateVisualExecution(
      designer,
      partial,
      [],
      "调用 generate_product_images 生成侧视图，不生成零件轮廓图，不调用render_component_views。",
    ),
  );
  assert.throws(
    () => validateVisualExecution(designer, claim, [proof], "绘制轮廓"),
    /没有对应的真实轮廓/,
  );
  assert.throws(
    () => validateVisualExecution(designer, pending, [], "执行四条外观生图"),
    /四视图尚未全部/,
  );
});

test("old images cannot satisfy a new request for the same view", () => {
  const request = {
    id: "new-front",
    kind: "image-request",
    label: "Front",
    properties: { imageSet: "appearance", view: "front", status: "pending" },
    references: [],
  };
  const old = {
    id: "old-image",
    kind: "generated-image",
    label: "Old front",
    properties: { imageSet: "appearance", view: "front" },
    references: ["old-front"],
  };
  const designer: Invocation = {
    id: "designer",
    role: "designer",
    title: "shape",
    status: "done",
    inputs: [],
    packet: packet([request, old]),
  };
  const gaps = stageGaps(
    {
      key: "shape",
      role: "mechanical",
      title: "mechanics",
      instruction: "design",
      dependsOn: ["designer"],
    },
    [designer],
  );
  assert(gaps.some((g) => g.includes("front")));
  old.references = ["new-front"];
  assert(
    !stageGaps(
      {
        key: "shape",
        role: "mechanical",
        title: "mechanics",
        instruction: "design",
        dependsOn: ["designer"],
      },
      [designer],
    ).some((g) => g.includes("front")),
  );
});

test("calling an unreferenced purchase candidate a baseline does not resolve the hardware gap", () => {
  const option = {
    id: "unbound",
    kind: "hardware-option",
    label: "未取证主控",
    properties: {
      bomVersion: "dreamatic.bom/1",
      selectionStatus: "candidate",
      hardwareRefs: [],
    },
    references: [],
  };
  const embedded: Invocation = {
    ...node("embedded"),
    id: "embedded",
    status: "done",
    packet: packet([
      option,
      {
        id: "baseline",
        kind: "bom-baseline",
        label: "BOM",
        properties: {
          rows: [
            {
              itemId: option.id,
              name: option.label,
              selectionStatus: "candidate",
            },
          ],
        },
        references: [option.id],
      },
    ]),
  };
  const designer: Invocation = {
    ...node("designer"),
    id: "designer",
    status: "done",
    packet: packet(),
  };
  assert(
    stageGaps(
      {
        key: "structure",
        role: "mechanical",
        title: "结构",
        instruction: "布局",
        dependsOn: [embedded.id, designer.id],
      },
      [embedded, designer],
    ).some((g) => g.includes("缺少硬件来源")),
  );
});

test("component projections wait for a completed layout rather than running beside the first structural task", () => {
  const task = {
    key: "project",
    role: "designer" as const,
    title: "轮廓三视图",
    instruction: "调用render_component_views生成轮廓三视图",
    dependsOn: ["layout"],
  };
  assert(stageGaps(task, []).some((g) => g.includes("已完成的结构布置")));
  const layout: Invocation = {
    ...node("mechanical"),
    id: "layout",
    status: "done",
    packet: packet([
      {
        id: "part",
        kind: "component-instance",
        label: "part",
        properties: {
          geometryRef: { assetId: "real" },
          positionMm: [0, 0, 10],
        },
        references: [],
      },
      {
        id: "shell",
        kind: "enclosure-proposal",
        label: "shell",
        properties: { dimensionsMm: [72, 86, 118], positionMm: [0, 0, 59] },
        references: [],
      },
    ]),
  };
  assert.deepEqual(stageGaps(task, [layout]), []);
});

test("an explicitly optional missing baseline row does not block structural work", () => {
  const option = {
    id: "optional",
    kind: "hardware-option",
    label: "未选备选电源",
    properties: { required: false, selectionStatus: "missing" },
    references: [],
  };
  const embedded: Invocation = {
    ...node("embedded"),
    id: "hardware",
    status: "done",
    packet: packet([
      option,
      {
        id: "bom",
        kind: "bom-baseline",
        label: "baseline",
        properties: {
          rows: [
            {
              itemId: "optional",
              name: option.label,
              selectionStatus: "missing",
            },
          ],
        },
        references: [option.id],
      },
    ]),
  };
  const designer: Invocation = {
    ...node("designer"),
    id: "appearance",
    status: "done",
    packet: packet(),
  };
  assert.deepEqual(
    stageGaps(
      {
        key: "structure",
        role: "mechanical",
        title: "structure",
        instruction: "layout",
        dependsOn: [embedded.id, designer.id],
      },
      [embedded, designer],
    ),
    [],
  );
});

test("visual context is compact, retains source identities and user constraints, and rejects oversize input", () => {
  const record = {
    id: "real",
    kind: "hardware-record",
    label: "Board",
    properties: {
      source: "arduino",
      recordId: "board",
      revision: "r",
      sourceText: "x".repeat(40000),
      assets: Array.from({ length: 80 }, (_, i) => ({
        id: String(i),
        role: "step_model",
      })),
      parameters: [{ name: "voltage", value: "3.3V" }],
    },
    references: [],
  };
  const input: any = {
    instruction: "design",
    packets: [
      packet([
        record,
        {
          id: "choice",
          kind: "user-selection",
          label: "power",
          properties: { selected: "USB-C" },
          references: [],
        },
      ]),
    ],
    state: { invocations: [] },
  };
  const before = JSON.stringify(input);
  const view = JSON.parse(prepareModelPrompt("designer", input));
  assert(prepareModelPrompt("designer", input).length < 5000);
  assert.equal(view.packets[0].data.structure[0].properties.recordId, "board");
  assert.equal(view.packets[0].data.structure[1].properties.selected, "USB-C");
  assert.equal(JSON.stringify(input), before);
  assert.throws(
    () =>
      prepareModelPrompt("designer", {
        ...input,
        instruction: "x".repeat(100000),
      }),
    /超出安全预算/,
  );
});

test("relaxed hardware search finds multilingual candidates while retaining source evidence", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dreamatic-search-"));
  const lib = await hardwareFixture(dir);
  try {
    const db = new DatabaseSync(
      join(lib.root, "official_catalog/library/hardware.sqlite3"),
    );
    db.prepare("INSERT INTO hardware VALUES(?,?,?,?,?,?)").run(
      "pir",
      "https://example.com/pir",
      "PIR motion sensor",
      "infrared sensor",
      "",
      JSON.stringify({ title: "PIR motion sensor", sourceText: "source data" }),
    );
    db.close();
    const found = await lib.search("PIR 红外人体感应模块", "arduino");
    assert.equal(found.searchMode, "relaxed");
    assert(found.items.some((i) => i.recordId === "pir"));
    assert.match(found.notice!, /宽松/);
    assert.equal((await lib.get("arduino", "pir")).physicalVerified, false);
    assert.equal((await lib.search("' OR 1=1 --")).total, 0);
  } finally {
    lib.close();
    await rm(dir, { recursive: true, force: true });
  }
});

const userQuestions = [
  { id: "q1", title: "Use", options: ["office", "home"] },
  { id: "q2", title: "Power", options: ["USB", "battery"] },
];
const task = (
  key: string,
  role: any,
  title: string,
  dependsOn: string[] = [],
) => ({ key, role, title, instruction: title, dependsOn });
const caller: Caller = async (role, input) => {
  const done = (input.state?.invocations || []).filter(
    (n) => n.status === "done",
  );
  const find = (r: string) => done.filter((n) => n.role === r);
  if (role === "coordinator") {
    let tasks: any[] = [];
    if (!find("analyst").length) tasks = [task("analysis", "analyst", "分析")];
    else if (!find("embedded").length)
      tasks = [
        task("parts", "embedded", "传感器", [find("analyst")[0].id]),
        task("shape", "designer", "外观规范", [find("analyst")[0].id]),
      ];
    else if (!find("mechanical").length)
      tasks = [
        task("structure", "mechanical", "结构", [
          find("embedded")[0].id,
          find("designer")[0].id,
        ]),
      ];
    return {
      summary: "decision",
      decision: {
        action: tasks.length ? "dispatch" : "finish",
        reason: "next",
        tasks,
      },
    };
  }
  if (role === "analyst")
    return { summary: "questions", data: data(), questions: userQuestions };
  if (role === "embedded")
    return {
      summary: "missing sensor",
      data: {
        ...data(),
        structure: [
          {
            id: "missing",
            kind: "hardware-option",
            label: "红外传感器",
            properties: {
              bomVersion: "dreamatic.bom/1",
              function: "presence",
              manufacturer: "unknown",
              partNumber: "unknown",
              quantity: 1,
              unit: "pcs",
              scope: "product",
              selectionStatus: "missing",
              interfaces: "unknown",
              unverified: ["unknown"],
              hardwareRefs: [],
            },
            references: [],
          },
        ],
      },
    };
  if (role === "designer")
    return {
      summary: "pending",
      data: {
        ...data(),
        structure: [
          {
            id: "image-request",
            kind: "image-request",
            label: "Front",
            properties: {
              imageSet: "appearance",
              view: "front",
              status: "pending",
              prompt: "case",
            },
            references: [],
          },
        ],
      },
    };
  return { summary: "concept", data: data() };
};

test("readiness gaps return to the manager for a BOM correction before structural work", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dreamatic-remediation-"));
  const lib = await hardwareFixture(join(dir, "library"));
  const record = await lib.get("arduino", "board");
  let diagnosed = false;
  const remedyCaller: Caller = async (role, input) => {
    const fixed = input.state?.invocations.find(
      (n) => n.title === "诊断并整理硬件基线" && n.status === "done",
    );
    if (role === "coordinator" && input.state?.stageReadiness && !fixed) {
      diagnosed = true;
      return {
        summary: "先处理未选备选与真正缺件",
        decision: {
          action: "dispatch",
          reason: "核实缺口原因",
          tasks: [
            {
              key: "remedy",
              role: "embedded",
              title: "诊断并整理硬件基线",
              instruction: "remedy",
              dependsOn: input.state.invocations
                .filter((n) => n.role === "embedded" && n.status === "done")
                .map((n) => n.id),
            },
          ],
        },
      };
    }
    if (role === "embedded" && input.instruction === "remedy") {
      await input.onHardware?.(record);
      const option = {
        id: "substitute",
        kind: "hardware-option",
        label: "替代候选",
        properties: {
          bomVersion: "dreamatic.bom/1",
          function: "presence",
          manufacturer: "fixture",
          partNumber: "candidate",
          quantity: 1,
          unit: "pcs",
          scope: "product",
          selectionStatus: "candidate",
          interfaces: "I2C",
          unverified: ["not physical validation"],
          hardwareItemIds: [record.itemId],
        },
        references: [],
      };
      return {
        summary: "基线明确保留候选，排除未选方案",
        data: {
          ...data(),
          structure: [
            option,
            {
              id: "baseline",
              kind: "bom-baseline",
              label: "基线",
              properties: {
                contractVersion: "dreamatic.bom/1",
                scope: "product",
                rows: [
                  {
                    itemId: option.id,
                    name: option.label,
                    partNumber: "candidate",
                    quantity: 1,
                    unit: "pcs",
                    selectionStatus: "candidate",
                  },
                ],
                excluded: ["missing为未选备选"],
                procedures: [],
                openChecks: ["待实物核实"],
              },
              references: [],
            },
          ],
        },
      };
    }
    if (role === "designer") return { summary: "外观规范", data: data() };
    if (role === "coordinator" && fixed) {
      const mechanical = input.state!.invocations.some(
        (n) => n.role === "mechanical" && n.status === "done",
      );
      return {
        summary: "处理后继续结构",
        decision: {
          action: mechanical ? "finish" : "dispatch",
          reason: "已明确候选与排除项",
          tasks: mechanical
            ? []
            : [
                {
                  key: "structure",
                  role: "mechanical",
                  title: "结构",
                  instruction: "structure",
                  dependsOn: [
                    fixed.id,
                    ...input
                      .state!.invocations.filter(
                        (n) => n.role === "designer" && n.status === "done",
                      )
                      .map((n) => n.id),
                  ],
                },
              ],
        },
      };
    }
    return caller(role, input);
  };
  try {
    const w = new Workbench(remedyCaller, dir, { visualContract: "legacy" });
    await w.start("timer");
    await w.answer(
      Object.fromEntries(w.project!.questions.map((q) => [q.id, q.options[0]])),
    );
    assert(diagnosed);
    assert.equal(w.project!.phase, "complete");
    assert(
      w.project!.nodes.some(
        (n) => n.role === "mechanical" && n.status === "done",
      ),
    );
    assert.equal(w.project!.gapOverrides, undefined);
  } finally {
    lib.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("unresolved stage gaps block, and only an authenticated explicit request continues with persisted uncertainty", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dreamatic-override-"));
  const w = new Workbench(caller, dir, { visualContract: "legacy" });
  const auth = new WorkbenchAuth();
  let server: ReturnType<typeof makeServer>["server"] | undefined;
  try {
    await w.start("timer");
    await w.answer(
      Object.fromEntries(w.project!.questions.map((q) => [q.id, q.options[0]])),
    );
    assert.equal(w.project!.phase, "blocked");
    assert.match(w.project!.error!, /红外传感器/);
    assert.match(w.project!.error!, /外观图片/);
    const id = w.project!.id,
      reason = w.project!.error!;
    server = makeServer(w, undefined, connectionStore, auth).server;
    await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
    const address = server.address();
    assert(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}/workbench-api/continue-with-gaps`;
    const post = (body: any, cookie?: string) =>
      fetch(base, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Workbench": "1",
          ...(cookie ? { Cookie: cookie } : {}),
        },
        body: JSON.stringify(body),
      });
    assert.equal((await post({ projectId: id, reason })).status, 401);
    const cookie = `dreamatic_workbench=${auth.createSession()}`;
    assert.equal(
      (await post({ projectId: id, reason: "stale" }, cookie)).status,
      409,
    );
    assert.equal((await post({ projectId: id, reason }, cookie)).status, 202);
    for (let i = 0; i < 100 && w.busy; i++)
      await new Promise((r) => setTimeout(r, 10));
    assert.equal(w.project!.phase, "complete");
    assert.equal(w.project!.gapOverrides!.length, 1);
    const mechanical = w.project!.nodes.find((n) => n.role === "mechanical")!;
    assert(
      mechanical.packet!.data.logic.some(
        (i) => i.kind === "unresolved-gap" && i.properties.reason === reason,
      ),
    );
    assert(
      w.project!.requests!.some((p) =>
        p.data.logic.some((i) => i.kind === "user-gap-override"),
      ),
    );
    const restored = new Workbench(caller, dir, { visualContract: "legacy" });
    await restored.restore();
    assert.equal(restored.project!.gapOverrides![0].reason, reason);
  } finally {
    if (server)
      await new Promise<void>((r, j) => server!.close((e) => (e ? j(e) : r())));
    await rm(dir, { recursive: true, force: true });
  }
});

test("repeated same-input protocol failures stop instead of creating an unbounded retry chain", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dreamatic-retry-"));
  const fail: Caller = async (role, input) => {
    if (role === "embedded")
      throw new SyntaxError("Unexpected end of JSON input");
    if (role === "analyst")
      return { summary: "questions", data: data(), questions: userQuestions };
    const done = (input.state?.invocations || []).find(
      (n) => n.role === "analyst" && n.status === "done",
    );
    return {
      summary: "next",
      decision: {
        action: "dispatch",
        reason: "next",
        tasks: done
          ? [
              task(
                "retry",
                "embedded",
                `红外在场检测硬件方案（改名${input.state?.invocations.length}）`,
                [done.id],
              ),
            ]
          : [task("analysis", "analyst", "分析")],
      },
    };
  };
  try {
    const w = new Workbench(fail, dir);
    await w.start("timer");
    await w.answer(
      Object.fromEntries(w.project!.questions.map((q) => [q.id, q.options[0]])),
    );
    assert.equal(w.project!.phase, "blocked");
    assert.equal(
      w.project!.nodes.filter((n) => n.role === "embedded").length,
      2,
    );
    assert.match(w.project!.error!, /两次/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

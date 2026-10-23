import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { Store } from "../packages/core/src/store";
import {
  Workflow,
  inputHash,
  invalidate,
  currentStage,
} from "../packages/core/src/workflow";
import {
  currentFunctionRouting,
  productFlowIssues,
} from "../packages/core/src/product-flow";
import { buildProductGraph } from "../apps/web/src/product-graph";
import {
  requirementDraft,
  functionDraft,
  hardwareDraft,
  productParts,
  routing,
} from "./fixtures/product-flow";

async function fixture() {
  const folder = await mkdtemp(join(tmpdir(), "make-flow-"));
  const store = new Store(folder, productParts),
    p = await store.create("鼠标", "办公鼠标"),
    workflow = new Workflow(store, productParts);
  for (const [stage, draft] of [
    ["requirements", requirementDraft],
    ["intent", functionDraft],
  ] as const) {
    await workflow.submit(p.id, stage, 1, "analyst", structuredClone(draft));
    await workflow.review(p.id, stage, 1, "pass", "fixture review");
    await workflow.approve(p.id, {
      stage,
      revision: 1,
      inputHash: inputHash(await store.get(p.id), stage),
      decision: "approved",
      key: randomUUID(),
    });
  }
  await workflow.submit(
    p.id,
    "hardware",
    1,
    "hardware-engineer",
    structuredClone(hardwareDraft),
  );
  return { folder, store, p, workflow };
}
test("统筹连接支持共享器件与一项功能多个器件，保存精确来源且不代用户确认", async () => {
  const f = await fixture();
  try {
    await f.workflow.routeFunctions(f.p.id, "hardware", 1, routing);
    const p = await f.store.get(f.p.id),
      route = currentFunctionRouting(p)!;
    assert.equal(
      route.links.filter((link) => link.partId === "controller").length,
      2,
    );
    assert.equal(
      route.links.filter((link) => link.functionId === "f-pointer").length,
      2,
    );
    assert.equal(route.partEvidence?.[0].libraryRef?.rawHash, "b".repeat(64));
    assert.equal(p.approvals.length, 2);
    assert.notEqual(p.stages.hardware.status, "approved");
    await f.workflow.review(p.id, "hardware", 1, "pass", "mapping covered");
    assert.equal(
      (await f.store.get(p.id)).stages.hardware.review?.verdict,
      "pass",
    );
  } finally {
    await rm(f.folder, { recursive: true, force: true });
  }
});
test("拒绝虚构功能端口、未选器件、孤立功能、孤立器件与伪软件豁免", async () => {
  const f = await fixture();
  try {
    const cases = [
      {
        ...routing,
        links: [
          ...routing.links,
          { functionId: "fake", partId: "sensor", role: "bad", reason: "bad" },
        ],
      },
      {
        ...routing,
        links: routing.links.map((l) => ({
          ...l,
          partId: l.partId === "sensor" ? "fake" : l.partId,
        })),
      },
      {
        ...routing,
        links: routing.links.filter((l) => l.functionId !== "f-click"),
      },
      { ...routing, links: routing.links.filter((l) => l.partId !== "sensor") },
      {
        ...routing,
        links: routing.links.filter((l) => l.functionId !== "f-click"),
        exceptions: [
          { functionId: "f-click", kind: "software", reason: "想绕过选型" },
        ],
      },
    ];
    for (const value of cases)
      await assert.rejects(() =>
        f.workflow.routeFunctions(f.p.id, "hardware", 1, value),
      );
    assert.equal((await f.store.get(f.p.id)).productFlow?.routing, undefined);
  } finally {
    await rm(f.folder, { recursive: true, force: true });
  }
});

test("多对多功能连接不能提升器件几何状态或绕过硬件阻塞", async () => {
  const f = await fixture();
  try {
    await f.store.saveCatalog(
      f.p.id,
      productParts.map((part) => ({ ...part, geometryVerified: false })),
    );
    await f.workflow.submit(
      f.p.id,
      "hardware",
      1,
      "hardware-engineer",
      structuredClone(hardwareDraft),
    );
    await f.workflow.routeFunctions(f.p.id, "hardware", 1, routing);
    await f.workflow.review(f.p.id, "hardware", 1, "pass", "功能连接完整");
    const p = await f.store.get(f.p.id);
    assert.equal(p.stages.hardware.review?.verdict, "changes_requested");
    assert.ok(
      p.stages.hardware.draft?.blockers.some((b) => b.includes("几何")),
    );
    assert.ok(
      (await f.workflow.catalogFor(p.id)).every(
        (part) => !part.geometryVerified,
      ),
    );
    await assert.rejects(() =>
      f.workflow.approve(p.id, {
        stage: "hardware",
        revision: 1,
        inputHash: inputHash(p, "hardware"),
        decision: "approved",
        key: randomUUID(),
      }),
    );
  } finally {
    await rm(f.folder, { recursive: true, force: true });
  }
});
test("功能输出引用真实需求，缺少结构化模块与重复端口不能作为新成果提交", async () => {
  const f = await fixture();
  try {
    await f.store.update(f.p.id, (p) => invalidate(p, "intent"));
    const invalid = structuredClone(functionDraft);
    invalid.functionModules![0].requirementIds = ["fake"];
    await assert.rejects(
      () => f.workflow.submit(f.p.id, "intent", 2, "analyst", invalid),
      /不存在/,
    );
    const legacy = structuredClone(functionDraft);
    delete legacy.functionModules;
    await assert.rejects(
      () => f.workflow.submit(f.p.id, "intent", 2, "analyst", legacy),
      /functionModules/,
    );
  } finally {
    await rm(f.folder, { recursive: true, force: true });
  }
});
test("输入或证据变化使路由失效，不能用旧审阅继续确认", async () => {
  const f = await fixture();
  try {
    await f.workflow.routeFunctions(f.p.id, "hardware", 1, routing);
    await f.workflow.review(f.p.id, "hardware", 1, "pass", "pass");
    await f.store.update(f.p.id, (p) => {
      p.stages.hardware.artifacts.push({
        id: "new-proof",
        name: "source-extra.json",
        hash: "new",
        path: "x",
        mime: "application/json",
        size: 1,
        stage: "hardware",
        revision: 1,
      });
    });
    const p = await f.store.get(f.p.id);
    assert.equal(currentFunctionRouting(p), undefined);
    assert.ok(productFlowIssues(p).length);
    await assert.rejects(
      () =>
        f.workflow.approve(p.id, {
          stage: "hardware",
          revision: 1,
          inputHash: inputHash(p, "hardware"),
          decision: "approved",
          key: randomUUID(),
        }),
      /审阅|连接/,
    );
  } finally {
    await rm(f.folder, { recursive: true, force: true });
  }
});
test("上游补充回退并使下游失效，保留旧确认，补充版必须再次经用户确认", async () => {
  const f = await fixture();
  try {
    const request = await f.workflow.requestUpstream(
      f.p.id,
      "hardware",
      1,
      "intent",
      "功能缺少采样率",
      ["明确位移采样的验收条件"],
    );
    let p = await f.store.get(f.p.id);
    assert.equal(currentStage(p), "intent");
    assert.equal(p.stages.hardware.status, "stale");
    assert.equal(p.approvals.length, 2);
    assert.equal(request.status, "open");
    await assert.rejects(
      () =>
        f.workflow.requestUpstream(p.id, "intent", 2, "intent", "bad", ["bad"]),
      /上游补充/,
    );
    await f.workflow.submit(
      p.id,
      "intent",
      2,
      "analyst",
      structuredClone(functionDraft),
    );
    await f.workflow.review(p.id, "intent", 2, "pass", "补齐");
    p = await f.store.get(p.id);
    assert.equal(p.productFlow?.requests[0].status, "open");
    await f.workflow.approve(p.id, {
      stage: "intent",
      revision: 2,
      inputHash: inputHash(p, "intent"),
      decision: "approved",
      key: randomUUID(),
    });
    p = await f.store.get(p.id);
    assert.equal(p.productFlow?.requests[0].status, "resolved");
    assert.equal(p.approvals.length, 3);
  } finally {
    await rm(f.folder, { recursive: true, force: true });
  }
});
test("画布连线都落在真实端口上，旧文字不冒充功能，多对多关系不丢失", async () => {
  const f = await fixture();
  try {
    await f.workflow.routeFunctions(f.p.id, "hardware", 1, routing);
    const p = await f.store.get(f.p.id),
      graph = buildProductGraph(
        { ...p, hashes: {} as any, flowRoutingCurrent: true },
        productParts,
      );
    assert.equal(
      graph.edges.filter((e) => e.data?.kind === "mapping").length,
      4,
    );
    for (const edge of graph.edges) {
      assert.ok(
        graph.nodes
          .find((n) => n.id === edge.source)
          ?.data.outputs.some((port) => port.id === edge.sourceHandle),
        edge.id,
      );
      assert.ok(
        graph.nodes
          .find((n) => n.id === edge.target)
          ?.data.inputs.some((port) => port.id === edge.targetHandle),
        edge.id,
      );
    }
    delete p.stages.intent.draft!.functionModules;
    const legacy = buildProductGraph(
      { ...p, hashes: {} as any, flowRoutingCurrent: false },
      productParts,
    );
    assert.equal(
      legacy.edges.filter((e) => e.data?.kind === "mapping").length,
      0,
    );
    assert.ok(
      legacy.nodes
        .find((n) => n.id === "intent")
        ?.data.outputs.some((port) => !port.ready),
    );
  } finally {
    await rm(f.folder, { recursive: true, force: true });
  }
});

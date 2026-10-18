import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Store, within } from "../packages/core/src/store";
import {
  Workflow,
  inputHash,
  currentStage,
  invalidate,
} from "../packages/core/src/workflow";
import {
  stages,
  roleForStage,
  enclosureSchema,
  type StageDraft,
} from "../packages/core/src/contracts";
import { Settings } from "../packages/core/src/settings";
import { runProcess } from "../packages/core/src/worker";
const draft: StageDraft = {
  title: "USB 桌面原型",
  summary: "有证据的设计草稿",
  facts: [{ label: "供电", value: "USB 5V" }],
  assumptions: [],
  blockers: [],
  choices: [],
  partIds: [],
};
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "make-test-"));
  const store = new Store(dir),
    p = await store.create("测试项目", "USB 供电桌面原型");
  return { dir, store, p, w: new Workflow(store, []) };
}
test("审批绑定当前版本、独立审阅与幂等键，修改使下游失效", async () => {
  const { dir, store, p, w } = await fixture();
  try {
    await assert.rejects(
      () => w.submit(p.id, "requirements", 1, "reviewer", draft),
      /角色/,
    );
    await w.submit(p.id, "requirements", 1, "analyst", draft);
    let fresh = await store.get(p.id);
    const args = {
      stage: "requirements" as const,
      revision: 1,
      inputHash: inputHash(fresh, "requirements"),
      decision: "approved" as const,
      key: randomUUID(),
    };
    await assert.rejects(() => w.approve(p.id, args), /独立审阅/);
    await w.review(p.id, "requirements", 1, "pass", "目标和验收清单一致");
    await w.approve(p.id, args);
    await w.approve(p.id, args);
    fresh = await store.get(p.id);
    assert.equal(fresh.approvals.length, 1);
    assert.equal(currentStage(fresh), "intent");
    await assert.rejects(
      () => w.approve(p.id, { ...args, key: randomUUID() }),
      /版本/,
    );
    await store.update(p.id, (p) => invalidate(p, "requirements"));
    fresh = await store.get(p.id);
    assert.equal(fresh.stages.requirements.status, "stale");
    assert.equal(fresh.stages.cad.revision, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("选择候选后旧审阅失效，未回答问题不允许确认", async () => {
  const { dir, store, p, w } = await fixture();
  try {
    await w.submit(p.id, "requirements", 1, "analyst", {
      ...draft,
      choices: [{ id: "a", label: "方案 A", description: "USB" }],
    });
    await w.review(p.id, "requirements", 1, "pass", "通过");
    await w.choose(p.id, "requirements", 1, "a");
    let fresh = await store.get(p.id);
    assert.equal(fresh.stages.requirements.review, undefined);
    await w.review(p.id, "requirements", 1, "pass", "已选 A");
    await w.ask(p.id, {
      title: "预算？",
      questions: [
        { id: "budget", label: "预算", options: ["200 元"], required: true },
      ],
    });
    fresh = await store.get(p.id);
    const args = {
      stage: "requirements" as const,
      revision: 1,
      inputHash: inputHash(fresh, "requirements"),
      decision: "approved" as const,
      key: randomUUID(),
    };
    await assert.rejects(() => w.approve(p.id, args), /独立审阅|回答/);
    const card = fresh.messages.find((m) => m.interaction)!.interaction!;
    await assert.rejects(() => w.answer(p.id, card.id, {}), /必填/);
    await w.answer(p.id, card.id, { budget: "200 元" });
    await w.review(p.id, "requirements", 1, "pass", "回答已纳入审阅");
    fresh = await store.get(p.id);
    await w.approve(p.id, {
      ...args,
      inputHash: inputHash(fresh, "requirements"),
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("工程产物哈希改变后禁止确认，几何缺口不会被模型清除", async () => {
  const { dir, store, p, w } = await fixture();
  try {
    const artifact = await store.artifact(
      p.id,
      "requirements",
      1,
      "evidence.txt",
      "original",
      "text/plain",
    );
    await w.submit(p.id, "requirements", 1, "analyst", draft);
    await store.update(p.id, (p) => {
      p.stages.requirements.artifacts = [artifact];
    });
    await w.review(p.id, "requirements", 1, "pass", "通过");
    const fresh = await store.get(p.id);
    await writeFile(within(store.dir(p.id), artifact.path), "tampered");
    await assert.rejects(
      () =>
        w.approve(p.id, {
          stage: "requirements",
          revision: 1,
          inputHash: inputHash(fresh, "requirements"),
          decision: "approved",
          key: randomUUID(),
        }),
      /产物已变更/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("串行更新与并发事件序号无丢失；中断执行可恢复", async () => {
  const { dir, store, p } = await fixture();
  try {
    await Promise.all(
      Array.from({ length: 15 }, (_, i) =>
        store.update(p.id, (p) => {
          p.messages.push({
            id: String(i),
            role: "system",
            text: "事件",
            createdAt: new Date().toISOString(),
          });
        }),
      ),
    );
    await Promise.all(
      Array.from({ length: 25 }, () => store.emit(p.id, "test", {})),
    );
    const events = await store.history(p.id);
    assert.equal(new Set(events.map((e) => e.sequence)).size, 40);
    assert.equal(events.length, 40);
    await store.update(p.id, (p) => {
      p.running = true;
      p.stages.requirements.status = "running";
    });
    await store.recover();
    const fresh = await store.get(p.id);
    assert.equal(fresh.running, false);
    assert.equal(fresh.stages.requirements.status, "failed");
    assert.equal(fresh.messages.length, 16);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("设置保存保留未知字段和注释，密钥掩码且正确处理并发更新", async () => {
  const dir = await mkdtemp(join(tmpdir(), "make-config-"));
  try {
    const settings = new Settings(dir);
    await writeFile(
      join(dir, ".env"),
      "# retained\nCUSTOM=untouched\nMAKE_API_KEY=old-secret\n",
    );
    await Promise.all([
      settings.save({ MAKE_MODEL: "model-a" }),
      settings.save({ MAKE_API_KEY: "new-secret" }),
    ]);
    const publicConfig = await settings.public();
    assert.equal(
      publicConfig.fields.find((f) => f.key === "MAKE_API_KEY")?.value,
      "",
    );
    assert.equal(
      publicConfig.fields.find((f) => f.key === "MAKE_API_KEY")?.configured,
      true,
    );
    assert.equal((await settings.snapshot()).MAKE_MODEL, "model-a");
    assert.match(
      await readFile(join(dir, ".env"), "utf8"),
      /# retained\nCUSTOM=untouched/,
    );
    await assert.rejects(() =>
      settings.save({ MAKE_BASE_URL: "file:///etc/passwd" }),
    );
    await assert.rejects(() => settings.save({ MAKE_MODEL: "bad\nvalue" }));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("路径、无效几何与失控进程被拒绝", async () => {
  assert.throws(() => within("/tmp/make-safe", "../secrets"));
  assert.throws(() =>
    enclosureSchema.parse({
      width: 20,
      depth: 20,
      height: 20,
      wall: 6,
      lid: 2,
      clearance: 0.3,
      holes: [],
    }),
  );
  assert.throws(() =>
    enclosureSchema.parse({
      width: 90,
      depth: 65,
      height: 35,
      wall: 2,
      lid: 2,
      clearance: 0.3,
      holes: [{ x: 44, y: 0, diameter: 3 }],
    }),
  );
  await assert.rejects(
    () =>
      runProcess(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
        cwd: tmpdir(),
        timeout: 100,
      }),
    /超时/,
  );
});

test("硬件尺寸缺口由服务端追加阻塞，不能被作者或审阅者清除", async () => {
  const { dir, store, p } = await fixture();
  try {
    const catalog = JSON.parse(await readFile("catalog/parts.json", "utf8"));
    const w = new Workflow(store, catalog);
    await store.update(p.id, (p) => {
      p.stages.requirements.status = "approved";
      p.stages.intent.status = "approved";
    });
    await w.submit(p.id, "hardware", 1, "hardware-engineer", {
      ...draft,
      partIds: ["rpi-pico"],
      blockers: [],
    });
    const part = catalog.find((part: any) => part.id === "rpi-pico");
    await w.submit(p.id, "hardware", 1, "hardware-engineer", {
      ...draft,
      partIds: ["rpi-pico", "rpi-pico"],
      blockers: [
        `${part.name} 的完整安装几何尚未核验（服务端自动追加；待实测）`,
        `${part.name} 的完整安装几何尚未核验`,
        "电机峰值电流待核验",
      ],
    });
    const normalized = (await store.get(p.id)).stages.hardware.draft!;
    assert.equal(
      normalized.blockers.filter((b) => b.includes("完整安装几何")).length,
      1,
    );
    assert(normalized.blockers.includes("电机峰值电流待核验"));
    await w.review(p.id, "hardware", 1, "pass", "模型声称通过不能覆盖未知几何");
    const fresh = await store.get(p.id);
    assert(
      fresh.stages.hardware.draft?.blockers.some((b) => b.includes("几何")),
    );
    await assert.rejects(
      () =>
        w.approve(p.id, {
          stage: "hardware",
          revision: 1,
          inputHash: inputHash(fresh, "hardware"),
          decision: "approved",
          key: randomUUID(),
        }),
      /独立审阅|几何/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("重新打开上游保留历史，用户输入改变后旧审阅不可确认", async () => {
  const { dir, store, p, w } = await fixture();
  try {
    await w.submit(p.id, "requirements", 1, "analyst", draft);
    await w.review(p.id, "requirements", 1, "pass", "初始审阅");
    await store.update(p.id, (p) =>
      p.messages.push({
        id: randomUUID(),
        role: "user",
        text: "预算改为 100 元",
        createdAt: new Date().toISOString(),
      }),
    );
    let fresh = await store.get(p.id);
    await assert.rejects(
      () =>
        w.approve(p.id, {
          stage: "requirements",
          revision: 1,
          inputHash: inputHash(fresh, "requirements"),
          decision: "approved",
          key: randomUUID(),
        }),
      /独立审阅/,
    );
    await w.review(p.id, "requirements", 1, "pass", "更新预算审阅");
    fresh = await store.get(p.id);
    await w.approve(p.id, {
      stage: "requirements",
      revision: 1,
      inputHash: inputHash(fresh, "requirements"),
      decision: "approved",
      key: randomUUID(),
    });
    await w.revise(p.id, "requirements", 1, "增加一个旋钮");
    fresh = await store.get(p.id);
    assert.equal(fresh.stages.requirements.revision, 2);
    assert.equal(fresh.stages.requirements.status, "stale");
    assert.equal(fresh.stages.firmware.revision, 2);
    assert(
      (await store.versions(p.id)).some((v) =>
        v.stages.some(
          (s) => s.id === "requirements" && s.status === "approved",
        ),
      ),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("需求阶段允许后续尺寸核验，当前 blockers 与 pass 不得同时存在", async () => {
  const { dir, store, p, w } = await fixture();
  try {
    await w.submit(p.id, "requirements", 1, "analyst", {
      ...draft,
      blockers: ["Pico 高度待实测"],
    });
    await w.review(p.id, "requirements", 1, "pass", "后续尺寸不影响需求完整性");
    let fresh = await store.get(p.id);
    assert.equal(
      fresh.stages.requirements.review?.verdict,
      "changes_requested",
    );
    await assert.rejects(
      () =>
        w.approve(p.id, {
          stage: "requirements",
          revision: 1,
          inputHash: inputHash(fresh, "requirements"),
          decision: "approved",
          key: randomUUID(),
        }),
      /独立审阅/,
    );
    await assert.rejects(
      () =>
        w.submit(p.id, "requirements", 1, "analyst", {
          ...draft,
          futureChecks: [
            { stage: "requirements", description: "当前问题不能推迟" },
          ],
        }),
      /后续阶段/,
    );
    await w.submit(p.id, "requirements", 1, "analyst", {
      ...draft,
      blockers: [],
      futureChecks: [
        {
          stage: "hardware",
          description: "Pico 器件高度、插头与安装空间需实测",
        },
      ],
    });
    await w.review(
      p.id,
      "requirements",
      1,
      "pass",
      "需求已完整，后续硬件核验单独保留",
    );
    fresh = await store.get(p.id);
    await w.approve(p.id, {
      stage: "requirements",
      revision: 1,
      inputHash: inputHash(fresh, "requirements"),
      decision: "approved",
      key: randomUUID(),
    });
    fresh = await store.get(p.id);
    assert.equal(fresh.stages.requirements.status, "approved");
    assert.equal(
      fresh.stages.requirements.draft?.futureChecks?.[0].stage,
      "hardware",
    );
    assert.equal(currentStage(fresh), "intent");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("非机械阶段拒绝顶层和候选几何字段，且不写入草稿", async () => {
  const { dir, store, p, w } = await fixture();
  try {
    for (const stage of [
      "requirements",
      "intent",
      "hardware",
      "cad",
      "firmware",
      "delivery",
    ] as const) {
      await assert.rejects(
        w.submit(p.id, stage, 1, roleForStage[stage], {
          ...draft,
          parameters: p.parameters,
        }),
        /Unrecognized key/,
      );
      await assert.rejects(
        w.submit(p.id, stage, 1, roleForStage[stage], {
          ...draft,
          choices: [
            {
              id: "a",
              label: "A",
              description: "test",
              parameters: p.parameters,
            },
          ],
        }),
        /Unrecognized key/,
      );
    }
    assert.equal((await store.get(p.id)).stages.requirements.draft, undefined);
    for (const stage of ["appearance", "structure"] as const) {
      await store.update(p.id, (project) => {
        for (const name of stages.slice(0, stages.indexOf(stage)))
          project.stages[name].status = "approved";
      });
      await w.submit(p.id, stage, 1, roleForStage[stage], {
        ...draft,
        parameters: { ...p.parameters, width: 100 },
      });
      assert.equal((await store.get(p.id)).parameters.width, 100);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("自动完善保留审阅与阻塞信息，无需用户编写方案且不自动批准", async () => {
  const { dir, store, p, w } = await fixture();
  try {
    await w.submit(p.id, "requirements", 1, "analyst", {
      ...draft,
      blockers: ["缺少供电需求核验"],
    });
    await w.review(
      p.id,
      "requirements",
      1,
      "changes_requested",
      "**核验供电**后重新提交",
    );
    const before = await store.get(p.id);
    await w.approve(p.id, {
      stage: "requirements",
      revision: 1,
      inputHash: inputHash(before, "requirements"),
      decision: "changes_requested",
      key: randomUUID(),
    });
    const after = await store.get(p.id);
    assert.equal(after.stages.requirements.revision, 2);
    assert.equal(after.stages.requirements.review, undefined);
    assert.notEqual(after.stages.requirements.status, "approved");
    const instruction = after.messages.at(-1)!.text;
    assert.match(instruction, /核验供电.*重新提交/);
    assert.match(instruction, /缺少供电需求核验/);
    assert.match(instruction, /用户无额外补充/);
    assert.match(instruction, /结构化问题卡/);
    assert.match(instruction, /不得自动代替用户批准/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

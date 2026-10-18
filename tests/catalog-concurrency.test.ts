import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../packages/core/src/store";
import { Workflow } from "../packages/core/src/workflow";
import type { Part } from "../packages/core/src/contracts";
test("并行添加部件不会覆盖目录，重复 ID 拒绝且后续写入仍可进行", async () => {
  const dir = await mkdtemp(join(tmpdir(), "make-catalog-race-"));
  try {
    const store = new Store(dir),
      project = await store.create("风扇", "多部件");
    const part = (id: string): Part => ({
      id,
      name: id,
      manufacturer: "fixture",
      revision: "1",
      source: "https://example.com/",
      licenseSource: "",
      openHardware: "unverified",
      geometryVerified: false,
      dimensions: { width: 10, depth: 10, height: null },
      holes: [],
      voltage: "3.3V",
      logic: "3.3V",
      interfaces: [],
      notes: "测试",
      checkedAt: "2026-10-18",
    });
    await Promise.all(
      ["aht20", "apds9960", "ssd1306"].map((id) =>
        store.addCatalogPart(project.id, part(id)),
      ),
    );
    assert.deepEqual(
      (await store.projectCatalog(project.id)).map((item) => item.id),
      ["aht20", "apds9960", "ssd1306"],
    );
    await assert.rejects(
      store.addCatalogPart(project.id, part("aht20")),
      /已存在/,
    );
    await store.addCatalogPart(project.id, part("battery"));
    assert.equal((await store.projectCatalog(project.id)).length, 4);
    const workflow = new Workflow(store, []);
    const question = {
      title: "来源",
      questions: [
        { id: "source", label: "请提供硬件来源", options: [], required: true },
      ],
    };
    await workflow.ask(project.id, question);
    const card = (await store.get(project.id)).messages.find(
      (message) => message.interaction,
    )!.interaction!;
    await workflow.answer(project.id, card.id, { source: "暂缓调查" });
    await assert.rejects(workflow.ask(project.id, question), /已经回答/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  rm,
  mkdir,
  readFile,
  writeFile,
  access,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../packages/core/src/store";
import { Settings } from "../packages/core/src/settings";
import {
  workspacePath,
  prepareWorkspace,
} from "../packages/core/src/workspace";
import { createApp } from "../apps/server/src/index";
import { once } from "node:events";

test("工作目录默认和相对路径基于系统根目录；保存后重启使用配置", async () => {
  const root = await mkdtemp(join(tmpdir(), "make-root-"));
  try {
    const settings = new Settings(root);
    assert.equal(
      workspacePath(root, (await settings.snapshot()).MAKE_WORKSPACE),
      join(root, "workspace"),
    );
    await settings.save({ MAKE_WORKSPACE: "data/projects" });
    assert.equal(
      workspacePath(root, (await settings.snapshot()).MAKE_WORKSPACE),
      join(root, "data/projects"),
    );
    await settings.save({ MAKE_WORKSPACE: join(root, "absolute") });
    assert.equal(
      workspacePath(root, (await settings.snapshot()).MAKE_WORKSPACE),
      join(root, "absolute"),
    );
    await assert.rejects(() => settings.save({ MAKE_WORKSPACE: "/" }));
    await assert.rejects(() => settings.save({ MAKE_WORKSPACE: root }));
    assert(
      (await settings.public()).fields.find((f) => f.key === "MAKE_WORKSPACE")
        ?.restartRequired,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("旧项目无损迁移到独立目录：ID、会话、产物、历史与哈希保持不变", async () => {
  const root = await mkdtemp(join(tmpdir(), "make-layout-"));
  try {
    const old = new Store(join(root, "projects"));
    const p = await old.create("旧项目", "完整数据");
    await writeFile(join(old.dir(p.id), "sessions", "test.jsonl"), "session");
    const a = await old.artifact(
      p.id,
      "requirements",
      1,
      "brief.txt",
      "evidence",
      "text/plain",
    );
    await old.update(p.id, (p) => p.stages.requirements.artifacts.push(a));
    const before = await readFile(join(old.dir(p.id), "project.json"), "utf8");
    const store = new Store(root);
    await store.initialize();
    assert.equal(store.dir(p.id), join(root, p.id));
    assert.equal(
      await readFile(join(store.dir(p.id), "project.json"), "utf8"),
      before,
    );
    assert.equal(
      await readFile(join(store.dir(p.id), "sessions/test.jsonl"), "utf8"),
      "session",
    );
    await store.verify(p.id, [a]);
    assert((await store.versions(p.id)).length > 0);
    await store.initialize();
    assert.equal((await store.list()).length, 1);
    const next = await store.create("新项目", "新文件");
    assert.equal(store.dir(next.id), join(root, next.id));
    await access(join(store.dir(next.id), "context"));
    assert.equal((await store.list()).length, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("目录迁移冲突时停止，不覆盖任何项目文件", async () => {
  const root = await mkdtemp(join(tmpdir(), "make-conflict-"));
  try {
    const legacy = new Store(join(root, "projects")),
      p = await legacy.create("旧项目", "旧数据");
    await mkdir(join(root, p.id));
    await writeFile(join(root, p.id, "keep.txt"), "keep");
    await assert.rejects(() => new Store(root).initialize(), /冲突/);
    assert.equal(await readFile(join(root, p.id, "keep.txt"), "utf8"), "keep");
    assert.equal((await legacy.get(p.id)).name, "旧项目");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("项目目录与硬件测量隔离；重启后保持项目快照", async () => {
  const root = await mkdtemp(join(tmpdir(), "make-isolation-"));
  const app = await createApp(root);
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  const url = `http://127.0.0.1:${(app.server.address() as any).port}`;
  try {
    const a = await app.store.create("A", "项目 A"),
      b = await app.store.create("B", "项目 B");
    const original = await app.workflow.catalogFor(b.id);
    const response = await fetch(
      url + `/api/projects/${a.id}/catalog/rpi-pico/measure`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          width: 21,
          depth: 51,
          height: 7,
          notes: "仅在 A 项目中记录的实际测量依据",
        }),
      },
    );
    assert.equal(response.status, 200);
    assert.equal((await app.workflow.catalogFor(a.id))[0].dimensions.height, 7);
    assert.deepEqual(await app.workflow.catalogFor(b.id), original);
    const project = await (await fetch(url + "/api/projects/" + a.id)).json();
    assert.equal(project.projectPath, join(root, a.id));
    const aArtifact = await app.store.artifact(
      a.id,
      "requirements",
      1,
      "private.txt",
      "A only",
      "text/plain",
    );
    await app.store.update(a.id, (p) =>
      p.stages.requirements.artifacts.push(aArtifact),
    );
    assert.equal(
      (await fetch(url + `/api/projects/${b.id}/artifacts/${aArtifact.id}`))
        .status,
      404,
    );
    assert.equal(new Store(root).dir(a.id), join(root, a.id));
    assert.equal(
      (await new Store(root).projectCatalog(a.id))[0].dimensions.height,
      7,
    );
  } finally {
    app.server.closeAllConnections();
    await new Promise<void>((done) => app.server.close(() => done()));
    await rm(root, { recursive: true, force: true });
  }
});

test("共享工具链与系统文件归入 .system，不混入项目列表", async () => {
  const root = await mkdtemp(join(tmpdir(), "make-shared-"));
  try {
    await mkdir(join(root, "toolchains/platformio"), { recursive: true });
    await writeFile(join(root, "toolchains/platformio/keep"), "cache");
    await writeFile(join(root, "custom-parts.json"), "[]");
    await prepareWorkspace(root);
    assert.equal(
      await readFile(join(root, ".system/toolchains/platformio/keep"), "utf8"),
      "cache",
    );
    assert.equal(
      await readFile(join(root, ".system/custom-parts.json"), "utf8"),
      "[]",
    );
    assert.deepEqual(await new Store(root).list(), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Settings 更换工作目录只在下一次启动生效，原项目保留且切回可用", async () => {
  const root = await mkdtemp(join(tmpdir(), "make-switch-"));
  try {
    const settings = new Settings(root);
    const first = join(root, "first"),
      second = join(root, "second");
    await settings.save({ MAKE_WORKSPACE: first });
    const app1 = await createApp(undefined, settings);
    const project = await app1.store.create("原项目", "保持原文件");
    await settings.save({ MAKE_WORKSPACE: second });
    assert.equal(app1.store.root, first);
    assert.equal((await app1.store.get(project.id)).name, "原项目");
    const app2 = await createApp(undefined, settings);
    assert.equal(app2.store.root, second);
    assert.deepEqual(await app2.store.list(), []);
    await access(join(first, project.id, "project.json"));
    await settings.save({ MAKE_WORKSPACE: first });
    const app3 = await createApp(undefined, settings);
    assert.equal((await app3.store.list())[0].id, project.id);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

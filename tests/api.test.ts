import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { once } from "node:events";
import { createApp } from "../apps/server/src/index";
test("API 项目管理、受限文件、来源检查与脱敏导出", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "make-api-"));
  const app = await createApp(workspace);
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  const url = `http://127.0.0.1:${(app.server.address() as any).port}`;
  const call = (path: string, method = "GET", data?: unknown) =>
    fetch(url + "/api" + path, {
      method,
      headers: data ? { "Content-Type": "application/json" } : {},
      body: data ? JSON.stringify(data) : undefined,
    });
  try {
    let r = await call("/projects", "POST", {
      name: "API 测试",
      brief: "一个 USB 桌面终端",
    });
    assert.equal(r.status, 201);
    const p = await r.json();
    r = await call("/projects/" + p.id);
    assert.equal((await r.json()).currentStage, "requirements");
    r = await call("/projects/" + p.id + "/artifacts/unknown");
    assert.equal(r.status, 404);
    r = await call("/projects/" + p.id + "/text-parameters", "POST", {
      instruction: "90×65×35",
    });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).parameters.width, 90);
    r = await call("/projects/" + p.id + "/export");
    assert.equal(r.headers.get("content-type"), "application/zip");
    r = await fetch(url + "/api/settings", {
      headers: { Origin: "https://evil.example" },
    });
    assert.equal(r.status, 403);
    r = await call("/projects/" + p.id, "PATCH", { archived: true });
    assert.equal(r.status, 200);
    r = await call("/projects/" + p.id);
    assert.equal((await r.json()).archived, true);
    r = await call("/agents");
    assert.equal((await r.json()).length, 8);
  } finally {
    app.server.closeAllConnections();
    await new Promise<void>((done) => app.server.close(() => done()));
    await rm(workspace, { recursive: true, force: true });
  }
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { Store } from "../packages/core/src/store";
import { Settings } from "../packages/core/src/settings";
import { Workflow } from "../packages/core/src/workflow";
import { Runtime } from "../packages/agent-runtime/src/runtime";
import { defaultEnclosure } from "../packages/core/src/contracts";
test("图生 CAD 实际发送图片与尺度，返回待确认参数，不自动建模", async () => {
  let receivedImage = false,
    receivedScale = false,
    calledCad = false;
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const c of req) raw += c;
    const body = JSON.parse(raw);
    assert.equal(req.url, "/image/v1/chat/completions");
    assert.equal(req.headers.authorization, "Bearer image-fixture");
    assert.equal(body.model, "independent-vision");
    receivedImage = body.messages.some(
      (m: any) =>
        Array.isArray(m.content) &&
        m.content.some(
          (c: any) =>
            c.type === "image_url" &&
            c.image_url.url.startsWith("data:image/png;base64,"),
        ),
    );
    receivedScale = raw.includes("100 mm");
    const answer = {
      parameters: { ...defaultEnclosure, width: 100 },
      observations: ["矩形分体外壳"],
      uncertainties: ["深度和内部结构无法从单图确定"],
    };
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    for (const [delta, finish_reason] of [
      [{ role: "assistant", content: JSON.stringify(answer) }, null],
      [{}, "stop"],
    ])
      res.write(
        "data: " +
          JSON.stringify({
            id: "vision-fixture",
            object: "chat.completion.chunk",
            created: 1,
            model: "fixture",
            choices: [{ index: 0, delta, finish_reason }],
          }) +
          "\n\n",
      );
    res.end("data: [DONE]\n\n");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const dir = await mkdtemp(join(tmpdir(), "make-vision-")),
    settings = new Settings(dir),
    store = new Store(join(dir, "projects"));
  try {
    await settings.save({
      MAKE_API_KEY: "",
      MAKE_BASE_URL: "http://127.0.0.1:1/v1",
      MAKE_MODEL: "reasoning-fixture",
      MAKE_IMAGE_API_KEY: "image-fixture",
      MAKE_IMAGE_BASE_URL: `http://127.0.0.1:${(server.address() as any).port}/image/v1`,
      MAKE_IMAGE_MODEL: "independent-vision",
    });
    const p = await store.create("图生 CAD 测试", "外壳参考"),
      attachmentId = randomUUID();
    await mkdir(join(store.dir(p.id), "uploads"), { recursive: true });
    await writeFile(
      join(store.dir(p.id), "uploads", "reference.png"),
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/gWQAAAAASUVORK5CYII=",
        "base64",
      ),
    );
    await writeFile(
      join(store.dir(p.id), "uploads.json"),
      JSON.stringify([
        {
          id: attachmentId,
          name: "reference.png",
          mime: "image/png",
          path: "uploads/reference.png",
        },
      ]),
    );
    const runtime = new Runtime(
      resolve("."),
      store,
      new Workflow(store, []),
      settings,
      {
        cad: async () => {
          calledCad = true;
        },
        firmware: async () => {},
      },
    );
    const result = await runtime.interpretImage(
      p.id,
      attachmentId,
      100,
      "保持图片比例",
    );
    assert(receivedImage && receivedScale);
    assert.equal(result.requiresConfirmation, true);
    assert.equal(result.parameters.width, 100);
    assert.equal(calledCad, false);
    assert.equal((await store.get(p.id)).parameters.width, 90);
    await assert.rejects(
      () => runtime.interpretImage(p.id, attachmentId, 0, ""),
      /参考宽度/,
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
    await rm(dir, { recursive: true, force: true });
  }
});

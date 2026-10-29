import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32, deflateSync } from "node:zlib";
import { ConnectionStore } from "../packages/workbench/connection";
import {
  ImageStore,
  imageInfo,
  imagePacket,
  type ImageAsset,
} from "../packages/workbench/images";
import {
  imageTools,
  validateImageOutput,
} from "../packages/workbench/image-tools";
import { packetSchema, type Packet } from "../packages/workbench/contracts";
import { Workbench, type Caller } from "../packages/workbench/runtime";
import { makeServer } from "../apps/workbench/server";
import { emptyData } from "./workbench-fixtures";
import {
  imagePreviewItems,
  inheritedImagePackets,
} from "../packages/workbench/image-preview";
import { renderLayoutViews } from "../packages/workbench/layout-tools";
import type { HardwareLibrary } from "../packages/workbench/hardware";
import type { Project, Invocation } from "../packages/workbench/contracts";

const KEY = "image-test-key-only";
const MODEL = "doubao-seedream-4-5-251128";
function png() {
  const chunk = (type: string, data: Buffer) => {
    const name = Buffer.from(type);
    const size = Buffer.alloc(4);
    size.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
    return Buffer.concat([size, name, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(64, 0);
  ihdr.writeUInt32BE(64, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc(64 * (1 + 64 * 4), 255);
  for (let y = 0; y < 64; y++) raw[y * (1 + 64 * 4)] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
async function settings(dir: string) {
  const store = new ConnectionStore(join(dir, "settings"), (async () =>
    Response.json({
      data: [{ id: "deepseek-flash" }, { id: "kimi-k3.1-pro" }, { id: MODEL }],
    })) as typeof fetch);
  await store.save({
    baseUrl: "https://images.example/v1",
    apiKey: KEY,
    generalModel: "deepseek-flash",
    cadModel: "kimi-k3.1-pro",
    imageModel: MODEL,
  });
  return store;
}
const request = {
  imageSet: "appearance" as const,
  view: "perspective" as const,
  label: "产品透视效果图待生成规范",
  prompt: "浅灰圆角Arduino Nano ESP32桌面保护外壳，USB-C接口开放，概念产品渲染",
};

test("real image bytes are persisted with hashes, cached without a second charge and referenced across views", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dreamatic-images-"));
  try {
    const config = await settings(dir);
    let calls = 0;
    const images = new ImageStore(join(dir, "images"), config, (async (
      url,
      init,
    ) => {
      assert.equal(String(url), "https://images.example/v1/images/generations");
      assert.equal(
        new Headers(init?.headers).get("Authorization"),
        `Bearer ${KEY}`,
      );
      const body = JSON.parse(init!.body as string);
      assert.equal(body.model, MODEL);
      assert.equal(body.response_format, "b64_json");
      if (calls++)
        assert.match(
          Array.isArray(body.image) ? body.image[0] : body.image,
          /^data:image\/png;base64,/,
        );
      if (Array.isArray(body.image)) assert.equal(body.image.length, 2);
      return Response.json({ data: [{ b64_json: png().toString("base64") }] });
    }) as typeof fetch);
    const first = await images.generate(request);
    assert.equal(first.label, "产品透视效果图");
    assert.equal(first.width, 64);
    assert.equal(first.engineeringVerified, false);
    assert.equal((await images.generate(request)).id, first.id);
    assert.equal(calls, 1);
    const next = await images.generate({ ...request, view: "front" }, first);
    assert.equal(next.referenceAssetId, first.id);
    assert.equal(calls, 2);
    const hardware = {
      bytes: png(),
      mime: "image/png",
      reference: {
        source: "arduino" as const,
        recordId: "board",
        revision: "a".repeat(64),
        assetId: "board-photo",
        sha256: createHash("sha256").update(png()).digest("hex"),
      },
    };
    await assert.rejects(
      () => images.generate({ ...request, view: "top" }, first, hardware),
      /纯外观/,
    );
    await assert.rejects(
      () => images.generate({ ...request, imageSet: "component_layout" }),
      /几何投影/,
    );
    assert.equal(
      calls,
      2,
      "Neither internal hardware references nor layout views may be sent to the appearance model",
    );
    assert.equal(
      (await stat(join(dir, "images", first.id + ".bin"))).mode & 0o777,
      0o600,
    );
    packetSchema.parse(imagePacket(first));
    assert(!JSON.stringify(first).includes(KEY));
    await writeFile(join(dir, "images", first.id + ".bin"), "corrupt");
    await assert.rejects(() => images.read(first.id), /SHA-256/);
    assert.throws(() => imageInfo(Buffer.from("<svg></svg>")), /不是/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("image failures never become assets and upstream errors redact credentials", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dreamatic-images-error-"));
  try {
    const config = await settings(dir);
    const images = new ImageStore(join(dir, "error"), config, (async () =>
      Response.json(
        { error: { message: `rejected ${KEY}` } },
        { status: 401 },
      )) as typeof fetch);
    await assert.rejects(
      () => images.generate(request),
      (e) =>
        e instanceof Error &&
        e.message.includes("401") &&
        !e.message.includes(KEY),
    );
    const noImage = new ImageStore(join(dir, "no-image"), config, (async () =>
      Response.json({ data: [{ text: "a picture" }] })) as typeof fetch);
    await assert.rejects(() => noImage.generate(request), /没有图像/);
    const localURL = new ImageStore(join(dir, "local-url"), config, (async () =>
      Response.json({
        data: [{ url: "https://127.0.0.1/private" }],
      })) as typeof fetch);
    await assert.rejects(() => localURL.generate(request), /私网/);
    await assert.rejects(
      () =>
        config.save({
          baseUrl: "https://images.example/v1",
          generalModel: "deepseek-flash",
          cadModel: "kimi-k3.1-pro",
          imageModel: "kimi-k3.1-pro",
        }),
      /生图模型/,
    );
    await config.save({
      baseUrl: "https://images.example/v1",
      generalModel: "deepseek-flash",
      cadModel: "kimi-k3.1-pro",
    });
    assert.equal((await config.public()).imageModel, MODEL);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("actual images replace duplicate model reference cards and pending view placeholders in the preview", () => {
  const generated = {
    id: "image:real",
    kind: "generated-image",
    label: "实际透视图",
    properties: { view: "perspective", imageUrl: "/workbench-api/images/real" },
    references: [],
  };
  const packet: Packet = {
    version: "dreamatic.workbench/1",
    id: "render",
    invocationId: "designer",
    inputs: [],
    summary: "render",
    evidence: "proposal",
    data: {
      ...emptyData(),
      structure: [
        {
          id: "reference-card",
          kind: "image-reference",
          label: "透视图已生成",
          properties: { view: "perspective", toolItemId: generated.id },
          references: [],
        },
        {
          id: "request",
          kind: "image-request",
          label: "待生成透视",
          properties: { view: "perspective", prompt: "original" },
          references: [],
        },
        generated,
      ],
    },
  };
  const result = imagePreviewItems({
    id: "designer",
    role: "designer",
    title: "render",
    status: "done",
    inputs: [],
    packet,
  });
  assert.deepEqual(
    result.items.map((i) => i.id),
    [generated.id],
  );
  assert.equal(result.ids.size, 3);
});

test("image tools execute only existing requests, keep partial execution evidence and reject fabricated outputs", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dreamatic-image-tools-"));
  try {
    const config = await settings(dir);
    let calls = 0;
    const observed: ImageAsset[] = [];
    const images = new ImageStore(join(dir, "images"), config, (async () =>
      ++calls === 1
        ? Response.json({ data: [{ b64_json: png().toString("base64") }] })
        : Response.json(
            { error: { message: "unavailable" } },
            { status: 503 },
          )) as typeof fetch);
    const input: Packet = {
      version: "dreamatic.workbench/1",
      id: "requests",
      invocationId: "designer",
      inputs: [],
      summary: "requests",
      evidence: "proposal",
      data: {
        ...emptyData(),
        structure: [
          {
            id: "perspective",
            kind: "image-request",
            label: request.label,
            properties: request,
            references: [],
          },
          {
            id: "front",
            kind: "image-request",
            label: "正视图",
            properties: { ...request, view: "front" },
            references: [],
          },
        ],
      },
    };
    const tool = imageTools(
      images,
      [input],
      async (a) => {
        observed.push(a);
      },
      async () => {},
    )[0];
    const execute = tool.execute as (
      id: string,
      p: { requestIds: string[] },
    ) => Promise<unknown>;
    await assert.rejects(
      () => execute("bad", { requestIds: ["made-up"] }),
      /先由外观/,
    );
    assert.equal(calls, 0);
    const legacy = structuredClone(input);
    delete legacy.data.structure[0].properties.imageSet;
    const legacyExecute = imageTools(
      images,
      [legacy],
      async () => {},
      async () => {},
    )[0].execute as typeof execute;
    await assert.rejects(
      () => legacyExecute("legacy", { requestIds: ["perspective"] }),
      /旧混合|纯外观/,
    );
    await assert.rejects(
      () => execute("two", { requestIds: ["perspective", "front"] }),
      /503/,
    );
    assert.equal(observed.length, 1);
    await assert.rejects(
      () => execute("again", { requestIds: ["perspective", "front"] }),
      /503/,
    );
    assert.equal(calls, 2);
    const fake = structuredClone(input);
    fake.data.structure[0].properties.imageUrl = "https://invented/image.png";
    assert.throws(() => validateImageOutput(fake, []), /执行证据/);
    const proof = imagePacket(observed[0]);
    assert.throws(() => validateImageOutput(proof, [proof]), /伪造/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a resumed side view uses the saved perspective from its input request family", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dreamatic-resume-image-"));
  try {
    const config = await settings(dir);
    let calls = 0;
    const images = new ImageStore(join(dir, "images"), config, (async (
      _url,
      init,
    ) => {
      if (calls++ > 0)
        assert.match(
          JSON.parse(String(init?.body)).image,
          /^data:image\/png;base64,/,
        );
      return Response.json({ data: [{ b64_json: png().toString("base64") }] });
    }) as typeof fetch);
    const first = await images.generate(request);
    const proof = imagePacket(first);
    proof.data.structure[0].references = ["request-perspective"];
    const requests: Packet = {
      ...proof,
      id: "requests",
      invocationId: "designer",
      evidence: "proposal",
      execution: undefined,
      data: {
        ...emptyData(),
        structure: [
          {
            id: "request-perspective",
            kind: "image-request",
            label: "轴测",
            properties: request,
            references: [],
          },
          {
            id: "request-side",
            kind: "image-request",
            label: "侧视",
            properties: { ...request, view: "side" },
            references: [],
          },
        ],
      },
    };
    const generated: ImageAsset[] = [];
    const execute = imageTools(
      images,
      [requests, proof],
      async (a) => {
        generated.push(a);
      },
      async () => {},
    )[0].execute as (
      id: string,
      args: { requestIds: string[] },
    ) => Promise<unknown>;
    await execute("resume", { requestIds: ["request-side"] });
    assert.equal(generated[0].referenceAssetId, first.id);
    assert.equal(generated[0].view, "side");
    assert.equal(calls, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("generated image execution persists in the designer invocation and image downloads require the application session", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dreamatic-image-route-"));
  const config = await settings(dir);
  const images = new ImageStore(join(dir, "images"), config, (async () =>
    Response.json({
      data: [{ b64_json: png().toString("base64") }],
    })) as typeof fetch);
  let captured: ImageAsset | undefined;
  const caller: Caller = async (role, input) => {
    const done = input.state!.invocations.filter((n) => n.status === "done");
    const designers = done.filter((n) => n.role === "designer");
    if (role === "coordinator") {
      const analyst = done.find((n) => n.role === "analyst");
      const task = !analyst
        ? { role: "analyst", dependsOn: [] }
        : designers.length === 0
          ? { role: "designer", dependsOn: [analyst.id] }
          : designers.length === 1
            ? { role: "designer", dependsOn: [designers[0].id] }
            : undefined;
      return {
        summary: "next",
        decision: {
          action: task ? "dispatch" : "finish",
          reason: "test",
          tasks: task
            ? [
                {
                  ...task,
                  key: "next",
                  title: "image test",
                  instruction: "execute",
                },
              ]
            : [],
        },
      };
    }
    if (role === "analyst")
      return {
        summary: "questions",
        data: emptyData(),
        questions: [{ id: "color", title: "颜色", options: ["灰", "白"] }],
      };
    if (!designers.length)
      return {
        summary: "image request",
        data: {
          ...emptyData(),
          structure: [
            {
              id: "image-perspective",
              kind: "image-request",
              label: request.label,
              properties: request,
              references: [],
            },
          ],
        },
      };
    captured = await images.generate(request);
    await input.onImage?.(captured, "image-perspective");
    return { summary: "image generated", data: emptyData() };
  };
  const workbench = new Workbench(caller, join(dir, "project"), {
    visualContract: "legacy",
  });
  const { server } = makeServer(
    workbench,
    "image-route-token",
    config,
    undefined,
    undefined,
    images,
  );
  try {
    await workbench.start("case");
    await workbench.answer(
      Object.fromEntries(
        workbench.project!.questions.map((q) => [q.id, q.options[0]]),
      ),
    );
    const generated = workbench.project!.nodes.find(
      (n) => n.imageEvidence?.length,
    )!;
    assert.equal(generated.packet?.data.structure[0].kind, "generated-image");
    assert.equal(generated.imageEvidence![0].evidence, "executed");
    const restored = new Workbench(caller, join(dir, "project"), {
      visualContract: "legacy",
    });
    await restored.restore();
    assert.equal(
      restored.project!.nodes.find((n) => n.id === generated.id)!
        .imageEvidence![0].execution!.digest,
      captured!.sha256,
    );
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const addr = server.address();
    assert(addr && typeof addr === "object");
    const base = `http://127.0.0.1:${addr.port}`;
    assert.equal((await fetch(base + captured!.imageUrl)).status, 401);
    const login = await fetch(base + "/workbench-api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Workbench": "1" },
      body: JSON.stringify({ token: "image-route-token" }),
    });
    const image = await fetch(base + captured!.imageUrl, {
      headers: { Cookie: login.headers.get("set-cookie")!.split(";")[0] },
    });
    assert.equal(image.status, 200);
    assert.equal(image.headers.get("content-type"), "image/png");
    assert.deepEqual(Buffer.from(await image.arrayBuffer()), png());
  } finally {
    server.closeAllConnections();
    if (server.listening)
      await new Promise<void>((r) => server.close(() => r()));
    await rm(dir, { recursive: true, force: true });
  }
});

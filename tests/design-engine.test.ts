import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { once } from "node:events";
import {
  DesignEngine,
  engineContextKey,
} from "../apps/server/src/design-engine";
import { createApp } from "../apps/server/src/index";
import { Store } from "../packages/core/src/store";
import { Settings, fields } from "../packages/core/src/settings";
import type { runProcess } from "../packages/core/src/worker";
import type { EngineState } from "../packages/core/src/design-engine";

class TestSettings extends Settings {
  override async snapshot() {
    return {
      ...Object.fromEntries(fields.map((f) => [f.key, f.default])),
      MAKE_ENGINE_PYTHON: process.env.MAKE_ENGINE_TEST_PYTHON ?? "python",
      MAKE_API_KEY: "",
      MAKE_IMAGE_API_KEY: "",
    };
  }
}
const respond: typeof runProcess = async (_command, _args, options) => {
  const input = JSON.parse(options.input!);
  assert.deepEqual(options.env, { PYTHONIOENCODING: "utf-8" });
  assert.deepEqual(_args, ["-B", "-m", "engine", "request"]);
  return {
    code: 0,
    stderr: "",
    stdout: JSON.stringify({
      request_id: input.request_id,
      type: "result",
      payload: {
        snapshot_id: "a".repeat(64),
        input_revisions: {},
        diagnostics: [],
        bodies: 2,
        joints: 1,
        nets: 0,
      },
    }),
  };
};
async function fixture(execute = respond) {
  const folder = await mkdtemp(join(tmpdir(), "engine-adapter-"));
  const store = new Store(folder);
  const project = await store.create("Engine", "Test snapshot");
  const engine = new DesignEngine(
    resolve("."),
    store,
    new TestSettings(folder),
    execute,
  );
  return {
    folder,
    store,
    project,
    engine,
    input: {
      method: "validate",
      bundle: {},
      contextKey: engineContextKey(await store.get(project.id)),
    },
    cleanup: () => rm(folder, { recursive: true, force: true }),
  };
}
test("engine persists immutable run records, preserves approvals, and marks changed Context stale", async () => {
  const f = await fixture();
  try {
    assert.equal((await f.engine.state(f.project.id)).record, null);
    const result = await f.engine.request(f.project.id, f.input);
    assert.equal(result.stale, false);
    assert.equal(result.record?.adapterVersion, 1);
    const path = join(
      f.store.dir(f.project.id),
      "jobs/design-engine",
      result.record!.id + ".json",
    );
    const original = await readFile(path, "utf8");
    assert.deepEqual((await f.store.get(f.project.id)).approvals, []);
    await f.store.update(f.project.id, (p) => {
      p.parameters.width += 1;
    });
    assert.equal((await f.engine.state(f.project.id)).stale, true);
    await assert.rejects(
      f.engine.request(f.project.id, f.input),
      /项目输入已变化/,
    );
    assert.equal(await readFile(path, "utf8"), original);
    const fresh = await f.engine.state(f.project.id);
    await assert.rejects(
      f.engine.request(f.project.id, {
        ...f.input,
        contextKey: fresh.contextKey,
        bundle: { input_revisions: { cad: 999 } },
      }),
      /版本已过期/,
    );
    await assert.rejects(
      f.engine.request(f.project.id, {
        ...f.input,
        contextKey: fresh.contextKey,
        bundle: { input_revisions: { arbitrary: 1 } },
      }),
      /无法识别/,
    );
    await assert.rejects(f.engine.example("../README"), /不存在/);
  } finally {
    await f.cleanup();
  }
});
test("engine refuses to publish a result after inputs change during execution", async () => {
  let change = async () => {};
  const f = await fixture(async (...args) => {
    await change();
    return respond(...args);
  });
  change = async () => {
    await f.store.update(f.project.id, (p) => {
      p.stages.hardware.revision++;
    });
  };
  try {
    await assert.rejects(
      f.engine.request(f.project.id, f.input),
      /本次引擎结果未发布/,
    );
    assert.equal((await f.engine.state(f.project.id)).record, null);
  } finally {
    await f.cleanup();
  }
});
test("engine cancellation terminates work, releases concurrency, and never publishes output", async () => {
  let started!: () => void;
  const ready = new Promise<void>((r) => {
    started = r;
  });
  const f = await fixture(async (_command, _args, options) => {
    started();
    return new Promise((_resolve, reject) =>
      options.signal!.addEventListener(
        "abort",
        () => reject(new Error("aborted")),
        { once: true },
      ),
    );
  });
  try {
    const request = f.engine.request(f.project.id, f.input);
    const rejected = assert.rejects(request, /已取消/);
    await ready;
    await assert.rejects(f.engine.request(f.project.id, f.input), /引擎忙/);
    f.engine.abort(f.project.id);
    await rejected;
    assert.equal(f.engine.isBusy(f.project.id), false);
    assert.equal((await f.engine.state(f.project.id)).record, null);
  } finally {
    await f.cleanup();
  }
});
test("engine rejects malformed worker output and unsupported adapter methods", async () => {
  const f = await fixture(async () => ({
    stdout: "not json",
    stderr: "private process details",
    code: 1,
  }));
  try {
    await assert.rejects(f.engine.request(f.project.id, f.input), /返回异常/);
    await assert.rejects(
      f.engine.request(f.project.id, { ...f.input, method: "arbitrary" }),
    );
    await assert.rejects(
      f.engine.request(f.project.id, { ...f.input, method: "preview" }),
      /场景文件/,
    );
    assert.equal((await f.engine.state(f.project.id)).record, null);
  } finally {
    await f.cleanup();
  }
});

test(
  "HTTP adapter executes real Python examples, replays signals, and preserves structured failures",
  {
    skip:
      !process.env.MAKE_ENGINE_TEST_PYTHON &&
      "Set MAKE_ENGINE_TEST_PYTHON to Python 3.11+ with Pydantic 2",
  },
  async () => {
    const folder = await mkdtemp(join(tmpdir(), "engine-http-"));
    const app = await createApp(folder, new TestSettings(folder));
    app.server.listen(0, "127.0.0.1");
    await once(app.server, "listening");
    const url = `http://127.0.0.1:${(app.server.address() as { port: number }).port}/api`;
    const project = await app.store.create("Engine API", "Fixture model");
    const base = `/projects/${project.id}/engine`;
    const call = async (path: string, input?: unknown) => {
      const response = await fetch(url + path, {
        method: input ? "POST" : "GET",
        headers: { "Content-Type": "application/json" },
        body: input ? JSON.stringify(input) : undefined,
      });
      assert.equal(response.status, 200, await response.clone().text());
      return response.json();
    };
    try {
      assert.equal(
        (
          await fetch(url + base, {
            headers: { Origin: "https://evil.example" },
          })
        ).status,
        403,
      );
      const { contextKey } = await call(base);
      for (const example of ["actuator", "fan", "lamp"]) {
        const documents = await call(base + "/examples/" + example);
        const state: EngineState = await call(base, {
          ...documents,
          contextKey,
          method: "workspace",
        });
        assert.equal(state.record?.reply.type, "result");
        if (state.record?.reply.type !== "result")
          throw new Error("Missing result");
        const payload = state.record.reply.payload;
        assert.equal(payload.result?.status, "completed");
        assert.equal(payload.scene?.snapshot_id, payload.circuit?.snapshot_id);
        assert.equal(payload.scene?.snapshot_id, payload.result?.snapshot_id);
        assert(payload.result!.frames.length > 1);
        const last = payload.result!.frames.at(-1)!;
        if (example === "actuator")
          assert(
            Math.abs(last.joint_positions["servo/joints/axis"] - 1) < 1e-9,
          );
        if (example === "fan") {
          assert.equal(payload.flow?.mode, "topology_only");
          assert.equal(payload.flow?.paths.length, 1);
        }
        if (example === "lamp")
          assert.equal(last.effects["effects/indicator"].value, "1");
      }
      const documents = await call(base + "/examples/actuator");
      const preview: EngineState = await call(base, {
        ...documents,
        contextKey,
        method: "preview",
      });
      assert(preview.record?.reply.type === "result");
      assert.equal(preview.record.reply.payload.result, null);
      assert(
        preview.record.reply.payload.scene?.bodies.every((b) => b.world_pose),
      );
      const stale: EngineState = await call(base, {
        ...documents,
        scenario: { ...documents.scenario, snapshot_id: "0".repeat(64) },
        contextKey,
        method: "workspace",
      });
      assert(stale.record?.reply.type === "result");
      assert.equal(stale.record.reply.payload.result?.status, "failed");
      assert.equal(stale.record.reply.payload.result?.frames.length, 0);
      const invalid: EngineState = await call(base, {
        bundle: {},
        method: "validate",
        contextKey,
      });
      assert.equal(invalid.record?.reply.type, "error");
      assert.equal((await app.store.get(project.id)).approvals.length, 0);
      assert.equal((await call(base)).record.id, invalid.record?.id);
    } finally {
      app.server.closeAllConnections();
      await new Promise<void>((r) => app.server.close(() => r()));
      await rm(folder, { recursive: true, force: true });
    }
  },
);

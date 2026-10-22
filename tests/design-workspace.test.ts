import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../apps/server/src/index";
import { Settings, fields } from "../packages/core/src/settings";
import {
  identityPose,
  defaultNotebook,
  emptyLayout,
  mergeLayout,
} from "../packages/core/src/design-workspace";
import { cubeStl } from "./fixtures/stl";

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
test(
  "workspace API: real layout, collision, independent motion, immutable authority and conflict protection",
  { skip: !process.env.MAKE_ENGINE_TEST_PYTHON },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "layout-api-"));
    const app = await createApp(root, new TestSettings(root));
    app.server.listen(0, "127.0.0.1");
    await once(app.server, "listening");
    const base = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
    const p = await app.store.create("Layout", "Test workspace");
    const path = `/api/projects/${p.id}/design`;
    const call = (url: string, data?: unknown) =>
      fetch(base + url, {
        method: data ? "POST" : "GET",
        headers: { "Content-Type": "application/json" },
        body: data ? JSON.stringify(data) : undefined,
      });
    try {
      const initial = await (await call(path)).json();
      assert.equal(initial.record.revision, 0);
      const draft = emptyLayout();
      for (const id of ["a", "b"]) {
        draft.entities[id] = { name: id };
        draft.bodies[`${id}/bodies/body`] = {
          entity: id,
          pose: identityPose(),
        };
        draft.envelopes[`${id}/envelopes/box`] = {
          body: `${id}/bodies/body`,
          pose: identityPose(),
          shape: { kind: "box", size_m: [0.02, 0.02, 0.02] },
          purpose: "solid",
          approximation: "outer",
          margin_m: 0,
        };
      }
      draft.edges.broken = {
        domain: "electrical",
        kind: "signal",
        members: ["missing_a", "missing_b"],
        directed: false,
      };
      const input = {
        contextKey: initial.contextKey,
        baseRevision: 0,
        draft,
        notebook: defaultNotebook(),
      };
      let response = await call(path, input);
      assert.equal(response.status, 200, await response.clone().text());
      const saved = await response.json();
      assert.equal(saved.state.record.pending, true);
      assert.equal(saved.projection.scene.bodies.length, 2);
      assert.deepEqual((await app.store.get(p.id)).approvals, []);
      assert.equal((await call(path, input)).status, 409);
      const operation = { contextKey: saved.state.contextKey, draft };
      response = await call(path + "/operate", {
        ...operation,
        method: "layout_collision",
      });
      const collision = await response.json();
      assert.equal(collision.check.pairs.length, 1);
      assert.equal(collision.check.status, "issues");
      response = await call(path + "/operate", {
        ...operation,
        method: "layout_connectivity",
      });
      assert.equal((await response.json()).check.status, "issues");
      response = await call(path + "/operate", {
        ...operation,
        method: "layout_project",
        draft: { ...draft, arbitrary: true },
      });
      assert.equal(response.status, 422);
      const reread = await (await call(path)).json();
      assert.deepEqual(reread.record.draft, saved.projection.draft);
      await app.store.update(p.id, (current) => {
        current.parameters.width += 1;
      });
      assert.equal(
        (
          await call(path + "/operate", {
            ...operation,
            method: "layout_collision",
          })
        ).status,
        409,
      );
      assert.equal((await (await call(path)).json()).stale, true);
      const runtime = await call("/api/notebook/worker");
      assert.equal(runtime.status, 200);
      assert.match(
        runtime.headers.get("content-security-policy")!,
        /worker-src 'none'/,
      );
      assert.doesNotMatch(
        runtime.headers.get("content-security-policy")!,
        /connect-src 'self'/,
      );
      assert.equal(
        (await call("/api/notebook/runtime/package.json")).status,
        404,
      );
      assert.equal(
        (await call("/api/notebook/runtime/python_stdlib.zip")).status,
        200,
      );
      if (process.env.MAKE_ENGINE_TEST_MESH === "1") {
        const artifact = await app.store.artifact(
          p.id,
          "cad",
          1,
          "lid.stl",
          cubeStl(),
          "model/stl",
        );
        await app.store.update(p.id, (current) => {
          current.stages.cad.artifacts = [artifact];
        });
        const assets = await (await call(path + "/cad-assets", {})).json();
        assert.equal(assets.length, 1);
        assert.deepEqual(assets[0].assemblyPose.rotation_xyzw, [1, 0, 0, 0]);
        const asset = assets[0];
        draft.envelopes["a/envelopes/box"].shape = {
          kind: "triangle_mesh",
          unit: "mm",
          collision_mode: "solid",
          asset_ref: {
            artifact_id: asset.id,
            sha256: asset.sha256,
            media_type: "model/stl",
          },
        };
        const current = await (await call(path)).json();
        const checked = await (
          await call(path + "/operate", {
            contextKey: current.contextKey,
            draft,
            method: "layout_collision",
          })
        ).json();
        assert.equal(checked.check.pairs.length, 1);
        assert.equal(checked.check.skipped.length, 0);
      }
    } finally {
      app.server.close();
      await once(app.server, "close");
      await rm(root, { recursive: true, force: true });
    }
  },
);

test("mesh append keeps existing objects and namespaces all internal references", () => {
  const base = emptyLayout(),
    imported = emptyLayout();
  base.entities.existing = { name: "Existing" };
  imported.entities.a = { name: "New" };
  imported.bodies["a/bodies/body"] = { entity: "a", pose: identityPose() };
  imported.envelopes.solid = {
    body: "a/bodies/body",
    pose: identityPose(),
    shape: {
      kind: "triangle_mesh",
      unit: "mm",
      collision_mode: "surface",
      asset_ref: {
        artifact_id: "asset",
        sha256: "a".repeat(64),
        media_type: "model/stl",
      },
    },
    purpose: "solid",
    approximation: "outer",
    margin_m: 0,
  };
  const result = mergeLayout(base, imported, "imported");
  assert.equal(result.entities.existing.name, "Existing");
  assert.equal(
    result.envelopes["imported/solid"].body,
    "imported/a/bodies/body",
  );
  assert.deepEqual(
    result.envelopes["imported/solid"].shape,
    imported.envelopes.solid.shape,
  );
  assert.deepEqual(Object.keys(base.entities), ["existing"]);
});

test(
  "layout imports preserve legacy snapshot bytes",
  { skip: !process.env.MAKE_ENGINE_TEST_PYTHON },
  async () => {
    const source = await readFile(
      "engine/examples/actuator.bundle.json",
      "utf8",
    );
    const { runProcess } = await import("../packages/core/src/worker");
    const result = await runProcess(
      process.env.MAKE_ENGINE_TEST_PYTHON!,
      ["-B", "-m", "engine", "request"],
      {
        cwd: process.cwd(),
        input: JSON.stringify({
          request_id: "layout-test",
          method: "layout_import",
          source: JSON.parse(source),
        }),
      },
    );
    assert.equal(result.code, 0, result.stdout);
    assert.equal(JSON.parse(result.stdout).payload.draft.layout_version, 1);
    assert.equal(
      await readFile("engine/examples/actuator.bundle.json", "utf8"),
      source,
    );
  },
);

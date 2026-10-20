import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { createApp } from "../apps/server/src/index";
import { Settings, fields } from "../packages/core/src/settings";
import { cubeStl } from "./fixtures/stl";
import type { EngineState } from "../packages/core/src/design-engine";

class MeshSettings extends Settings {
  override async snapshot() {
    return {
      ...Object.fromEntries(fields.map((f) => [f.key, f.default])),
      MAKE_ENGINE_PYTHON: process.env.MAKE_ENGINE_TEST_PYTHON!,
      MAKE_API_KEY: "",
      MAKE_IMAGE_API_KEY: "",
    };
  }
}

test(
  "real STL HTTP upload, assembly, collision, isolation, integrity and stale context",
  {
    skip:
      !process.env.MAKE_ENGINE_TEST_MESH &&
      "Set MAKE_ENGINE_TEST_MESH=1 and MAKE_ENGINE_TEST_PYTHON with requirements-mesh.txt",
  },
  async () => {
    const folder = await mkdtemp(join(tmpdir(), "mesh-http-"));
    const app = await createApp(folder, new MeshSettings(folder));
    app.server.listen(0, "127.0.0.1");
    await once(app.server, "listening");
    const root = `http://127.0.0.1:${(app.server.address() as { port: number }).port}/api/projects/`;
    const project = await app.store.create("STL", "Real mesh test");
    const other = await app.store.create("Other", "Isolated library");
    const base = root + project.id + "/engine";
    const request = (path: string, input?: unknown) =>
      fetch(base + path, {
        method: input ? "POST" : "GET",
        headers: { "Content-Type": "application/json" },
        body: input ? JSON.stringify(input) : undefined,
      });
    const call = async (path: string, input?: unknown) => {
      const response = await request(path, input);
      assert.equal(response.status, 200, await response.clone().text());
      return response.json();
    };
    try {
      const { contextKey } = await call("");
      assert.deepEqual(await call("/meshes"), []);
      const data = cubeStl();
      const asset = await call("/meshes", {
        name: "cube.stl",
        unit: "mm",
        data: data.toString("base64"),
      });
      assert.equal(asset.triangles, 12);
      assert.equal(asset.volume_candidate, true);
      assert.equal(asset.bounds_m[1][0], 0.01);
      assert.deepEqual(
        Buffer.from(await (await request("/meshes/" + asset.id)).arrayBuffer()),
        data,
      );
      assert.equal(
        (await fetch(root + other.id + "/engine/meshes/" + asset.id)).status,
        404,
      );
      assert.equal(
        (
          await request("/meshes", {
            name: "bad.stl",
            unit: "mm",
            data: Buffer.from("bad mesh").toString("base64"),
          })
        ).status,
        422,
      );
      assert.equal(
        (
          await request("/meshes", {
            name: "cube.stl",
            data: data.toString("base64"),
          })
        ).status,
        400,
      );
      // Large valid base64 reaches bounded STL validation without regex stack overflow.
      assert.equal(
        (
          await request("/meshes", {
            name: "large-invalid.stl",
            unit: "mm",
            data: Buffer.alloc(2_000_000).toString("base64"),
          })
        ).status,
        422,
      );
      const item = {
        assetId: asset.id,
        unit: "mm",
        collisionMode: "solid",
        position: [0, 0, 0],
        rotation: [0, 0, 0],
      };
      const run = async (x: number, rotation = [0, 0, 0]) => {
        const docs = await call("/mesh-model", {
          contextKey,
          meshes: [item, { ...item, position: [x, 0, 0], rotation }],
        });
        const state: EngineState = await call("", {
          ...docs,
          contextKey,
          method: "workspace",
        });
        assert(state.record?.reply.type === "result");
        const result = state.record.reply.payload.result!;
        assert.equal(result.status, "completed");
        assert.match(result.coverage.join(" "), /FCL/);
        return { result, docs };
      };
      const overlapping = await run(0.015);
      assert.equal(overlapping.result.frames[0].collisions.length, 1);
      assert.equal((await run(0.04)).result.frames[0].collisions.length, 0);
      assert.equal(
        (await run(0.023, [0, 0, 45])).result.frames[0].collisions.length,
        1,
      );
      const forged = structuredClone(overlapping.docs);
      forged.bundle.components[0].physical.geometry.envelopes.mesh_1.shape.asset_ref.sha256 =
        "0".repeat(64);
      assert.equal(
        (await request("", { ...forged, contextKey, method: "workspace" }))
          .status,
        409,
      );
      forged.bundle.components[0].physical.geometry.envelopes.mesh_1.shape.asset_ref.relative_path =
        "../outside.stl";
      assert.equal(
        (await request("", { ...forged, contextKey, method: "workspace" }))
          .status,
        400,
      );
      await writeFile(
        join(
          app.store.dir(project.id),
          "uploads/engine-meshes",
          asset.id + ".stl",
        ),
        Buffer.from("corrupted"),
      );
      assert.equal((await request("/meshes/" + asset.id)).status, 409);
      await app.store.update(project.id, (p) => {
        p.parameters.width++;
      });
      assert.equal(
        (await request("/mesh-model", { contextKey, meshes: [item] })).status,
        409,
      );
      assert.deepEqual((await app.store.get(project.id)).approvals, []);
    } finally {
      app.server.closeAllConnections();
      await new Promise<void>((r) => app.server.close(() => r()));
      await rm(folder, { recursive: true, force: true });
    }
  },
);

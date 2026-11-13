import assert from "node:assert/strict";
import test from "node:test";
import { CadCapabilityError, CadRouter } from "../packages/cad-runtime/src/router";
import type { CadBackend, CadJob } from "../packages/cad-runtime/src/contracts";

const job: CadJob = {
  jobId: "cad-1", projectId: "p", workspace: "/workspace", objective: "housing",
  requiredCapabilities: ["brep", "step-export"], inputs: [], parameters: {}, outputs: ["source", "step"],
};

function backend(id: CadBackend["id"], available = true): CadBackend {
  return {
    id,
    capabilities: new Set(id === "jscad-preview" ? ["mesh-export"] : ["brep", "step-export"]),
    available: async () => ({ available }),
    execute: async () => ({
      backend: id, backendVersion: "test", sourceSha256: "a", validBrep: true,
      outputs: [{ path: "part.step", sha256: "b", bytes: 1 }], solidCount: 1,
      volumeMm3: 1, boundsMm: [1, 1, 1], watertightMeshes: true, warnings: [],
    }),
  };
}

test("production CAD uses Rhino", async () => {
  const evidence = await new CadRouter([backend("rhino")]).execute(job);
  assert.equal(evidence.backend, "rhino");
});

test("production CAD never falls back to JSCAD", async () => {
  await assert.rejects(() => new CadRouter([backend("jscad-preview")]).execute(job), CadCapabilityError);
});

test("CAD fails closed when exact geometry evidence is invalid", async () => {
  const invalid = backend("rhino");
  invalid.execute = async () => ({
    backend: "rhino", backendVersion: "test", sourceSha256: "a", outputs: [],
    solidCount: 0, validBrep: false, volumeMm3: 0, boundsMm: [0, 0, 0],
    watertightMeshes: false, warnings: [],
  });
  await assert.rejects(() => new CadRouter([invalid]).execute(job), /invalid or empty/);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AgentEngine } from "../apps/server/src/agent-engine";
import {
  DesignEngine,
  engineContextKey,
} from "../apps/server/src/design-engine";
import { Store } from "../packages/core/src/store";
import { Settings, fields } from "../packages/core/src/settings";
import { Workflow, inputHash } from "../packages/core/src/workflow";
import {
  engineDesignSchema,
  evaluateDesign,
} from "../packages/core/src/agent-design";
import type { EnginePayload } from "../packages/core/src/design-engine";
import type { Artifact } from "../packages/core/src/contracts";
import { cubeStl } from "./fixtures/stl";

const component = {
  record_kind: "component_design",
  category: "light",
  id: "led",
  name: "LED",
  channels: { brightness: { kind: "constant", value: 0.5 } },
  geometry: {
    root_body: "body",
    bodies: { body: {} },
    envelopes: {
      solid: {
        body_ref: "body",
        approximation: "outer",
        shape: { kind: "box", size_m: [0.01, 0.01, 0.01] },
      },
    },
  },
};
function layout() {
  return {
    source: {
      id: "product",
      name: "Product",
      components: { led: structuredClone(component) },
    },
    scenario: {
      id: "acceptance",
      duration_s: 0,
      roots: [
        {
          body_ref: {
            instance_path: ["led"],
            collection: "bodies",
            object_id: "body",
          },
        },
      ],
    },
    bindings: [{ partId: "led", instanceId: "led" }],
    constraints: [
      {
        id: "opening",
        kind: "opening",
        instanceIds: ["led"],
        description: "Keep indicator visible",
      },
    ],
    checks: [
      { id: "clear", kind: "collision_free", requirement: "No overlap" },
      {
        id: "on",
        kind: "sample",
        requirement: "Indicator brightness",
        collection: "effects",
        ref: "led/effects/brightness",
        timeS: 0,
        expected: 0.5,
      },
    ],
  };
}
test("design checks reject unknown signals, missed goals, collisions and unsupported coverage", () => {
  const design = engineDesignSchema.parse({
    version: 1,
    bundle: {},
    ...layout(),
  });
  const payload = {
    snapshot_id: "a".repeat(64),
    input_revisions: {},
    diagnostics: [],
    result: {
      snapshot_id: "a".repeat(64),
      status: "completed",
      actual_end_s: 0,
      coverage: [],
      diagnostics: [],
      frames: [
        {
          time_s: 0,
          body_poses: {},
          joint_positions: {},
          network_samples: {},
          behavior_outputs: {},
          sensor_samples: {},
          effects: {
            "led/effects/brightness": {
              value: 0.5,
              quality: "valid",
              origin: "model",
              time_s: 0,
            },
          },
          collisions: [],
        },
      ],
    },
  } as EnginePayload;
  assert.equal(evaluateDesign(design, payload).passed, true);
  payload.result!.frames[0].effects["led/effects/brightness"].quality =
    "unknown";
  assert.equal(evaluateDesign(design, payload).passed, false);
  payload.result!.frames[0].effects["led/effects/brightness"].quality = "valid";
  payload.result!.frames[0].effects["led/effects/brightness"].value = 0;
  assert.equal(evaluateDesign(design, payload).passed, false);
  payload.result!.frames[0].effects["led/effects/brightness"].value = 0.5;
  payload.result!.frames[0].collisions.push(["a", "b"]);
  assert.equal(evaluateDesign(design, payload).passed, false);
  payload.result!.frames[0].collisions = [];
  payload.diagnostics.push({
    message: "not solved",
    outcome: "unsupported",
    severity: "warning",
  });
  assert.equal(evaluateDesign(design, payload).passed, false);
  assert.equal(evaluateDesign(design).passed, false);
});

class EngineSettings extends Settings {
  override async snapshot() {
    return {
      ...Object.fromEntries(fields.map((field) => [field.key, field.default])),
      MAKE_ENGINE_PYTHON: process.env.MAKE_ENGINE_TEST_PYTHON!,
    };
  }
}
async function fixture() {
  const folder = await mkdtemp(join(tmpdir(), "agent-design-")),
    store = new Store(folder);
  const p = await store.create("Product", "Indicator brightness 0.5");
  await store.update(p.id, (current) => {
    for (const stage of [
      "requirements",
      "intent",
      "hardware",
      "appearance",
    ] as const)
      current.stages[stage].status = "approved";
    current.selectedParts = ["led"];
    current.running = true;
  });
  const engine = new DesignEngine(
    resolve("."),
    store,
    new EngineSettings(folder),
  );
  return {
    folder,
    store,
    p,
    engine,
    agent: new AgentEngine(resolve("."), store, engine),
    workflow: new Workflow(store, []),
  };
}
const real = { skip: !process.env.MAKE_ENGINE_TEST_PYTHON };
test(
  "real CAD STL handoff is composed and verified as actual mesh geometry",
  {
    skip:
      !process.env.MAKE_ENGINE_TEST_PYTHON ||
      process.env.MAKE_ENGINE_TEST_MESH !== "1",
  },
  async () => {
    const f = await fixture();
    try {
      const design = await f.agent.compose(f.p.id, "structure", 1, layout());
      const artifacts: Artifact[] = [];
      for (const name of ["base.stl", "lid.stl"])
        artifacts.push(
          await f.store.artifact(
            f.p.id,
            "cad",
            1,
            name,
            cubeStl(),
            "model/stl",
          ),
        );
      await f.store.update(f.p.id, (p) => {
        p.stages.structure.status = "approved";
        p.stages.structure.draft = {
          title: "Layout",
          summary: "Layout",
          facts: [],
          assumptions: [],
          blockers: [],
          choices: [],
          partIds: [],
          engineDesign: design,
        };
        p.stages.cad.artifacts = artifacts;
      });
      const imported = await f.agent.importCad(f.p.id);
      const scenario = { ...design.scenario };
      delete scenario.snapshot_id;
      scenario.roots = [
        ...(scenario.roots as unknown[]),
        ...["custom_base", "custom_lid"].map((instance, i) => ({
          body_ref: {
            instance_path: [instance],
            collection: "bodies",
            object_id: "body",
          },
          world_pose: { translation_m: [0.1 + i * 0.1, 0, 0] },
        })),
      ];
      const input = {
        source: {
          ...design.source,
          components: {
            ...(design.source.components as object),
            ...imported.components,
          },
        },
        scenario,
        bindings: design.bindings,
        constraints: design.constraints,
        checks: design.checks,
      };
      const cad = await f.agent.compose(f.p.id, "cad", 1, input);
      await f.workflow.submit(f.p.id, "cad", 1, "cad-engineer", {
        title: "CAD",
        summary: "Real imported STL fixtures",
        facts: [],
        engineDesign: cad,
      });
      const verification = await f.agent.verify(f.p.id, "cad", 1);
      assert.equal(verification.passed, true, JSON.stringify(verification));
      const state = await f.engine.state(f.p.id);
      assert.equal(state.record?.reply.type, "result");
      if (state.record?.reply.type === "result")
        assert.equal(
          state.record.reply.payload.scene?.envelopes.filter(
            (envelope) => envelope.shape.kind === "triangle_mesh",
          ).length,
          2,
        );
    } finally {
      await rm(f.folder, { recursive: true, force: true });
    }
  },
);
test(
  "real agent layout → Python simulation → evidence → independent review; stale evidence cannot approve",
  real,
  async () => {
    const f = await fixture();
    try {
      const design = await f.agent.compose(f.p.id, "structure", 1, layout());
      assert.equal(design.bundle.input_revisions !== undefined, true);
      await f.workflow.submit(f.p.id, "structure", 1, "mechanical-engineer", {
        title: "Layout",
        summary: "Visible indicator",
        facts: [],
        engineDesign: design,
      });
      await f.workflow.review(
        f.p.id,
        "structure",
        1,
        "pass",
        "Claim without execution",
      );
      assert.equal(
        (await f.store.get(f.p.id)).stages.structure.review?.verdict,
        "changes_requested",
      );
      const context = engineContextKey(await f.store.get(f.p.id));
      await assert.rejects(
        f.engine.request(f.p.id, {
          method: "workspace",
          bundle: design.bundle,
          scenario: design.scenario,
          contextKey: context,
        }),
        /请等待/,
      );
      let verification = await f.agent.verify(f.p.id, "structure", 1);
      assert.equal(verification.passed, true, JSON.stringify(verification));
      assert.equal((await f.engine.state(f.p.id)).stale, false);
      await f.workflow.review(
        f.p.id,
        "structure",
        1,
        "pass",
        "Actual scenario meets goals",
        verification,
      );
      let p = await f.store.get(f.p.id);
      assert.equal(
        p.stages.structure.review?.verdict,
        "pass",
        p.stages.structure.review?.summary,
      );
      assert.equal(p.approvals.length, 0);
      await f.store.update(p.id, (current) => {
        current.messages.push({
          id: "changed-input",
          role: "user",
          text: "Also check the new requirement",
          createdAt: new Date().toISOString(),
        });
      });
      await f.workflow.review(
        p.id,
        "structure",
        1,
        "pass",
        "Old evidence after user input changed",
        verification,
      );
      assert.equal(
        (await f.store.get(p.id)).stages.structure.review?.verdict,
        "changes_requested",
      );
      verification = await f.agent.verify(p.id, "structure", 1);
      await f.workflow.review(
        p.id,
        "structure",
        1,
        "pass",
        "Refreshed evidence",
        verification,
      );
      assert.equal(
        (await f.store.get(p.id)).stages.structure.review?.verdict,
        "pass",
      );
      await f.store.update(p.id, (current) => {
        current.stages.structure.draft!.engineDesign!.checks[1] = {
          id: "changed",
          kind: "sample",
          requirement: "Brighter",
          collection: "effects",
          ref: "led/effects/brightness",
          timeS: 0,
          expected: 1,
          tolerance: 0,
        };
      });
      await f.workflow.review(
        p.id,
        "structure",
        1,
        "pass",
        "Reusing stale proof",
        verification,
      );
      p = await f.store.get(p.id);
      assert.equal(p.stages.structure.review?.verdict, "changes_requested");
      await f.store.update(p.id, (current) => {
        current.running = false;
      });
      await assert.rejects(
        f.workflow.approve(p.id, {
          stage: "structure",
          revision: 1,
          inputHash: inputHash(await f.store.get(p.id), "structure"),
          decision: "approved",
          key: "fixture",
        }),
        /独立审阅/,
      );
    } finally {
      await rm(f.folder, { recursive: true, force: true });
    }
  },
);
test(
  "real layout rejects missing hardware, downstream physical edits and weakened acceptance checks",
  real,
  async () => {
    const f = await fixture();
    try {
      await assert.rejects(
        f.agent.compose(f.p.id, "structure", 1, { ...layout(), bindings: [] }),
        /遗漏/,
      );
      const design = await f.agent.compose(f.p.id, "structure", 1, layout());
      await f.store.update(f.p.id, (p) => {
        p.stages.structure.status = "approved";
        p.stages.structure.draft = {
          title: "Layout",
          summary: "Layout",
          facts: [],
          assumptions: [],
          blockers: [],
          choices: [],
          partIds: [],
          engineDesign: design,
        };
        p.stages.cad.status = "approved";
      });
      const input: any = { ...design, scenario: { ...design.scenario } };
      delete input.version;
      delete input.bundle;
      delete input.scenario.snapshot_id;
      input.source = structuredClone(input.source);
      input.source.components.led.geometry.envelopes.solid.shape.size_m = [
        1, 1, 1,
      ];
      await assert.rejects(
        f.agent.compose(f.p.id, "firmware", 1, input),
        /物理接口/,
      );
      input.source = structuredClone(design.source);
      input.checks = [input.checks[0]];
      await assert.rejects(
        f.agent.compose(f.p.id, "firmware", 1, input),
        /删除或削弱/,
      );
      const templates = await f.agent.library(f.p.id, "light");
      assert(templates.templates.length);
      assert(
        templates.templates.every(
          (item) => item.evidence === "synthetic-template-only",
        ),
      );
    } finally {
      await rm(f.folder, { recursive: true, force: true });
    }
  },
);

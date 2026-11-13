import assert from "node:assert/strict";
import test from "node:test";
import { ownerFor, roles } from "../packages/orchestrator/src/roles";
import { agentIds } from "../packages/orchestrator/src/contracts";

test("the product exposes exactly seven roles", () => {
  assert.equal(agentIds.length, 7);
  assert.deepEqual(Object.keys(roles).sort(), [...agentIds].sort());
});

test("specialist stages have stable owners", () => {
  assert.equal(ownerFor("appearance"), "industrial-design");
  assert.equal(ownerFor("logical_layout"), "embedded");
  assert.equal(ownerFor("assembly_detail"), "mechanical");
  assert.equal(ownerFor("software_design"), "software");
});

test("reviewer never authors a stage", () => {
  assert.equal(roles.reviewer.stages.length, 0);
  assert.equal(roles.reviewer.canReview, true);
});

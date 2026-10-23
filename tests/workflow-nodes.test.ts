import { test } from "node:test";
import assert from "node:assert/strict";
import {
  stages,
  defaultEnclosure,
  type Project,
} from "../packages/core/src/contracts";
import { workflowInputs, workflowState } from "../apps/web/src/workflow";

function project(): Project & { currentStage: "intent" } {
  return {
    id: "test",
    name: "mouse",
    brief: "office mouse",
    version: 1,
    createdAt: "",
    updatedAt: "",
    archived: false,
    running: false,
    stages: Object.fromEntries(
      stages.map((id) => [
        id,
        { id, status: "not_started", revision: 1, artifacts: [] },
      ]),
    ) as unknown as Project["stages"],
    parameters: defaultEnclosure,
    selectedParts: [],
    approvals: [],
    messages: [],
    currentStage: "intent",
  };
}

test("pending questions belong only to the active stage, even when browsing an earlier node", () => {
  const p = project();
  p.stages.requirements.status = "approved";
  p.running = true;
  p.messages.push({
    id: "q",
    role: "assistant",
    text: "",
    createdAt: "",
    interaction: { id: "q", title: "question", questions: [] },
  });
  assert.equal(workflowState(p, "requirements").pending, undefined);
  assert.equal(workflowState(p, "requirements").label, "已确认");
  assert.equal(workflowState(p, "intent").label, "等待回答");
  assert.equal(workflowState(p, "intent").running, false);
});

test("drafts, stale and failed stages are never represented as confirmed upstream inputs", () => {
  const p = project();
  p.stages.requirements.status = "approved";
  p.stages.intent.status = "awaiting_confirmation";
  p.stages.hardware.status = "stale";
  p.stages.appearance.status = "failed";
  assert.deepEqual(workflowInputs(p, "structure"), ["requirements"]);
  p.stages.requirements.status = "stale";
  assert.deepEqual(workflowInputs(p, "structure"), []);
});

test("answered questions do not keep a node waiting, and downstream nodes do not inherit active execution", () => {
  const p = project();
  p.running = true;
  p.messages.push({
    id: "q",
    role: "assistant",
    text: "",
    createdAt: "",
    interaction: {
      id: "q",
      title: "question",
      questions: [],
      answers: { choice: "yes" },
    },
  });
  assert.equal(workflowState(p, "intent").label, "正在执行");
  assert.equal(workflowState(p, "hardware").label, "尚未开始");
});

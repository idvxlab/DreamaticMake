import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve, join } from "node:path";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { loadRole, roleIds } from "../packages/agent-runtime/src/roles";

test("需求与功能阶段使用各自角色覆盖，其它角色保持定义", async () => {
  const root = resolve(".");
  const original = await loadRole(root, "analyst");
  const requirements = await loadRole(root, "analyst", "requirements");
  const intent = await loadRole(root, "analyst", "intent");
  assert.match(intent.prompt, /functionModules/);
  assert.deepEqual(requirements.allowed_tools, original.allowed_tools);
  const fixture = await mkdtemp(join(tmpdir(), "make-role-scope-"));
  try {
    await mkdir(join(fixture, ".pi/agents"), { recursive: true });
    await mkdir(join(fixture, ".pi/stages"), { recursive: true });
    const baseline = await readFile(
      join(root, ".pi/agents/analyst.md"),
      "utf8",
    );
    await writeFile(join(fixture, ".pi/agents/analyst.md"), baseline);
    await writeFile(
      join(fixture, ".pi/stages/requirements-analyst.md"),
      baseline + "\nREQUIREMENTS_ONLY_MARKER\n",
    );
    await writeFile(
      join(fixture, ".pi/stages/intent-analyst.md"),
      baseline + "\nINTENT_ONLY_MARKER\n",
    );
    assert.match(
      (await loadRole(fixture, "analyst", "requirements")).prompt,
      /REQUIREMENTS_ONLY_MARKER/,
    );
    assert.doesNotMatch(
      (await loadRole(fixture, "analyst", "intent")).prompt,
      /REQUIREMENTS_ONLY_MARKER/,
    );
    assert.match(
      (await loadRole(fixture, "analyst", "intent")).prompt,
      /INTENT_ONLY_MARKER/,
    );
    assert.doesNotMatch(
      (await loadRole(fixture, "analyst", "requirements")).prompt,
      /INTENT_ONLY_MARKER/,
    );
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
  for (const id of roleIds.filter((id) => id !== "analyst")) {
    assert.deepEqual(
      await loadRole(root, id, "requirements"),
      await loadRole(root, id),
    );
    assert.deepEqual(
      await loadRole(root, id, "intent"),
      await loadRole(root, id),
    );
  }
});

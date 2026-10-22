import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DesignCases } from "../apps/server/src/design-cases";

test("local design cases keep components, layers and Python source separate", async () => {
  const directory = await mkdtemp(join(tmpdir(), "design-cases-"));
  const cases = new DesignCases(directory);
  try {
    assert.deepEqual(await cases.list(), []);
    for (const sub of ["components", "design", "logic"])
      await mkdir(join(directory, "demo", sub), { recursive: true });
    const json = (file: string, value: unknown) =>
      writeFile(join(directory, "demo", file), JSON.stringify(value));
    await json("project.json", {
      version: 1,
      id: "demo",
      title: "Demo",
      summary: "Local source",
      focus: ["structure"],
    });
    await json("components/part.json", {
      record_kind: "component_design",
      category: "structure",
      id: "part",
      name: "Part",
    });
    await json("design/structure.json", {
      instances: { part: { definition: "part" } },
    });
    for (const layer of ["motion", "circuit-energy", "flow"])
      await json(`design/${layer}.json`, {});
    await json("logic/notebook.json", {
      version: 1,
      cells: [{ id: "control", file: "control.py" }],
      inputs: [],
      bindings: [],
    });
    await writeFile(
      join(directory, "demo/logic/control.py"),
      'raise RuntimeError("Loading must not execute code")',
    );
    const loaded = await cases.load("demo");
    assert.equal(loaded.source.record_kind, "layout_project");
    assert.match(loaded.notebook.cells[0].code, /raise RuntimeError/);
    assert.deepEqual((loaded.source.structure as any).instances, {
      part: { definition: "part" },
    });
    await assert.rejects(cases.load("../demo"));
    await json("logic/notebook.json", {
      version: 1,
      cells: [{ id: "control", file: "../outside.py" }],
      inputs: [],
      bindings: [],
    });
    await assert.rejects(cases.load("demo"));
    await json("project.json", {
      version: 1,
      id: "other",
      title: "Demo",
      summary: "",
      focus: [],
    });
    await assert.rejects(cases.list(), /project.json/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

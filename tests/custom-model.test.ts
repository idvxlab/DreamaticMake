import assert from "node:assert/strict";
import test from "node:test";
import { buildModel } from "../engine/custom_model/kernel";
import { EXAMPLE, toSTL } from "../engine/custom_model/model";
import { parseCondition, parseProject } from "../engine/custom_model/contracts";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";

test("CAD kernel executes real enclosure subtraction and binary STL round-trip", () => {
  const result = buildModel(EXAMPLE);
  assert.equal(result.parts.length, 1);
  const part = result.parts[0];
  assert.equal(part.id, "housing");
  assert.ok(part.volume_mm3 > 0 && part.volume_mm3 < 80 * 60 * 30);
  assert.deepEqual(part.bounds_mm, [
    [-40, -30, 0],
    [40, 30, 30],
  ]);
  const geometry = new STLLoader().parse(toSTL(part));
  assert.equal(
    geometry.getAttribute("position").count,
    part.positions.length / 3,
  );
  geometry.computeBoundingBox();
  assert.ok(Math.abs((geometry.boundingBox?.max.z ?? 0) - 30) < 0.001);
  geometry.dispose();
});

test("CAD supports separate outputs, transforms, intersection, union and profile extrusion", () => {
  const result = buildModel(`box a 10 10 10
move b a 5 0 0
intersect common a b
union joined a b
extrude prism 4 0,0 10,0 0,10
show common
show joined
show prism`);
  assert.deepEqual(
    result.parts.map((p) => Math.round(p.volume_mm3)),
    [500, 1500, 200],
  );
});

test("CAD reports command line errors without executing host code", () => {
  assert.throws(
    () => buildModel("box a 10 10 10\nsubtract b a missing"),
    /第 2 行.*missing/,
  );
  assert.throws(() => buildModel("box a NaN 10 10"), /第 1 行/);
  assert.throws(() => buildModel("box a 10 10 10\nbox a 1 1 1"), /名称重复/);
  assert.throws(() => buildModel("eval x process.exit()"), /未知命令/);
  assert.throws(() => buildModel("box a 10 10 10\nsubtract b a a"), /为空/);
});

test("conditions preserve proposed fields and model projects round-trip material and source identity", () => {
  const pack = {
    record_kind: "custom_model_conditions",
    schema_version: "0.1.0-draft",
    condition_id: "support",
    revision: 1,
    title: "承托条件",
    requirements: { support: { strength: "must", knowledge: "unknown" } },
    references: { image: { artifact_id: "image1" } },
  };
  assert.deepEqual(parseCondition(pack), pack);
  const project = {
    record_kind: "custom_model_project",
    schema_version: "0.1.0-draft",
    design_id: "gripper",
    source_snapshot_id: "snapshot",
    commands: EXAMPLE,
    material: "PETG",
    conditions: [pack],
  };
  assert.deepEqual(parseProject(JSON.parse(JSON.stringify(project))), project);
  assert.throws(
    () => parseProject({ ...project, material: "toString" }),
    /格式无效/,
  );
  assert.throws(
    () => parseProject({ ...project, conditions: [pack, pack] }),
    /重复/,
  );
  assert.throws(() => parseCondition({ ...pack, revision: 0 }), /正整数/);
});

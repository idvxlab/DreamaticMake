import json
import unittest
from pathlib import Path
from engine.layout import parse_layout, project_layout, motion, collision, connectivity, import_layout, dispatch_layout


def fixture():
    return {"entities": {"a": {"name": "A"}, "b": {"name": "B"}},
            "bodies": {"a/bodies/body": {"entity": "a"}, "b/bodies/body": {"entity": "b"}},
            "envelopes": {f"{name}/envelopes/solid": {"body": f"{name}/bodies/body", "shape": {"kind": "box", "size_m": [1, 1, 1]}} for name in ("a", "b")}}


class LayoutTests(unittest.TestCase):
    def test_collisions_do_not_prevent_projection_or_persisted_source(self):
        d = parse_layout(fixture())
        self.assertEqual(len(project_layout(d)["scene"]["bodies"]), 2)
        result = dispatch_layout("layout_collision", {"draft": d.model_dump(mode="json")})
        self.assertEqual(result["check"]["status"], "issues")
        self.assertEqual(len(result["check"]["pairs"]), 1)
        self.assertEqual(project_layout(d)["scene"]["collisions"], [])

    def test_missing_references_are_visible_but_never_connected(self):
        raw = fixture()
        raw["ports"] = {"p": {"entity": "a", "domain": "information", "required": True}}
        raw["edges"] = {"broken": {"domain": "information", "members": ["p", "missing"]}}
        d = parse_layout(raw)
        self.assertTrue(any(n["missing"] for n in project_layout(d)["flow"]["nodes"]))
        self.assertEqual({x["code"] for x in connectivity(d)["diagnostics"]}, {"connection.missing", "connection.required"})

    def test_motion_independent_of_electrical_errors(self):
        raw = fixture()
        raw["joints"] = {"joint": {"kind": "revolute", "parent": "a/bodies/body", "child": "b/bodies/body", "axis": [0, 0, 1], "initial": 0, "lower": -2, "upper": 2}}
        raw["edges"] = {"broken": {"domain": "electrical", "members": ["missing1", "missing2"]}}
        d = parse_layout(raw)
        poses, result = motion(d, {"joint": 1.0})
        self.assertEqual(result["status"], "completed")
        self.assertAlmostEqual(poses["b/bodies/body"].rotation_xyzw[2], .4794255386)
        self.assertEqual(connectivity(d)["status"], "issues")

    def test_invalid_mechanism_keeps_poses_without_blocking_another(self):
        raw = fixture()
        raw["entities"]["c"] = {"name": "C"}; raw["entities"]["d"] = {"name": "D"}
        raw["bodies"]["c/bodies/body"] = {"entity": "c"}; raw["bodies"]["d/bodies/body"] = {"entity": "d"}
        joint = {"kind": "revolute", "axis": [0, 0, 1], "initial": 0, "lower": -2, "upper": 2}
        raw["joints"] = {"bad1": {**joint, "parent": "a/bodies/body", "child": "b/bodies/body"}, "bad2": {**joint, "parent": "b/bodies/body", "child": "a/bodies/body"}, "ok": {**joint, "parent": "c/bodies/body", "child": "d/bodies/body"}}
        poses, result = motion(parse_layout(raw), {"ok": 1.0})
        self.assertEqual(result["accepted"], ["ok"])
        self.assertEqual(poses["a/bodies/body"].rotation_xyzw, (0, 0, 0, 1))
        self.assertNotEqual(poses["d/bodies/body"].rotation_xyzw, (0, 0, 0, 1))

    def test_unfinished_joint_can_be_displayed(self):
        raw = fixture(); raw["joints"] = {"draft": {"kind": "revolute", "parent": "a/bodies/body", "child": "b/bodies/body"}}
        d = parse_layout(raw)
        self.assertEqual(len(project_layout(d)["scene"]["joints"]), 1)
        self.assertEqual(motion(d, {})[1]["status"], "issues")

    def test_connectivity_respects_direction_types_and_no_internal_conduction(self):
        raw = fixture()
        raw["ports"] = {"p": {"entity": "a", "domain": "information", "direction": "out", "data_type": "number"}, "q": {"entity": "b", "domain": "information", "direction": "in", "data_type": "number"}, "internal": {"entity": "b", "domain": "information"}}
        raw["edges"] = {"signal": {"domain": "information", "members": ["p", "q"], "directed": True}}
        raw["paths"] = [{"domain": "information", "source": "p", "target": "q"}, {"domain": "information", "source": "q", "target": "p"}, {"domain": "information", "source": "p", "target": "internal"}]
        result = connectivity(parse_layout(raw))
        self.assertEqual([p["connected"] for p in result["paths"]], [True, False, False])
        raw["ports"]["q"]["data_type"] = "text"
        self.assertIn("connection.type", [d["code"] for d in connectivity(parse_layout(raw))["diagnostics"]])

    def test_missing_geometry_is_partial_not_pass(self):
        raw = fixture(); del raw["envelopes"]["b/envelopes/solid"]
        d = parse_layout(raw); result = collision(d, {k: b.pose for k, b in d.bodies.items()})
        self.assertEqual(result["status"], "partial")
        self.assertIn("b/bodies/body", result["missing_bodies"])

    def test_snapshot_and_pose_identity_change_separately(self):
        source = json.loads(Path("examples/engine/actuator.bundle.json").read_text())
        scenario = json.loads(Path("examples/engine/actuator.scenario.json").read_text())
        d = import_layout(source, scenario)
        a = dispatch_layout("layout_motion", {"draft": d, "joint_inputs": {"servo/joints/axis": 0}})
        b = dispatch_layout("layout_motion", {"draft": d, "joint_inputs": {"servo/joints/axis": .5}})
        self.assertEqual(a["snapshot_id"], b["snapshot_id"])
        self.assertNotEqual(a["pose_id"], b["pose_id"])

    def test_legacy_examples_import_without_full_simulation(self):
        for name in ("actuator", "fan", "lamp"):
            with self.subTest(name=name):
                d = parse_layout(import_layout(json.loads(Path(f"examples/engine/{name}.bundle.json").read_text()), json.loads(Path(f"examples/engine/{name}.scenario.json").read_text())))
                self.assertTrue(project_layout(d)["snapshot_id"])
                self.assertTrue(d.ports)

    def test_single_component_import_and_default_root_pose(self):
        source = json.loads(Path("examples/element/servo.json").read_text())
        d = parse_layout(import_layout(source))
        self.assertTrue(d.entities)
        self.assertTrue(d.bodies)
        source = json.loads(Path("examples/engine/actuator.bundle.json").read_text())
        scenario = {"roots": [{"body_ref": {"instance_path": ["servo"], "object_id": "case"}}]}
        self.assertTrue(import_layout(source, scenario)["bodies"])

    def test_bad_syntax_numbers_and_unknown_fields_fail(self):
        for data in ({"mystery": True}, {"bodies": {"invalid": {"entity": "x"}}}, {"bodies": {"a/bodies/body": {"entity": "a", "pose": {"translation_m": [float("nan"), 0, 0]}}}}):
            with self.assertRaises(ValueError): parse_layout(data)

    def test_placeholder_is_visible_but_not_collision_evidence(self):
        d = {"entities": {"logic": {"name": "Controller"}}, "ports": {"signal": {"entity": "logic", "domain": "information"}}}
        result = dispatch_layout("layout_collision", {"draft": d})
        self.assertEqual(result["bindings"]["signal"], result["bindings"]["logic"])
        self.assertEqual(len(result["scene"]["envelopes"]), 1)
        self.assertEqual(result["check"]["status"], "partial")
        self.assertEqual(result["check"]["checked"], [])
        self.assertEqual(result["check"]["missing_bodies"], ["logic"])

    def test_transmission_drives_follower_and_rejects_out_of_range(self):
        raw = fixture()
        raw["bodies"]["c/bodies/body"] = {"entity": "a"}
        raw["joints"] = {
            "driver": {"kind": "continuous", "parent": "a/bodies/body", "child": "b/bodies/body", "axis": [0, 0, 1], "initial": 0},
            "follower": {"kind": "prismatic", "parent": "a/bodies/body", "child": "c/bodies/body", "axis": [1, 0, 0], "initial": 0, "lower": 0, "upper": .02}}
        raw["transmissions"] = {"screw": {"driver": "driver", "follower": "follower", "kind": "screw", "factor": .01}}
        from math import pi
        poses, report = motion(parse_layout(raw), {"driver": pi * 2})
        self.assertAlmostEqual(report["joint_positions"]["follower"], .01)
        self.assertAlmostEqual(poses["c/bodies/body"].translation_m[0], .01)
        poses, report = motion(parse_layout(raw), {"driver": pi * 6})
        self.assertEqual(report["status"], "issues")
        self.assertEqual(poses["c/bodies/body"].translation_m, (0, 0, 0))

    def test_reserved_browser_identities_are_rejected(self):
        for raw in ({"entities": {"__proto__": {"name": "X"}}}, {"edges": {"e": {"domain": "information", "members": ["a", "constructor"]}}}):
            with self.assertRaises(ValueError): parse_layout(raw)


if __name__ == "__main__": unittest.main()

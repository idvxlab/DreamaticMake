import copy
import unittest
from math import sqrt
from engine.layout import import_layout, dispatch_layout
from engine.io.json_schema import export_schema


def fixture():
    component = {"record_kind": "component_design", "category": "structure", "id": "fixture.link", "name": "Link",
        "geometry": {"root_body": "body", "bodies": {"body": {}}, "envelopes": {"solid": {"body_ref": "body", "shape": {"kind": "box", "size_m": [.01, .02, .03]}}}}}
    return {"record_kind": "layout_project", "project_version": 1, "components": {"link": component},
        "structure": {"instances": {"a": {"definition": "link"}, "b": {"definition": "link", "pose": {"translation_m": [.1, 0, 0]}}}},
        "motion": {}, "circuit_energy": {}, "flow": {}}


class LayoutProjectTests(unittest.TestCase):
    def test_reuses_definitions_without_mutating_them(self):
        source = fixture(); original = copy.deepcopy(source)
        d = import_layout(source)
        self.assertEqual(source, original)
        self.assertEqual(set(d["entities"]), {"a", "b"})
        self.assertEqual(d["bodies"]["b/bodies/body"]["pose"]["translation_m"], [.1, 0, 0])
        self.assertEqual(dispatch_layout("layout_collision", {"draft": d})["check"]["status"], "completed")

    def test_layer_joint_composes_with_root_orientation(self):
        source = fixture()
        source["structure"]["instances"]["a"]["pose"] = {"rotation_xyzw": [0, 0, sqrt(.5), sqrt(.5)]}
        source["motion"]["joints"] = {"assembly/hinge": {"kind": "fixed", "parent": "a/bodies/body", "child": "b/bodies/body", "parent_anchor": {"translation_m": [.05, 0, 0]}}}
        d = import_layout(source)
        self.assertAlmostEqual(d["bodies"]["b/bodies/body"]["pose"]["translation_m"][1], .05)
        self.assertEqual(len(d["joints"]), 1)

    def test_graph_layers_preserve_native_ports_and_domains(self):
        source = fixture()
        source["flow"] = {"ports": {"a/info/out": {"entity": "a", "domain": "information", "direction": "out"}, "b/info/in": {"entity": "b", "domain": "information", "direction": "in"}},
            "edges": {"flow/data": {"domain": "information", "members": ["a/info/out", "b/info/in"], "directed": True}}}
        d = import_layout(source)
        self.assertEqual(dispatch_layout("layout_connectivity", {"draft": d})["check"]["status"], "completed")
        source["circuit_energy"] = source["flow"]
        with self.assertRaises(ValueError): import_layout(source)

    def test_missing_definitions_and_colliding_layer_ids_rejected(self):
        source = fixture(); source["structure"]["instances"]["a"]["definition"] = "missing"
        with self.assertRaises(ValueError): import_layout(source)
        source = fixture(); source["flow"] = {"ports": {"a/bodies/body": {"entity": "a", "domain": "information"}}}
        with self.assertRaises(ValueError): import_layout(source)
        self.assertIn("components", export_schema("layout_project")["properties"])

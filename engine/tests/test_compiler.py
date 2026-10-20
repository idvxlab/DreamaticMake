import unittest
from engine.base.diagnostic import ModelError
from engine.compiler.lower import compile_model
from engine.schema.component import ComponentDefinition
from engine.schema.assembly import AssemblyDefinition, ModelBundle
from engine.examples.build_examples import parse, ref, definition_ref, actuator_example, quantity, pose
from engine.tests.helpers import single


class CompilerTests(unittest.TestCase):
    def test_wrong_definition_hash(self):
        bundle, _ = actuator_example()
        data = bundle.model_dump(mode="json")
        data["root"]["content_hash"] = "0" * 64
        with self.assertRaises(ModelError) as cm:
            compile_model(parse(ModelBundle, data))
        self.assertIn("definition.mismatch", str(cm.exception))

    def test_missing_reference(self):
        with self.assertRaises(ModelError) as cm:
            single({"physical": {"geometry": {"root_body": "body", "bodies": {"body": {}},
                "envelopes": {"box": {"body_ref": "absent", "shape": {"kind": "box", "size_m": [1, 1, 1]}}}}}})
        self.assertIn("reference.missing", str(cm.exception))

    def test_closed_kinematics_rejected(self):
        with self.assertRaises(ModelError) as cm:
            single({"physical": {"geometry": {"root_body": "a", "bodies": {"a": {}, "b": {}}},
                "motion": {"joints": {
                    "ab": {"kind": "fixed", "parent_body": ref("bodies", "a"), "child_body": ref("bodies", "b")},
                    "ba": {"kind": "fixed", "parent_body": ref("bodies", "b"), "child_body": ref("bodies", "a")}}}}})
        self.assertIn("joint.cycle", str(cm.exception))

    def test_overconstrained_body_rejected(self):
        with self.assertRaises(ModelError) as cm:
            single({"physical": {"geometry": {"root_body": "a", "bodies": {"a": {}, "b": {}, "c": {}}},
                "motion": {"joints": {name: {"kind": "fixed", "parent_body": ref("bodies", parent), "child_body": ref("bodies", "c")}
                                     for name, parent in (("one", "a"), ("two", "b"))}}}})
        self.assertIn("joint.overconstrained", str(cm.exception))

    def test_evidence_must_resolve(self):
        with self.assertRaises(ModelError) as cm:
            single({"parameters": {"length": {"status": "assumed", "value": quantity(1, "m"), "evidence_refs": ["missing"]}}})
        self.assertIn("evidence.missing", str(cm.exception))

    def test_invalid_supply_voltage_rejected(self):
        bundle, _ = actuator_example()
        data = bundle.model_dump(mode="json")
        source = next(c for c in data["components"] if c["id"] == "example.ideal_supply")
        source["electronic"]["electrical"]["terminals"]["positive"]["nominal_voltage"]["value"] = 12
        source = parse(ComponentDefinition, source)
        data["components"] = [source.model_dump(mode="json") if c["id"] == source.id else c for c in data["components"]]
        data["assemblies"][0]["instances"]["supply"]["definition_ref"] = definition_ref(source)
        data["root"] = definition_ref(parse(AssemblyDefinition, data["assemblies"][0]))
        with self.assertRaises(ModelError) as cm:
            compile_model(parse(ModelBundle, data))
        self.assertIn("power.voltage", str(cm.exception))

    def test_nested_export_and_two_instances(self):
        part = parse(ComponentDefinition, {"id": "part", "name": "Part", "physical": {"geometry": {"root_body": "body", "bodies": {"body": {}}},
                          "mechanical": {"ports": {"mount": {"body_ref": "body", "kind": "plane"}}}}})
        child = parse(AssemblyDefinition, {"id": "child", "name": "Child", "instances": {"part": {"definition_ref": definition_ref(part)}},
                                          "exported_ports": {"mount": ref("mechanical_ports", "mount", "part")}})
        root = parse(AssemblyDefinition, {"id": "root", "name": "Root", "instances": {name: {"definition_ref": definition_ref(child)} for name in ("left", "right")},
                    "connections": {"mechanical": {"join": {"a": ref("mechanical_ports", "mount", "left"), "b": ref("mechanical_ports", "mount", "right"),
                                                         "constraint_mode": "fixed", "method": "adhesive", "alignment": pose(x=1)}}}})
        bundle = parse(ModelBundle, {"components": [part.model_dump(mode="json")], "assemblies": [child.model_dump(mode="json"), root.model_dump(mode="json")], "root": definition_ref(root)})
        ir = compile_model(bundle)
        self.assertEqual(len(ir.collection("bodies")), 2)
        self.assertEqual(ir.roots, ("left/part/bodies/body",))
        self.assertEqual(ir.aliases["right/mechanical_ports/mount"], "right/part/mechanical_ports/mount")

    def test_pinned_instance_parameters_cannot_change_rating(self):
        part = parse(ComponentDefinition, {"id": "part", "name": "Part", "parameters": {"voltage": {"status": "known", "value": quantity(5, "V")}}})
        root = parse(AssemblyDefinition, {"id": "root", "name": "Root", "instances": {"part": {"definition_ref": definition_ref(part),
                            "parameter_bindings": {"voltage": {"status": "known", "value": quantity(12, "V")}}}}})
        bundle = parse(ModelBundle, {"components": [part.model_dump(mode="json")], "assemblies": [root.model_dump(mode="json")], "root": definition_ref(root)})
        with self.assertRaises(ModelError) as cm:
            compile_model(bundle)
        self.assertIn("parameter.readonly", str(cm.exception))

    def test_model_copy_does_not_bypass_compiler_validation(self):
        bundle, _ = actuator_example()
        with self.assertRaises(ValueError):
            compile_model(bundle.model_copy(update={"input_revisions": {"entry": -1}}))

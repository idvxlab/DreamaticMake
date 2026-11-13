"""Colors survive category lowering, layout composition and scene projection."""
import json
import unittest
from pydantic import ValidationError
from element.categories.mechanical import Structure
from element.categories.housing_spec import HousingMaterial, CADHousingSpec
from element.categories.specs import MechanicalDescription
from element.interfaces.geometry import Box, RigidBody
from element.io.save import content_hash
from engine.compiler.lower import compile_model
from engine.projection.scene import project_scene
from engine.layout import import_layout, project_layout


class AppearanceTests(unittest.TestCase):
    def part(self, housing=False):
        metadata = ({"structural_role": "housing", "cad_housing": CADHousingSpec(
            material=HousingMaterial(name="PLA", color="#E6DED0"))} if housing else {
            "spec": MechanicalDescription(kind="bracket", material="PETG", color="#327F90")})
        return Structure.from_shape(id="colored", name="Colored part",
                                    shape=Box(size_m=(.02, .03, .04)), **metadata)

    def test_strict_srgb_and_optional_defaults(self):
        for factory in (lambda color: HousingMaterial(name="PLA", color=color),
                        lambda color: MechanicalDescription(kind="bracket", color=color),
                        lambda color: RigidBody(color=color)):
            self.assertIsNone(factory(None).color)
            self.assertEqual(factory("#aB120F").color, "#aB120F")
            for invalid in ("red", "#fff", "#12345678", "123456", "#GG0000", 123):
                with self.subTest(invalid=invalid), self.assertRaises(ValidationError):
                    factory(invalid)

    def test_material_color_reaches_both_scene_routes_without_mutation(self):
        for housing, color in ((False, "#327F90"), (True, "#E6DED0")):
            part = self.part(housing)
            before = content_hash(part)
            self.assertEqual(project_scene(compile_model(part))["bodies"][0]["color"], color)
            source = {"project_version": 1, "record_kind": "layout_project",
                      "components": {"part": part.model_dump(mode="json")},
                      "structure": {"instances": {"a": {"definition": "part"},
                                                 "b": {"definition": "part"}}}}
            scene = project_layout(import_layout(source))["scene"]
            self.assertEqual([body["color"] for body in scene["bodies"]], [color, color])
            self.assertEqual(content_hash(part), before)
            self.assertIsNone(part.geometry.bodies["body"].color)

    def test_body_override_and_color_affect_identity(self):
        part = self.part()
        data = part.model_dump(mode="json")
        data["geometry"]["bodies"]["body"]["color"] = "#112233"
        override = Structure.model_validate_json(json.dumps(data))
        self.assertNotEqual(content_hash(part), content_hash(override))
        self.assertEqual(project_scene(compile_model(override))["bodies"][0]["color"], "#112233")

    def test_missing_color_preserves_existing_content_hashes(self):
        # Existing pinned library elements must not gain a serialized color:null.
        for value in (RigidBody(), HousingMaterial(name="PLA"),
                      MechanicalDescription(kind="bracket", material="PLA")):
            data = value.model_dump(mode="json")
            self.assertNotIn("color", data)
            self.assertEqual(content_hash(value), content_hash(data))

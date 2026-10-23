import math
import tempfile
import unittest
from pathlib import Path
from element.base.quantity import Quantity, Range, Parameter
from element.base.frame import Pose
from element.base.reference import AssetRef
from engine.io.load import loads, load
from element.io.load import read_asset
from element.io.save import dumps, save, content_hash
from engine.io.json_schema import export_schema
from engine.schema.component import ComponentDefinition
from engine.schema.scenario import SolverOptions
from examples.engine.build_examples import actuator_example


class ContractTests(unittest.TestCase):
    def test_unit_conversions_and_affine_temperature(self):
        self.assertEqual(Quantity(value=1000, unit="mm").to("m").value, 1)
        self.assertAlmostEqual(Quantity(value=180, unit="deg").to("rad").value, math.pi)
        self.assertAlmostEqual(Quantity(value=20, unit="degC").to("K").value, 293.15)
        self.assertAlmostEqual(Quantity(value=273.15, unit="K").to("degC").value, 0)
        with self.assertRaises(ValueError):
            Quantity(value=1, unit="V").to("m")
        with self.assertRaises(ValueError):
            Quantity(value=-300, unit="degC")
        with self.assertRaises(ValueError):
            Quantity(value=1e308, unit="kPa")

    def test_unknown_is_not_zero_and_range_has_dimensions(self):
        p = Parameter(status="unknown")
        self.assertIsNone(p.value)
        with self.assertRaises(ValueError):
            Parameter(status="unknown", value=Quantity(value=0, unit="m"))
        with self.assertRaises(ValueError):
            Range(min=Quantity(value=0, unit="m"), max=Quantity(value=1, unit="V"))

    def test_strict_json(self):
        for text in ('{"value":1,"value":2,"unit":"m"}', '{"value":NaN,"unit":"m"}',
                     '{"value":1e999,"unit":"m"}', '{"value":true,"unit":"m"}',
                     '{"value":"2","unit":"m"}', '{"value":1,"unit":"m","surprise":4}'):
            with self.subTest(text=text), self.assertRaises(ValueError):
                loads(text, Quantity)

    def test_version_and_record_kind_are_not_guessed(self):
        with self.assertRaises(ValueError):
            loads('{"record_kind":"mystery"}')
        with self.assertRaises(ValueError):
            loads('{"dsl_version":"0.1.0-proposal","id":"test","name":"Test"}', ComponentDefinition)

    def test_roundtrip_and_immutable_maps(self):
        bundle, _ = actuator_example()
        other = loads(dumps(bundle))
        self.assertEqual(bundle, other)
        self.assertEqual(content_hash(bundle), content_hash(other))
        with self.assertRaises(TypeError):
            bundle.components[0].physical.geometry.bodies["new"] = None
        with self.assertRaises(ValueError):
            bundle.components[0].name = "Changed"

    def test_hash_ignores_dictionary_order(self):
        self.assertEqual(content_hash({"b": 2, "a": 1}), content_hash({"a": 1, "b": 2}))

    def test_save_no_overwrite_and_explicit_replacement(self):
        c = ComponentDefinition(id="test", name="Test")
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / "component.json"
            save(c, path)
            self.assertEqual(load(path), c)
            with self.assertRaises(FileExistsError):
                save(c, path)
            save(c, path, overwrite=True)
            self.assertEqual(load(path), c)

    def test_asset_scope_and_hash(self):
        import hashlib
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / "asset.bin"
            path.write_bytes(b"fixture")
            sha = hashlib.sha256(b"fixture").hexdigest()
            ref = AssetRef(relative_path="asset.bin", sha256=sha, media_type="application/octet-stream")
            self.assertEqual(read_asset(ref, Path(root)), b"fixture")
            bad = ref.model_copy(update={"sha256": "0" * 64})
            with self.assertRaises(ValueError):
                read_asset(bad, Path(root))
        for name in ("../secret", "C:/secret", "\\secret", "/secret"):
            with self.assertRaises(ValueError):
                AssetRef(relative_path=name, sha256="0" * 64, media_type="text/plain")

    def test_transform_inverse_and_axis_convention(self):
        pose = Pose(translation_m=(1.0, 2.0, 3.0)).compose(Pose.axis_angle((0.0, 0.0, 1.0), math.pi / 2))
        endpoint = pose.compose(Pose(translation_m=(1.0, 0.0, 0.0)))
        self.assertAlmostEqual(endpoint.translation_m[0], 1)
        self.assertAlmostEqual(endpoint.translation_m[1], 3)
        identity = pose.compose(pose.inverse())
        for value in identity.translation_m:
            self.assertAlmostEqual(value, 0)
        with self.assertRaises(ValueError):
            Pose(rotation_xyzw=(0.0, 0.0, 0.0, 2.0))

    def test_generated_schema_and_solver_limits(self):
        schema = export_schema("model_bundle")
        self.assertEqual(schema["additionalProperties"], False)
        self.assertIn("MechanicalPort", schema["$defs"])
        for step in (0, -1, 1e-20, float("inf")):
            with self.assertRaises(ValueError):
                SolverOptions(step_s=step)

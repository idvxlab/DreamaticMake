"""Category authoring, executable outcomes, format boundaries and old-DSL compatibility."""
from engine.adapters.elements import to_bundle, to_definition
from engine.adapters.commands import move_to, set_speed
import importlib.util
import json
import math
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from element.base.quantity import Quantity
from element.base.reference import ObjectRef
from element.base.signal import SignalType
from element.categories import Structure, ControlFunction
from engine.adapters.assembly import assemble_components
from engine.compiler.lower import compile_model
from examples.engine.build_components import examples, scenario_for
from element.interfaces.behavior import BehaviorSpec, InputBinding
from element.interfaces.mechanical import MechanicalSpec, MechanicalPort
from engine.schema.connections import MechanicalConnection
from element.io.components import parse_component, load_component
from engine.io.load import load, loads, loads_model
from element.io.load import read_asset
from element.io.save import content_hash, save
from engine.io.json_schema import export_schema
from engine.schema.assembly import Connections
from engine.schema.scenario import Scenario, RootPlacement, FixtureChannel, Stimulus
from engine.simulator.engine import simulate
from engine.projection.flow import project_flow

EXAMPLES = Path(__file__).resolve().parents[2] / "examples" / "element"
MESH = all(importlib.util.find_spec(name) for name in ("trimesh", "fcl", "rtree"))


class ComponentTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.examples = examples()

    def test_legacy_categories_roundtrip_and_run_committed_scenarios(self):
        self.assertEqual(len({c.category for c in self.examples.values()}), 13)
        for name, design in self.examples.items():
            with self.subTest(name=name):
                self.assertEqual(parse_component(design.model_dump(mode="json")), design)
                loaded = load(EXAMPLES / f"{name}.json")
                self.assertEqual(loaded, design)
                ir = compile_model(loaded)
                self.assertEqual(ir.snapshot_id, compile_model(to_bundle(design)).snapshot_id)
                result = simulate(ir, load(EXAMPLES / f"{name}.scenario.json"))
                self.assertEqual(result.status, "completed", result.diagnostics)
                self.assertEqual(result.actual_end_s, 0.5)
                self.assertTrue(any(d.code == "component.design_contract" for d in result.diagnostics))

    def test_motion_outputs_respect_units_and_modes(self):
        expected = {"servo": math.pi / 6, "motor": 1.0, "continuous_servo": 1.0, "slider": 0.02}
        for name, position in expected.items():
            c = self.examples[name]
            run = simulate(compile_model(c), scenario_for(c))
            self.assertAlmostEqual(run.frames[-1].joint_positions["joints/axis"], position)
        with self.assertRaises(ValueError):
            move_to(self.examples['continuous_servo'], Quantity(value=30.0, unit='deg'))
        with self.assertRaises(ValueError):
            move_to(self.examples['servo'], Quantity(value=180.0, unit='deg'))
        with self.assertRaises(ValueError):
            set_speed(self.examples['motor'], Quantity(value=200.0, unit='rpm'))
        with self.assertRaises(ValueError):
            move_to(self.examples['slider'], Quantity(value=1.0, unit='rad'))

    def test_specialized_outputs_and_immutable_edits(self):
        edits = ((self.examples["rgb_led"].set_brightness(0.6, channel="red"), "red", 0.6),
                 (self.examples["oled"].show_text("Hello"), "text", "Hello"),
                 (self.examples["buzzer"].play_tone(Quantity(value=880.0, unit="Hz")), "tone", 880.0),
                 (self.examples["buzzer"].silence(), "tone", 0.0))
        for design, effect, expected in edits:
            run = simulate(compile_model(design), scenario_for(design))
            self.assertEqual(run.frames[-1].effects[f"effects/{effect}"].value, expected)
        self.assertEqual(self.examples["rgb_led"].channels["red"].value, 0.8)
        with self.assertRaises(TypeError):
            self.examples["rgb_led"].channels["red"] = InputBinding(kind="constant", value=0.5)
        with self.assertRaises(ValueError):
            self.examples["rgb_led"].set_brightness(2.0, channel="red")
        with self.assertRaises(ValueError):
            self.examples["buzzer"].play_tone(Quantity(value=-1.0, unit="Hz"))

    def test_sensor_latency_conversion_and_controller_function(self):
        sensor = self.examples["temperature"]
        run = simulate(compile_model(sensor), scenario_for(sensor))
        self.assertNotIn("sensors/temperature", run.frames[0].sensor_samples)
        self.assertAlmostEqual(run.frames[-1].sensor_samples["sensors/temperature"].value, 313.15)
        self.assertEqual(sensor.read("temperature").ref.collection, "sensors")
        controller = self.examples["controller"]
        run = simulate(compile_model(controller), scenario_for(controller))
        self.assertEqual(run.frames[-1].behavior_outputs["behaviors/too_hot"].value, "1")
        self.assertEqual(controller.output("too_hot").ref.object_id, "too_hot")
        with self.assertRaises(ValueError):
            controller.output("missing")
        with self.assertRaises(ValueError):
            controller.define_function("too_hot", controller.control_functions["too_hot"])

    def test_display_x_and_z_are_text_not_unknown_digital_values(self):
        for text in ("X", "Z", ""):
            display = self.examples["oled"].show_text(text)
            run = simulate(compile_model(display), scenario_for(display))
            self.assertEqual(run.frames[-1].effects["effects/text"].value, text)
            self.assertEqual(run.frames[-1].effects["effects/text"].quality, "valid")
        display = self.examples["oled"].replace(text=InputBinding(kind="fixture", channel="text"))
        ir = compile_model(display)
        scenario = Scenario(id="text", snapshot_id=ir.snapshot_id, duration_s=0.1,
            channels={"text": FixtureChannel(signal_type=SignalType(kind="event"), initial_value="X")},
            stimuli=(Stimulus(time_s=0.1, channel="text", value="Z"),))
        run = simulate(ir, scenario)
        self.assertEqual(run.frames[0].effects["effects/text"].value, "X")
        self.assertEqual(run.frames[-1].effects["effects/text"].value, "Z")
        self.assertTrue(all(f.effects["effects/text"].quality == "valid" for f in run.frames))
        from engine.simulator.logic import sample
        self.assertEqual(sample("X", 0.0).quality, "unknown")

    def test_function_signature_and_closed_registry(self):
        b = self.examples["controller"].control_functions["too_hot"].behavior
        with self.assertRaises(ValueError):
            ControlFunction(inputs={"value": SignalType(kind="digital")}, behavior=b)
        with self.assertRaises(ValueError):
            ControlFunction(inputs={}, behavior=b)
        with self.assertRaises(ValueError):
            ControlFunction(inputs={}, behavior=BehaviorSpec(model_id="exec_python", output_type=SignalType(kind="digital")))
        with self.assertRaises(ValueError):
            ControlFunction(inputs={"value": SignalType(kind="digital")}, behavior=BehaviorSpec(model_id="pass",
                inputs={"value": InputBinding(kind="constant", value=3.0)}, output_type=SignalType(kind="digital")))

    def test_categories_reject_foreign_fields_versions_and_unchecked_edits(self):
        design = self.examples["housing"].model_dump(mode="json")
        for change in ({"category": "mystery"}, {"firmware": "arbitrary.py"}, {"design_version": "2"},
                       {"dsl_version": "old"}, {"category": "display"}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                parse_component({**design, **change})
        forged = self.examples["usb_supply"].model_copy(update={"voltage": Quantity(value=0.0, unit="V")})
        for invoke in ((lambda: to_definition(forged)), lambda: compile_model(forged)):
            with self.assertRaises(ValueError):
                invoke()

    def test_authoring_metadata_is_hash_pinned(self):
        oled = self.examples["oled"]
        changed = oled.replace(width_px=256)
        self.assertNotEqual(compile_model(oled).snapshot_id, compile_model(changed).snapshot_id)
        definition = to_definition(oled)
        self.assertEqual(definition.sources["_component_design"].source_revision, content_hash(oled))
        self.assertEqual(definition.functions["_category"].capability, "component.display")

    def test_storage_and_transport_do_not_claim_dynamic_solution(self):
        pump = self.examples["pump"]
        self.assertEqual(project_flow(compile_model(pump))["mode"], "topology_only")
        self.assertEqual(pump.port_ref("outlet").collection, "material_ports")
        spring = self.examples["spring"]
        self.assertEqual(spring.store_energy(0.15).initial_energy_j, 0.15)
        with self.assertRaises(ValueError):
            spring.store_energy(0.3)
        with self.assertRaises(ValueError):
            self.examples["keypad"].replace(debounce_s=0.01)

    def test_composition_deduplicates_and_preserves_connections(self):
        port = lambda body: MechanicalSpec(ports={"mount": MechanicalPort(body_ref=body, kind="plane")})
        servo = self.examples["servo"].replace(mounts=port("shaft"))
        pointer = self.examples["housing"].replace(mounts=port("body"), structural_role="pointer")
        connection = MechanicalConnection(a=ObjectRef(instance_path=("servo",), collection="mechanical_ports", object_id="mount"),
            b=ObjectRef(instance_path=("pointer",), collection="mechanical_ports", object_id="mount"),
            method="fastener", constraint_mode="fixed")
        bundle = assemble_components(id="pointer_demo", name="Servo pointer", components={"servo": servo, "pointer": pointer},
            connections=Connections(mechanical={"pointer_mount": connection}))
        ir = compile_model(bundle)
        scenario = Scenario(id="run", snapshot_id=ir.snapshot_id, duration_s=0.5,
            roots=(RootPlacement(body_ref=ObjectRef(instance_path=("servo",), collection="bodies", object_id="case")),),
            joint_commands=(move_to(servo, Quantity(value=30.0, unit='deg'), instance_path=('servo',)),))
        result = simulate(ir, scenario)
        self.assertEqual(result.status, "completed", result.diagnostics)
        self.assertEqual(result.frames[-1].body_poses["pointer/bodies/body"].rotation_xyzw,
                         result.frames[-1].body_poses["servo/bodies/shaft"].rotation_xyzw)
        duplicates = assemble_components(id="pair", name="Pair", components={"a": pointer, "b": pointer})
        self.assertEqual(len(duplicates.components), 1)
        with self.assertRaises(ValueError):
            assemble_components(id="bad", name="Bad", components={"a": pointer, "b": pointer.replace(name="Changed")})

    def test_formats_and_schema(self):
        toml = load(EXAMPLES / "indicator.toml")
        self.assertEqual(toml.channels["brightness"].value, 0.5)
        self.assertEqual(len(export_schema("component_design")["oneOf"]), 14)
        self.assertEqual(loads(self.examples["servo"].model_dump_json()), self.examples["servo"])
        legacy = to_bundle(self.examples['servo']).model_dump(mode="json")
        legacy.pop("record_kind")
        self.assertEqual(compile_model(loads_model(json.dumps(legacy))).snapshot_id,
                         compile_model(self.examples["servo"]).snapshot_id)
        for text in ('{"record_kind":"component_design","category":"light","category":"sound"}',
                     '{"record_kind":"component_design","category":"light","value":NaN}'):
            with self.assertRaises(ValueError):
                loads(text)
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "component.toml"
            path.write_text('category="power"\nid="bad"\nname="bad"\nsource_kind="usb"\n[voltage]\nvalue=nan\nunit="V"', encoding="utf-8")
            with self.assertRaises(ValueError):
                load_component(path)
            with self.assertRaises(ValueError):
                load_component(Path(folder) / "execute.py")
            path = Path(folder) / "component.json"
            save(toml, path)
            self.assertEqual(load_component(path), toml)

    def test_cli_component_toml_and_inline_request(self):
        for args in (["compile", str(EXAMPLES / "indicator.toml")], ["schema", "component_design"]):
            run = subprocess.run([sys.executable, "-m", "engine", *args], capture_output=True, text=True, timeout=20)
            self.assertEqual(run.returncode, 0, run.stdout + run.stderr)
            json.loads(run.stdout)
        c = self.examples["servo"]
        request = {"request_id": "design", "method": "simulate", "bundle": c.model_dump(mode="json"),
                   "scenario": scenario_for(c).model_dump(mode="json")}
        run = subprocess.run([sys.executable, "-m", "engine", "request"], input=json.dumps(request),
                             capture_output=True, text=True, timeout=20)
        self.assertEqual(run.returncode, 0, run.stdout + run.stderr)
        self.assertEqual(json.loads(run.stdout)["payload"]["status"], "completed")

    @unittest.skipUnless(MESH, "Install engine/requirements-mesh.txt")
    def test_real_stl_import_scope_hash_units_and_simulation(self):
        import trimesh
        from element.io.mesh import resolve_stl
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            path = root / "housing.stl"
            path.write_bytes(trimesh.creation.box(extents=(20, 30, 40)).export(file_type="stl"))
            c = Structure.from_stl(id="imported", name="Imported housing", path=path, asset_root=root,
                                   unit="mm", collision_mode="solid")
            resolver = lambda ref: read_asset(ref, root)
            shape = c.geometry.envelopes["solid"].shape
            mesh = resolve_stl(shape, resolver)
            self.assertAlmostEqual(mesh.extents[0], 0.02)
            run = simulate(compile_model(c), scenario_for(c), asset_resolver=resolver)
            self.assertEqual(run.status, "completed", run.diagnostics)
            nested = root / "nested"
            nested.mkdir()
            with self.assertRaises(ValueError):
                Structure.from_stl(id="bad", name="Bad", path=path, asset_root=nested, unit="mm")
            path.write_bytes(b"tampered")
            with self.assertRaises(ValueError):
                resolve_stl(shape, resolver)


if __name__ == "__main__":
    unittest.main()

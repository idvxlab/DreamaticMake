"""Typed descriptions, provenance compatibility and honest circuit/stream coverage."""
from engine.adapters.elements import to_definition
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from element.base.frame import LocalFrame
from element.base.quantity import Quantity
from element.base.reference import ObjectRef
from element.base.signal import SignalType
from element.categories import Sensor, Driver
from engine.adapters.assembly import assemble_components
from element.categories.specs import InertialDescription, PowerDescription, DisplayDescription
from element.categories.circuit import ResistorSpec
from engine.examples.build_components import examples as legacy_examples, scenario_for
from engine.examples.described_components import examples
from element.interfaces.behavior import BehaviorSpec, InputBinding
from element.interfaces.electrical import ElectricalSpec, Terminal
from element.io.components import parse_component, load_component
from engine.io.design import compose_design
from engine.io.load import loads_model, loads
from engine.io.json_schema import export_schema
from element.io.save import save
from engine.compiler.lower import compile_model
from engine.cli import dispatch
from engine.schema.assembly import Connections
from engine.schema.connections import ElectricalNet
from engine.schema.scenario import Scenario, RootPlacement, FixtureChannel
from engine.simulator.engine import simulate


class DescriptionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.examples = examples()

    def test_legacy_records_keep_their_pinned_scenarios(self):
        directory = Path(__file__).resolve().parents[1] / "examples" / "components"
        for name, design in legacy_examples().items():
            with self.subTest(name=name):
                self.assertNotIn("spec", design.model_dump(mode="json"))
                scenario = loads((directory / f"{name}.scenario.json").read_text(encoding="utf-8"))
                self.assertEqual(compile_model(design).snapshot_id, scenario.snapshot_id)
        self.assertNotIn("wiring", legacy_examples()["usb_supply"].model_dump(mode="json"))

    def test_descriptions_roundtrip_and_have_category_specific_schemas(self):
        schema = export_schema("component_design")
        self.assertEqual(len(schema["discriminator"]["mapping"]), 14)
        self.assertIn("circuit_element", schema["discriminator"]["mapping"])
        for name, design in self.examples.items():
            with self.subTest(name=name):
                self.assertEqual(parse_component(design.model_dump(mode="json")), design)
                self.assertEqual(loads_model(design.model_dump_json()), design)
                path = Path(__file__).resolve().parents[1] / "examples" / "components" / f"described_{name}.json"
                self.assertEqual(load_component(path), design)
                compile_model(design)
        data = self.examples["screen"].model_dump(mode="json")
        data["spec"] = {"kind": "camera", "resolution_px": [640, 480]}
        with self.assertRaises(ValueError):
            parse_component(data)

    def test_metadata_changes_pin_provenance_without_changing_existing_execution(self):
        display = self.examples["screen"]
        changed = display.replace(spec=display.spec.model_copy(update={"refresh": "partial"}))
        self.assertNotEqual(compile_model(display).snapshot_id, compile_model(changed).snapshot_id)
        self.assertEqual(to_definition(display).behaviors, to_definition(changed).behaviors)
        self.assertEqual(to_definition(display).physical, to_definition(changed).physical)
        self.assertEqual(simulate(compile_model(changed), scenario_for(display)).status, "failed")
        self.assertEqual(simulate(compile_model(changed), scenario_for(changed)).frames[-1].effects["effects/text"].value, "Ready")

    def test_imu_axes_use_real_dimensions_and_fixture_conversion(self):
        design = self.examples["imu"]
        readings = dict(design.measurements)
        readings["az"] = readings["az"].model_copy(update={"signal_type": SignalType(kind="scalar", unit="g0")})
        design = design.replace(measurements=readings)
        ir = compile_model(design)
        scenario = scenario_for(design).model_copy(update={"channels": {
            name: FixtureChannel(signal_type=reading.signal_type, initial_value=1.0 if name == "az" else 0.0)
            for name, reading in readings.items()}})
        run = simulate(ir, scenario)
        self.assertEqual(run.status, "completed")
        self.assertAlmostEqual(run.frames[-1].sensor_samples["sensors/az"].value, 9.80665)
        with self.assertRaises(ValueError):
            design.replace(spec=InertialDescription(axes={"ax": "gx"}, frame=LocalFrame(body_ref="body")))
        with self.assertRaises(ValueError):
            design.replace(spec=InertialDescription(axes={"ax": "ax", "ay": "ax"}, frame=LocalFrame(body_ref="body")))

    def test_frames_units_and_pin_references_are_not_unchecked_metadata(self):
        with self.assertRaises(ValueError):
            self.examples["screen"].replace(spec=DisplayDescription(kind="oled", cable_exit=LocalFrame(body_ref="missing")))
        strip = self.examples["strip"]
        with self.assertRaises(ValueError):
            strip.replace(spec=strip.spec.model_copy(update={"data_terminal": "missing"}))
        with self.assertRaises(ValueError):
            self.examples["stepper"].replace(technology="dc_motor")
        with self.assertRaises(ValueError):
            self.examples["stepper"].replace(spec=self.examples["stepper"].spec.model_copy(
                update={"rated_effort": Quantity(value=1.0, unit="V")}))
        with self.assertRaises(ValueError):
            self.examples["speaker"].replace(spec=self.examples["speaker"].spec.model_copy(
                update={"impedance": Quantity(value=8.0, unit="V")}))

    def test_streams_are_explicit_descriptions_without_fabricated_samples(self):
        with self.assertRaises(ValueError):
            Sensor(id="empty", name="No measurements")
        for name in ("camera", "microphone"):
            design = self.examples[name]
            result = simulate(compile_model(design), scenario_for(design))
            self.assertTrue(any(d.code == "sensor.stream_unavailable" and d.outcome == "unsupported"
                                for d in result.diagnostics))
            self.assertTrue(all(not f.sensor_samples for f in result.frames))
            self.assertTrue(all(not f.effects for f in result.frames))

    def test_power_custom_terminal_poses_preserve_ideal_source_semantics(self):
        battery = self.examples["battery"]
        definition = to_definition(battery)
        positive = definition.electronic.electrical.terminals["positive"]
        self.assertEqual(positive.pose.translation_m, (0.01, 0.0, 0.0))
        self.assertEqual(positive.nominal_voltage, battery.voltage)
        self.assertEqual(positive.reference_terminal, "ground")
        self.assertAlmostEqual(battery.spec.capacity.to("Ah").value, 1.0)
        with self.assertRaises(ValueError):
            battery.replace(source_kind="usb")
        with self.assertRaises(ValueError):
            battery.replace(spec=PowerDescription(capacity=Quantity(value=1.0, unit="V")))
        bad = dict(battery.wiring.terminals)
        bad["positive"] = bad["positive"].model_copy(update={"nominal_voltage": Quantity(value=5.0, unit="V")})
        with self.assertRaises(ValueError):
            battery.replace(wiring=ElectricalSpec(terminals=bad))

    def test_circuit_families_validate_ratings_polarity_and_physical_pins(self):
        for name in ("resistor", "capacitor", "inductor", "diode", "transistor", "optocoupler"):
            design = self.examples[name]
            ir = compile_model(design)
            self.assertEqual(len(ir.collection("terminals")), len(design.wiring.terminals))
            self.assertTrue(any(d.code == "circuit.analysis_unavailable" and d.outcome == "unsupported"
                                for d in ir.diagnostics))
            self.assertEqual(design.terminal_ref(next(iter(design.wiring.terminals))).collection, "terminals")
        self.assertEqual(len(self.examples["optocoupler"].wiring.terminals), 6)
        resistor = self.examples["resistor"]
        for spec in ({"kind": "resistor", "resistance": {"value": -1.0, "unit": "ohm"}},
                     {"kind": "resistor", "resistance": {"value": 1.0, "unit": "V"}},
                     {"kind": "capacitor", "capacitance": {"value": 0.0, "unit": "uF"}}):
            with self.subTest(spec=spec), self.assertRaises(ValueError):
                parse_component({**resistor.model_dump(mode="json"), "spec": spec})
        with self.assertRaises(ValueError):
            self.examples["capacitor"].replace(wiring=resistor.wiring)
        with self.assertRaises(ValueError):
            resistor.replace(wiring=ElectricalSpec(terminals={"a": resistor.wiring.terminals["a"]}))
        bad = dict(resistor.wiring.terminals)
        bad["b"] = bad["b"].model_copy(update={"physical_pin_number": "1"})
        with self.assertRaises(ValueError):
            resistor.replace(wiring=ElectricalSpec(terminals=bad))
        self.assertEqual(ResistorSpec(resistance=Quantity(value=0.0, unit="ohm")).resistance.value, 0.0)

    def test_circuit_does_not_short_two_networks_or_invent_analog_results(self):
        source = Driver(id="source", name="Digital source", driver_kind="relay",
            wiring=ElectricalSpec(terminals={"out": Terminal(physical_pin_number="1", electrical_role="output", drive="push_pull")}),
            channels={"value": BehaviorSpec(model_id="constant", output_type=SignalType(kind="digital"),
                inputs={"value": InputBinding(kind="constant", value="1")}, output_terminals=("out",))})
        sink = Driver(id="sink", name="Digital receiver", driver_kind="relay",
            wiring=ElectricalSpec(terminals={"input": Terminal(physical_pin_number="1", electrical_role="input")}),
            channels={"value": BehaviorSpec(model_id="pass", output_type=SignalType(kind="digital"),
                inputs={"value": InputBinding(kind="terminal", ref=ObjectRef(collection="terminals", object_id="input"))})})
        def pin(instance, name):
            return ObjectRef(instance_path=(instance,), collection="terminals", object_id=name)
        bundle = assemble_components(id="circuit", name="No implicit resistor solver",
            components={"source": source, "r": self.examples["resistor"], "sink": sink},
            connections=Connections(electrical_nets={
                "before": ElectricalNet(members=(pin("source", "out"), pin("r", "a"))),
                "after": ElectricalNet(members=(pin("r", "b"), pin("sink", "input")))}))
        ir = compile_model(bundle)
        scenario = Scenario(id="run", snapshot_id=ir.snapshot_id, duration_s=0.0,
            roots=(RootPlacement(body_ref=ObjectRef(instance_path=("r",), collection="bodies", object_id="body")),))
        result = simulate(ir, scenario)
        self.assertEqual(result.frames[0].network_samples["nets/before"].value, "1")
        self.assertEqual(result.frames[0].behavior_outputs["sink/behaviors/value"].quality, "unknown")
        self.assertTrue(any(d.code == "circuit.analysis_unavailable" for d in result.diagnostics))

    def test_formats_schema_cli_and_compose_accept_the_new_contract(self):
        resistor = self.examples["resistor"]
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "resistor.json"
            save(resistor, path)
            self.assertEqual(load_component(path), resistor)
            path = Path(folder) / "resistor.toml"
            path.write_text('category="circuit_element"\nid="r"\nname="Resistor"\n'
                '[spec]\nkind="resistor"\n[spec.resistance]\nvalue=1.0\nunit="kohm"\n'
                '[wiring.terminals.a]\nphysical_pin_number="1"\nelectrical_role="passive"\n'
                '[wiring.terminals.b]\nphysical_pin_number="2"\nelectrical_role="passive"\n', encoding="utf-8")
            self.assertEqual(load_component(path).spec.resistance.to("ohm").value, 1000.0)
        source = {"id": "circuit", "name": "Layout", "components": {"r": resistor.model_dump(mode="json")}}
        scenario = {"id": "initial", "duration_s": 0.0, "roots": [{"body_ref": {
            "instance_path": ["r"], "collection": "bodies", "object_id": "body"}}]}
        request = {"request_id": "circuit", "method": "compose", "design": source, "scenario": scenario}
        run = subprocess.run([sys.executable, "-B", "-m", "engine", "request"],
            input=json.dumps(request), capture_output=True, text=True, timeout=20)
        self.assertEqual(run.returncode, 0, run.stdout + run.stderr)
        payload = json.loads(run.stdout)["payload"]
        self.assertEqual(payload, compose_design(source, scenario))
        workspace = dispatch("preview", loads_model(json.dumps(payload["bundle"])),
                             loads(json.dumps(payload["scenario"])))
        self.assertIsNotNone(workspace["scene"]["bodies"][0]["world_pose"])
        self.assertEqual(len(workspace["circuit"]["terminals"]), 2)
        self.assertIsNone(workspace["result"])


if __name__ == "__main__":
    unittest.main()

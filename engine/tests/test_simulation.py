import math
import unittest
from element.base.frame import Pose, rotate
from engine.compiler.lower import compile_model
from engine.examples.build_examples import actuator_example, fan_example, lamp_example, ref, quantity, parse
from engine.schema.scenario import Scenario
from engine.simulator.engine import simulate
from engine.simulator.collision import Collider, BASIS, intersects
from engine.simulator.electrical import resolve_logic
from engine.simulator.material import transfer_mass
from engine.tests.helpers import single


class SimulationTests(unittest.TestCase):
    def test_actuator_end_to_end_and_replay(self):
        bundle, scenario = actuator_example()
        ir = compile_model(bundle)
        result = simulate(ir, scenario)
        self.assertEqual(result.status, "completed")
        self.assertAlmostEqual(result.frames[-1].joint_positions["servo/joints/axis"], 1)
        self.assertAlmostEqual(result.frames[3].joint_positions["servo/joints/axis"], 0.1)
        self.assertEqual(result, simulate(ir, scenario))
        self.assertEqual(ir.snapshot_id, compile_model(bundle).snapshot_id)

    def test_continuous_fan_and_topology_only_flow(self):
        bundle, scenario = fan_example()
        result = simulate(compile_model(bundle), scenario)
        self.assertEqual(result.status, "completed")
        self.assertAlmostEqual(result.frames[-1].joint_positions["fan/joints/axis"], 5)
        self.assertTrue(any(d.code == "material.topology_only" and d.outcome == "unsupported" for d in result.diagnostics))

    def test_sensor_latency_and_temperature_conversion(self):
        bundle, scenario = lamp_example()
        result = simulate(compile_model(bundle), scenario)
        frames = {round(f.time_s, 8): f for f in result.frames}
        self.assertEqual(frames[0].effects["effects/indicator"].value, "X")
        self.assertEqual(frames[0.1].effects["effects/indicator"].value, "0")
        self.assertEqual(frames[0.12].effects["effects/indicator"].value, "1")
        reading = frames[0.12].sensor_samples["sensors/temperature"]
        self.assertAlmostEqual(reading.value, 313.15)
        self.assertEqual(reading.origin, "fixture")
        self.assertAlmostEqual(reading.time_s, 0.1)

    def test_stale_snapshot_never_runs(self):
        bundle, scenario = actuator_example()
        result = simulate(compile_model(bundle), scenario.model_copy(update={"snapshot_id": "0" * 64}))
        self.assertEqual(result.status, "failed")
        self.assertEqual(result.frames, ())
        self.assertIn("snapshot.stale", [d.code for d in result.diagnostics])

    def test_bad_pulse_propagates_unknown_not_motion(self):
        bundle, scenario = actuator_example()
        data = scenario.model_dump(mode="json")
        data["channels"]["pulse"]["initial_value"] = 10
        data["stimuli"] = []
        result = simulate(compile_model(bundle), parse(Scenario, data))
        self.assertEqual(result.status, "completed")
        self.assertEqual(result.frames[-1].joint_positions["servo/joints/axis"], 0)
        self.assertEqual(result.frames[-1].effects["servo/effects/rotation"].quality, "unknown")

    def test_fixture_dimension_mismatch(self):
        bundle, scenario = actuator_example()
        data = scenario.model_dump(mode="json")
        data["channels"]["pulse"]["signal_type"]["unit"] = "V"
        result = simulate(compile_model(bundle), parse(Scenario, data))
        self.assertEqual(result.status, "failed")
        self.assertIn("behavior.input_type", [d.code for d in result.diagnostics])

    def test_step_budget_and_cancellation(self):
        bundle, scenario = actuator_example()
        options = scenario.solver_options.model_copy(update={"max_steps": 1})
        result = simulate(compile_model(bundle), scenario.model_copy(update={"solver_options": options}))
        self.assertEqual(result.status, "failed")
        self.assertLess(result.actual_end_s, scenario.duration_s)
        cancelled = simulate(compile_model(bundle), scenario, cancelled=lambda: True)
        self.assertEqual(cancelled.status, "cancelled")

    def test_step_refinement_keeps_rate_limited_endpoint(self):
        bundle, scenario = actuator_example()
        ir = compile_model(bundle)
        first = simulate(ir, scenario)
        refined = simulate(ir, scenario.model_copy(update={"solver_options": scenario.solver_options.model_copy(update={"step_s": 0.007})}))
        self.assertEqual(refined.status, "completed")
        self.assertAlmostEqual(first.frames[-1].joint_positions["servo/joints/axis"], refined.frames[-1].joint_positions["servo/joints/axis"])

    def test_analytic_two_joint_chain(self):
        joints = {}
        for name, parent, child, x in (("one", "a", "b", 0), ("two", "b", "c", 1)):
            joints[name] = {"kind": "revolute", "parent_body": ref("bodies", parent), "child_body": ref("bodies", child),
                            "parent_anchor": {"translation_m": [x, 0, 0]}, "axis": [0, 0, 1],
                            "initial_position": quantity(90, "deg"),
                            "position_limit": {"min": quantity(-180, "deg"), "max": quantity(180, "deg")}}
        ir, scenario = single({"physical": {"geometry": {"root_body": "a", "bodies": {"a": {}, "b": {}, "c": {}}}, "motion": {"joints": joints}}},
                              {"duration_s": 0, "roots": [{"body_ref": ref("bodies", "a")}]})
        result = simulate(ir, scenario)
        endpoint = result.frames[-1].body_poses["bodies/c"].compose(Pose(translation_m=(1.0, 0.0, 0.0)))
        self.assertAlmostEqual(endpoint.translation_m[0], -1)
        self.assertAlmostEqual(endpoint.translation_m[1], 1)

    def test_unsupported_shape_and_explicit_conservative_mode(self):
        ir, scenario = single({"physical": {"geometry": {"root_body": "a", "bodies": {"a": {}}, "envelopes": {
            "cylinder": {"body_ref": "a", "shape": {"kind": "cylinder", "radius_m": 1, "length_m": 2}}}}}},
            {"roots": [{"body_ref": ref("bodies", "a")}]})
        self.assertEqual(simulate(ir, scenario).status, "unsupported")
        enabled = scenario.model_copy(update={"solver_options": scenario.solver_options.model_copy(update={"conservative_shapes": True})})
        result = simulate(ir, enabled)
        self.assertEqual(result.status, "completed")
        self.assertIn("collision.approximation", [d.code for d in result.diagnostics])

    def test_sphere_contact_and_separation(self):
        a = Collider("a", "a", (0, 0, 0), BASIS, None, 1)
        b = Collider("b", "b", (2, 0, 0), BASIS, None, 1)
        self.assertTrue(intersects(a, b))
        self.assertFalse(intersects(a, Collider("b", "b", (2.01, 0, 0), BASIS, None, 1)))

    def test_sphere_box_and_obb_narrow_phase(self):
        box = Collider("box", "box", (0, 0, 0), BASIS, (1, 1, 1), None)
        self.assertTrue(intersects(box, Collider("s", "s", (1.5, 0, 0), BASIS, None, 0.5)))
        self.assertFalse(intersects(box, Collider("s", "s", (1.51, 0, 0), BASIS, None, 0.5)))
        q = Pose.axis_angle((0.0, 0.0, 1.0), math.pi / 4).rotation_xyzw
        axes = tuple(rotate(q, v) for v in BASIS)
        a = Collider("a", "a", (0, 0, 0), axes, (1, 0.05, 0.05), None)
        b = Collider("b", "b", (-0.15, 0.15, 0), axes, (1, 0.05, 0.05), None)
        self.assertFalse(intersects(a, b))

    def test_logic_resolution(self):
        self.assertEqual(resolve_logic([]), "Z")
        self.assertEqual(resolve_logic([("1", "open_drain")]), "Z")
        self.assertEqual(resolve_logic([("1", "open_drain")], ["up"]), "1")
        self.assertEqual(resolve_logic([("0", "open_drain")], ["up"]), "0")
        self.assertEqual(resolve_logic([("0", "push_pull"), ("1", "push_pull")]), "X")
        self.assertEqual(resolve_logic([("X", "push_pull")], ["down"]), "X")
        self.assertEqual(resolve_logic([], ["up", "down"]), "X")
        self.assertEqual(resolve_logic([("0", "open_drain"), ("X", "open_drain")], ["up"]), "0")

    def test_timer_event_splits_macro_step(self):
        ir, scenario = single({"behaviors": {"delay": {"model_id": "timer", "inputs": {"value": {"kind": "fixture", "channel": "enable"}},
                            "output_type": {"kind": "digital"}, "parameters": {"delay": quantity(0.035, "s")}}}},
            {"channels": {"enable": {"signal_type": {"kind": "digital"}, "initial_value": "1"}}, "solver_options": {"step_s": 0.1}})
        result = simulate(ir, scenario)
        frames = {round(f.time_s, 8): f for f in result.frames}
        self.assertEqual(result.status, "completed")
        self.assertEqual(frames[0].behavior_outputs["behaviors/delay"].value, "0")
        self.assertEqual(frames[0.035].behavior_outputs["behaviors/delay"].value, "1")

    def test_state_machine_event_is_committed_once(self):
        ir, scenario = single({"behaviors": {"toggle": {"kind": "state_machine", "model_id": "state_machine",
            "inputs": {"event": {"kind": "fixture", "channel": "button"}}, "output_type": {"kind": "digital"},
            "initial_state": "off", "states": {"off": "0", "on": "1"}, "transitions": [
                {"from_state": "off", "to_state": "on", "event": "press"}, {"from_state": "on", "to_state": "off", "event": "press"}]}}},
            {"channels": {"button": {"signal_type": {"kind": "event"}, "initial_value": "press"}}})
        result = simulate(ir, scenario)
        self.assertEqual(result.status, "completed")
        self.assertTrue(all(f.behavior_outputs["behaviors/toggle"].value == "1" for f in result.frames))

    def test_unknown_behavior_is_not_success(self):
        ir, scenario = single({"behaviors": {"unavailable": {"model_id": "spice_transient", "output_type": {"kind": "digital"}}}})
        self.assertEqual(simulate(ir, scenario).status, "unsupported")

    def test_inventory_mass_conservation(self):
        source, target = transfer_mass(2, 0.9, 1, 10, 1)
        self.assertAlmostEqual(source, 1.9)
        self.assertAlmostEqual(target, 1)
        self.assertAlmostEqual(source + target, 2.9)
        with self.assertRaises(ValueError):
            transfer_mass(-1, 0, 1, 1, 1)

    def test_transmission_ratio_and_follower_speed_limit(self):
        joints = {name: {"kind": "continuous", "parent_body": ref("bodies", "base"), "child_body": ref("bodies", name),
                        "axis": [0, 0, 1], "initial_position": quantity(0, "rad"),
                        "drive_mode": "velocity" if name == "driver" else "passive",
                        "velocity_limit": quantity(2 if name == "driver" else 4, "rad/s")}
                  for name in ("driver", "follower")}
        data = {"physical": {"geometry": {"root_body": "base", "bodies": {"base": {}, "driver": {}, "follower": {}}},
                 "motion": {"joints": joints, "transmissions": {"gear": {"kind": "rotary_ratio", "driver_joint": ref("joints", "driver"),
                    "follower_joint": ref("joints", "follower"), "ratio": -2, "offset": quantity(0, "rad")}}}}}
        scenario = {"roots": [{"body_ref": ref("bodies", "base")}], "joint_commands": [
            {"time_s": 0, "target": ref("joints", "driver"), "mode": "velocity", "value": quantity(1, "rad/s")}]}
        ir, run = single(data, scenario)
        result = simulate(ir, run)
        self.assertEqual(result.status, "completed")
        self.assertAlmostEqual(result.frames[-1].joint_positions["joints/follower"], -0.4)
        data["physical"]["motion"]["joints"]["follower"]["velocity_limit"] = quantity(0.5, "rad/s")
        ir, run = single(data, scenario)
        self.assertEqual(simulate(ir, run).status, "failed")

    def test_two_instances_have_separate_inputs_and_state(self):
        from element.schema.model import ComponentDefinition
        from engine.schema.assembly import AssemblyDefinition, ModelBundle
        from engine.examples.build_examples import definition_ref
        component = parse(ComponentDefinition, {"id": "counter", "name": "Timer", "behaviors": {"timer": {
            "model_id": "timer", "output_type": {"kind": "digital"}, "inputs": {"value": {"kind": "fixture", "channel": "enable"}},
            "parameters": {"delay": quantity(0.02, "s")}}}})
        assembly = parse(AssemblyDefinition, {"id": "pair", "name": "Two timers", "instances": {
            name: {"definition_ref": definition_ref(component)} for name in ("left", "right")}})
        bundle = parse(ModelBundle, {"components": [component.model_dump(mode="json")], "assemblies": [assembly.model_dump(mode="json")], "root": definition_ref(assembly)})
        ir = compile_model(bundle)
        scenario = parse(Scenario, {"id": "independent", "snapshot_id": ir.snapshot_id, "duration_s": 0.1, "channels": {
            "left/enable": {"signal_type": {"kind": "digital"}, "initial_value": "1"},
            "right/enable": {"signal_type": {"kind": "digital"}, "initial_value": "0"}}})
        result = simulate(ir, scenario)
        self.assertEqual(result.status, "completed")
        self.assertEqual(result.frames[-1].behavior_outputs["left/behaviors/timer"].value, "1")
        self.assertEqual(result.frames[-1].behavior_outputs["right/behaviors/timer"].value, "0")

    def test_absent_ground_disables_physical_output(self):
        from engine.schema.assembly import ModelBundle, AssemblyDefinition
        from engine.examples.build_examples import definition_ref
        bundle, scenario = actuator_example()
        data = bundle.model_dump(mode="json")
        del data["assemblies"][0]["connections"]["electrical_nets"]["ground"]
        data["assemblies"][0]["connections"]["electrical_nets"]["power"]["reference_net"] = None
        data["root"] = definition_ref(parse(AssemblyDefinition, data["assemblies"][0]))
        ir = compile_model(parse(ModelBundle, data))
        result = simulate(ir, scenario.model_copy(update={"snapshot_id": ir.snapshot_id}))
        self.assertEqual(result.status, "completed")
        self.assertEqual(result.frames[-1].joint_positions["servo/joints/axis"], 0)
        self.assertEqual(result.frames[-1].effects["servo/effects/rotation"].quality, "unknown")
        self.assertIn("supply.unavailable", [d.code for d in result.diagnostics])

    def test_electrical_network_propagates_to_behavior(self):
        from element.schema.model import ComponentDefinition
        from engine.schema.assembly import AssemblyDefinition, ModelBundle
        from engine.examples.build_examples import definition_ref
        source = parse(ComponentDefinition, {"id": "source", "name": "Driver", "electronic": {"electrical": {"terminals": {
            "out": {"physical_pin_number": "1", "electrical_role": "output", "drive": "push_pull"}}}}, "behaviors": {"drive": {
            "model_id": "pass", "inputs": {"value": {"kind": "fixture", "channel": "input"}},
            "output_type": {"kind": "digital"}, "output_terminals": ["out"]}}})
        sink = parse(ComponentDefinition, {"id": "sink", "name": "Receiver", "electronic": {"electrical": {"terminals": {
            "in": {"physical_pin_number": "1", "electrical_role": "input"}}}}, "behaviors": {"invert": {
            "model_id": "not", "inputs": {"value": {"kind": "terminal", "ref": ref("terminals", "in")}}, "output_type": {"kind": "digital"}}}})
        assembly = parse(AssemblyDefinition, {"id": "circuit", "name": "Circuit", "instances": {name: {"definition_ref": definition_ref(c)} for name, c in (("source", source), ("sink", sink))},
                    "connections": {"electrical_nets": {"signal": {"members": [ref("terminals", "out", "source"), ref("terminals", "in", "sink")]}}}})
        bundle = parse(ModelBundle, {"components": [c.model_dump(mode="json") for c in (source, sink)], "assemblies": [assembly.model_dump(mode="json")], "root": definition_ref(assembly)})
        ir = compile_model(bundle)
        scenario = parse(Scenario, {"id": "logic", "snapshot_id": ir.snapshot_id, "duration_s": 0.1,
            "channels": {"input": {"signal_type": {"kind": "digital"}, "initial_value": "0"}},
            "stimuli": [{"time_s": 0.05, "channel": "input", "value": "1"}]})
        result = simulate(ir, scenario)
        self.assertEqual(result.status, "completed")
        self.assertEqual(result.frames[0].behavior_outputs["sink/behaviors/invert"].value, "1")
        self.assertEqual(result.frames[-1].behavior_outputs["sink/behaviors/invert"].value, "0")
        self.assertEqual(result.frames[-1].network_samples["nets/signal"].value, "1")

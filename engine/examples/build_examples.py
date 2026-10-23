"""Regenerate the three offline example bundles and scenarios."""

from pathlib import Path
from element.base.identity import DefinitionRef
from element.base.reference import ObjectRef
from engine.io.load import loads
from element.io.save import content_hash, save
from element.schema.model import ComponentDefinition
from engine.schema.assembly import AssemblyDefinition, ModelBundle
from engine.schema.scenario import Scenario
from engine.compiler.lower import compile_model
import json


def parse(cls, data):
    return loads(json.dumps(data), cls)


def ref(collection, name, *instances):
    return {"instance_path": list(instances), "collection": collection, "object_id": name}


def definition_ref(definition):
    return {"id": definition.id, "revision": definition.revision, "content_hash": content_hash(definition)}


def pose(x=0.0, y=0.0, z=0.0):
    return {"translation_m": [x, y, z], "rotation_xyzw": [0, 0, 0, 1]}


def quantity(value, unit):
    return {"value": value, "unit": unit}


ASSUMPTION = {"kind": "assumed", "conditions": "Offline synthetic demonstration only",
              "note": "Not manufacturer data or evidence of physical validation."}


def power_component():
    return parse(ComponentDefinition, {
        "id": "example.ideal_supply", "name": "Assumed ideal 5 V supply",
        "electronic": {"electrical": {"terminals": {
            "positive": {"physical_pin_number": "+", "electrical_role": "power_out",
                         "nominal_voltage": quantity(5, "V"), "reference_terminal": "ground"},
            "ground": {"physical_pin_number": "-", "electrical_role": "ground"}}}},
        "evidence": {"assumption": ASSUMPTION}})


def load_terminals():
    return {"vcc": {"physical_pin_number": "1", "electrical_role": "power_in",
                    "voltage_limits": {"min": quantity(4, "V"), "max": quantity(6, "V")},
                    "reference_terminal": "ground"},
            "ground": {"physical_pin_number": "2", "electrical_role": "ground"}}


def assembly(components, target, mechanical=None):
    return parse(AssemblyDefinition, {
        "id": "example." + target + "_assembly", "name": "Synthetic " + target + " assembly",
        "instances": {name: {"definition_ref": definition_ref(c)} for name, c in components.items()},
        "connections": {
            "mechanical": mechanical or {},
            "electrical_nets": {
                "power": {"kind": "power", "reference_net": "ground",
                          "members": [ref("terminals", "positive", "supply"), ref("terminals", "vcc", target)]},
                "ground": {"kind": "ground", "members": [ref("terminals", "ground", "supply"), ref("terminals", "ground", target)]}}},
        "evidence": {"assumption": ASSUMPTION}})


def bundle_for(components, a):
    return parse(ModelBundle, {"components": [c.model_dump(mode="json") for c in components.values()],
                              "assemblies": [a.model_dump(mode="json")], "root": definition_ref(a),
                              "input_revisions": {"synthetic-fixture": 1}})


def actuator_example():
    c = parse(ComponentDefinition, {
        "id": "example.position_actuator", "name": "Synthetic position actuator",
        "physical": {
            "geometry": {"root_body": "case", "bodies": {"case": {}, "shaft": {}},
                         "envelopes": {"case": {"body_ref": "case", "shape": {"kind": "box", "size_m": [0.04, 0.02, 0.03]}, "evidence_refs": ["assumption"]}}},
            "motion": {"joints": {"axis": {
                "kind": "revolute", "parent_body": ref("bodies", "case"), "child_body": ref("bodies", "shaft"),
                "parent_anchor": pose(z=0.04), "axis": [0, 0, 1], "drive_mode": "position",
                "position_limit": {"min": quantity(-1, "rad"), "max": quantity(1, "rad")},
                "velocity_limit": quantity(2, "rad/s"), "initial_position": quantity(0, "rad")}}},
            "mechanical": {"ports": {"output": {"body_ref": "shaft", "kind": "plane", "allowed_mates": ["plane"]}}}},
        "electronic": {"electrical": {"terminals": load_terminals()},
                       "effects": {"rotation": {"kind": "motion", "target_joint": ref("joints", "axis"), "mode": "position",
                           "value_type": {"kind": "scalar", "unit": "rad"}, "behavior_output_ref": {"behavior_id": "controller"}}}},
        "behaviors": {"controller": {
            "model_id": "pulse_position_command", "output_type": {"kind": "scalar", "unit": "rad"},
            "inputs": {"pulse": {"kind": "fixture", "channel": "pulse"}}, "supply_terminals": ["vcc"],
            "parameters": {"pulse_min": quantity(1, "ms"), "pulse_max": quantity(2, "ms"),
                           "angle_min": quantity(-1, "rad"), "angle_max": quantity(1, "rad")},
            "assumptions": ["Abstract pulse-width fixture; no wire-level PWM timing, torque, backlash, or internal control loop."]}},
        "functions": {"position": {"capability": "motion.bounded_position"}},
        "principles": {"servo": {"mechanism": "Ideal rate-limited positioning", "behavior_refs": ["controller"]}},
        "realizations": {"positioning": {"function_ref": "position", "principle_refs": ["servo"], "object_refs": [ref("joints", "axis")]}},
        "evidence": {"assumption": ASSUMPTION}})
    arm = parse(ComponentDefinition, {
        "id": "example.link", "name": "Synthetic rigid link",
        "physical": {"geometry": {"root_body": "link", "bodies": {"link": {}},
                                  "envelopes": {"link": {"body_ref": "link", "pose": pose(x=0.08), "shape": {"kind": "box", "size_m": [0.16, 0.01, 0.01]}}}},
                     "mechanical": {"ports": {"mount": {"body_ref": "link", "kind": "plane", "allowed_mates": ["plane"]}}}},
        "evidence": {"assumption": ASSUMPTION}})
    components = {"servo": c, "arm": arm, "supply": power_component()}
    a = assembly(components, "servo", {"arm_mount": {"a": ref("mechanical_ports", "output", "servo"),
        "b": ref("mechanical_ports", "mount", "arm"), "method": "fastener", "constraint_mode": "fixed",
        "assumptions": ["Ideal fixed attachment without fit or torque validation."]}})
    bundle = bundle_for(components, a)
    scenario = parse(Scenario, {"id": "actuator_step", "snapshot_id": compile_model(bundle).snapshot_id, "duration_s": 1,
        "roots": [{"body_ref": ref("bodies", "case", "servo")}],
        "channels": {"pulse": {"signal_type": {"kind": "scalar", "unit": "ms"}, "initial_value": 1.5}},
        "stimuli": [{"time_s": 0.1, "channel": "pulse", "value": 2}], "solver_options": {"step_s": 0.05}})
    return bundle, scenario


def fan_example():
    c = parse(ComponentDefinition, {
        "id": "example.fan", "name": "Synthetic continuous fan",
        "physical": {"geometry": {"root_body": "case", "bodies": {"case": {}, "rotor": {}},
                      "envelopes": {"rotor": {"body_ref": "rotor", "shape": {"kind": "box", "size_m": [0.08, 0.01, 0.005]}}}},
            "motion": {"joints": {"axis": {"kind": "continuous", "parent_body": ref("bodies", "case"),
                "child_body": ref("bodies", "rotor"), "axis": [0, 0, 1], "drive_mode": "velocity",
                "velocity_limit": quantity(20, "rad/s"), "initial_position": quantity(0, "rad")}}},
            "material": {"ports": {
                "inlet": {"body_ref": "case", "medium_kind": "gas", "medium_ref": "air", "direction": "in", "aperture": {"kind": "circle", "diameter_m": 0.08}},
                "outlet": {"body_ref": "case", "medium_kind": "gas", "medium_ref": "air", "direction": "out", "aperture": {"kind": "circle", "diameter_m": 0.08}}},
                "paths": {"air": {"inlet_port": "inlet", "outlet_port": "outlet", "mechanism": "fan"}}}},
        "electronic": {"electrical": {"terminals": load_terminals()}, "effects": {"rotation": {
            "kind": "motion", "target_joint": ref("joints", "axis"), "mode": "velocity",
            "value_type": {"kind": "scalar", "unit": "rad/s"}, "behavior_output_ref": {"behavior_id": "speed"}}}},
        "behaviors": {"speed": {"model_id": "pass", "inputs": {"value": {"kind": "fixture", "channel": "speed"}},
            "output_type": {"kind": "scalar", "unit": "rad/s"}, "supply_terminals": ["vcc"]}},
        "evidence": {"assumption": ASSUMPTION}})
    components = {"fan": c, "supply": power_component()}
    bundle = bundle_for(components, assembly(components, "fan"))
    scenario = parse(Scenario, {"id": "fan_spin", "snapshot_id": compile_model(bundle).snapshot_id, "duration_s": 0.5,
        "roots": [{"body_ref": ref("bodies", "case", "fan")}],
        "channels": {"speed": {"signal_type": {"kind": "scalar", "unit": "rad/s"}, "initial_value": 10}},
        "solver_options": {"step_s": 0.05}})
    return bundle, scenario


def lamp_example():
    c = parse(ComponentDefinition, {
        "id": "example.lamp", "name": "Synthetic temperature-triggered indicator",
        "electronic": {"sensors": {"temperature": {"quantity": "temperature", "signal_type": {"kind": "scalar", "unit": "K"},
            "source": {"kind": "environment", "channel": "temperature"}, "sample_period_s": 0.05, "latency_s": 0.02}},
            "effects": {"indicator": {"kind": "light", "value_type": {"kind": "digital"}, "behavior_output_ref": {"behavior_id": "threshold"}}}},
        "behaviors": {"threshold": {"model_id": "threshold", "inputs": {"value": {"kind": "sensor", "ref": ref("sensors", "temperature")}},
            "output_type": {"kind": "digital"}, "parameters": {"threshold": quantity(30, "degC")},
            "assumptions": ["Logical indicator only; no light distribution, thermal solver, or physical sensor model."]}},
        "evidence": {"assumption": ASSUMPTION}})
    bundle = parse(ModelBundle, {"components": [c.model_dump(mode="json")], "root": definition_ref(c)})
    scenario = parse(Scenario, {"id": "lamp_temperature", "snapshot_id": compile_model(bundle).snapshot_id, "duration_s": 0.3,
        "channels": {"temperature": {"signal_type": {"kind": "scalar", "unit": "degC"}, "initial_value": 20}},
        "stimuli": [{"time_s": 0.1, "channel": "temperature", "value": 40}], "solver_options": {"step_s": 0.05}})
    return bundle, scenario


if __name__ == "__main__":
    root = Path(__file__).parent
    for name, build in (("actuator", actuator_example), ("fan", fan_example), ("lamp", lamp_example)):
        bundle, scenario = build()
        save(bundle, root / f"{name}.bundle.json", overwrite=True)
        save(scenario, root / f"{name}.scenario.json", overwrite=True)
        print(f"Wrote synthetic {name} bundle and scenario")

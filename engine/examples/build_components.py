"""Trusted Python authoring examples. Run explicitly; the model loader never runs scripts."""
from engine.adapters.commands import move_to, set_speed
import json
from pathlib import Path
from element.base.evidence import Evidence
from element.base.quantity import Quantity, Range
from element.base.reference import ObjectRef
from element.base.signal import SignalType
from element.categories import Structure, Actuator, TransmissionComponent, Light, Display, Sound, HumanInput, Sensor, Controller, Driver, PowerSource, Transport, EnergyStorage, ControlFunction
from element.interfaces.geometry import Box, GeometrySpec, RigidBody, Envelope
from element.interfaces.motion import Joint, MotionSpec, Transmission
from element.interfaces.material import MaterialSpec, MaterialPort, MaterialPath, CircularAperture
from element.interfaces.behavior import InputBinding, BehaviorSpec
from element.interfaces.sensing import SensorInput, SensorSource
from engine.schema.scenario import Scenario, RootPlacement, FixtureChannel
from engine.compiler.lower import compile_model
from element.interfaces.behavior_validation import input_signal_type
from element.io.save import save


ASSUMED = {"demo": Evidence(kind="assumed", conditions="Synthetic offline component example",
    note="Illustrative dimensions and ratings; not manufacturer specifications or physical validation.")}


def body(name):
    return ObjectRef(collection="bodies", object_id=name)


def motor_geometry():
    return GeometrySpec(root_body="case", bodies={"case": RigidBody(), "shaft": RigidBody()},
        envelopes={"case": Envelope(body_ref="case", shape=Box(size_m=(0.04, 0.02, 0.03)))})


def fixture(channel):
    return InputBinding(kind="fixture", channel=channel)


def constant(value):
    return InputBinding(kind="constant", value=value)


def examples():
    def meta(id, name):
        return {"id": f"example.{id}", "name": name, "evidence": ASSUMED}

    housing = Structure.from_shape(**meta("housing", "Assumed housing envelope"), structural_role="housing",
                                  shape=Box(size_m=(0.08, 0.05, 0.03)))
    servo = Actuator.position_servo(**meta("servo", "Position servo"), geometry=motor_geometry(),
        travel=Range(min=Quantity(value=-90.0, unit="deg"), max=Quantity(value=90.0, unit="deg")),
        max_speed=Quantity(value=3.0, unit="rad/s"), initial_position=Quantity(value=0.0, unit="deg"))
    motor = Actuator.continuous_motor(**meta("motor", "DC motor, ideal speed command"), geometry=motor_geometry(),
                                     max_speed=Quantity(value=120.0, unit="rpm"))
    continuous = Actuator.continuous_motor(**meta("continuous_servo", "Continuous servo with assumed speed calibration"),
        technology="servo", geometry=motor_geometry(), max_speed=Quantity(value=60.0, unit="rpm"))
    slider = Actuator(**meta("slider", "Position-controlled linear actuator"), technology="linear",
        geometry=motor_geometry(), joint=Joint(kind="prismatic", parent_body=body("case"), child_body=body("shaft"),
            axis=(1.0, 0.0, 0.0), drive_mode="position", initial_position=Quantity(value=0.0, unit="mm"),
            position_limit=Range(min=Quantity(value=0.0, unit="mm"), max=Quantity(value=100.0, unit="mm")),
            velocity_limit=Quantity(value=0.05, unit="m/s")))
    gear_joints = {name: Joint(kind="continuous", parent_body=body("case"), child_body=body(name),
        axis=(0.0, 0.0, 1.0), initial_position=Quantity(value=0.0, unit="rad")) for name in ("input", "output")}
    gears = TransmissionComponent(**meta("gears", "Passive 2:1 rotary transmission"), mechanism="gear",
        geometry=GeometrySpec(root_body="case", bodies={n: RigidBody() for n in ("case", "input", "output")}),
        motion=MotionSpec(joints=gear_joints, transmissions={"reduction": Transmission(kind="rotary_ratio",
            driver_joint=ObjectRef(collection="joints", object_id="input"), follower_joint=ObjectRef(collection="joints", object_id="output"),
            ratio=-0.5, offset=Quantity(value=0.0, unit="rad"))}))
    led = Light(**meta("rgb_led", "RGB indicator, normalized commands"),
                channels={"red": constant(0.8), "green": constant(0.2), "blue": constant(0.0)})
    display = Display(**meta("oled", "128x64 OLED text command"), width_px=128, height_px=64,
                      text=constant("Ready"))
    buzzer = Sound(**meta("buzzer", "Passive buzzer tone command"), transducer="buzzer", frequency=constant(440.0))
    keypad = HumanInput(**meta("keypad", "Two-key input, pre-debounced fixtures"), input_kind="keypad",
        controls={key: SensorInput(quantity="pressed", signal_type=SignalType(kind="digital"),
            source=SensorSource(kind="environment", channel=key), sample_period_s=0.01) for key in ("left", "right")})
    temperature = Sensor(**meta("temperature", "Temperature input"), measurements={"temperature": SensorInput(
        quantity="temperature", signal_type=SignalType(kind="scalar", unit="degC"),
        source=SensorSource(kind="environment", channel="temperature"), sample_period_s=0.05, latency_s=0.02)})
    controller = Controller(**meta("controller", "Controller with a named threshold function"), platform="generic_mcu").define_function(
        "too_hot", ControlFunction(description="temperature.threshold", inputs={"value": SignalType(kind="scalar", unit="degC")},
            behavior=BehaviorSpec(model_id="threshold", inputs={"value": fixture("temperature")},
                parameters={"threshold": Quantity(value=30.0, unit="degC")}, output_type=SignalType(kind="digital"))))
    driver = Driver(**meta("motor_driver", "Motor enable driver, logical model only"), driver_kind="motor",
        channels={"enable": BehaviorSpec(model_id="pass", inputs={"value": fixture("enable")}, output_type=SignalType(kind="digital"))})
    supply = PowerSource(**meta("usb_supply", "Ideal USB 5 V source"), source_kind="usb", voltage=Quantity(value=5.0, unit="V"))
    pump = Transport(**meta("pump", "Pump liquid topology"), mechanism="pump", geometry=housing.geometry,
        material=MaterialSpec(ports={name: MaterialPort(body_ref="body", medium_kind="liquid", medium_ref="water",
            direction=direction, aperture=CircularAperture(diameter_m=0.006)) for name, direction in (("inlet", "in"), ("outlet", "out"))},
            paths={"water": MaterialPath(inlet_port="inlet", outlet_port="outlet", mechanism="pump")}))
    spring = EnergyStorage(**meta("spring", "Torsion spring capacity contract"), mechanism="torsion_spring",
                           capacity_j=0.2, initial_energy_j=0.1)
    return {c.id.removeprefix("example."): c for c in (housing, servo, motor, continuous, slider, gears,
        led, display, buzzer, keypad, temperature, controller, driver, supply, pump, spring)}


def scenario_for(component):
    """Synthetic fixture values, not inferred hardware behavior or calibration."""
    ir = compile_model(component)
    channels = {}
    for obj in ir.collection("sensors").values():
        if obj.spec.source.kind == "environment":
            channels[obj.spec.source.channel] = obj.spec.signal_type
    for obj in ir.collection("behaviors").values():
        for binding in obj.spec.inputs.values():
            if binding.kind == "fixture":
                channels[binding.channel] = input_signal_type(obj.spec)
    commands = ()
    if isinstance(component, Actuator):
        commands = (set_speed(component, Quantity(value=2.0, unit='rad/s')),) if component.joint.drive_mode == "velocity" else (
            move_to(component, Quantity(value=0.02, unit='m') if component.joint.dimension == 'length' else Quantity(value=30.0, unit='deg')),)
    return Scenario(id=component.id + ".demo", snapshot_id=ir.snapshot_id, duration_s=0.5,
        roots=tuple(RootPlacement(body_ref=body(key.split("/")[-1])) for key in ir.roots),
        channels={key: FixtureChannel(signal_type=t, initial_value="1" if t.kind == "digital" else 40.0)
                  for key, t in channels.items()}, joint_commands=commands)


def compact_record(component):
    """Omit defaults but retain nested union discriminators (shape/aperture kind)."""
    def restore_tags(full, compact):
        if isinstance(compact, dict):
            for key in ("kind", "category", "record_kind", "design_version"):
                if key in full:
                    compact[key] = full[key]
            for key, value in compact.items():
                restore_tags(full[key], value)
        elif isinstance(compact, list):
            for a, b in zip(full, compact):
                restore_tags(a, b)
    record = component.model_dump(mode="json", exclude_defaults=True)
    restore_tags(component.model_dump(mode="json"), record)
    return record


if __name__ == "__main__":
    folder = Path(__file__).parent / "components"
    folder.mkdir(exist_ok=True)
    for name, component in examples().items():
        # Compact authoring records expose only relevant fields. Full defaults remain hash-covered.
        record = compact_record(component)
        (folder / f"{name}.json").write_text(json.dumps(record, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        save(scenario_for(component), folder / f"{name}.scenario.json", overwrite=True)
    print(f"Wrote {len(examples())} component designs and scenarios")

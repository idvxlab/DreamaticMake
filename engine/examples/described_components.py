"""Synthetic descriptions and circuit parts; run explicitly, without physical claims."""
import json
from element.base.frame import LocalFrame, Pose
from element.base.quantity import Quantity
from element.base.signal import SignalType
from element.categories import Sensor, CircuitElement, Structure
from element.categories.specs import MechanicalDescription, ActuatorDescription, LightDescription, DisplayDescription, SoundDescription, InertialDescription, CameraDescription, MicrophoneDescription, PowerDescription
from element.categories.circuit import ResistorSpec, CapacitorSpec, InductorSpec, DiodeSpec, TransistorSpec, OptocouplerSpec
from engine.examples.build_components import examples as original_examples, ASSUMED
from element.interfaces.electrical import ElectricalSpec, Terminal
from element.interfaces.sensing import SensorInput, SensorSource
from element.interfaces.geometry import Box
from engine.compiler.lower import compile_model


def q(value, unit):
    return Quantity(value=value, unit=unit)


def examples():
    old = original_examples()
    geometry = old["housing"].geometry
    frame = LocalFrame(body_ref="body")
    output = {
        "screw": Structure.from_shape(id="described.screw", name="Assumed M3 fastener envelope", evidence=ASSUMED,
            shape=Box(size_m=(0.006, 0.006, 0.014)), spec=MechanicalDescription(
                kind="fastener", standard="M3", dimensions={"length": q(12.0, "mm")}, material="steel")),
        "gear": old["gears"].replace(id="described.gear", spec=MechanicalDescription(
            kind="gear", dimensions={"shaft_diameter": q(3.0, "mm")})),
        "stepper": old["motor"].replace(id="described.stepper", technology="stepper",
            spec=ActuatorDescription(steps_per_revolution=200, rated_effort=q(0.1, "N*m"))),
        "strip": old["rgb_led"].replace(id="described.strip", geometry=geometry,
            wiring=ElectricalSpec(terminals={"din": Terminal(body_ref="body", pose=Pose(),
                physical_pin_number="1", electrical_role="input")}),
            spec=LightDescription(kind="addressable", count=8, protocol="WS2812", data_terminal="din", color_order="GRB")),
        "screen": old["oled"].replace(id="described.screen", geometry=geometry,
            spec=DisplayDescription(kind="oled", active_size_m=(0.02, 0.01), bus="i2c", cable_exit=frame)),
        "speaker": old["buzzer"].replace(id="described.speaker", transducer="speaker", geometry=geometry,
            spec=SoundDescription(impedance=q(8.0, "ohm"), rated_power=q(1.0, "W"), sound_port=frame)),
    }
    readings = {axis: SensorInput(quantity="acceleration" if axis[0] == "a" else "angular_speed",
        signal_type=SignalType(kind="scalar", unit="m/s2" if axis[0] == "a" else "rad/s"),
        source=SensorSource(kind="environment", channel=axis), sample_period_s=0.01)
        for axis in ("ax", "ay", "az", "gx", "gy", "gz")}
    output["imu"] = Sensor(id="described.imu", name="Assumed six-axis IMU", evidence=ASSUMED,
        geometry=geometry, measurements=readings,
        spec=InertialDescription(axes={name: name for name in readings}, frame=frame, bus="i2c"))
    output["camera"] = Sensor(id="described.camera", name="Camera description only", evidence=ASSUMED,
        geometry=geometry, spec=CameraDescription(resolution_px=(640, 480), frame_rate_hz=30.0,
            encoding="jpeg", optical_frame=frame, bus="csi"))
    output["microphone"] = Sensor(id="described.microphone", name="Audio stream description only", evidence=ASSUMED,
        geometry=geometry, spec=MicrophoneDescription(sample_rate_hz=16000.0, sound_port=frame, bus="i2s"))
    output["battery"] = old["usb_supply"].replace(id="described.battery", source_kind="battery",
        voltage=q(3.7, "V"), geometry=geometry,
        spec=PowerDescription(capacity=q(1000.0, "mAh"), current_limit=q(0.5, "A"), chemistry="Li-ion"),
        wiring=ElectricalSpec(terminals={
            "positive": Terminal(body_ref="body", pose=Pose(translation_m=(0.01, 0.0, 0.0)),
                physical_pin_number="1", electrical_role="power_out"),
            "ground": Terminal(body_ref="body", pose=Pose(translation_m=(-0.01, 0.0, 0.0)),
                physical_pin_number="2", electrical_role="ground")}))
    parts = [
        (ResistorSpec(resistance=q(220.0, "ohm"), tolerance=0.05, package="axial"), ("a", "b")),
        (CapacitorSpec(capacitance=q(100.0, "uF"), polarized=True, voltage_rating=q(16.0, "V")), ("positive", "negative")),
        (InductorSpec(inductance=q(10.0, "uH")), ("a", "b")),
        (DiodeSpec(reverse_voltage=q(50.0, "V")), ("anode", "cathode")),
        (TransistorSpec(technology="nmos"), ("gate", "drain", "source")),
        (OptocouplerSpec(package="DIP-6"), ("anode", "cathode", "nc", "emitter", "collector", "base")),
    ]
    for spec, pins in parts:
        output[spec.kind] = CircuitElement(id=f"described.{spec.kind}", name=f"Assumed {spec.kind}",
            evidence=ASSUMED, geometry=geometry, spec=spec,
            wiring=ElectricalSpec(terminals={name: Terminal(body_ref="body",
                pose=Pose(translation_m=(index * 0.00254, 0.0, 0.0)),
                physical_pin_number=str(index + 1), electrical_role="passive") for index, name in enumerate(pins)}))
    return output


if __name__ == "__main__":
    import argparse
    from pathlib import Path
    from engine.examples.build_components import compact_record
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true", help="Regenerate explicit synthetic library templates")
    args = parser.parse_args()
    # Model compilation verifies description contracts, not physical performance.
    for name, design in examples().items():
        ir = compile_model(design)
        if args.write:
            path = Path(__file__).parent / "components" / f"described_{name}.json"
            path.write_text(json.dumps(compact_record(design), indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(json.dumps({"name": name, "category": design.category, "snapshot_id": ir.snapshot_id,
            "diagnostics": [d.model_dump(mode="json") for d in ir.diagnostics]}))

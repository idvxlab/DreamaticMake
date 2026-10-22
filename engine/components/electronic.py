from typing import Literal
from pydantic import Field, model_validator
from engine.base.contract import Contract, Id
from engine.base.quantity import Quantity
from engine.base.reference import AssetRef, ObjectRef
from engine.base.signal import SignalType
from engine.base.evidence import SourceRecord
from engine.interface.behavior import BehaviorSpec, InputBinding
from engine.interface.electrical import ElectricalSpec
from engine.interface.electronic import ElectricalInterface
from engine.interface.sensing import SensorInput
from engine.interface.effects import ObservableEffect, BehaviorOutputRef
from engine.interface.function import FunctionSpec
from engine.components.base import ComponentDesign
from engine.components.specs import (LightDescription, DisplayDescription, SoundDescription,
    SensorDescription, InertialDescription, CameraDescription, MicrophoneDescription)
from engine.base.quantity import UNITS


class ElectricalDesign(ComponentDesign):
    wiring: ElectricalSpec = Field(default_factory=ElectricalSpec)


def _observable(design, kind, channels, signal_type):
    behaviors = {key: BehaviorSpec(model_id="pass", inputs={"value": binding}, output_type=signal_type,
        supply_terminals=design.supply_terminals) for key, binding in channels.items()}
    effects = {key: ObservableEffect(kind=kind, value_type=signal_type,
        behavior_output_ref=BehaviorOutputRef(behavior_id=key)) for key in channels}
    return design._definition(electrical=design.wiring, behaviors=behaviors, effects=effects)


class Light(ElectricalDesign):
    category: Literal["light"] = "light"
    channels: dict[Id, InputBinding] = Field(min_length=1)
    supply_terminals: tuple[Id, ...] = ()
    spec: LightDescription | None = None

    @model_validator(mode="after")
    def normalized_constants(self):
        if self.spec and self.spec.data_terminal and self.spec.data_terminal not in self.wiring.terminals:
            raise ValueError("Light data_terminal must reference an existing wiring terminal")
        for binding in self.channels.values():
            if binding.kind == "constant" and (isinstance(binding.value, (bool, str)) or
                    not isinstance(binding.value, (float, int)) or not 0 <= binding.value <= 1):
                raise ValueError("Constant light levels must be normalized scalars in [0, 1]")
        return self

    def set_brightness(self, value: float, *, channel="brightness"):
        if channel not in self.channels:
            raise ValueError(f"Unknown light channel: {channel}")
        return self.replace(channels={**self.channels, channel: InputBinding(kind="constant", value=value)})

    def _lower(self):
        return _observable(self, "light", self.channels, SignalType(kind="scalar", unit="1"))


class Display(ElectricalDesign):
    category: Literal["display"] = "display"
    width_px: int = Field(gt=0)
    height_px: int = Field(gt=0)
    text: InputBinding
    supply_terminals: tuple[Id, ...] = ()
    spec: DisplayDescription | None = None

    @model_validator(mode="after")
    def text_constant(self):
        if self.text.kind == "constant" and not isinstance(self.text.value, str):
            raise ValueError("Display text requires a string token")
        return self

    def show_text(self, text: str):
        return self.replace(text=InputBinding(kind="constant", value=text))

    def _lower(self):
        # Current simulator supports string tokens, not pixel buffers or rendering.
        return _observable(self, "display", {"text": self.text}, SignalType(kind="event", protocol="display.text"))


class Sound(ElectricalDesign):
    category: Literal["sound"] = "sound"
    transducer: Literal["buzzer", "speaker"]
    frequency: InputBinding
    supply_terminals: tuple[Id, ...] = ()
    spec: SoundDescription | None = None

    @model_validator(mode="after")
    def nonnegative_tone(self):
        value = self.frequency.value
        if self.frequency.kind == "constant" and (isinstance(value, (bool, str)) or
                not isinstance(value, (float, int)) or value < 0):
            raise ValueError("Constant tone frequency must be nonnegative Hz")
        return self

    def play_tone(self, frequency: Quantity):
        return self.replace(frequency=InputBinding(kind="constant", value=frequency.require("frequency")))

    def silence(self):
        return self.play_tone(Quantity(value=0.0, unit="Hz"))

    def _lower(self):
        return _observable(self, "sound", {"tone": self.frequency}, SignalType(kind="scalar", unit="Hz"))


class Sensor(ElectricalDesign):
    category: Literal["sensor"] = "sensor"
    measurements: dict[Id, SensorInput] = Field(default_factory=dict)
    calibration_notes: tuple[str, ...] = ()
    spec: SensorDescription | None = None

    @model_validator(mode="after")
    def measurement_contract(self):
        if not self.measurements and not isinstance(self.spec, (CameraDescription, MicrophoneDescription)):
            raise ValueError("Sensors require measurements or an explicit camera/microphone stream description")
        if isinstance(self.spec, InertialDescription):
            if len(set(self.spec.axes.values())) != len(self.spec.axes):
                raise ValueError("IMU axes must reference distinct measurements")
            for axis, name in self.spec.axes.items():
                reading = self.measurements.get(name)
                dimension = {"a": "acceleration", "g": "angular_speed", "m": "magnetic_flux_density"}[axis[0]]
                if reading is None or reading.signal_type.kind != "scalar" or UNITS[reading.signal_type.unit][0] != dimension:
                    raise ValueError(f"IMU axis {axis} requires a {dimension} measurement")
        return self

    def read(self, name: str, *, instance_path=()):
        if name not in self.measurements:
            raise ValueError(f"Unknown measurement: {name}")
        return InputBinding(kind="sensor", ref=ObjectRef(instance_path=instance_path, collection="sensors", object_id=name))

    def _lower(self):
        return self._definition(electrical=self.wiring, sensors=self.measurements)


class HumanInput(ElectricalDesign):
    category: Literal["human_input"] = "human_input"
    input_kind: Literal["button", "keypad", "encoder", "potentiometer", "touch"]
    controls: dict[Id, SensorInput] = Field(min_length=1)
    debounce_s: float = Field(default=0.0, ge=0)

    @model_validator(mode="after")
    def debounce_boundary(self):
        if self.debounce_s != 0:
            raise ValueError("Debouncing is not simulated; supply pre-debounced fixture events and use debounce_s=0")
        return self

    def read(self, name: str, *, instance_path=()):
        if name not in self.controls:
            raise ValueError(f"Unknown input control: {name}")
        return InputBinding(kind="sensor", ref=ObjectRef(instance_path=instance_path, collection="sensors", object_id=name))

    def _lower(self):
        return self._definition(electrical=self.wiring, sensors=self.controls)


class ControlFunction(Contract):
    """One named, typed callable contract mapped to a closed declarative behavior."""
    inputs: dict[Id, SignalType] = Field(default_factory=dict)
    behavior: BehaviorSpec
    description: str = ""

    @model_validator(mode="after")
    def signature(self):
        from engine.simulator.registry import check_behavior, input_signal_type
        from engine.simulator.engine import compatible, typed_value
        from engine.base.quantity import UNITS
        if set(self.inputs) != set(self.behavior.inputs):
            raise ValueError("Function input names must match behavior bindings")
        errors = check_behavior(self.behavior)
        if errors:
            raise ValueError("; ".join(errors))
        expected = input_signal_type(self.behavior)
        for name, signal_type in self.inputs.items():
            if not compatible(signal_type, expected):
                raise ValueError(f"Function input {name} has incompatible signal type")
            binding = self.behavior.inputs[name]
            if binding.kind == "constant":
                validation_type = SignalType(kind="scalar", unit=UNITS[expected.unit][3]) if expected.kind == "scalar" else expected
                typed_value(binding.value, validation_type)
        return self


class FirmwareSource(Contract):
    language: Literal["c", "cpp", "python", "circuitpython", "micropython"]
    asset_ref: AssetRef
    entrypoint: str


class Controller(ElectricalDesign):
    category: Literal["controller"] = "controller"
    platform: str
    control_functions: dict[Id, ControlFunction] = Field(default_factory=dict)
    interfaces: dict[Id, ElectricalInterface] = Field(default_factory=dict)
    firmware: FirmwareSource | None = None

    def define_function(self, name: str, function: ControlFunction):
        if name in self.control_functions:
            raise ValueError(f"Function already defined: {name}")
        return self.replace(control_functions={**self.control_functions, name: function})

    def output(self, name: str, *, instance_path=()):
        if name not in self.control_functions:
            raise ValueError(f"Unknown control function: {name}")
        return InputBinding(kind="behavior", ref=ObjectRef(instance_path=instance_path, collection="behaviors", object_id=name))

    def _lower(self):
        sources = {}
        if self.firmware:
            if "_firmware" in self.sources:
                raise ValueError("_firmware is reserved")
            sources["_firmware"] = SourceRecord(title=f"{self.firmware.language} firmware source (not executed)",
                asset_ref=self.firmware.asset_ref, locator=self.firmware.entrypoint)
        return self._definition(electrical=self.wiring, interfaces=self.interfaces,
            behaviors={key: fn.behavior for key, fn in self.control_functions.items()}, extra_sources=sources,
            functions={key: FunctionSpec(capability=fn.description or f"control.{key}", inputs=fn.inputs,
                outputs={"value": fn.behavior.output_type}) for key, fn in self.control_functions.items()})


class Driver(ElectricalDesign):
    category: Literal["driver"] = "driver"
    driver_kind: Literal["motor", "led", "audio", "relay"]
    channels: dict[Id, BehaviorSpec] = Field(min_length=1)

    def output(self, name: str, *, instance_path=()):
        if name not in self.channels:
            raise ValueError(f"Unknown driver channel: {name}")
        return InputBinding(kind="behavior", ref=ObjectRef(instance_path=instance_path, collection="behaviors", object_id=name))

    def _lower(self):
        return self._definition(electrical=self.wiring, behaviors=self.channels)

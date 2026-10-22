"""Optional, typed authoring descriptions. These do not install physical solvers."""
from typing import Annotated, Literal
from pydantic import Field, model_validator
from engine.base.contract import Contract, Id, Positive
from engine.base.frame import LocalFrame
from engine.base.quantity import Quantity


def require_positive(value: Quantity | None, dimension: str, *, zero=False):
    if value is not None:
        number = value.require(dimension)
        if number < 0 or (number == 0 and not zero):
            raise ValueError(f"Expected a {'nonnegative' if zero else 'positive'} {dimension}")


class MechanicalDescription(Contract):
    kind: Literal["fastener", "bearing", "rail", "shaft", "wheel", "coupling", "gear", "belt",
                  "screw", "linkage", "housing", "bracket", "blade", "pointer", "diffuser", "other"]
    standard: str | None = None
    dimensions: dict[Id, Quantity] = Field(default_factory=dict)
    material: str | None = None

    @model_validator(mode="after")
    def sizes(self):
        for value in self.dimensions.values():
            require_positive(value, "length")
        return self


class ActuatorDescription(Contract):
    feedback: Literal["open_loop", "internal_position", "external_encoder"] = "open_loop"
    steps_per_revolution: int | None = Field(default=None, gt=0)
    limit_terminals: tuple[Id, ...] = ()
    rated_effort: Quantity | None = None


class LightDescription(Contract):
    kind: Literal["single", "rgb", "strip", "addressable"]
    count: int = Field(default=1, ge=1)
    color_order: Literal["RGB", "GRB", "RGBW", "GRBW"] = "RGB"
    protocol: str | None = None
    data_terminal: Id | None = None
    rated_power: Quantity | None = None

    @model_validator(mode="after")
    def addressable(self):
        if self.kind == "addressable" and not self.protocol:
            raise ValueError("Addressable lights require a named protocol")
        if self.kind != "addressable" and (self.protocol is not None or self.data_terminal is not None):
            raise ValueError("Serial protocol/data terminal require addressable lights")
        require_positive(self.rated_power, "power")
        return self


class DisplayDescription(Contract):
    kind: Literal["oled", "tft", "character_lcd", "epaper", "segment", "matrix"]
    active_size_m: tuple[Positive, Positive] | None = None
    refresh: Literal["continuous", "full", "partial"] = "continuous"
    bus: Literal["parallel", "i2c", "spi", "uart"] | None = None
    cable_exit: LocalFrame | None = None


class SoundDescription(Contract):
    impedance: Quantity | None = None
    rated_power: Quantity | None = None
    sound_port: LocalFrame | None = None

    @model_validator(mode="after")
    def ratings(self):
        require_positive(self.impedance, "resistance")
        require_positive(self.rated_power, "power")
        return self


class InertialDescription(Contract):
    kind: Literal["imu"] = "imu"
    axes: dict[Literal["ax", "ay", "az", "gx", "gy", "gz", "mx", "my", "mz"], Id] = Field(min_length=1)
    frame: LocalFrame
    bus: Literal["i2c", "spi"] | None = None


class CameraDescription(Contract):
    kind: Literal["camera"] = "camera"
    resolution_px: tuple[Annotated[int, Field(gt=0)], Annotated[int, Field(gt=0)]]
    frame_rate_hz: Positive
    encoding: Literal["gray8", "rgb8", "jpeg", "h264"]
    field_of_view_deg: tuple[Annotated[float, Field(gt=0, lt=180)],
                             Annotated[float, Field(gt=0, lt=180)]] | None = None
    optical_frame: LocalFrame | None = None
    bus: Literal["csi", "usb", "spi", "parallel"] | None = None


class MicrophoneDescription(Contract):
    kind: Literal["microphone"] = "microphone"
    sample_rate_hz: Positive
    channels: int = Field(default=1, ge=1, le=8)
    encoding: Literal["pcm_s16le", "pcm_f32"] = "pcm_s16le"
    sound_port: LocalFrame | None = None
    bus: Literal["analog", "i2s", "pdm", "usb"] | None = None


SensorDescription = Annotated[InertialDescription | CameraDescription | MicrophoneDescription,
                              Field(discriminator="kind")]


class PowerDescription(Contract):
    capacity: Quantity | None = None
    current_limit: Quantity | None = None
    chemistry: str | None = None

    @model_validator(mode="after")
    def ratings(self):
        require_positive(self.capacity, "charge")
        require_positive(self.current_limit, "current")
        return self

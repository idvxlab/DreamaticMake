"""Category-specific authoring API. No dynamic imports or executable model files."""
from typing import Annotated
from pydantic import Field, TypeAdapter
from engine.components.base import ComponentDesign
from engine.components.mechanical import Structure, Actuator, TransmissionComponent, Transport, EnergyStorage
from engine.components.electronic import Light, Display, Sound, HumanInput, Sensor, Controller, Driver, ControlFunction, FirmwareSource
from engine.components.power import PowerSource
from engine.components.circuit import CircuitElement
from engine.components.assembly import assemble_components

Component = Annotated[
    Structure | Actuator | TransmissionComponent | Light | Display | Sound | HumanInput |
    Sensor | Controller | Driver | PowerSource | Transport | EnergyStorage | CircuitElement,
    Field(discriminator="category")]
COMPONENT_ADAPTER = TypeAdapter(Component)

__all__ = ["Component", "ComponentDesign", "Structure", "Actuator", "TransmissionComponent", "Light",
           "Display", "Sound", "HumanInput", "Sensor", "Controller", "Driver", "PowerSource",
           "Transport", "EnergyStorage", "CircuitElement", "ControlFunction", "FirmwareSource", "assemble_components"]

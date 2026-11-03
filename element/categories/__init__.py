"""Category-specific authoring API. No dynamic imports or executable model files."""
from typing import Annotated
from pydantic import Field, TypeAdapter
from element.categories.base import ComponentDesign
from element.categories.mechanical import Structure, Actuator, TransmissionComponent, Transport, EnergyStorage
from element.categories.electronic import Light, Display, Sound, HumanInput, Sensor, Controller, Driver, ControlFunction, FirmwareSource
from element.categories.power import PowerSource
from element.categories.circuit import CircuitElement

Component = Annotated[
    Structure | Actuator | TransmissionComponent | Light | Display | Sound | HumanInput |
    Sensor | Controller | Driver | PowerSource | Transport | EnergyStorage | CircuitElement,
    Field(discriminator="category")]
COMPONENT_ADAPTER = TypeAdapter(Component)

__all__ = ["Component", "ComponentDesign", "Structure", "Actuator", "TransmissionComponent", "Light",
           "Display", "Sound", "HumanInput", "Sensor", "Controller", "Driver", "PowerSource",
           "Transport", "EnergyStorage", "CircuitElement", "ControlFunction", "FirmwareSource"]

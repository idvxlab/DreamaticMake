"""Explicit lowering from element authoring records to legacy execution contracts."""
from element.base.identity import DefinitionRef
from element.base.evidence import SourceRecord
from element.interfaces.function import FunctionSpec
from element.schema.model import ComponentDefinition, PhysicalSpec, ElectronicSpec
from engine.schema.assembly import ModelBundle
from element.base.reference import ObjectRef
from element.interfaces.motion import MotionSpec
from element.interfaces.behavior import BehaviorSpec
from element.interfaces.electrical import ElectricalSpec
from element.interfaces.effects import MotionEffect, BehaviorOutputRef
from element.base.signal import SignalType
from element.interfaces.effects import ObservableEffect
from element.interfaces.electrical import Terminal

def _definition(self, *, motion=None, material=None, electrical=None,
                sensors=None, effects=None, behaviors=None, interfaces=None,
                functions=None, extra_sources=None):
    from element.io.save import content_hash
    if "_component_design" in self.sources or "_category" in self.functions:
        raise ValueError("_component_design and _category are reserved authoring keys")
    sources = {**self.sources, **(extra_sources or {}), "_component_design": SourceRecord(
        title=f"Component design v{self.design_version}: {self.category}",
        source_revision=content_hash(self), locator=f"category={self.category}")}
    capabilities = {**self.functions, "_category": FunctionSpec(
        capability=f"component.{self.category}", operating_conditions=self.roles)}
    spec = getattr(self, "spec", None)
    if spec is not None:
        if "_description" in self.functions:
            raise ValueError("_description is reserved for typed authoring descriptions")
        capabilities["_description"] = FunctionSpec(
            capability=f"description.{self.category}.{getattr(spec, 'kind', self.category)}",
            operating_conditions=("Typed source description; no additional physical solver executed",))
    for key, value in (functions or {}).items():
        if key in capabilities:
            raise ValueError(f"Duplicate function ID: {key}")
        capabilities[key] = value
    physical = {"geometry": self.geometry, "mechanical": self.mounts}
    if motion is not None:
        physical["motion"] = motion
    if material is not None:
        physical["material"] = material
    return ComponentDefinition(
        id=self.id, revision=self.revision, name=self.name, parameters=self.parameters,
        functions=capabilities, principles=self.principles, realizations=self.realizations,
        sources=sources, evidence=self.evidence,
        physical=PhysicalSpec(**physical),
        electronic=ElectronicSpec(**({"electrical": electrical} if electrical is not None else {}),
            sensors=sensors or {}, effects=effects or {}, interfaces=interfaces or {}),
        behaviors=behaviors or {})

def lower_Structure(self):
    return _definition(self)

def lower_Actuator(self):
    effects = {} if self.control is None else {"motion": MotionEffect(
        target_joint=ObjectRef(collection="joints", object_id="axis"), mode=self.joint.drive_mode,
        value_type=self.control.output_type, behavior_output_ref=BehaviorOutputRef(behavior_id="control"))}
    return _definition(self, motion=MotionSpec(joints={"axis": self.joint}), electrical=self.wiring,
        behaviors={"control": self.control} if self.control else {}, effects=effects)

def lower_TransmissionComponent(self):
    return _definition(self, motion=self.motion)

def lower_Transport(self):
    return _definition(self, material=self.material)

def lower_EnergyStorage(self):
    return _definition(self, motion=self.motion)

def lower_Light(self):
    return _observable(self, "light", self.channels, SignalType(kind="scalar", unit="1"))

def lower_Display(self):
    # Current simulator supports string tokens, not pixel buffers or rendering.
    return _observable(self, "display", {"text": self.text}, SignalType(kind="event", protocol="display.text"))

def lower_Sound(self):
    return _observable(self, "sound", {"tone": self.frequency}, SignalType(kind="scalar", unit="Hz"))

def lower_Sensor(self):
    return _definition(self, electrical=self.wiring, sensors=self.measurements)

def lower_HumanInput(self):
    return _definition(self, electrical=self.wiring, sensors=self.controls)

def lower_Controller(self):
    sources = {}
    if self.firmware:
        if "_firmware" in self.sources:
            raise ValueError("_firmware is reserved")
        sources["_firmware"] = SourceRecord(title=f"{self.firmware.language} firmware source (not executed)",
            asset_ref=self.firmware.asset_ref, locator=self.firmware.entrypoint)
    return _definition(self, electrical=self.wiring, interfaces=self.interfaces,
        behaviors={key: fn.behavior for key, fn in self.control_functions.items()}, extra_sources=sources,
        functions={key: FunctionSpec(capability=fn.description or f"control.{key}", inputs=fn.inputs,
            outputs={"value": fn.behavior.output_type}) for key, fn in self.control_functions.items()})

def lower_Driver(self):
    return _definition(self, electrical=self.wiring, behaviors=self.channels)

def _observable(design, kind, channels, signal_type):
    behaviors = {key: BehaviorSpec(model_id="pass", inputs={"value": binding}, output_type=signal_type,
        supply_terminals=design.supply_terminals) for key, binding in channels.items()}
    effects = {key: ObservableEffect(kind=kind, value_type=signal_type,
        behavior_output_ref=BehaviorOutputRef(behavior_id=key)) for key in channels}
    return _definition(design, electrical=design.wiring, behaviors=behaviors, effects=effects)

def lower_PowerSource(self):
    if self.wiring is not None:
        positive = Terminal.model_validate({**dict(self.wiring.terminals["positive"]),
            "nominal_voltage": self.voltage, "reference_terminal": "ground"})
        electrical = ElectricalSpec(terminals={**self.wiring.terminals, "positive": positive},
                                    connectors=self.wiring.connectors)
        return _definition(self, electrical=electrical)
    return _definition(self, electrical=ElectricalSpec(terminals={
        "positive": Terminal(physical_pin_number="+", electrical_role="power_out",
            nominal_voltage=self.voltage, reference_terminal="ground"),
        "ground": Terminal(physical_pin_number="-", electrical_role="ground")}))

def lower_CircuitElement(self):
    return _definition(self, electrical=self.wiring)

LOWERERS = {
    "Structure": lower_Structure,
    "Actuator": lower_Actuator,
    "TransmissionComponent": lower_TransmissionComponent,
    "Transport": lower_Transport,
    "EnergyStorage": lower_EnergyStorage,
    "Light": lower_Light,
    "Display": lower_Display,
    "Sound": lower_Sound,
    "Sensor": lower_Sensor,
    "HumanInput": lower_HumanInput,
    "Controller": lower_Controller,
    "Driver": lower_Driver,
    "PowerSource": lower_PowerSource,
    "CircuitElement": lower_CircuitElement,
}

def to_definition(design):
    from element.categories import COMPONENT_ADAPTER
    from element.schema.library import ElementDefinition
    if isinstance(design, ElementDefinition):
        from element.io.records import parse_element, element_ref
        design = parse_element(design)
        ref = element_ref(design)
        definition = to_definition(design.model)
        return ComponentDefinition.model_validate({**dict(definition), 'sources': {**definition.sources,
            '_element': SourceRecord(title=f'Element {ref.library_id}/{ref.element_id}',
                locator=f'revision={ref.revision}', source_revision=ref.content_hash)}})
    design = COMPONENT_ADAPTER.validate_json(design.model_dump_json())
    return LOWERERS[type(design).__name__](design)

def to_bundle(design):
    from engine.schema.assembly import ModelBundle
    from element.io.save import content_hash
    definition = to_definition(design)
    return ModelBundle(components=(definition,), root=DefinitionRef(
        id=definition.id, revision=definition.revision, content_hash=content_hash(definition)))

def assemble_elements(*, id, name, elements, connections=None):
    """Compose pinned library records with collision-free definition IDs across libraries."""
    from element.io.records import parse_element, element_ref, record_hash
    from engine.adapters.assembly import assemble_components
    definitions = {}
    for occurrence, element in elements.items():
        element = parse_element(element)
        definition = to_definition(element)
        definition_id = 'element_' + record_hash(element_ref(element), 'assembly-element-id-v1')[:32]
        definitions[occurrence] = ComponentDefinition.model_validate({**dict(definition), 'id': definition_id})
    return assemble_components(id=id, name=name, components=definitions, connections=connections)

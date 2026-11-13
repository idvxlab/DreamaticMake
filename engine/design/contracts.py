"""Eight strictly typed, editable design layers; incomplete references are diagnostics."""
from typing import Annotated, Generic, Literal, TypeVar
from pydantic import JsonValue
from pydantic import Field, TypeAdapter, model_validator
from element.base.contract import Contract as BaseContract, Id, Sha256
from element.base.frame import Pose, Vec3, dot
from element.base.quantity import Quantity
from element.base.reference import AssetRef
from element.interfaces.geometry import Shape
from element.interfaces.material import MaterialPortProperties
from element.interfaces.electrical import TerminalProperties
from element.interfaces.behavior import BehaviorProgram
from element.schema.library import ElementRef, ElementObjectRef, Source, Evidence, EnergyPort, Revision

Kind = Literal['analysis', 'function', 'selection', 'structure', 'motion', 'circuit_energy', 'flow', 'logic']
KINDS = ('analysis', 'function', 'selection', 'structure', 'motion', 'circuit_energy', 'flow', 'logic')

class Contract(BaseContract):
    model_config = {**BaseContract.model_config, 'serialize_by_alias': True, 'validate_by_name': True}

class ObjectRef(Contract):
    record_id: Id
    collection: str | None = None
    object_id: str | None = None

    @model_validator(mode='after')
    def shape(self):
        if (self.collection is None) != (self.object_id is None):
            raise ValueError('collection and object_id must both be set or absent')
        if self.collection is not None:
            TypeAdapter(Id).validate_python(self.collection)
            pieces = self.object_id.split(':') if self.collection in ('unit_inputs', 'unit_outputs') else [self.object_id]
            if self.collection in ('unit_inputs', 'unit_outputs') and len(pieces) != 2:
                raise ValueError('Unit port reference requires unit_id:port_id')
            for piece in pieces: TypeAdapter(Id).validate_python(piece)
        return self

    def key(self):
        return '/'.join(x for x in (self.record_id, self.collection, self.object_id) if x is not None)

class RecordRef(Contract):
    record_id: Id
    revision: Revision
    content_hash: Sha256

class Markdown(Contract):
    format: Literal['markdown'] = 'markdown'
    text: str = Field(default='', max_length=1_000_000)
    attachments: tuple[AssetRef, ...] = Field(default=(), max_length=128)

class TraceLink(Contract):
    relation: Literal['motivates', 'decomposes', 'realizes', 'constrains', 'depends_on', 'documents']
    target: ObjectRef
    note: str = ''

class BooleanType(Contract):
    kind: Literal['boolean'] = 'boolean'
class ScalarType(Contract):
    kind: Literal['scalar'] = 'scalar'
    unit: str
    @model_validator(mode='after')
    def unit_known(self):
        Quantity(value=0.0, unit=self.unit)
        return self
class EnumType(Contract):
    kind: Literal['enum'] = 'enum'
    values: tuple[str, ...] = Field(min_length=1)
    @model_validator(mode='after')
    def unique(self):
        if len(set(self.values)) != len(self.values): raise ValueError('Duplicate enum values')
        return self
class EventType(Contract):
    kind: Literal['event'] = 'event'
    schema_id: str
class StreamType(Contract):
    kind: Literal['stream'] = 'stream'
    schema_id: str
ValueType = Annotated[BooleanType | ScalarType | EnumType | EventType | StreamType, Field(discriminator='kind')]

class Bounds(Contract):
    min: Quantity | None = None
    max: Quantity | None = None
    @model_validator(mode='after')
    def ordered(self):
        if self.min and self.max:
            if self.min.dimension != self.max.dimension or self.min.si_value > self.max.si_value:
                raise ValueError('Bounds require compatible dimensions and ordered values')
        return self

class Conclusion(Contract):
    statement: str
    basis: Literal['assumption', 'evidence', 'open_question']
    evidence_ids: tuple[Id, ...] = ()
    affects: tuple[ObjectRef, ...] = ()
class AnalysisData(Contract):
    purpose: Literal['background', 'requirements', 'feasibility', 'tradeoff', 'risk', 'decision', 'other'] = 'other'
    body: Markdown = Markdown()
    subjects: tuple[ObjectRef, ...] = ()
    conclusions: dict[Id, Conclusion] = Field(default_factory=dict)

class FunctionPort(Contract):
    name: str
    type: ValueType
    required: bool = False
class Criterion(Contract):
    statement: str
    metric: str | None = None
    target: Bounds | None = None
    method: Literal['inspection', 'calculation', 'simulation', 'physical_test']
    evidence_ids: tuple[Id, ...] = ()
class FunctionData(Contract):
    body: Markdown = Markdown()
    parent: ObjectRef | None = None
    inputs: dict[Id, FunctionPort] = Field(default_factory=dict)
    outputs: dict[Id, FunctionPort] = Field(default_factory=dict)
    criteria: dict[Id, Criterion] = Field(default_factory=dict)
    realizations: tuple[ObjectRef, ...] = ()

class Requirement(Bounds):
    statement: str
    parameter_code: Id | None = None
    required: bool = True
class Assessment(Contract):
    outcome: Literal['match', 'mismatch', 'unknown']
    evidence_ids: tuple[Id, ...] = ()
class Candidate(Contract):
    element_ref: ElementRef
    reason: Markdown = Markdown()
    assessments: dict[Id, Assessment] = Field(default_factory=dict)
class Instance(Contract):
    label: str
    pose: Pose | None = None
    parent_instance: ObjectRef | None = None
class DiscreteUsage(Contract):
    kind: Literal['discrete'] = 'discrete'
    planned_count: int = Field(default=0, ge=0, le=100000)
    instances: dict[Id, Instance] = Field(default_factory=dict)
class BulkUsage(Contract):
    kind: Literal['bulk'] = 'bulk'
    quantity: Quantity
    instance: Instance | None = None
    @model_validator(mode='after')
    def positive(self):
        if self.quantity.value < 0: raise ValueError('Bulk quantity must be nonnegative')
        return self
class SelectionData(Contract):
    function_refs: tuple[ObjectRef, ...] = ()
    requirements: dict[Id, Requirement] = Field(default_factory=dict)
    candidates: dict[Id, Candidate] = Field(default_factory=dict)
    chosen_candidate_id: Id | None = None
    decision: Markdown = Markdown()
    usage: Annotated[DiscreteUsage | BulkUsage, Field(discriminator='kind')] = DiscreteUsage()

class ElementBinding(Contract):
    instance_ref: ObjectRef
    local_ref: ElementObjectRef
class InheritedObject(Contract):
    """Reference plus explicit design differences; resolved against the pinned element."""
    source: ElementBinding
    overrides: dict[str, JsonValue] = Field(default_factory=dict)

class Body(Contract):
    instance_ref: ObjectRef
    source: ElementBinding | None = None
    parent_body: ObjectRef | None = None
    pose: Pose | None = None
    placement: Literal['specified', 'suggested', 'unplaced'] = 'unplaced'
    @model_validator(mode='after')
    def placement_pose(self):
        if (self.placement == 'unplaced') != (self.pose is None):
            raise ValueError('Only unplaced bodies have a null pose')
        return self
class Geometry(Contract):
    body_ref: ObjectRef
    pose: Pose = Pose()
    shape: Shape
    purpose: Literal['solid', 'keepout', 'service'] = 'solid'
    approximation: Literal['outer', 'inner', 'unknown'] = 'unknown'
    margin_m: float = Field(default=0.0, ge=0)
    source: ElementBinding | None = None
class Mount(Contract):
    body_ref: ObjectRef
    pose: Pose = Pose()
    source: ElementBinding | None = None
    interface_kind: str
class StructureConnection(Contract):
    a: ObjectRef
    b: ObjectRef
    kind: Literal['fixed', 'joint']
    joint_ref: ObjectRef | None = None
class StructureData(Contract):
    bodies: dict[Id, Body | InheritedObject] = Field(default_factory=dict)
    geometry: dict[Id, Geometry | InheritedObject] = Field(default_factory=dict)
    mounts: dict[Id, Mount | InheritedObject] = Field(default_factory=dict)
    connections: dict[Id, StructureConnection] = Field(default_factory=dict)

class Joint(Contract):
    parent_body: ObjectRef
    child_body: ObjectRef
    source: ElementBinding | None = None
    kind: Literal['fixed', 'revolute', 'continuous', 'prismatic']
    axis: Vec3 | None = None
    parent_anchor: Pose = Pose()
    child_anchor: Pose = Pose()
    lower: Quantity | None = None
    upper: Quantity | None = None
    initial: Quantity | None = None
    @model_validator(mode='after')
    def dimensions(self):
        if self.axis and abs(dot(self.axis, self.axis)-1) > 1e-6: raise ValueError('Axis must be normalized')
        dimension = 'length' if self.kind == 'prismatic' else 'angle'
        for value in (self.lower, self.upper, self.initial):
            if value: value.require(dimension)
        Bounds(min=self.lower, max=self.upper)
        if self.initial and ((self.lower and self.initial.si_value < self.lower.si_value) or (self.upper and self.initial.si_value > self.upper.si_value)):
            raise ValueError('Initial joint position is outside limits')
        return self
class Transmission(Contract):
    source: ElementBinding | None = None
    driver: ObjectRef
    follower: ObjectRef
    kind: Literal['rotary_ratio', 'screw']
    factor: Quantity | None = None
    offset: Quantity | None = None
    @model_validator(mode='after')
    def dimensions(self):
        if self.factor: self.factor.require('dimensionless' if self.kind == 'rotary_ratio' else 'length')
        if self.offset: self.offset.require('angle' if self.kind == 'rotary_ratio' else 'length')
        return self
class Drive(Contract):
    joint_ref: ObjectRef
    mode: Literal['position', 'velocity']
    command: Quantity | None = None
    speed_limit: Quantity | None = None
    input_ref: ObjectRef | None = None
    @model_validator(mode='after')
    def source(self):
        if self.input_ref and self.command: raise ValueError('Drive cannot have two command sources')
        if self.speed_limit and self.speed_limit.value <= 0: raise ValueError('Speed limit must be positive')
        return self
class MotionData(Contract):
    joints: dict[Id, Joint | InheritedObject] = Field(default_factory=dict)
    transmissions: dict[Id, Transmission | InheritedObject] = Field(default_factory=dict)
    drives: dict[Id, Drive] = Field(default_factory=dict)

class TerminalSpec(TerminalProperties):
    voltage_limits: Bounds | None = None
    current_limits: Bounds | None = None
    reference_terminal: ObjectRef | None = None
    evidence_ids: tuple[Id, ...] = ()
class Terminal(Contract):
    instance_ref: ObjectRef
    source: ElementBinding | None = None
    spec: TerminalSpec
    body_ref: ObjectRef | None = None
    pose: Pose | None = None
    @model_validator(mode='after')
    def location(self):
        if self.pose and not self.body_ref: raise ValueError('Terminal pose requires body')
        return self
class Net(Contract):
    kind: Literal['signal', 'power', 'ground']
    members: tuple[ObjectRef, ...] = ()
    reference_net: ObjectRef | None = None
class EnergyFrame(Contract):
    body_ref: ObjectRef
    pose: Pose = Pose()
class DesignEnergySpec(EnergyPort):
    frame: EnergyFrame | None = None
class DesignEnergyPort(Contract):
    instance_ref: ObjectRef
    source: ElementBinding | None = None
    spec: DesignEnergySpec
class EnergyTransfer(Contract):
    carrier: Literal['electrical', 'rotational', 'linear', 'thermal']
    from_: ObjectRef = Field(alias='from')
    to: ObjectRef
    via: tuple[ObjectRef, ...] = ()
    ratings: dict[Id, Quantity] = Field(default_factory=dict)
class CircuitEnergyData(Contract):
    terminals: dict[Id, Terminal | InheritedObject] = Field(default_factory=dict)
    nets: dict[Id, Net] = Field(default_factory=dict)
    energy_ports: dict[Id, DesignEnergyPort | InheritedObject] = Field(default_factory=dict)
    transfers: dict[Id, EnergyTransfer] = Field(default_factory=dict)

class FlowPortBase(Contract):
    instance_ref: ObjectRef
    source: ElementBinding | None = None
    direction: Literal['in', 'out', 'bidirectional']
    required: bool = False
    body_ref: ObjectRef | None = None
    pose: Pose | None = None
    @model_validator(mode='after')
    def frame(self):
        if self.pose and not self.body_ref: raise ValueError('Port pose requires a body')
        return self
class MaterialPort(FlowPortBase):
    domain: Literal['material'] = 'material'
    medium: str | None = None
    spec: MaterialPortProperties | None = None
class InformationPort(FlowPortBase):
    domain: Literal['information'] = 'information'
    type: ValueType | None = None
    interface_ref: ObjectRef | None = None
FlowPort = Annotated[MaterialPort | InformationPort, Field(discriminator='domain')]
class FlowEdge(Contract):
    source: ElementBinding | None = None
    domain: Literal['material', 'information']
    from_: ObjectRef = Field(alias='from')
    to: tuple[ObjectRef, ...] = Field(min_length=1, max_length=128)
    scope: Literal['internal', 'external'] = 'external'
    mechanism: str | None = None
    constraints: dict[Id, Quantity] = Field(default_factory=dict)
    physical_binding_refs: tuple[ObjectRef, ...] = ()
class RequiredPath(Contract):
    domain: Literal['material', 'information']
    from_: ObjectRef = Field(alias='from')
    to: ObjectRef
class FlowData(Contract):
    ports: dict[Id, FlowPort | InheritedObject] = Field(default_factory=dict)
    edges: dict[Id, FlowEdge | InheritedObject] = Field(default_factory=dict)
    required_paths: dict[Id, RequiredPath] = Field(default_factory=dict)

class LogicInterface(Contract):
    source: ElementBinding | None = None
    instance_ref: ObjectRef
    protocol: str
    terminal_bindings: dict[Id, ObjectRef] = Field(default_factory=dict)
    information_port_refs: tuple[ObjectRef, ...] = ()
class LogicPort(Contract):
    name: str
    type: ValueType
class UnitBase(Contract):
    name: str
    instance_ref: ObjectRef | None = None
    inputs: dict[Id, ValueType] = Field(default_factory=dict)
    outputs: dict[Id, ValueType] = Field(default_factory=dict)
class DeclarativeUnit(UnitBase):
    kind: Literal['declarative'] = 'declarative'
    behavior: BehaviorProgram
    supply_terminal_refs: tuple[ObjectRef, ...] = ()
class CodeUnit(UnitBase):
    kind: Literal['code'] = 'code'
    language: Literal['python'] = 'python'
    source: str = Field(max_length=1_000_000)
    environment_ref: AssetRef | None = None
class MarkdownUnit(UnitBase):
    kind: Literal['markdown'] = 'markdown'
    body: Markdown = Markdown()
    @model_validator(mode='after')
    def no_ports(self):
        if self.inputs or self.outputs: raise ValueError('Markdown units cannot have ports')
        return self
class FirmwareUnit(UnitBase):
    kind: Literal['firmware_reference'] = 'firmware_reference'
    assets: tuple[AssetRef, ...] = ()
    target: str
class ElementUnit(UnitBase):
    kind: Literal['element'] = 'element'
    source: ElementBinding

LogicUnit = Annotated[DeclarativeUnit | CodeUnit | MarkdownUnit | FirmwareUnit | ElementUnit, Field(discriminator='kind')]
class LogicBinding(Contract):
    source: ObjectRef
    target: ObjectRef
class LogicData(Contract):
    interfaces: dict[Id, LogicInterface | InheritedObject] = Field(default_factory=dict)
    inputs: dict[Id, LogicPort] = Field(default_factory=dict)
    outputs: dict[Id, LogicPort] = Field(default_factory=dict)
    units: dict[Id, LogicUnit | InheritedObject] = Field(default_factory=dict)
    bindings: dict[Id, LogicBinding] = Field(default_factory=dict)
    execution_order: tuple[Id, ...] = ()

T = TypeVar('T')
class DesignRecord(Contract, Generic[T]):
    record_kind: Literal['design_record'] = 'design_record'
    schema_version: Literal['2.0.0-draft'] = '2.0.0-draft'
    design_id: Id
    record_id: Id
    revision: Revision = 1
    title: str
    maturity: Literal['draft', 'specified', 'archived'] = 'draft'
    tags: tuple[str, ...] = ()
    links: tuple[TraceLink, ...] = ()
    sources: dict[Id, Source] = Field(default_factory=dict)
    evidence: dict[Id, Evidence] = Field(default_factory=dict)
    data: T
class AnalysisRecord(DesignRecord[AnalysisData]):
    kind: Literal['analysis'] = 'analysis'
class FunctionRecord(DesignRecord[FunctionData]):
    kind: Literal['function'] = 'function'
class SelectionRecord(DesignRecord[SelectionData]):
    kind: Literal['selection'] = 'selection'
class StructureRecord(DesignRecord[StructureData]):
    kind: Literal['structure'] = 'structure'
class MotionRecord(DesignRecord[MotionData]):
    kind: Literal['motion'] = 'motion'
class CircuitEnergyRecord(DesignRecord[CircuitEnergyData]):
    kind: Literal['circuit_energy'] = 'circuit_energy'
class FlowRecord(DesignRecord[FlowData]):
    kind: Literal['flow'] = 'flow'
class LogicRecord(DesignRecord[LogicData]):
    kind: Literal['logic'] = 'logic'
Record = Annotated[AnalysisRecord | FunctionRecord | SelectionRecord | StructureRecord |
                   MotionRecord | CircuitEnergyRecord | FlowRecord | LogicRecord, Field(discriminator='kind')]
RECORD_ADAPTER = TypeAdapter(Record)

class DesignManifest(Contract):
    record_kind: Literal['design_manifest'] = 'design_manifest'
    schema_version: Literal['2.0.0-draft'] = '2.0.0-draft'
    design_id: Id
    revision: Revision = 1
    title: str
    layers: dict[Kind, tuple[RecordRef, ...]] = Field(default_factory=lambda: {k: () for k in KINDS})
    input_revisions: dict[str, Revision] = Field(default_factory=dict)
    @model_validator(mode='after')
    def layers_complete(self):
        if set(self.layers) != set(KINDS): raise ValueError('Manifest must contain all eight layer keys')
        ids = [r.record_id for layer in self.layers.values() for r in layer]
        if len(ids) != len(set(ids)): raise ValueError('Manifest must pin each record exactly once')
        if len(ids) > 2000: raise ValueError('Record budget exceeded')
        return self

from element.schema.library import ElementDefinition
class DesignPackage(Contract):
    record_kind: Literal['design_package'] = 'design_package'
    schema_version: Literal['2.0.0-draft'] = '2.0.0-draft'
    manifest: DesignManifest
    records: tuple[Record, ...] = Field(default=(), max_length=2000)
    elements: tuple[ElementDefinition, ...] = Field(default=(), max_length=1000)

class Diagnostic(Contract):
    code: str
    severity: Literal['info', 'warning', 'error']
    message: str
    refs: tuple[ObjectRef, ...] = ()
    field_path: str | None = None

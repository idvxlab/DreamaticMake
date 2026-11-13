"""Professional element v2. Legacy category objects are derived, never persisted.

The category adapter validates specification against the existing fourteen-category
union. Conversion is explicit; reading a historical revision never rewrites it.
"""
from typing import Annotated, Literal
from pydantic import Field, model_validator
from element.base.contract import Contract, Id, Positive, NonNegative
from element.base.frame import Pose, Vec3, dot
from element.base.reference import AssetRef
from element.schema.library import Category, Product, Revision


class DomainRef(Contract):
    unit_path: tuple[Id, ...] = Field(default=(), max_length=16, exclude_if=lambda v: not v)
    domain: Literal['mechanical', 'electrical', 'behavior', 'flow']
    collection: Id
    id: Id


class OccurrenceRef(DomainRef):
    instance: Id


class Box(Contract):
    type: Literal['box'] = 'box'
    size_m: tuple[Positive, Positive, Positive]


class Sphere(Contract):
    type: Literal['sphere'] = 'sphere'
    radius_m: Positive


class Cylinder(Contract):
    type: Literal['cylinder'] = 'cylinder'
    radius_m: Positive
    length_m: Positive


class Capsule(Contract):
    type: Literal['capsule'] = 'capsule'
    radius_m: Positive
    segment_length_m: NonNegative


class Mesh(Contract):
    type: Literal['mesh'] = 'mesh'
    asset_ref: AssetRef
    unit: Literal['m', 'cm', 'mm']


class BRep(Contract):
    type: Literal['brep'] = 'brep'
    asset_ref: AssetRef
    format: Literal['step'] = 'step'
    unit: Literal['m', 'cm', 'mm']
    selection: str | None = None


Geometry = Annotated[Box | Sphere | Cylinder | Capsule | Mesh | BRep, Field(discriminator='type')]


class Graphic(Contract):
    origin: Pose = Pose()
    geometry: Geometry


class Collision(Graphic):
    interpretation: Literal['surface', 'solid'] = 'solid'
    approximation: Literal['outer', 'inner', 'unknown', 'tessellated'] = 'unknown'
    margin_m: NonNegative = 0.0
    evidence_refs: tuple[Id, ...] = ()


class Space(Graphic):
    kind: Literal['keepout', 'service']


class Inertia(Contract):
    ixx: Positive
    ixy: float = 0.
    ixz: float = 0.
    iyy: Positive
    iyz: float = 0.
    izz: Positive

    @model_validator(mode='after')
    def physical(self):
        a, b, c, d, e, f = self.ixx, self.iyy, self.izz, self.ixy, self.ixz, self.iyz
        if a*b-d*d <= 0 or a*b*c+2*d*e*f-a*f*f-b*e*e-c*d*d <= 0:
            raise ValueError('Inertia tensor must be positive definite')
        # Second moment matrix is PSD iff the inertia is physically realizable.
        a, b, c = (b+c-a)/2, (a+c-b)/2, (a+b-c)/2
        if min(a, b, c, a*b-d*d, a*c-e*e, b*c-f*f,
               a*b*c-2*d*e*f-a*f*f-b*e*e-c*d*d) < -1e-15:
            raise ValueError('Inertia violates physical triangle inequalities')
        return self


class Inertial(Contract):
    origin: Pose = Pose()
    mass_kg: Positive
    inertia_kg_m2: Inertia
    evidence_refs: tuple[Id, ...] = ()


class Link(Contract):
    description: str = ''
    color: str | None = None
    # Preserve unknown quantities and evidence; do not invent inertias for export.
    mass: dict | None = None
    inertia_ref: AssetRef | None = None
    inertial: Inertial | None = Field(default=None, exclude_if=lambda v: v is None)
    visuals: dict[Id, Graphic] = Field(default_factory=dict)
    collisions: dict[Id, Collision] = Field(default_factory=dict)
    spaces: dict[Id, Space] = Field(default_factory=dict)


class Limit(Contract):
    lower: float | None = None
    upper: float | None = None
    velocity: Positive | None = None
    effort: Positive | None = None

    @model_validator(mode='after')
    def ordered(self):
        if self.lower is not None and self.upper is not None and self.lower > self.upper:
            raise ValueError('Joint lower limit exceeds upper limit')
        return self


class Joint(Contract):
    type: Literal['fixed', 'revolute', 'continuous', 'prismatic']
    parent: DomainRef | OccurrenceRef
    child: DomainRef | OccurrenceRef
    origin: Pose = Pose()
    child_origin: Pose = Pose()
    axis: Vec3 | None = None
    limit: Limit | None = None
    evidence_refs: tuple[Id, ...] = ()

    @model_validator(mode='after')
    def semantics(self):
        if any(r.domain != 'mechanical' or r.collection != 'links' for r in (self.parent, self.child)):
            raise ValueError('Joint endpoints must be links')
        if self.parent == self.child:
            raise ValueError('Joint cannot connect a link to itself')
        if self.type == 'fixed':
            if self.axis is not None or self.limit is not None:
                raise ValueError('Fixed joints have no axis or limits')
        elif self.axis is None or abs(dot(self.axis, self.axis) - 1) > 1e-6:
            raise ValueError('Moving joints require a unit axis')
        if self.type == 'continuous' and self.limit and (self.limit.lower is not None or self.limit.upper is not None):
            raise ValueError('Continuous joints have no position bounds')
        return self


class Mechanical(Contract):
    root_link: Id | None = None
    roots: tuple[Id, ...] = Field(default=(), exclude_if=lambda v: not v)
    materials: dict[Id, dict] = Field(default_factory=dict, exclude_if=lambda v: not v)
    links: dict[Id, Link] = Field(default_factory=dict)
    joints: dict[str, Joint] = Field(default_factory=dict)
    mounts: dict[Id, dict] = Field(default_factory=dict)
    couplings: dict[Id, dict] = Field(default_factory=dict)
    initial_positions: dict[Id, float] = Field(default_factory=dict)
    drives: dict[Id, Literal['passive', 'position', 'velocity']] = Field(default_factory=dict)
    mount_connections: dict[Id, dict] = Field(default_factory=dict, exclude_if=lambda v: not v)


class Pin(Contract):
    number: str
    name: str = ''
    electrical_type: Literal['input', 'output', 'bidirectional', 'tri_state', 'passive', 'power_in',
                             'power_out', 'open_collector', 'open_emitter', 'no_connect', 'unspecified']
    power: dict | None = None
    capabilities: dict = Field(default_factory=dict)
    default_config: dict = Field(default_factory=dict)
    physical: dict | None = None
    reference_pin: Id | None = None
    evidence_refs: tuple[Id, ...] = ()


class Electrical(Contract):
    pins: dict[Id, Pin] = Field(default_factory=dict)
    connectors: dict[Id, dict] = Field(default_factory=dict)
    interfaces: dict[Id, dict] = Field(default_factory=dict)
    nets: dict[Id, 'InternalNet'] = Field(default_factory=dict, exclude_if=lambda v: not v)


class InternalNet(Contract):
    kind: Literal['signal', 'power', 'ground'] = 'signal'
    nodes: tuple[DomainRef, ...] = Field(min_length=2, max_length=128)


class UnitLocation(Contract):
    kind: Literal['custom', 'library']
    path: str


class ReferenceUnit(Contract):
    kind: Literal['reference'] = 'reference'
    element_ref: 'ElementRef'
    location: UnitLocation
    parameter_bindings: dict[Id, dict] = Field(default_factory=dict, exclude_if=lambda v: not v)


class InlineUnit(Contract):
    kind: Literal['inline'] = 'inline'
    definition: 'UnitDefinition'


class BomPolicy(Contract):
    policy: Literal['self', 'children'] = 'self'


class Behavior(Contract):
    # Category adapter payloads remain typed by COMPONENT_ADAPTER on lowering.
    models: dict[Id, dict] = Field(default_factory=dict)
    sensors: dict[Id, dict] = Field(default_factory=dict)
    effects: dict[Id, dict] = Field(default_factory=dict)
    ports: dict[Id, 'BehaviorPort'] = Field(default_factory=dict, exclude_if=lambda v: not v)
    bindings: dict[Id, dict] = Field(default_factory=dict, exclude_if=lambda v: not v)


class BehaviorPort(Contract):
    direction: Literal['in', 'out', 'bidirectional']
    type: Literal['scalar', 'boolean', 'digital', 'event', 'record']
    unit: str | None = None
    delivery: Literal['sample', 'event'] = 'sample'
    required: bool = False
    fields: dict[Id, str] | None = None

    @model_validator(mode='after')
    def record_shape(self):
        if self.type == 'record' and not self.fields: raise ValueError('Record ports require explicit fields')
        return self


class UnitDefinition(Contract):
    name: str
    category: Category
    aliases: tuple[str, ...] = ()
    subtype: str | None = None
    form: Literal['part', 'chip', 'module', 'assembly', 'software'] = 'part'
    origin: Literal['catalog', 'custom', 'template'] = 'custom'
    roles: tuple[str, ...] = ()
    tags: tuple[str, ...] = ()
    product: Product = Product()
    description_markdown: str = ''
    parameters: dict[Id, dict] = Field(default_factory=dict)
    functions: dict[Id, dict] = Field(default_factory=dict)
    principles: dict[Id, dict] = Field(default_factory=dict)
    realizations: dict[Id, dict] = Field(default_factory=dict)
    capabilities: dict[Id, dict] = Field(default_factory=dict)
    specification: dict = Field(default_factory=dict)
    mechanical: Mechanical = Mechanical()
    electrical: Electrical = Electrical()
    behavior: Behavior = Behavior()
    flow: dict = Field(default_factory=dict)
    authoring: dict = Field(default_factory=dict)
    manufacturing: dict = Field(default_factory=dict)
    procurement: dict | None = None
    sources: dict[Id, dict] = Field(default_factory=dict)
    evidence: dict[Id, dict] = Field(default_factory=dict)
    units: dict[Id, Annotated[InlineUnit | ReferenceUnit, Field(discriminator='kind')]] = Field(
        default_factory=dict, max_length=64, exclude_if=lambda v: not v)
    exports: dict[str, dict[str, dict[Id, DomainRef]]] = Field(default_factory=dict, exclude_if=lambda v: not v)
    bom: BomPolicy = Field(default_factory=BomPolicy, exclude_if=lambda v: v.policy == 'self')

    @model_validator(mode='after')
    def references(self):
        m = self.mechanical
        if m.root_link is not None and m.root_link not in m.links:
            raise ValueError('Unknown root link')
        if set(m.roots) - m.links.keys(): raise ValueError('Unknown mechanical roots')
        parents = {}
        for joint in m.joints.values():
            if any(isinstance(r, OccurrenceRef) or (not r.unit_path and r.id not in m.links) for r in (joint.parent, joint.child)):
                raise ValueError('Unresolved internal joint link')
            if any(r.unit_path for r in (joint.parent, joint.child)):
                continue  # Scoped references are checked against pinned dependencies by the resolver.
            if joint.child.id in parents: raise ValueError('Duplicate internal joint parent')
            parents[joint.child.id] = joint.parent.id
        for child in parents:
            seen, cursor = set(), child
            while cursor in parents:
                if cursor in seen: raise ValueError('Internal joint cycle')
                seen.add(cursor)
                cursor = parents[cursor]
        for pin in self.electrical.pins.values():
            if pin.physical and pin.physical['link'] not in m.links:
                raise ValueError('Unresolved physical pin link')
            if pin.reference_pin and pin.reference_pin not in self.electrical.pins:
                raise ValueError('Unresolved reference pin')
        return self


class ElementDefinitionV2(UnitDefinition):
    """Version-dispatched native contract. Empty additions preserve v2 serialization/pins."""
    record_kind: Literal['element_definition'] = 'element_definition'
    schema_version: Literal['2.0.0-draft', '3.0.0-draft'] = '2.0.0-draft'
    library_id: Id
    element_id: Id
    revision: Revision

    @model_validator(mode='after')
    def version_features(self):
        if self.schema_version == '2.0.0-draft':
            if self.units or self.exports or self.bom.policy != 'self' or self.electrical.nets or self.mechanical.mount_connections:
                raise ValueError('Composition requires element v3')
            if any(r.unit_path for j in self.mechanical.joints.values() for r in (j.parent, j.child)):
                raise ValueError('Scoped internal references require element v3')
        return self

    @property
    def model(self):
        """Read-only compatibility projection; absent from serialized v2 records."""
        if self.units:
            raise ValueError('Composite elements require explicit resolved projection')
        from element.migration import lower_element
        return lower_element(self)

    def collections(self):
        from element.schema.library import ElementDefinition
        return ElementDefinition(library_id=self.library_id, element_id=self.element_id,
            revision=self.revision, name=self.name, category=self.category, model=self.model).collections()


from element.schema.library import ElementRef
UnitDefinition.model_rebuild()
ElementDefinitionV2.model_rebuild()
Electrical.model_rebuild()

"""Versioned reusable element/library contracts; no engine or application imports."""
from typing import Annotated, Literal
from pydantic import Field, BaseModel, model_validator
from element.base.contract import Contract, Id, Sha256
from element.base.quantity import Quantity, Range
from element.base.reference import AssetRef, ObjectRef
from element.base.frame import Pose
from element.categories import Component

Revision = Annotated[int, Field(ge=1, le=9007199254740991)]

Category = Literal['structure', 'transmission', 'actuator', 'light', 'display', 'sound',
                   'human_input', 'sensor', 'controller', 'driver', 'power', 'transport',
                   'energy_storage', 'circuit_element']

class Source(Contract):
    title: str
    locator: str
    source_revision: str | None = None
    retrieved_at: str | None = None

class Evidence(Contract):
    source_ids: tuple[Id, ...] = ()
    basis: Literal['datasheet', 'measurement', 'assumption', 'derived']
    statement: str
    artifact_refs: tuple[AssetRef, ...] = ()

class ElementRef(Contract):
    library_id: Id
    element_id: Id
    revision: Revision
    content_hash: Sha256

class ElementObjectRef(Contract):
    collection: Literal['bodies', 'envelopes', 'mounts', 'joints', 'terminals', 'interfaces',
                        'material_ports', 'information_ports', 'energy_ports', 'behaviors',
                        'transmissions', 'material_paths', 'visual_assets', 'sensors']
    object_id: Id

class ElementParameter(Contract):
    value: Quantity | None = None
    limits: Range | None = None
    configurable: bool = False
    evidence_ids: tuple[Id, ...] = ()

    @model_validator(mode='after')
    def dimensions(self):
        if self.value and self.limits:
            if not self.limits.contains(self.value):
                raise ValueError('Parameter value is outside its declared limits')
        return self

class Capability(Contract):
    code: str
    port_refs: tuple[ElementObjectRef, ...] = ()
    conditions: tuple[str, ...] = ()
    evidence_ids: tuple[Id, ...] = ()

class Product(Contract):
    manufacturer: str | None = None
    model: str | None = None
    hardware_revision: str | None = None

class PortFrame(Contract):
    body_id: Id
    pose: Pose = Pose()

class InformationPort(Contract):
    name: str
    direction: Literal['in', 'out', 'bidirectional']
    data_type: str
    interface_id: Id | None = None
    frame: PortFrame | None = None
    required: bool = False

class EnergyPort(Contract):
    name: str
    carrier: Literal['rotational', 'linear', 'thermal']
    direction: Literal['in', 'out', 'bidirectional']
    frame: PortFrame | None = None
    ratings: dict[Id, Quantity] = Field(default_factory=dict)
    required: bool = False

class ElementDefinition(Contract):
    record_kind: Literal['element_definition'] = 'element_definition'
    schema_version: Literal['1.0.0-draft'] = '1.0.0-draft'
    library_id: Id
    element_id: Id
    revision: Revision = 1
    name: str
    aliases: tuple[str, ...] = ()
    category: Category
    subtype: str | None = None
    form: Literal['part', 'chip', 'module', 'assembly', 'software'] = 'part'
    origin: Literal['catalog', 'custom', 'template'] = 'custom'
    roles: tuple[str, ...] = ()
    tags: tuple[str, ...] = ()
    product: Product = Product()
    description_markdown: str = Field(default='', max_length=1_000_000)
    parameters: dict[Id, ElementParameter] = Field(default_factory=dict)
    capabilities: dict[Id, Capability] = Field(default_factory=dict)
    # Preserve the complete, editable 14-category authoring union, not a lowered snapshot.
    model: Component
    information_ports: dict[Id, InformationPort] = Field(default_factory=dict)
    energy_ports: dict[Id, EnergyPort] = Field(default_factory=dict)
    sources: dict[Id, Source] = Field(default_factory=dict)
    evidence: dict[Id, Evidence] = Field(default_factory=dict)

    @model_validator(mode='after')
    def consistency(self):
        if (self.model.id, self.model.revision, self.model.category) != (self.element_id, self.revision, self.category):
            raise ValueError('Element identity/revision/category must match the authoring model')
        collections = self.collections()
        for evidence in self.evidence.values():
            if set(evidence.source_ids) - self.sources.keys():
                raise ValueError('Unknown evidence source')
        for value in (*self.parameters.values(), *self.capabilities.values()):
            if set(value.evidence_ids) - self.evidence.keys():
                raise ValueError('Unknown parameter/capability evidence')
        for cap in self.capabilities.values():
            for ref in cap.port_refs:
                if ref.object_id not in collections[ref.collection]:
                    raise ValueError('Unresolved capability port')
        for port in (*self.information_ports.values(), *self.energy_ports.values()):
            if port.frame and port.frame.body_id not in collections['bodies']:
                raise ValueError('Unresolved port frame')
            if isinstance(port, InformationPort) and port.interface_id and port.interface_id not in collections['interfaces']:
                raise ValueError('Unresolved information interface')
        # Validate structural local references without invoking any compiler or simulator.
        def visit(value):
            if isinstance(value, ObjectRef):
                collection = {'mechanical_ports': 'mounts'}.get(value.collection, value.collection)
                if value.instance_path or value.object_id not in collections.get(collection, {}):
                    raise ValueError(f'Unresolved local reference: {value.key()}')
            elif isinstance(value, BaseModel):
                for key in type(value).model_fields:
                    visit(getattr(value, key))
            elif isinstance(value, dict):
                for item in value.values(): visit(item)
            elif isinstance(value, (tuple, list)):
                for item in value: visit(item)
        visit(self.model)
        for item in (*self.model.geometry.envelopes.values(), *self.model.geometry.visual_assets.values(),
                     *self.model.mounts.ports.values()):
            if item.body_ref not in collections['bodies']:
                raise ValueError('Unresolved geometry/mount body')
        if self.model.geometry.root_body and self.model.geometry.root_body not in collections['bodies']:
            raise ValueError('Unresolved root body')
        for terminal in collections['terminals'].values():
            if terminal.body_ref and terminal.body_ref not in collections['bodies']:
                raise ValueError('Unresolved terminal body')
            if terminal.reference_terminal and terminal.reference_terminal not in collections['terminals']:
                raise ValueError('Unresolved terminal reference')
        wiring = getattr(self.model, 'wiring', None)
        if wiring:
            for connector in wiring.connectors.values():
                if connector.body_ref not in collections['bodies'] or set(connector.pin_map.values()) - collections['terminals'].keys():
                    raise ValueError('Unresolved connector body/pin')
        for interface in collections['interfaces'].values():
            terminals = (*interface.terminal_bindings.values(), *interface.supply_terminals)
            if interface.reference_terminal: terminals = (*terminals, interface.reference_terminal)
            if set(terminals) - collections['terminals'].keys() or interface.behavior_ref not in collections['behaviors']:
                raise ValueError('Unresolved electronic interface binding')
        for port in collections['material_ports'].values():
            if port.body_ref not in collections['bodies']: raise ValueError('Unresolved material port body')
        for path in collections['material_paths'].values():
            if path.inlet_port not in collections['material_ports'] or path.outlet_port not in collections['material_ports']:
                raise ValueError('Unresolved internal material path')
        return self

    def collections(self):
        model = self.model
        motion = getattr(model, 'motion', None)
        material = getattr(model, 'material', None)
        wiring = getattr(model, 'electrical', None) or getattr(model, 'wiring', None)
        joints = dict(motion.joints) if motion else {}
        if hasattr(model, 'joint'): joints['axis'] = model.joint
        behaviors = dict(getattr(model, 'functions', {}))
        behaviors.update(getattr(model, 'control_functions', {}))
        behaviors.update(getattr(model, 'channels', {}))
        if getattr(model, 'control', None): behaviors['control'] = model.control
        for field in ('text', 'frequency'):
            if hasattr(model, field): behaviors[field] = getattr(model, field)
        return {'bodies': model.geometry.bodies, 'envelopes': model.geometry.envelopes,
                'mounts': model.mounts.ports, 'joints': joints,
                'visual_assets': model.geometry.visual_assets,
                'transmissions': motion.transmissions if motion else {},
                'terminals': wiring.terminals if wiring else {},
                'interfaces': getattr(model, 'interfaces', {}),
                'material_ports': material.ports if material else {},
                'material_paths': material.paths if material else {},
                'information_ports': self.information_ports, 'energy_ports': self.energy_ports,
                'behaviors': behaviors, 'sensors': getattr(model, 'measurements', getattr(model, 'controls', {}))}

class Price(Contract):
    amount: float = Field(ge=0)
    currency: str = Field(pattern=r'^[A-Z]{3}$')

class Offer(Contract):
    supplier: str
    sku: str
    url: str | None = None
    price: Price | None = None
    availability: str | None = None
    observed_at: str
    source_id: Id

class CatalogEntry(Contract):
    ref: ElementRef
    catalog_revision: Revision = 1
    status: Literal['active', 'deprecated', 'withdrawn'] = 'active'
    replacement_refs: tuple[ElementRef, ...] = ()
    offers: tuple[Offer, ...] = ()
    sources: dict[Id, Source] = Field(default_factory=dict)

    @model_validator(mode='after')
    def offer_sources(self):
        if any(o.source_id not in self.sources for o in self.offers):
            raise ValueError('Unknown offer source')
        return self

class NumericFilter(Contract):
    parameter_code: Id
    relation: Literal['within', 'overlaps', 'contains']
    min: Quantity
    max: Quantity

    @model_validator(mode='after')
    def range(self):
        Range(min=self.min, max=self.max)
        return self

class ElementQuery(Contract):
    text: str = Field(default='', max_length=1000)
    categories: tuple[Category, ...] = ()
    capability_codes: tuple[str, ...] = ()
    protocols: tuple[str, ...] = ()
    numeric: tuple[NumericFilter, ...] = ()
    include_assumptions: bool = False
    include_deprecated: bool = False
    version_policy: Literal['latest_active', 'all'] = 'latest_active'
    limit: int = Field(default=20, ge=1, le=100)
    cursor: str | None = Field(default=None, max_length=4000)

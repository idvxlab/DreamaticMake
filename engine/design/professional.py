"""Design package v3: one pinned source, four derived views, no approvals."""
import json
from typing import Literal
from pydantic import Field, field_validator, model_validator
from element.base.contract import Contract, Id, Sha256
from element.base.frame import Pose
from element.schema.library import ElementRef
from element.schema.professional import ElementDefinitionV2, Joint, OccurrenceRef
from element.io.records import element_ref, record_hash
from .authoring import LinkRef, PinRef, ProjectJoint, occurrence


class Location(Contract):
    kind: Literal['custom', 'library']
    path: str


class Instance(Contract):
    element_ref: ElementRef
    location: Location
    name: str | None = None
    refdes: str | None = None
    config: dict = Field(default_factory=dict)


class ElementIndex(Contract):
    record_kind: Literal['project_elements'] = 'project_elements'
    schema_version: Literal['2'] = '2'
    instances: dict[Id, Instance] = Field(min_length=1, max_length=64)


class Record(Contract):
    record_id: Id
    revision: int = Field(ge=1, default=1)
    schema_version: Literal['3.0.0-draft'] = '3.0.0-draft'


class Placement(Contract):
    relative_to: LinkRef
    origin: Pose = Pose()


class Structure(Record):
    frame_id: Id = 'world'
    root_placements: dict[str, Pose] = Field(default_factory=dict)
    placements: dict[str, Placement] = Field(default_factory=dict)
    # Source-only shared metadata is materialized into each connection before
    # hashing, projection or execution. Explicit per-connection values win.
    mount_defaults: dict[Literal['hardware', 'status', 'source_record'], str] = Field(default_factory=dict, exclude=True)
    mount_connections: dict[Id, dict] = Field(default_factory=dict)
    display_overrides: dict = Field(default_factory=dict)

    @field_validator('mount_connections', mode='before')
    @classmethod
    def expand_mounts(cls, value, info):
        if not isinstance(value, dict): return value
        result = {}
        for id, item in value.items():
            if not isinstance(item, dict): raise ValueError('Mount connection must be an object')
            item = {**info.data.get('mount_defaults', {}), **item}
            for end in ('a', 'b'):
                if end in item:
                    ref = OccurrenceRef.model_validate_json(json.dumps(occurrence(item[end], 'mechanical', 'mounts')))
                    item[end] = ref.model_dump(mode='json')
            result[id] = item
        return result


class Motion(Record):
    joints: dict[str, ProjectJoint] = Field(default_factory=dict)
    initial_positions: dict[str, float] = Field(default_factory=dict)
    configurations: dict[str, dict] = Field(default_factory=dict)
    couplings: dict[str, dict] = Field(default_factory=dict)
    drives: dict[str, dict] = Field(default_factory=dict)
    collision_policy: dict = Field(default_factory=dict)


class Net(Contract):
    name: str
    kind: Literal['signal', 'power', 'ground'] = 'signal'
    nodes: tuple[PinRef, ...] = Field(min_length=2, max_length=128)
    reference_net: Id | None = None
    evidence_refs: tuple[Id, ...] = ()


class NetInput(Net):
    # Within Electrical.nets, an omitted name is inherited from the map key.
    name: str = ''


class UnconnectedPin(Contract):
    pin: PinRef
    intentional: bool
    reason: str = Field(min_length=1)


class UnconnectedGroup(Contract):
    pins: tuple[PinRef, ...] = Field(min_length=1, max_length=128)
    intentional: bool
    reason: str = Field(min_length=1)


class Electrical(Record):
    symbols: dict[Id, dict] = Field(default_factory=dict)
    nets: dict[Id, Net] = Field(default_factory=dict)
    unconnected: tuple[dict, ...] = ()
    buses: dict[Id, dict] = Field(default_factory=dict)
    pin_config: dict[str, dict] = Field(default_factory=dict)
    interface_config: dict[str, dict] = Field(default_factory=dict)
    schematic: dict = Field(default_factory=dict)

    @field_validator('nets', mode='before', json_schema_input_type=dict[Id, NetInput])
    @classmethod
    def net_names(cls, value):
        if not isinstance(value, dict): return value
        return {id: Net.model_validate_json(json.dumps({'name': id, **net}))
                if isinstance(net, dict) else net for id, net in value.items()}

    @field_validator('unconnected', mode='before', json_schema_input_type=tuple[UnconnectedPin | UnconnectedGroup, ...])
    @classmethod
    def expand_unconnected(cls, value):
        if not isinstance(value, (list, tuple)): return value
        result = []
        for item in value:
            if not isinstance(item, dict) or not ('pins' in item or 'pin' in item):
                raise ValueError('Unconnected declaration requires pin or pins')
            if 'pins' in item:
                group = UnconnectedGroup.model_validate_json(json.dumps(item))
                pins = [pin.model_dump(mode='json') for pin in group.pins]
                metadata = {k: v for k, v in item.items() if k != 'pins'}
            else:
                pins = [item['pin']]
                metadata = {k: v for k, v in item.items() if k != 'pin'}
            for pin in pins:
                ref = OccurrenceRef.model_validate_json(json.dumps(occurrence(pin, 'electrical', 'pins')))
                result.append({'pin': ref.model_dump(mode='json'), **metadata})
        return tuple(result)


class Logic(Record):
    units: dict[Id, dict] = Field(default_factory=dict)
    bindings: dict[Id, dict] = Field(default_factory=dict)
    hardware_bindings: dict[Id, dict] = Field(default_factory=dict)
    software_projects: dict[Id, dict] = Field(default_factory=dict)
    scenarios: tuple[str, ...] = ()


class RecordPin(Contract):
    record_id: Id
    revision: int = Field(ge=1)
    content_hash: Sha256


class DesignFiles(Contract):
    structure: str = 'design/structure.json'
    motion: str = 'design/motion.json'
    circuit_logic: str = 'design/circuit-logic.json'
    logic: str = 'design/logic.json'


class Manifest(Contract):
    record_kind: Literal['project_manifest'] = 'project_manifest'
    project_version: Literal[3] = 3
    schema_version: Literal['3.0.0-draft'] = '3.0.0-draft'
    id: Id
    title: str
    summary: str = ''
    element_index: str = 'element/index.json'
    element_index_hash: Sha256
    design: DesignFiles = DesignFiles()
    record_pins: dict[Id, RecordPin]
    documents: str = 'doc/index.json'


def key(ref):
    return f'{ref.instance}/{ref.collection}/{ref.id}'


class DesignPackageV3(Contract):
    record_kind: Literal['design_package'] = 'design_package'
    schema_version: Literal['3.0.0-draft'] = '3.0.0-draft'
    manifest: Manifest
    index: ElementIndex
    elements: dict[str, ElementDefinitionV2]
    structure: Structure
    motion: Motion
    circuit_logic: Electrical
    logic: Logic
    asset_hashes: dict[str, Sha256] = Field(default_factory=dict)

    @model_validator(mode='after')
    def pins_and_references(self):
        if record_hash(self.index, 'project-index-v3') != self.manifest.element_index_hash:
            raise ValueError('Element index hash differs from pin')
        if set(self.manifest.record_pins) != {'structure', 'motion', 'circuit_logic', 'logic'}:
            raise ValueError('Four domain records must be pinned')
        for field in self.manifest.record_pins:
            record, pin = getattr(self, field), self.manifest.record_pins[field]
            if (record.record_id, record.revision, record_hash(record, 'design-record-v3')) != (pin.record_id, pin.revision, pin.content_hash):
                raise ValueError('Domain record differs from pin: ' + field)
        for id, instance in self.index.instances.items():
            definition = self.elements.get(instance.element_ref.content_hash)
            if definition is None or element_ref(definition) != instance.element_ref:
                raise ValueError('Element pin is unavailable: ' + id)
            for param, value in instance.config.items():
                spec = definition.parameters.get(param)
                if not spec or not spec.get('configurable', False):
                    raise ValueError('Instance cannot override intrinsic parameters: ' + param)
        pins = self.occurrences('electrical', 'pins')
        used = set()
        for net in self.circuit_logic.nets.values():
            for ref in net.nodes:
                if ref.domain != 'electrical' or ref.collection != 'pins' or key(ref) not in pins:
                    raise ValueError('Unresolved net pin')
                if key(ref) in used: raise ValueError('Pin occurs more than once in electrical nets')
                used.add(key(ref))
        for bus in self.circuit_logic.buses.values():
            if set(bus.get('signals', {}).values()) - self.circuit_logic.nets.keys():
                raise ValueError('Unresolved bus net')
            interfaces = self.occurrences('electrical', 'interfaces')
            if any(ref not in interfaces for ref in bus.get('participants', [])):
                raise ValueError('Unresolved bus interface')
        for item in self.circuit_logic.unconnected:
            ref = OccurrenceRef.model_validate_json(json.dumps(item['pin']))
            if ref.domain != 'electrical' or key(ref) not in pins or key(ref) in used:
                raise ValueError('Invalid unconnected pin declaration')
            if not isinstance(item.get('intentional'), bool) or not item.get('reason'):
                raise ValueError('Unconnected pin requires intention and reason')
            used.add(key(ref))
        if set(self.circuit_logic.symbols) - self.index.instances.keys(): raise ValueError('Unknown symbol instance')
        refdes = [s['refdes'] for s in self.circuit_logic.symbols.values()]
        if len(set(refdes)) != len(refdes): raise ValueError('Duplicate symbol reference designator')
        for unit in self.logic.units.values():
            if unit.get('owner_instance') and unit['owner_instance'] not in self.index.instances:
                raise ValueError('Unknown behavior unit owner')
            from element.schema.professional import BehaviorPort
            for port in unit.get('ports', {}).values(): BehaviorPort.model_validate_json(json.dumps(port))
        for id, software in self.logic.software_projects.items():
            owner = software['owner_instance']
            if owner not in self.index.instances or self.definition(owner).category != 'controller':
                raise ValueError('Software owner must be a controller')
        self.effective_joints()  # tree, endpoints, duplicate parents and cycles
        return self

    @property
    def snapshot_id(self):
        return record_hash(self, 'design-package-v3')

    def definition(self, instance):
        return self.elements[self.index.instances[instance].element_ref.content_hash]

    def occurrences(self, domain, collection):
        return {f'{id}/{collection}/{local}': value for id in self.index.instances
                for local, value in getattr(getattr(self.definition(id), domain), collection).items()}

    def effective_joints(self):
        joints = {}
        for instance in self.index.instances:
            for id, j in self.definition(instance).mechanical.joints.items():
                d = j.model_dump(mode='json')
                for end in ('parent', 'child'): d[end]['instance'] = instance
                joints[f'{instance}/joints/{id}'] = Joint.model_validate_json(json.dumps(d))
        for id, joint in self.motion.joints.items():
            if id in joints: raise ValueError('Project cannot override intrinsic joints')
            if not all(isinstance(r, OccurrenceRef) for r in (joint.parent, joint.child)):
                raise ValueError('Cross-instance joints require occurrence references')
            joints[id] = joint
        links, parents = self.occurrences('mechanical', 'links'), {}
        for id, joint in joints.items():
            p, c = key(joint.parent), key(joint.child)
            if p not in links or c not in links: raise ValueError('Unresolved joint link: ' + id)
            if c in parents: raise ValueError('Duplicate parent for link: ' + c)
            parents[c] = p
        for c in parents:
            seen, cursor = set(), c
            while cursor in parents:
                if cursor in seen: raise ValueError('Motion tree contains a cycle')
                seen.add(cursor)
                cursor = parents[cursor]
        authority = set(parents)
        for ref in (*self.structure.root_placements, *self.structure.placements):
            if ref not in links: raise ValueError('Placement references unknown link')
            if ref in authority: raise ValueError('Link has multiple pose authorities: ' + ref)
            authority.add(ref)
        return joints


def parse_package(value):
    return DesignPackageV3.model_validate_json(json.dumps(value, allow_nan=False))


def resolved_poses(package, positions=None):
    """Native FK retains both anchor frames and fails on missing roots."""
    p = package
    joints = p.effective_joints()
    poses = dict(p.structure.root_placements)
    pending = {key(j.child): (id, j) for id, j in joints.items()}
    static = dict(p.structure.placements)
    q = {f'{i}/joints/{j}': v for i in p.index.instances for j, v in p.definition(i).mechanical.initial_positions.items()}
    q.update(p.motion.initial_positions)
    q.update(positions or {})
    for id in q:
        if id not in joints or joints[id].type == 'fixed': raise ValueError('Initial position references no moving joint: ' + id)
    while pending or static:
        progressed = False
        for child, (id, joint) in list(pending.items()):
            if key(joint.parent) not in poses: continue
            if joint.type != 'fixed' and id not in q: raise ValueError('Missing joint initial position: ' + id)
            value = q.get(id, 0.)
            limit = joint.limit
            if limit and ((limit.lower is not None and value < limit.lower) or (limit.upper is not None and value > limit.upper)):
                raise ValueError('Joint position exceeds limit: ' + id)
            transform = Pose()
            if joint.type == 'prismatic': transform = Pose(translation_m=tuple(value * v for v in joint.axis))
            elif joint.type != 'fixed': transform = Pose.axis_angle(joint.axis, value)
            poses[child] = poses[key(joint.parent)].compose(joint.origin).compose(transform).compose(joint.child_origin.inverse())
            del pending[child]
            progressed = True
        for child, placement in list(static.items()):
            if key(placement.relative_to) not in poses: continue
            poses[child] = poses[key(placement.relative_to)].compose(placement.origin)
            del static[child]
            progressed = True
        if not progressed: raise ValueError('Missing root placement or cyclic static placement')
    missing = p.occurrences('mechanical', 'links').keys() - poses.keys()
    if missing: raise ValueError('Missing root placement: ' + ', '.join(sorted(missing)))
    return poses


def layout_project(package):
    """Explicit transitional v2 projection. This is never written back to source."""
    from engine.layout_project import LayoutProject
    p = package
    poses = resolved_poses(p)
    elements, sources = {}, {}
    for id, instance in p.index.instances.items():
        elements[id] = p.definition(id).model.model_dump(mode='json')
        sources[id] = {**instance.location.model_dump(mode='json'), 'ref': instance.element_ref.model_dump(mode='json')}
    for software in p.logic.software_projects.values():
        link = {k: software[k] for k in ('relative_path', 'language', 'entrypoint')}
        elements[software['owner_instance']]['software'] = link
        sources[software['owner_instance']]['software'] = link
    # The legacy compositor uses one placement per instance; overwrite the final
    # link poses in layout_draft below so multi-link static placement stays exact.
    motion = {'joints': {}, 'configuration': {}}
    for id, j in p.motion.joints.items():
        limit = j.limit
        motion['joints'][id] = {'kind': j.type, 'parent': key(j.parent).replace('/links/', '/bodies/'),
            'child': key(j.child).replace('/links/', '/bodies/'), 'parent_anchor': j.origin.model_dump(mode='json'),
            'child_anchor': j.child_origin.model_dump(mode='json'), 'axis': j.axis,
            'lower': limit.lower if limit else None, 'upper': limit.upper if limit else None,
            'initial': p.motion.initial_positions.get(id)}
    for id, q in p.motion.initial_positions.items():
        if id not in p.motion.joints: motion['configuration'][id.replace('/joints/', '/')] = {'initial': q}
    return LayoutProject.model_validate_json(json.dumps({'elements': elements, 'element_sources': sources,
        'structure': {'placements': {id: poses[f'{id}/links/{p.definition(id).mechanical.root_link}'].model_dump(mode='json')
            for id in p.index.instances if p.definition(id).mechanical.root_link}}, 'motion': motion,
        'circuit_logic': {'nets': {id: {'kind': net.kind, 'members': [f'{r.instance}/{r.id}' for r in net.nodes]}
            for id, net in p.circuit_logic.nets.items()}}})).model_dump(mode='json')


def project_views(p):
    from engine.layout import import_layout, project_layout
    draft = import_layout(layout_project(p))
    poses = resolved_poses(p)
    for ref, pose in poses.items(): draft['bodies'][ref.replace('/links/', '/bodies/')]['pose'] = pose.model_dump(mode='json')
    old = project_layout(draft)
    refs = {f'{i}/{domain}/{collection}/{id}': {'instance': i, 'domain': domain, 'collection': collection, 'id': id}
        for i in p.index.instances for domain, collection in (('mechanical', 'links'), ('electrical', 'pins'))
        for id in getattr(getattr(p.definition(i), domain), collection)}
    source_map = {ref: {'element_ref': p.index.instances[value['instance']].element_ref.model_dump(mode='json'),
                        'pointer': f"/{value['domain']}/{value['collection']}/{value['id']}"} for ref, value in refs.items()}
    for collection, record, file in (('joints', p.motion, 'motion'), ('nets', p.circuit_logic, 'circuit_logic'), ('units', p.logic, 'logic')):
        for id in getattr(record, collection):
            ref = f'{record.record_id}/{collection}/{id}'
            refs[ref] = {'record_id': record.record_id, 'collection': collection, 'id': id}
            source_map[ref] = {'record_id': record.record_id, 'revision': record.revision,
                'path': getattr(p.manifest.design, file), 'pointer': f"/{collection}/{id.replace('~','~0').replace('/','~1')}"}
    for i in p.index.instances:
        for id in p.definition(i).mechanical.joints:
            ref = f'{i}/mechanical/joints/{id}'
            refs[ref] = {'instance': i, 'domain': 'mechanical', 'collection': 'joints', 'id': id}
            source_map[ref] = {'element_ref': p.index.instances[i].element_ref.model_dump(mode='json'),
                'pointer': f'/mechanical/joints/{id}'}
    common = {'snapshot_id': p.snapshot_id, 'object_refs': refs, 'source_map': source_map,
              'capabilities': ['kinematics', 'electrical_rules'], 'diagnostics': old['diagnostics']}
    return {'projection_version': 2, **common, 'scene': {**old['scene'], **common},
        'bom': bill_of_materials(p),
        'motion': {**common, 'joints': {id: j.model_dump(mode='json') for id, j in p.effective_joints().items()}},
        'schematic': {**common, **p.circuit_logic.model_dump(mode='json')},
        'logic': {**common, **p.logic.model_dump(mode='json')}}


def bill_of_materials(p):
    """Count occurrences by the full immutable pin, excluding export-only roots."""
    groups = {}
    for id, instance in p.index.instances.items():
        hash = instance.element_ref.content_hash
        group = groups.setdefault(hash, {'element_ref': instance.element_ref.model_dump(mode='json'), 'instances': [], 'quantity': 0})
        group['instances'].append(id)
        group['quantity'] += 1
    return list(groups.values())

"""Resolve exactly one pinned snapshot, retaining incomplete authoring references."""
import json
from pydantic import BaseModel
from element.io.records import element_ref
from engine.design.contracts import *
from engine.design.io import parse_package, record_ref, snapshot_id

COLLECTIONS = {
    'analysis': ('conclusions',), 'function': ('inputs', 'outputs', 'criteria'),
    'selection': ('requirements', 'candidates', 'instances'),
    'structure': ('bodies', 'geometry', 'mounts', 'connections'),
    'motion': ('joints', 'transmissions', 'drives'),
    'circuit_energy': ('terminals', 'nets', 'energy_ports', 'transfers'),
    'flow': ('ports', 'edges', 'required_paths'),
    'logic': ('interfaces', 'inputs', 'outputs', 'units', 'bindings', 'unit_inputs', 'unit_outputs'),
}

def instances(selection):
    usage = selection.usage
    if usage.kind == 'discrete': return usage.instances
    return {'bulk': usage.instance} if usage.instance else {}

def walk(value, path=''):
    yield path, value
    if isinstance(value, BaseModel):
        for name in type(value).model_fields:
            yield from walk(getattr(value, name), f'{path}.{name}' if path else name)
    elif isinstance(value, dict):
        for name, child in value.items(): yield from walk(child, f'{path}.{name}')
    elif isinstance(value, (tuple, list)):
        for i, child in enumerate(value): yield from walk(child, f'{path}.{i}')

class ResolvedDesign:
    def __init__(self, package, library=None):
        self.package = parse_package(package)
        self.snapshot_id = snapshot_id(self.package.manifest)
        self.records = {}
        self.objects = {}
        self.diagnostics = []
        self.reverse = {}
        self.elements = {}
        self.instance_elements = {}
        for definition in self.package.elements:
            ref = element_ref(definition)
            key = (ref.library_id, ref.element_id, ref.revision)
            if key in self.elements: raise ValueError('Duplicate embedded element identity/version')
            self.elements[key] = definition
        pins = {r.record_id: (kind, r) for kind, refs in self.package.manifest.layers.items() for r in refs}
        for record in self.package.records:
            if record.record_id in self.records: raise ValueError('Duplicate record ID')
            if record.design_id != self.package.manifest.design_id: raise ValueError('Cross-design record')
            if record.record_id not in pins: raise ValueError('Unpinned record')
            kind, pin = pins[record.record_id]
            if record.kind != kind or record_ref(record) != pin: raise ValueError('Record pin/hash mismatch')
            self.records[record.record_id] = record
            self.objects[record.record_id] = record
            for collection in COLLECTIONS[record.kind]:
                if collection == 'instances': values = instances(record.data)
                elif collection in ('unit_inputs', 'unit_outputs'):
                    values = {f'{u}:{p}': value for u, unit in record.data.units.items()
                              for p, value in getattr(unit, collection.removeprefix('unit_')).items()}
                else: values = getattr(record.data, collection)
                for name, value in values.items():
                    self.objects[f'{record.record_id}/{collection}/{name}'] = value
        if set(self.records) != set(pins): raise ValueError('Pinned record is missing')
        if len(self.objects) > 10000: raise ValueError('Design object budget exceeded')
        for record in self.records.values():
            for path, value in walk(record):
                if isinstance(value, ObjectRef):
                    if value.key() not in self.objects:
                        self.issue('reference.unresolved', 'Unresolved design reference', value, path=path)
                    self.reverse.setdefault(value.key(), []).append({'record_id': record.record_id, 'field_path': path})
                if isinstance(value, BaseModel) and hasattr(value, 'evidence_ids'):
                    if set(value.evidence_ids) - record.evidence.keys():
                        self.issue('evidence.unresolved', 'Unknown evidence ID', ObjectRef(record_id=record.record_id), path=path)
            for evidence in record.evidence.values():
                if set(evidence.source_ids) - record.sources.keys():
                    self.issue('evidence.source', 'Unknown evidence source', ObjectRef(record_id=record.record_id))
            if record.kind == 'selection':
                self._selection(record, library)
        self._semantics()

    def issue(self, code, message, *refs, path=None, severity='error'):
        self.diagnostics.append(Diagnostic(code=code, severity=severity, message=message, refs=refs, field_path=path))

    def get(self, ref, expected=None):
        value = self.objects.get(ref.key()) if ref else None
        if value is not None and expected and not isinstance(value, expected):
            self.issue('reference.type', 'Reference targets the wrong object type', ref)
            return None
        return value

    def _selection(self, record, library):
        data = record.data
        record_target = ObjectRef(record_id=record.record_id)
        for candidate in data.candidates.values():
            if set(candidate.assessments) - data.requirements.keys():
                self.issue('selection.assessment', 'Assessment references an absent requirement', record_target)
            ref = candidate.element_ref
            key = (ref.library_id, ref.element_id, ref.revision)
            definition = self.elements.get(key)
            if definition is None and library:
                try: definition = library.get(ref)
                except ValueError:
                    self.issue('element.unavailable', 'Pinned element could not be loaded', record_target)
            if definition is not None:
                if element_ref(definition) != ref: raise ValueError('Element pin/hash mismatch')
                self.elements[key] = definition
        chosen = data.candidates.get(data.chosen_candidate_id)
        if not chosen:
            self.issue('selection.unselected', 'Selection has no valid chosen candidate', record_target, severity='warning')
        definition = self.elements.get((chosen.element_ref.library_id, chosen.element_ref.element_id,
                                      chosen.element_ref.revision)) if chosen else None
        if chosen and definition is None:
            self.issue('element.unavailable', 'Selected pinned definition is unavailable', record_target)
        if data.usage.kind == 'discrete' and data.usage.planned_count != len(data.usage.instances):
            self.issue('selection.count', 'Planned count differs from modeled occurrences', record_target)
        for name, instance in instances(data).items():
            key = f'{record.record_id}/instances/{name}'
            if definition: self.instance_elements[key] = definition
            for parameter, value in instance.parameter_bindings.items():
                p = definition.parameters.get(parameter) if definition else None
                if not p or not p.configurable:
                    self.issue('parameter.unavailable', 'Parameter is absent or not configurable', ObjectRef(record_id=record.record_id, collection='instances', object_id=name))
                elif (p.value and p.value.dimension != value.dimension) or (p.limits and not p.limits.contains(value)):
                    self.issue('parameter.range', 'Parameter binding has incompatible dimension/range', record_target)

    def _cycles(self, graph, name):
        done = set()
        for start in graph:
            chain = set()
            current = start
            while current in graph and current not in done:
                if current in chain:
                    self.issue(f'{name}.cycle', 'Cyclic parent relation', ObjectRef(record_id=start.split('/')[0]))
                    break
                chain.add(current)
                current = graph[current]
            done.update(chain)

    def _semantics(self):
        parents = {'structure': {}, 'instance': {}, 'function': {}}
        net_members = {}
        for key, value in self.objects.items():
            owner = key.split('/')[0]
            if isinstance(value, Body):
                self.get(value.instance_ref, Instance)
                if value.parent_body:
                    self.get(value.parent_body, Body)
                    parents['structure'][key] = value.parent_body.key()
            elif isinstance(value, Instance) and value.parent_instance:
                self.get(value.parent_instance, Instance)
                parents['instance'][key] = value.parent_instance.key()
            elif isinstance(value, FunctionRecord) and value.data.parent:
                self.get(value.data.parent, FunctionRecord)
                parents['function'][key] = value.data.parent.key()
            elif isinstance(value, (Geometry, Mount)):
                self.get(value.body_ref, Body)
            elif isinstance(value, StructureConnection):
                self.get(value.a, Mount); self.get(value.b, Mount)
                if (value.kind == 'joint') != bool(value.joint_ref):
                    self.issue('mount.joint', 'Joint connection requires exactly one joint binding', ObjectRef(record_id=owner))
                if value.joint_ref: self.get(value.joint_ref, Joint)
            elif isinstance(value, Joint):
                self.get(value.parent_body, Body); self.get(value.child_body, Body)
                if value.kind != 'fixed' and (value.axis is None or value.initial is None):
                    self.issue('motion.incomplete', 'Moving joint requires axis and initial value', ObjectRef(record_id=owner), severity='warning')
            elif isinstance(value, Transmission):
                self.get(value.driver, Joint); self.get(value.follower, Joint)
            elif isinstance(value, Drive):
                joint = self.get(value.joint_ref, Joint)
                if joint:
                    dimension = ('length' if joint.kind == 'prismatic' else 'angle') if value.mode == 'position' else ('speed' if joint.kind == 'prismatic' else 'angular_speed')
                    if value.command and value.command.dimension != dimension:
                        self.issue('motion.command_unit', 'Drive command has incompatible dimension', value.joint_ref)
                    if value.speed_limit and value.speed_limit.dimension != ('speed' if joint.kind == 'prismatic' else 'angular_speed'):
                        self.issue('motion.speed_unit', 'Speed limit has incompatible dimension', value.joint_ref)
            elif isinstance(value, Terminal):
                self.get(value.instance_ref, Instance)
                if value.body_ref: self.get(value.body_ref, Body)
                if value.spec.reference_terminal: self.get(value.spec.reference_terminal, Terminal)
            elif isinstance(value, Net):
                if len({r.key() for r in value.members}) < 2 or len({r.key() for r in value.members}) != len(value.members):
                    self.issue('net.members', 'Net requires at least two distinct terminals', ObjectRef(record_id=owner))
                for ref in value.members:
                    self.get(ref, Terminal)
                    if ref.key() in net_members:
                        self.issue('net.multiple', 'Terminal belongs to more than one net', ref)
                    net_members[ref.key()] = key
                if value.reference_net: self.get(value.reference_net, Net)
            elif isinstance(value, EnergyTransfer):
                for ref in (value.from_, value.to):
                    target = self.get(ref, Terminal if value.carrier == 'electrical' else DesignEnergyPort)
                    if isinstance(target, DesignEnergyPort) and target.spec.carrier != value.carrier:
                        self.issue('energy.carrier', 'Energy carrier mismatch', ref)
                for ref in value.via: self.get(ref, Net if value.carrier == 'electrical' else None)
            elif isinstance(value, FlowPortBase):
                self.get(value.instance_ref, Instance)
                if value.body_ref: self.get(value.body_ref, Body)
                if isinstance(value, InformationPort) and value.interface_ref: self.get(value.interface_ref, LogicInterface)
            elif isinstance(value, FlowEdge):
                refs = (value.from_, *value.to)
                ports = [self.get(ref, FlowPortBase) for ref in refs]
                if all(ports):
                    if any(p.domain != value.domain for p in ports): self.issue('flow.domain', 'Flow domains differ', *refs)
                    if ports[0].direction == 'in' or any(p.direction == 'out' for p in ports[1:]): self.issue('flow.direction', 'Flow direction mismatch', *refs)
                    if value.scope == 'internal' and len({p.instance_ref.key() for p in ports}) != 1: self.issue('flow.internal', 'Internal flow crosses instance boundaries', *refs)
                    types = {str(p.type) if isinstance(p, InformationPort) else p.medium for p in ports} - {None, 'None'}
                    if len(types) > 1: self.issue('flow.type', 'Flow medium/data types differ', *refs)
            elif isinstance(value, RequiredPath):
                for ref in (value.from_, value.to):
                    port = self.get(ref, FlowPortBase)
                    if port and port.domain != value.domain: self.issue('flow.path_domain', 'Path endpoint domain differs', ref)
            elif isinstance(value, DesignEnergyPort):
                self.get(value.instance_ref, Instance)
                if value.spec.frame: self.get(value.spec.frame.body_ref, Body)
            elif isinstance(value, LogicInterface):
                self.get(value.instance_ref, Instance)
                for ref in value.terminal_bindings.values(): self.get(ref, Terminal)
                for ref in value.information_port_refs: self.get(ref, InformationPort)
            elif isinstance(value, UnitBase):
                if value.instance_ref: self.get(value.instance_ref, Instance)
                if isinstance(value, DeclarativeUnit):
                    from element.interfaces.behavior import BehaviorSpec, InputBinding
                    from element.interfaces.behavior_validation import check_behavior
                    try:
                        behavior = BehaviorSpec.model_validate_json(json.dumps({
                            **value.behavior.model_dump(mode='json'),
                            'inputs': {name: InputBinding(kind='fixture', channel=name).model_dump(mode='json') for name in value.inputs}}))
                        problems = check_behavior(behavior)
                    except ValueError as exc: problems = [str(exc)]
                    if problems: self.issue('logic.behavior', '; '.join(problems), ObjectRef(record_id=owner))
                    for ref in value.supply_terminal_refs: self.get(ref, Terminal)
            elif isinstance(value, LogicRecord):
                d = value.data
                if len(d.execution_order) != len(set(d.execution_order)) or set(d.execution_order) != set(d.units):
                    self.issue('logic.order', 'Execution order must list each unit exactly once', ObjectRef(record_id=owner))
                targets = set()
                for binding in d.bindings.values():
                    if binding.target.key() in targets: self.issue('logic.multiple_writers', 'Input has multiple writers', binding.target)
                    targets.add(binding.target.key())
                    source, target = self.get(binding.source), self.get(binding.target)
                    value_types = (BooleanType, ScalarType, EnumType, EventType, StreamType)
                    if source is not None and not isinstance(source, (LogicPort, InformationPort, *value_types)):
                        self.issue('logic.source', 'Binding source must be an explicit output port', binding.source)
                    if target is not None and not isinstance(target, (LogicPort, InformationPort, Drive, *value_types)):
                        self.issue('logic.target', 'Binding target must be an explicit input port or drive', binding.target)
                    source_type = getattr(source, 'type', source)
                    target_type = getattr(target, 'type', target)
                    if isinstance(source_type, (BooleanType, ScalarType, EnumType, EventType, StreamType)) and isinstance(target_type, (BooleanType, ScalarType, EnumType, EventType, StreamType)) and source_type != target_type:
                        self.issue('logic.binding_type', 'Binding types differ; explicit conversion required', binding.source, binding.target)
        for name, graph in parents.items(): self._cycles(graph, name)
        for record in self.records.values():
            for _, value in walk(record):
                if isinstance(value, ElementBinding):
                    self.get(value.instance_ref, Instance)
                    definition = self.instance_elements.get(value.instance_ref.key())
                    if definition and value.local_ref.object_id not in definition.collections()[value.local_ref.collection]:
                        self.issue('element.local_ref', 'Element occurrence references an absent local object', value.instance_ref)
                if isinstance(value, SelectionData):
                    for ref in value.function_refs: self.get(ref, FunctionRecord)

def resolve_design(package, library=None):
    return ResolvedDesign(package, library)

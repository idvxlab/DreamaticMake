"""Cross-element mechanical, electrical, material, information and energy relations."""
import json
from typing import Literal
from pydantic import Field
from element.base.contract import Contract, Id
from engine.design.contracts import (ObjectRef, StructureConnection, Net, FlowEdge, RequiredPath,
    EnergyTransfer, StructureData, CircuitEnergyData, FlowData, Mount, Joint, Terminal,
    MaterialPort, InformationPort, DesignEnergyPort)
from process.contracts import ProcessRequest, ProcessResult
from process.base import DesignProcess, need
from process.proposal import updated_record


class ConnectionInput(Contract):
    structure_record_id: Id = 'structure'
    circuit_record_id: Id = 'circuit'
    flow_record_id: Id = 'flow'
    mechanical: dict[Id, StructureConnection] = Field(default_factory=dict)
    nets: dict[Id, Net] = Field(default_factory=dict)
    flows: dict[Id, FlowEdge] = Field(default_factory=dict)
    transfers: dict[Id, EnergyTransfer] = Field(default_factory=dict)
    required_paths: dict[Id, RequiredPath] = Field(default_factory=dict)


class ConnectionOutput(Contract):
    relation_refs: tuple[ObjectRef, ...]


class ConnectionRequest(ProcessRequest[ConnectionInput]):
    process_kind: Literal['connection'] = 'connection'


ConnectionResult = ProcessResult[ConnectionOutput]


def connection_groups(x):
    return ((x.structure_record_id, 'structure', StructureData, {'connections': x.mechanical}),
            (x.circuit_record_id, 'circuit_energy', CircuitEnergyData, {'nets': x.nets, 'transfers': x.transfers}),
            (x.flow_record_id, 'flow', FlowData, {'edges': x.flows, 'required_paths': x.required_paths}))


def inspect_connections(r, resolved):
    x, items = r.input, []
    active = [(rid, kind) for rid, kind, _, groups in connection_groups(x) if any(groups.values())]
    if not active:
        items.append(need('connections', 'Provide explicit connection endpoints'))
    if len({rid for rid, _ in active}) != len(active):
        items.append(need('record_ids', 'Different domains need distinct record IDs', state='conflict'))
    for rid, kind in active:
        if rid not in r.scope.write_record_ids:
            items.append(need('scope', 'Connection record is outside write scope', state='conflict'))
        if rid in resolved.records and resolved.records[rid].kind != kind:
            items.append(need('record_ids', 'Record layer mismatch', 'design', 'conflict'))
    def endpoint(ref, types):
        if not isinstance(resolved.objects.get(ref.key()), types):
            items.append(need('endpoints', 'Endpoint is unavailable or has the wrong domain', 'design', refs=(ref,)))
    for link in x.mechanical.values():
        endpoint(link.a, Mount); endpoint(link.b, Mount)
        if (link.kind == 'joint') != bool(link.joint_ref):
            items.append(need('joint_ref', 'Joint connection requires exactly one existing joint'))
        if link.joint_ref:
            endpoint(link.joint_ref, Joint)
    for net in x.nets.values():
        if len(set(net.members)) < 2 or len(set(net.members)) != len(net.members):
            items.append(need('nets', 'A new net needs at least two distinct terminals', state='conflict'))
        for ref in net.members:
            endpoint(ref, Terminal)
    for edge in x.flows.values():
        if edge.source is not None or edge.scope != 'external':
            items.append(need('flows', 'Internal paths belong to element definitions', state='conflict'))
        for ref in (edge.from_, *edge.to):
            endpoint(ref, MaterialPort if edge.domain == 'material' else InformationPort)
    for transfer in x.transfers.values():
        for ref in (transfer.from_, transfer.to):
            endpoint(ref, Terminal if transfer.carrier == 'electrical' else DesignEnergyPort)
    for path in x.required_paths.values():
        for ref in (path.from_, path.to):
            endpoint(ref, MaterialPort if path.domain == 'material' else InformationPort)
    return items


def connection_changes(r):
    changes, refs = [], []
    for rid, kind, model, groups in connection_groups(r.input):
        if not any(groups.values()):
            continue
        old = next((v for v in r.base.design.records if v.record_id == rid), None)
        raw = old.data.model_dump(mode='json') if old else model().model_dump(mode='json')
        for collection, values in groups.items():
            raw[collection].update({key: value.model_dump(mode='json') for key, value in values.items()})
            refs.extend(ObjectRef(record_id=rid, collection=collection, object_id=key) for key in values)
        data = model.model_validate_json(json.dumps(raw))
        changes.append(updated_record(r.base.design, rid, kind, data))
    return tuple(changes), tuple(refs)

class ConnectionProcess(DesignProcess[ConnectionRequest, ConnectionResult]):
    kind, title = 'connection', '元件连接'
    actions = ('connect',)
    request_model, result_model, output_model = ConnectionRequest, ConnectionResult, ConnectionOutput

    def _inspect(self, r, ctx, resolved):
        return inspect_connections(r, resolved)

    def _run(self, r, ctx):
        changes, refs = connection_changes(r)
        return self.finish(r, ctx, ConnectionOutput(relation_refs=refs), changes=changes)

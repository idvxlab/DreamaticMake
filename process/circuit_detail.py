"""Explicit wiring realization. Schematic/PCB generation needs an EDA backend."""
from typing import Literal
from pydantic import Field
from element.base.contract import Contract, Id
from engine.design.contracts import Net, ObjectRef
from process.contracts import ProcessRequest, ProcessResult
from process.base import DesignProcess, need
from process.connection import ConnectionInput, ConnectionRequest, inspect_connections, connection_changes


class CircuitDetailInput(Contract):
    action: Literal['realize', 'check'] = 'realize'
    level: Literal['wiring', 'schematic', 'pcb'] = 'wiring'
    circuit_record_id: Id = 'circuit'
    nets: dict[Id, Net] = Field(default_factory=dict)


class CircuitDetailOutput(Contract):
    net_refs: tuple[ObjectRef, ...]
    limitations: tuple[str, ...] = ('Connectivity is not analog/ERC/PCB or physical validation.',)


class CircuitDetailRequest(ProcessRequest[CircuitDetailInput]):
    process_kind: Literal['circuit_detail'] = 'circuit_detail'


CircuitDetailResult = ProcessResult[CircuitDetailOutput]


class CircuitDetailProcess(DesignProcess[CircuitDetailRequest, CircuitDetailResult]):
    kind, title = 'circuit_detail', '电路深化'
    actions = ('realize', 'check')
    request_model, result_model, output_model = CircuitDetailRequest, CircuitDetailResult, CircuitDetailOutput

    def _connection(self, r):
        return ConnectionRequest(request_id=r.request_id, base=r.base, scope=r.scope, intent=r.intent,
            requirement_refs=r.requirement_refs, requested_checks=r.requested_checks,
            input=ConnectionInput(circuit_record_id=r.input.circuit_record_id, nets=r.input.nets))

    def _inspect(self, r, ctx, resolved):
        if r.input.level != 'wiring':
            return [need('eda_executor', 'Schematic/PCB generation has no registered backend', 'executor', 'unsupported')]
        if r.input.action == 'check':
            return [need('electrical_executor', 'Electrical realization checks need an ERC/analog backend; use design connectivity checks for topology', 'executor', 'unsupported')]
        return inspect_connections(self._connection(r), resolved)

    def _run(self, r, ctx):
        changes, refs = connection_changes(self._connection(r))
        return self.finish(r, ctx, CircuitDetailOutput(net_refs=refs), changes=changes)

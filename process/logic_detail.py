"""Author explicit typed logic. Code/firmware execution is never implied by saving it."""
from typing import Literal
from element.base.contract import Contract, Id
from engine.design.contracts import LogicData, ObjectRef
from process.contracts import ProcessRequest, ProcessResult
from process.base import DesignProcess, need
from process.proposal import updated_record


class LogicDetailInput(Contract):
    action: Literal['author', 'bind', 'verify', 'build'] = 'author'
    logic_record_id: Id = 'logic'
    data: LogicData


class LogicDetailOutput(Contract):
    unit_refs: tuple[ObjectRef, ...]
    binding_refs: tuple[ObjectRef, ...]
    execution_order: tuple[Id, ...]
    limitations: tuple[str, ...] = ('Logic was authored and reference-checked, not executed or flashed.',)


class LogicDetailRequest(ProcessRequest[LogicDetailInput]):
    process_kind: Literal['logic_detail'] = 'logic_detail'


LogicDetailResult = ProcessResult[LogicDetailOutput]


class LogicDetailProcess(DesignProcess[LogicDetailRequest, LogicDetailResult]):
    kind, title = 'logic_detail', '逻辑深化'
    actions = ('author', 'bind', 'verify', 'build')
    request_model, result_model, output_model = LogicDetailRequest, LogicDetailResult, LogicDetailOutput

    def _inspect(self, r, ctx, resolved):
        if r.input.action in ('verify', 'build'):
            return [need('logic_executor', 'No logic execution or firmware toolchain is registered', 'executor', 'unsupported')]
        items = []
        rid = r.input.logic_record_id
        if rid not in r.scope.write_record_ids:
            items.append(need('scope', 'Logic record is outside write scope', state='conflict'))
        old = next((v for v in r.base.design.records if v.record_id == rid), None)
        if old and old.kind != 'logic':
            items.append(need('logic_record_id', 'Record layer mismatch', 'design', 'conflict'))
        if old:
            new = r.input.data
            for collection in ('interfaces', 'inputs', 'outputs', 'units', 'bindings'):
                if set(getattr(old.data, collection)) - set(getattr(new, collection)):
                    items.append(need('data', 'Explicit logic update must preserve existing IDs; deletion is not supported in this action', state='conflict'))
        return items

    def _run(self, r, ctx):
        x = r.input
        return self.finish(r, ctx, LogicDetailOutput(
            unit_refs=tuple(ObjectRef(record_id=x.logic_record_id, collection='units', object_id=k) for k in x.data.units),
            binding_refs=tuple(ObjectRef(record_id=x.logic_record_id, collection='bindings', object_id=k) for k in x.data.bindings),
            execution_order=x.data.execution_order), changes=(updated_record(r.base.design,
                x.logic_record_id, 'logic', x.data),))

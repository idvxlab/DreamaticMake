"""Common process contract: inspect information, then produce a reviewable proposal."""
from abc import ABC, abstractmethod
from uuid import uuid4
from typing import Generic, TypeVar
from engine.design import snapshot_id, check_design
from engine.design.contracts import Diagnostic, ObjectRef
from process.contracts import (InputNeed, InputRequirementReport, ProcessDescriptor,
    DesignProposal, CheckEvidence, ProcessRequest, ProcessResult)
from process.context import ProcessContext
from process.proposal import build_candidate


def need(key, description, source='caller', state='missing', refs=()):
    return InputNeed(key=key, description=description, source=source, state=state, subject_refs=tuple(refs))


RequestT = TypeVar('RequestT', bound=ProcessRequest)
ResultT = TypeVar('ResultT', bound=ProcessResult)


class DesignProcess(ABC, Generic[RequestT, ResultT]):
    request_model = None
    result_model = None
    output_model = None
    kind = ''
    title = ''
    actions = ()

    def describe(self) -> ProcessDescriptor:
        return ProcessDescriptor(process_kind=self.kind, title=self.title, actions=self.actions,
            input_schema=self.request_model.model_json_schema(),
            output_schema=self.result_model.model_json_schema())

    def _request(self, request):
        if hasattr(request, 'model_dump_json'):
            return self.request_model.model_validate_json(request.model_dump_json())
        from json import dumps
        return self.request_model.model_validate_json(dumps(request))

    def inspect(self, request: RequestT, context: ProcessContext | None = None) -> InputRequirementReport:
        request = self._request(request)
        context = context or ProcessContext()
        items = []
        if snapshot_id(request.base.design.manifest) != request.base.snapshot_id or (
            request.base.design.manifest.revision != request.base.expected_manifest_revision
        ):
            items.append(need('base', 'Input snapshot/revision does not match the design', 'design', 'conflict'))
        if context.cancelled():
            items.append(need('execution', 'Process cancelled', 'executor', 'conflict'))
        if not items:
            try:
                resolved = context.resolve(request.base.design)
            except ValueError:
                return InputRequirementReport(items=(need('base.design', 'Invalid or conflicting object pins', 'design', 'conflict'),))
            for ref in (*request.scope.read_refs, *request.requirement_refs):
                if ref.key() not in resolved.objects:
                    items.append(need('references', 'Requested object is unavailable', 'design', refs=(ref,)))
            items.extend(self._inspect(request, context, resolved))
            items.append(InputNeed(key='base.design', description='Fixed design snapshot is available',
                source='design', state='available', blocking=False))
        return InputRequirementReport(items=tuple(items))

    @abstractmethod
    def _inspect(self, request, context, resolved): ...

    @abstractmethod
    def _run(self, request, context): ...

    def run(self, request: RequestT, context: ProcessContext | None = None) -> ResultT:
        request = self._request(request)
        context = context or ProcessContext()
        report = self.inspect(request, context)
        if not report.ready:
            status = 'unsupported' if any(i.state == 'unsupported' for i in report.items) else 'needs_input'
            return self.result_model(request_id=request.request_id, process_kind=self.kind,
                base_snapshot_id=request.base.snapshot_id, status=status,
                missing_inputs=tuple(i for i in report.items if i.state not in ('available', 'assumed')))
        if context.cancelled():
            return self.result_model(request_id=request.request_id, process_kind=self.kind,
                base_snapshot_id=request.base.snapshot_id, status='failed',
                missing_inputs=(need('execution', 'Process cancelled', 'executor', 'conflict'),))
        try:
            return self._run(request, context)
        except (ValueError, KeyError, OSError):
            return self.result_model(request_id=request.request_id, process_kind=self.kind,
                base_snapshot_id=request.base.snapshot_id, status='failed',
                diagnostics=(Diagnostic(code='process.execution', severity='error',
                    message='Execution failed; no proposal was published or persisted.'),))

    def finish(self, request, context, output, *, changes=(), elements=(), assets=()):
        proposals, checks, diagnostics = (), (), ()
        if changes or elements:
            proposal = DesignProposal(proposal_id='proposal_' + uuid4().hex,
                base_snapshot_id=request.base.snapshot_id, record_changes=tuple(changes),
                element_drafts=tuple(elements), asset_refs=tuple(assets), affected_refs=tuple(
                    ObjectRef(record_id=c.record.record_id if hasattr(c, 'record') else c.before.record_id)
                    for c in changes))
            candidate = build_candidate(request.base.design, proposal,
                write_record_ids=request.scope.write_record_ids)
            diagnostics = tuple(context.resolve(candidate).diagnostics)
            allowed = set(request.scope.allowed_asset_refs)
            def resolver(ref):
                import hashlib
                if ref not in allowed or context.asset_resolver is None:
                    raise ValueError('Asset is outside the supplied scope or unavailable')
                data = context.asset_resolver(ref)
                if hashlib.sha256(data).hexdigest() != ref.sha256:
                    raise ValueError('Asset hash mismatch')
                return data
            for kind in dict.fromkeys(request.requested_checks):
                if context.cancelled():
                    raise ValueError('Process cancelled before checks completed')
                raw = check_design(candidate, kind, library=context.elements, asset_resolver=resolver)
                checks += (CheckEvidence(run_id=raw['run_id'], subject_snapshot_id=raw['snapshot_id'],
                    check_kind=kind, execution=raw['status'], outcome=raw['outcome'],
                    executor_version=raw['tool_version'], options_hash=raw['options_hash'], native_report=raw),)
            proposals = (proposal,)
        return self.result_model(request_id=request.request_id, process_kind=self.kind,
            base_snapshot_id=request.base.snapshot_id, status='completed', output=output,
            proposals=proposals, checks=checks, diagnostics=diagnostics)

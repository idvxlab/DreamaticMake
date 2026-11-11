"""V3 task capabilities. Project doc/tasks/index.json owns task reference plans."""
import json
from typing import Literal
from pydantic import Field
from element.base.contract import Contract, Sha256
from element.io.records import record_hash
from engine.query import QueryRequest, Budget, Selector
from engine.candidate import SetPlacement, SetJointInitial, CandidateProposal

TASK_KINDS = ('collision.classify', 'spatial_layout.refine', 'motion_detail.initial')


class DocumentSelection(Contract):
    source_id: str
    start_line: int = Field(default=1, ge=1)
    end_line: int = Field(default=30, ge=1)


class ContextDefinition(Contract):
    queries: tuple[Literal['project.overview', 'elements.inspect', 'instances.inspect',
                            'layout.inspect', 'circuit.inspect', 'evidence.query'], ...]
    references: tuple[DocumentSelection, ...] = Field(min_length=1, max_length=20)


class TaskSpec(Contract):
    schema_version: Literal['design-task/1'] = 'design-task/1'
    task_id: str
    kind: Literal['collision.classify', 'spatial_layout.refine', 'motion_detail.initial']
    source_kind: Literal['design_v3'] = 'design_v3'
    project_handle: str
    base_snapshot_id: Sha256
    source_manifest_id: Sha256
    instances: tuple[str, ...] = Field(min_length=1, max_length=64)
    write_targets: tuple[str, ...] = ()
    depends_on: tuple[str, ...] = ()
    evidence_run_ids: tuple[str, ...] = Field(default=(), max_length=20)
    max_attempts: int = Field(default=3, ge=1, le=3)
    budget: Budget = Budget(max_text_tokens=24000)


class Finding(Contract):
    owner: str
    classification: Literal['contact', 'nominal_envelope', 'overlap', 'approximation', 'unknown']
    rationale: str = Field(min_length=1, max_length=2000)
    source_ids: tuple[str, ...] = Field(min_length=1)


class TaskResult(Contract):
    schema_version: Literal['task-result/1'] = 'task-result/1'
    task_id: str
    attempt_id: str
    context_manifest_id: Sha256
    status: Literal['proposed', 'needs_input', 'cannot_complete']
    findings: tuple[Finding, ...] = ()
    operations: tuple[SetPlacement | SetJointInitial, ...] = ()
    open_issues: tuple[str, ...] = ()


def describe_task(kind):
    if kind not in TASK_KINDS: raise ValueError('Unsupported task kind')
    return {'kind': kind, 'context_source': 'doc/tasks/index.json',
            'context_schema': ContextDefinition.model_json_schema(), 'input_schema': TaskSpec.model_json_schema(),
            'output_schema': TaskResult.model_json_schema(), 'required_checks':
            [] if kind == 'collision.classify' else ['native_load', 'complete_forest_fk', 'assembly_collision'],
            'limitations': ['No automatic collision-policy editing', 'No manufacturing or target-board claim']}


def plan_tasks(service, instances):
    common = dict(project_handle=service.handle, base_snapshot_id=service.package.snapshot_id,
                  source_manifest_id=service.source_manifest(), instances=tuple(instances))
    return (TaskSpec(task_id='F0', kind='collision.classify', **common),)


def prepare_task(task, query_client):
    with query_client.document_session():
        return _prepare_task(task, query_client)


def _prepare_task(task, query_client):
    if task.base_snapshot_id != query_client.package.snapshot_id or task.source_manifest_id != query_client.source_manifest():
        raise ValueError('Stale task baseline')
    describe_task(task.kind)
    definition = ContextDefinition.model_validate_json(json.dumps(query_client.task_definition(task.kind)))
    queries = []
    for n, method in enumerate(definition.queries):
        queries.append(query_client.query(QueryRequest(request_id=f'{task.task_id}.{n}',
            project_handle=task.project_handle, snapshot_id=task.base_snapshot_id, method=method,
            selector=Selector(instances=task.instances, run_ids=task.evidence_run_ids if method == 'evidence.query' else ()), facet='mechanical', budget=task.budget)).model_dump(mode='json'))
    for n, reference in enumerate(definition.references):
        queries.append(query_client.query(QueryRequest(request_id=f'{task.task_id}.doc{n}',
            project_handle=task.project_handle, snapshot_id=task.base_snapshot_id, method='documents.read',
            selector=Selector(**reference.model_dump()), budget=task.budget)).model_dump(mode='json'))
    payload = {'schema_version': 'task-context/1', 'task': task.model_dump(mode='json'), 'queries': queries,
               'output_schema': TaskResult.model_json_schema(),
               'source_manifest_id': task.source_manifest_id}
    return {**payload, 'context_manifest_id': record_hash(payload, 'task-context-v1'),
            'ready': all(q['completeness'] != 'needs_narrower_scope' for q in queries)
                and len(json.dumps(payload, ensure_ascii=False).encode('utf-8')) + 2048 <= task.budget.max_text_tokens}


def validate_deliverable(task, result, context, attempt_id):
    result = TaskResult.model_validate_json(result.model_dump_json() if isinstance(result, TaskResult) else json.dumps(result))
    if (result.task_id != task.task_id or result.attempt_id != attempt_id or
            result.context_manifest_id != context['context_manifest_id']):
        raise ValueError('Result identity or context mismatch')
    sources = {s['source_id'] for q in context['queries'] for s in q['sources']}
    for f in result.findings:
        if f.owner not in task.instances or set(f.source_ids) - sources: raise ValueError('Unresolved finding source or owner')
    if task.kind == 'collision.classify' and result.operations: raise ValueError('Read-only task cannot write')
    expected = SetJointInitial if task.kind == 'motion_detail.initial' else SetPlacement
    if any(not isinstance(o, expected) for o in result.operations): raise ValueError('Operation is outside task capability')
    if set(o.target for o in result.operations) - set(task.write_targets): raise ValueError('Write scope exceeded')
    if result.status == 'proposed':
        if not context['ready']: raise ValueError('Context budget is not ready')
        if task.kind == 'collision.classify' and not result.findings: raise ValueError('No classification delivered')
        if task.kind != 'collision.classify' and not result.operations: raise ValueError('No semantic change delivered')
    elif result.operations:
        raise ValueError('Blocked results cannot carry executable changes')
    return result


def integrate_deliverable(task, result, context, attempt_id):
    result = validate_deliverable(task, result, context, attempt_id)
    if result.status != 'proposed' or not result.operations: raise ValueError('No proposed semantic operations')
    return CandidateProposal(base_snapshot_id=task.base_snapshot_id,
        source_manifest_id=task.source_manifest_id, operations=result.operations)


def assess_acceptance(task, receipt):
    if receipt.get('base_snapshot_id') != task.base_snapshot_id: return 'stale'
    required = set(describe_task(task.kind)['required_checks'])
    return 'validated_draft' if required <= set(receipt.get('checks', [])) and not receipt.get('missing_checks') else 'needs_input'

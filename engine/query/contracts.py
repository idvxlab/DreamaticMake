"""Read-only context protocol; host bindings never appear in model arguments."""
from typing import Literal
from pydantic import Field
from element.base.contract import Contract, Sha256


class Budget(Contract):
    max_text_tokens: int = Field(default=5000, ge=128, le=32000)
    max_items: int = Field(default=20, ge=1, le=200)
    max_images: int = Field(default=0, ge=0, le=8)


class Selector(Contract):
    instances: tuple[str, ...] = Field(default=(), max_length=64)
    source_id: str | None = None
    stage: str | None = None
    text: str = Field(default='', max_length=200)
    start_line: int = Field(default=1, ge=1)
    end_line: int = Field(default=80, ge=1)
    run_ids: tuple[str, ...] = Field(default=(), max_length=20)


class QueryRequest(Contract):
    schema_version: Literal['context-query/1'] = 'context-query/1'
    request_id: str = Field(min_length=1, max_length=128)
    project_handle: str
    snapshot_id: Sha256
    method: Literal['project.overview', 'requirements.query', 'documents.list',
                    'documents.read', 'documents.search', 'elements.inspect',
                    'instances.inspect', 'layout.inspect', 'circuit.inspect',
                    'evidence.query', 'views.render']
    selector: Selector = Selector()
    facet: Literal['identity', 'mechanical', 'electrical', 'behavior', 'manufacturing', 'native'] = 'identity'
    detail: Literal['summary', 'task', 'native'] = 'task'
    budget: Budget = Budget()


class QueryResult(Contract):
    schema_version: Literal['context-result/1'] = 'context-result/1'
    query_id: Sha256
    snapshot_id: Sha256
    source_kind: Literal['design_v3'] = 'design_v3'
    schema_ref: str
    data: tuple[dict, ...] = ()
    sources: tuple[dict, ...] = ()
    boundary: tuple[dict, ...] = ()
    unknowns: tuple[dict, ...] = ()
    diagnostics: tuple[dict, ...] = ()
    attachments: tuple[dict, ...] = ()
    included: tuple[str, ...] = ()
    omitted: tuple[dict, ...] = ()
    next_cursor: str | None = None
    usage: dict
    completeness: Literal['complete', 'partial', 'needs_narrower_scope']

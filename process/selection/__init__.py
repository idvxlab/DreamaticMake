"""Fixed-version selection into an existing design; search never writes the library."""
import json
from hashlib import sha256
from typing import Annotated, Literal
from pydantic import Field
from element.base.contract import Contract, Id
from element.schema.library import ElementRef, ElementQuery, Evidence, Source
from element.io.records import element_ref
from engine.design.contracts import (Requirement, Candidate, Assessment, Markdown, SelectionData,
    DiscreteUsage, BulkUsage, ObjectRef)
from process.contracts import ProcessRequest, ProcessResult
from process.base import DesignProcess, need
from process.proposal import updated_record

Usage = Annotated[DiscreteUsage | BulkUsage, Field(discriminator='kind')]


class SelectionInput(Contract):
    action: Literal['search', 'compare', 'choose', 'replace']
    selection_record_id: Id = 'selection'
    requirements: dict[Id, Requirement] = Field(default_factory=dict)
    query: ElementQuery | None = None
    candidate_refs: tuple[ElementRef, ...] = ()
    chosen_ref: ElementRef | None = None
    usage: Usage | None = None


class SelectionOutput(Contract):
    candidates: dict[Id, Candidate]
    chosen_candidate_id: Id | None = None
    usage: Usage | None = None
    instance_refs: tuple[ObjectRef, ...] = ()
    replacement_impacts: tuple[ObjectRef, ...] = ()
    next_cursor: str | None = None
    sources: dict[Id, Source] = Field(default_factory=dict)
    evidence: dict[Id, Evidence] = Field(default_factory=dict)


class SelectionRequest(ProcessRequest[SelectionInput]):
    process_kind: Literal['selection'] = 'selection'


SelectionResult = ProcessResult[SelectionOutput]


class SelectionProcess(DesignProcess[SelectionRequest, SelectionResult]):
    kind, title = 'selection', '元件选型'
    actions = ('search', 'compare', 'choose', 'replace')
    request_model, result_model, output_model = SelectionRequest, SelectionResult, SelectionOutput

    def _inspect(self, r, ctx, resolved):
        x, items = r.input, []
        if x.action == 'search':
            if x.query is None:
                items.append(need('query', 'Search requires an ElementQuery'))
            if ctx.elements is None:
                items.append(need('elements', 'Search requires a library reader', 'element'))
        elif x.action == 'compare' and not x.candidate_refs:
            items.append(need('candidate_refs', 'Comparison needs pinned candidates', 'element'))
        if x.action in ('choose', 'replace'):
            if x.chosen_ref is None:
                items.append(need('chosen_ref', 'Choose a concrete element pin', 'element'))
            if x.usage is None:
                items.append(need('usage', 'Specify instances or a bulk quantity'))
            if isinstance(x.usage, DiscreteUsage) and x.usage.planned_count != len(x.usage.instances):
                items.append(need('usage', 'Planned count differs from actual instances', state='conflict'))
            if x.selection_record_id not in r.scope.write_record_ids:
                items.append(need('scope', 'Selection record is outside write scope', state='conflict'))
            old = resolved.records.get(x.selection_record_id)
            if old and old.kind != 'selection':
                items.append(need('selection_record_id', 'Record belongs to a different layer', 'design', 'conflict'))
            if x.action == 'replace' and old is None:
                items.append(need('selection_record_id', 'Replacement requires an existing selection', 'design'))
        for ref in dict.fromkeys((*x.candidate_refs, *((x.chosen_ref,) if x.chosen_ref else ()))):
            try:
                ctx.element(r.base.design, ref)
            except ValueError:
                items.append(need('candidate_refs', 'Pinned candidate is unavailable', 'element'))
        return items

    def _run(self, r, ctx):
        x = r.input
        refs, cursor = x.candidate_refs, None
        if x.action == 'search':
            page = ctx.elements.search(x.query)
            refs = tuple(ElementRef.model_validate_json(json.dumps(h['ref'])) for h in page['items'])
            cursor = page['next_cursor']
        refs = tuple(dict.fromkeys((*refs, *((x.chosen_ref,) if x.chosen_ref else ()))))
        definitions = tuple(ctx.element(r.base.design, ref) for ref in refs)
        candidates, sources, evidence = {}, {}, {}
        chosen = None
        for definition in definitions:
            ref = element_ref(definition)
            cid = 'candidate_' + ref.content_hash[:24]
            assessments = {}
            for key, requirement in x.requirements.items():
                parameter = definition.parameters.get(requirement.parameter_code)
                outcome = 'unknown'
                assessment_evidence = []
                for eid in parameter.evidence_ids if parameter else ():
                    original = definition.evidence[eid]
                    source_ids = []
                    for sid in original.source_ids:
                        mapped_source = 's_' + sha256(f'{ref.content_hash}/{sid}'.encode()).hexdigest()[:24]
                        sources[mapped_source] = definition.sources[sid]
                        source_ids.append(mapped_source)
                    mapped_evidence = 'e_' + sha256(f'{ref.content_hash}/{eid}'.encode()).hexdigest()[:24]
                    evidence[mapped_evidence] = Evidence(source_ids=tuple(source_ids), basis=original.basis,
                        statement=original.statement, artifact_refs=original.artifact_refs)
                    assessment_evidence.append(mapped_evidence)
                if parameter and parameter.value and parameter.evidence_ids and all(
                    definition.evidence[e].basis != 'assumption' for e in parameter.evidence_ids
                ):
                    value = parameter.value
                    bounds = [b for b in (requirement.min, requirement.max) if b]
                    if all(b.dimension == value.dimension for b in bounds):
                        outcome = 'match' if all((not requirement.min or value.si_value >= requirement.min.si_value,
                            not requirement.max or value.si_value <= requirement.max.si_value)) else 'mismatch'
                assessments[key] = Assessment(outcome=outcome, evidence_ids=tuple(assessment_evidence))
            candidates[cid] = Candidate(element_ref=ref, assessments=assessments,
                reason=Markdown(text='Pinned candidate; unknown or assumed properties are not verified matches.'))
            if ref == x.chosen_ref:
                chosen = cid
        instance_refs = ()
        impacts = ()
        if x.action in ('choose', 'replace'):
            old = next((record for record in r.base.design.records if record.record_id == x.selection_record_id), None)
            data = SelectionData(function_refs=old.data.function_refs if old else (),
                requirements=x.requirements, candidates=candidates, chosen_candidate_id=chosen,
                decision=Markdown(text=r.intent), usage=x.usage)
            names = x.usage.instances.keys() if isinstance(x.usage, DiscreteUsage) else ('bulk',) if x.usage.instance else ()
            instance_refs = tuple(ObjectRef(record_id=x.selection_record_id, collection='instances', object_id=n) for n in names)
            if old:
                resolved = ctx.resolve(r.base.design)
                affected = {target.key() for (instance, _, _), target in resolved.occurrence_refs.items()
                    if instance.startswith(x.selection_record_id + '/instances/')}
                owners = {link['record_id'] for key in affected for link in resolved.reverse.get(key, ())}
                impacts = tuple(ObjectRef(record_id=record.record_id) for record in r.base.design.records
                    if record.record_id != x.selection_record_id and record.record_id in owners)
            output = SelectionOutput(candidates=candidates, chosen_candidate_id=chosen,
                usage=x.usage, instance_refs=instance_refs, replacement_impacts=impacts,
                sources=sources, evidence=evidence)
            return self.finish(r, ctx, output, changes=(updated_record(r.base.design,
                x.selection_record_id, 'selection', data, sources=sources, evidence=evidence),), elements=definitions)
        return self.finish(r, ctx, SelectionOutput(candidates=candidates, next_cursor=cursor,
            sources=sources, evidence=evidence))

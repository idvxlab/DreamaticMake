"""Pure candidate construction with revision/pin/scope checks; no persistence."""
from engine.design import make_package, parse_package, parse_record, record_ref, snapshot_id, resolve_design
from element.io.records import parse_element, element_ref
from process.contracts import DesignProposal, RecordUpsert, RecordDelete


def updated_record(package, record_id, kind, data, title=None, *, sources=None, evidence=None):
    old = next((r for r in package.records if r.record_id == record_id), None)
    if old and old.kind != kind:
        raise ValueError('Cannot change an existing record kind')
    raw = old.model_dump(mode='json') if old else dict(
        record_id=record_id, design_id=package.manifest.design_id, kind=kind, title=title or record_id)
    raw.update(data=data.model_dump(mode='json'), revision=old.revision + 1 if old else 1)
    for name, values in (('sources', sources), ('evidence', evidence)):
        if values is not None:
            raw.setdefault(name, {}).update({key: value.model_dump(mode='json') for key, value in values.items()})
    return RecordUpsert(before=record_ref(old) if old else None, record=parse_record(raw))


def build_candidate(package, proposal, *, write_record_ids):
    package = parse_package(package)
    proposal = DesignProposal.model_validate_json(proposal.model_dump_json())
    if snapshot_id(package.manifest) != proposal.base_snapshot_id:
        raise ValueError('stale_snapshot')
    records = {r.record_id: r for r in package.records}
    seen = set()
    for change in proposal.record_changes:
        rid = change.before.record_id if isinstance(change, RecordDelete) else change.record.record_id
        if rid not in write_record_ids or rid in seen:
            raise ValueError('Record write is outside scope or duplicated')
        seen.add(rid)
        old = records.get(rid)
        if (record_ref(old) if old else None) != change.before:
            raise ValueError('record_revision_conflict')
        if isinstance(change, RecordDelete):
            if old is None:
                raise ValueError('Cannot delete absent record')
            del records[rid]
        else:
            new = change.record
            if new.design_id != package.manifest.design_id or new.revision != (old.revision + 1 if old else 1):
                raise ValueError('Invalid design identity or record revision')
            if old and old.kind != new.kind:
                raise ValueError('Cannot change record kind')
            records[rid] = new
    definitions = {(e.library_id, e.element_id, e.revision): e for e in package.elements}
    for draft in proposal.element_drafts:
        draft = parse_element(draft)
        key = (draft.library_id, draft.element_id, draft.revision)
        if key in definitions and element_ref(definitions[key]) != element_ref(draft):
            raise ValueError('Element revision is immutable')
        definitions[key] = draft
    candidate = make_package(design_id=package.manifest.design_id, title=package.manifest.title,
        revision=package.manifest.revision + 1, records=tuple(records.values()),
        elements=tuple(definitions.values()), input_revisions=dict(package.manifest.input_revisions))
    resolve_design(candidate)  # Hard pin failures reject; incomplete references remain diagnostic drafts.
    return candidate

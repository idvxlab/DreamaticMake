from element.io.save import canonical_json
from element.base.quantity import UNITS
from engine.design.resolve import resolve_design, instances

def derive_bom(package, library=None):
    """Read-only BOM proposal. The owning application decides whether to publish it."""
    r = resolve_design(package, library)
    if any(d.severity == 'error' and d.code.startswith('element.') for d in r.diagnostics):
        raise ValueError('Cannot derive BOM from conflicting element sources')
    rows = {}
    for record in r.records.values():
        if record.kind != 'selection': continue
        d = record.data
        selected = d.candidates.get(d.chosen_candidate_id)
        if selected is None: raise ValueError('Cannot publish BOM with unselected roles')
        ref = selected.element_ref
        if (ref.library_id, ref.element_id, ref.revision) not in r.elements: raise ValueError('Selected definition unavailable')
        if d.usage.kind == 'discrete':
            if d.usage.planned_count != len(d.usage.instances): raise ValueError('BOM count differs from instances')
            entries = [(name, inst, 1, '1') for name, inst in instances(d).items()]
        else:
            entries = [('bulk', d.usage.instance, d.usage.quantity.si_value,
                        UNITS[d.usage.quantity.unit][3])]
        for name, instance, amount, unit in entries:
            key = canonical_json({'ref': ref.model_dump(mode='json'), 'unit': unit})
            row = rows.setdefault(key, {'element_ref': ref.model_dump(mode='json'), 'quantity': {'value': 0, 'unit': unit}, 'source_refs': []})
            row['quantity']['value'] += amount
            row['source_refs'].append({'record_id': record.record_id, 'collection': 'instances' if instance else None, 'object_id': name if instance else None})
    return {'snapshot_id': r.snapshot_id, 'input_revisions': dict(r.package.manifest.input_revisions), 'items': list(rows.values())}

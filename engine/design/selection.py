"""Select element occurrences without copying intrinsic engineering definitions."""
from engine.design.io import make_package

def instantiate_element(definition, *, design_id='design', title=None, instance_id='instance', pose=None):
    """Select one pinned element. Engineering objects exist only in the resolved view."""
    from element.io.records import parse_element, element_ref
    from engine.design.resolve import resolve_design
    definition = parse_element(definition)
    package = make_package(design_id=design_id, title=title or definition.name, elements=(definition,), records=[{
        'kind': 'selection', 'design_id': design_id, 'record_id': 'selection', 'title': definition.name,
        'data': {'candidates': {'chosen': {'element_ref': element_ref(definition).model_dump(mode='json')}},
                 'chosen_candidate_id': 'chosen', 'usage': {'kind': 'discrete', 'planned_count': 1,
                 'instances': {instance_id: {'label': definition.name, 'pose': pose}}}}}])
    resolved = resolve_design(package)
    mapping = {f'{collection}/{name}': ref.model_dump(mode='json')
               for (_, collection, name), ref in resolved.occurrence_refs.items()}
    return {'package': package.model_dump(mode='json'), 'identity_map': mapping}

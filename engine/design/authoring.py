"""Context-specific source shorthand; execution always receives expanded references."""
from itertools import groupby
from typing import Annotated, Literal
from pydantic import BeforeValidator
from element.schema.professional import OccurrenceRef, Joint


def occurrence(value, domain, collection):
    if isinstance(value, str):
        parts = value.split('/')
        if len(parts) != 2:
            raise ValueError('Short reference must be instance/local_id')
        value = {'instance': parts[0], 'domain': domain, 'collection': collection, 'id': parts[1]}
    if isinstance(value, dict) and (value.get('domain') != domain or value.get('collection') != collection):
        raise ValueError(f'Reference must address {domain}/{collection}')
    return value


LinkRef = Annotated[OccurrenceRef, BeforeValidator(
    lambda v: occurrence(v, 'mechanical', 'links'), json_schema_input_type=OccurrenceRef | str)]
PinRef = Annotated[OccurrenceRef, BeforeValidator(
    lambda v: occurrence(v, 'electrical', 'pins'), json_schema_input_type=OccurrenceRef | str)]


class ProjectJoint(Joint):
    # A missing type denotes a rigid assembly connection. Moving joints must
    # explicitly supply their type, axis and initial position as before.
    type: Literal['fixed', 'revolute', 'continuous', 'prismatic'] = 'fixed'
    parent: LinkRef
    child: LinkRef


def compact_record(record):
    """Export editable v3 source without changing its expanded, pinned contents."""
    from .professional import Structure, Motion, Electrical, Logic
    if not isinstance(record, (Structure, Motion, Electrical, Logic)):
        raise ValueError('Expected a v3 domain record')
    # Keep record identity/version explicit even when revision equals its default.
    data = {'record_id': record.record_id, 'revision': record.revision, 'schema_version': record.schema_version,
            **record.model_dump(mode='json', exclude_defaults=True, exclude_none=True)}

    def short(ref):
        return f"{ref['instance']}/{ref['id']}"

    if isinstance(record, Structure):
        for placement in data.get('placements', {}).values():
            placement['relative_to'] = short(placement['relative_to'])
        mounts = data.get('mount_connections', {})
        defaults = {key: next(iter(mounts.values()))[key]
                    for key in ('hardware', 'status', 'source_record')
                    if mounts and all(key in item for item in mounts.values())
                    and all(item[key] == next(iter(mounts.values()))[key] for item in mounts.values())}
        if defaults: data['mount_defaults'] = defaults
        for item in mounts.values():
            for key in defaults: item.pop(key)
            for end in ('a', 'b'):
                if end in item: item[end] = short(item[end])
    elif isinstance(record, Motion):
        for joint in data.get('joints', {}).values():
            for end in ('parent', 'child'): joint[end] = short(joint[end])
    elif isinstance(record, Electrical):
        for id, net in data.get('nets', {}).items():
            if net.get('name') == id: net.pop('name')
            net['nodes'] = [short(ref) for ref in net['nodes']]
        groups = []
        # Only group adjacent entries with identical metadata, preserving order.
        for metadata, items in groupby(data.get('unconnected', []),
                key=lambda item: {k: v for k, v in item.items() if k != 'pin'}):
            pins = [short(item['pin']) for item in items]
            groups.append({('pins' if len(pins) > 1 else 'pin'): pins if len(pins) > 1 else pins[0], **metadata})
        if groups: data['unconnected'] = groups
    return data

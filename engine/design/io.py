from pydantic import BaseModel
from element.io.load import _record_object, MAX_BYTES
from element.io.save import canonical_json
from element.io.records import record_hash
from engine.design.contracts import RECORD_ADAPTER, RecordRef, DesignManifest, DesignPackage

def _data(value):
    if isinstance(value, BaseModel): value = value.model_dump(mode='json', by_alias=True)
    if isinstance(value, str): value = _record_object(value)
    text = canonical_json(value)
    if len(text.encode('utf-8')) > MAX_BYTES: raise ValueError('Design exceeds 16 MiB')
    return text

def parse_record(value):
    return RECORD_ADAPTER.validate_json(_data(value))

def parse_package(value):
    return DesignPackage.model_validate_json(_data(value))

def record_ref(record):
    record = parse_record(record)
    return RecordRef(record_id=record.record_id, revision=record.revision,
                     content_hash=record_hash(record, 'design-record-v1'))

def snapshot_id(manifest):
    manifest = DesignManifest.model_validate_json(_data(manifest))
    return record_hash(manifest, 'design-manifest-v1')

def make_package(*, design_id, title, records=(), revision=1, elements=(), input_revisions=None):
    from engine.design.contracts import KINDS
    records = tuple(parse_record(r) for r in records)
    layers = {k: tuple(record_ref(r) for r in records if r.kind == k) for k in KINDS}
    return DesignPackage(manifest=DesignManifest(design_id=design_id, title=title,
        revision=revision, layers=layers, input_revisions=input_revisions or {}), records=records, elements=tuple(elements))

def export_schema(kind):
    model = {'design_manifest': DesignManifest, 'design_package': DesignPackage}.get(kind)
    schema = RECORD_ADAPTER.json_schema() if kind == 'design_record' else model.model_json_schema() if model else None
    if schema is None: raise ValueError('Unknown design schema')
    return {'$schema': 'https://json-schema.org/draft/2020-12/schema', **schema}

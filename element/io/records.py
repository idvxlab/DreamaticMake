from element.io.load import _record_object
from element.io.save import canonical_json
from hashlib import sha256
from element.schema.library import ElementDefinition, ElementRef, CatalogEntry

def parse_element(value):
    from pydantic import BaseModel
    if isinstance(value, BaseModel): value = value.model_dump(mode='json')
    if isinstance(value, str): value = _record_object(value)
    if value.get('schema_version') == '2.0.0-draft':
        from element.schema.professional import ElementDefinitionV2
        return ElementDefinitionV2.model_validate_json(canonical_json(value))
    return ElementDefinition.model_validate_json(canonical_json(value))

def record_hash(value, domain='element-v1'):
    return sha256((domain + '\n' + canonical_json(value)).encode('utf-8')).hexdigest()

def element_ref(value):
    definition = parse_element(value)
    return ElementRef(library_id=definition.library_id, element_id=definition.element_id,
                      revision=definition.revision, content_hash=record_hash(definition,
                          'element-v2' if definition.schema_version == '2.0.0-draft' else 'element-v1'))

def export_schema(kind='element_definition'):
    if kind == 'element_definition_v2':
        from element.schema.professional import ElementDefinitionV2
        return {'$schema': 'https://json-schema.org/draft/2020-12/schema', **ElementDefinitionV2.model_json_schema()}
    from element.schema.retrieval import RetrievalQuery, RetrievalRef, RetrievalResult
    model = {'element_definition': ElementDefinition, 'element_ref': ElementRef, 'catalog_entry': CatalogEntry}.get(kind)
    model = model or {'retrieval_query': RetrievalQuery, 'retrieval_ref': RetrievalRef, 'retrieval_result': RetrievalResult}.get(kind)
    if model is None: raise ValueError('Unknown element schema')
    return {'$schema': 'https://json-schema.org/draft/2020-12/schema', **model.model_json_schema()}

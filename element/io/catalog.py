"""Explicit migration of legacy procurement metadata; never invent a device model."""
from element.io.components import parse_component
from element.schema.library import ElementDefinition, ElementParameter, Product, Source, Evidence
from element.base.quantity import Quantity

def import_catalog_part(part, model, *, library_id='catalog'):
    model = parse_component(model)
    if part['id'] != model.id: raise ValueError('Catalog part and explicit model must share an identity')
    sources = {}
    evidence = {}
    if part.get('source'):
        sources['catalog_source'] = Source(title=part['name'], locator=part['source'],
            source_revision=part.get('revision'), retrieved_at=None)
        evidence['catalog_description'] = Evidence(source_ids=('catalog_source',), basis='datasheet',
            statement='Imported catalog description; geometry has not been independently verified by this importer')
    parameters = {}
    for name in ('width', 'depth', 'height'):
        value = part.get('dimensions', {}).get(name)
        parameters[name] = ElementParameter(value=Quantity(value=value, unit='mm') if value is not None else None,
            evidence_ids=('catalog_description',) if evidence and value is not None else ())
    return ElementDefinition(library_id=library_id, element_id=model.id, revision=model.revision,
        name=part['name'], category=model.category, origin='catalog', form='module', model=model,
        product=Product(manufacturer=part.get('manufacturer'), model=part['name'], hardware_revision=part.get('revision')),
        description_markdown=part.get('notes', ''), parameters=parameters, sources=sources, evidence=evidence)

"""Read-only Markdown output for design packages and existing project records."""
import json
from element.language._markdown import LANGUAGE_VERSION, Document, document_payload, record_data
from element.io.components import parse_component

__all__ = ['LANGUAGE_VERSION', 'to_markdown', 'to_document']


def to_markdown(value) -> str:
    """Accept typed records, mappings or JSON; never execute or resolve asset files.

    Design packages verify pins and report incomplete references. Legacy projects
    retain their native contracts instead of being lowered to a lossy layout.
    """
    data = record_data(value)
    kind = data.get('record_kind')
    if kind == 'design_package' and data.get('schema_version') == '3.0.0-draft':
        from engine.design.professional import parse_package
        package = parse_package(data)
        doc = Document('设计项目 · ' + package.manifest.title, kind)
        doc.section('快照', {'snapshot_id': package.snapshot_id})
        for field, value in package.model_dump(mode='json').items(): doc.section(field, {field: value})
        return doc.finish()
    if kind == 'layout_project':
        from engine.layout_project import parse_project, LegacyLayoutProject
        model = parse_project(data)
        # LayoutProject's components are raw dicts: validate each native definition.
        field = 'components' if isinstance(model, LegacyLayoutProject) else 'elements'
        components = {key: parse_component(component).model_dump(mode='json')
                      for key, component in getattr(model, field).items()}
        if isinstance(model, LegacyLayoutProject):
            for instance in model.structure.instances.values():
                if instance.definition not in components:
                    raise ValueError('Unknown component definition: ' + instance.definition)
        elif set(model.structure.placements) - components.keys():
            raise ValueError('Placement references an unknown element key')
        data = {**model.model_dump(mode='json'), field: components}
        doc = Document('设计项目 · layout_project', kind)
    elif kind == 'layout_draft':
        from engine.layout import parse_layout
        model = parse_layout(data)
        doc = Document('布局草稿 · layout_draft', kind)
    elif kind == 'model_bundle':
        from engine.schema.assembly import ModelBundle
        model = ModelBundle.model_validate_json(json.dumps(data, allow_nan=False))
        doc = Document('设计快照 · model_bundle', kind)
    else:
        raise ValueError('Unsupported engine language record_kind')
    if kind != 'layout_project':
        data = model.model_dump(mode='json', by_alias=True)
    for key, child in data.items():
        doc.section(key, {key: child})
    return doc.finish()


def to_document(value) -> dict:
    """Return Markdown with explicit format/version for existing JSON transports."""
    return document_payload(to_markdown(value))

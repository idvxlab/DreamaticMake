"""Read-only Markdown output for design packages and existing project records."""
import json
from element.language._markdown import LANGUAGE_VERSION, Document, document_payload, record_data
from element.io.components import parse_component
from element.io.records import element_ref
from engine.design.contracts import KINDS, DesignManifest
from engine.design.io import parse_record, record_ref, snapshot_id
from engine.design.resolve import resolve_design

__all__ = ['LANGUAGE_VERSION', 'to_markdown', 'to_document']

LAYERS = dict(zip(KINDS, ('分析', '功能', '选型', '结构', '运动', '电路与能量', '物料与信息流', '逻辑')))


def _record(doc, record, level):
    doc.section(f'{record.record_id} · {record.title}', {
        'ref': record_ref(record).model_dump(mode='json'),
        **record.model_dump(mode='json', by_alias=True),
    }, level)


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
    if kind == 'design_package':
        resolved = resolve_design(data)
        package = resolved.package
        doc = Document('设计项目 · ' + package.manifest.title, kind)
        doc.section('项目版本', {'record_kind': kind, 'schema_version': package.schema_version,
                              'snapshot_id': resolved.snapshot_id})
        doc.section('清单 · manifest', package.manifest)
        records = {r.record_id: r for r in package.records}
        for layer in KINDS:
            doc.lines.extend([f'## {LAYERS[layer]} · {layer}', ''])
            pins = package.manifest.layers[layer]
            if not pins:
                doc.lines.extend(['未声明记录。', ''])
            for pin in pins:
                _record(doc, records[pin.record_id], 3)
        doc.lines.extend(['## 零件定义 · elements', '',
                          '以下为嵌入的原生定义；选型通过固定版本引用复用，固有工程属性仍归零件所有。', ''])
        if not package.elements:
            doc.lines.extend(['未嵌入零件定义。', ''])
        for definition in sorted(package.elements, key=lambda d: (d.library_id, d.element_id, d.revision)):
            doc.section(f'{definition.library_id}/{definition.element_id}@{definition.revision}', {
                'ref': element_ref(definition).model_dump(mode='json'),
                'definition': definition.model_dump(mode='json'),
            }, 3)
        doc.section('引用诊断 · diagnostics', [d.model_dump(mode='json') for d in resolved.diagnostics])
        return doc.finish()
    if kind == 'design_record':
        record = parse_record(data)
        doc = Document('设计记录 · ' + record.title, kind)
        _record(doc, record, 2)
        return doc.finish()
    if kind == 'design_manifest':
        model = DesignManifest.model_validate_json(json.dumps(data, allow_nan=False))
        doc = Document('设计清单 · ' + model.title, kind)
        doc.section('快照', {'snapshot_id': snapshot_id(model)})
    elif kind == 'layout_project':
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
        doc.section(LAYERS.get(key, key), {key: child})
    return doc.finish()


def to_document(value) -> dict:
    """Return Markdown with explicit format/version for existing JSON transports."""
    return document_payload(to_markdown(value))

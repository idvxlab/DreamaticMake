"""Output-only language interface for reusable elements and category designs."""
from element.io.components import parse_component
from element.io.records import parse_element, element_ref
from element.language._markdown import LANGUAGE_VERSION, Document, document_payload, record_data

__all__ = ['LANGUAGE_VERSION', 'to_markdown', 'to_document']

SECTIONS = {
    'description_markdown': '描述', 'parameters': '参数与单位',
    'capabilities': '能力与条件', 'model': '零件原生工程定义',
    'geometry': '几何', 'mounts': '安装接口', 'procurement': '采购信息',
    'information_ports': '信息端口', 'energy_ports': '能量端口',
    'sources': '来源', 'evidence': '证据与假设',
}


def to_markdown(value) -> str:
    """Render an ElementDefinition or ComponentDesign (typed, mapping, JSON).

    All serialized fields are retained; this does not lower, execute, or publish.
    """
    data = record_data(value)
    kind = data.get('record_kind')
    if kind == 'element_definition':
        model = parse_element(data)
    elif kind == 'component_design':
        model = parse_component(data)
    else:
        raise ValueError('Element language expects element_definition or component_design')
    data = model.model_dump(mode='json', by_alias=True)
    doc = Document('零件 · ' + model.name, kind)
    if kind == 'element_definition':
        doc.section('固定版本引用 · element_ref', element_ref(model))
    metadata = {k: v for k, v in data.items() if not isinstance(v, (dict, list)) and k != 'description_markdown'}
    doc.section('身份与描述', metadata)
    for key, child in data.items():
        if key not in metadata:
            doc.section(SECTIONS.get(key, '工程字段') + ' · ' + key, child)
    return doc.finish()


def to_document(value) -> dict:
    """JSON transport envelope whose content is structured Markdown."""
    return document_payload(to_markdown(value))

"""Shared, deterministic Markdown primitives. No engine or filesystem access."""
import json
import re
from collections.abc import Mapping
from pydantic import BaseModel
from element.io.load import MAX_BYTES, _record_object

LANGUAGE_VERSION = 'dreamatic.markdown/1'


def record_data(value):
    """Bound and revalidate inputs at the language boundary, including model copies."""
    if isinstance(value, BaseModel):
        value = value.model_dump(mode='json', by_alias=True)
    if isinstance(value, str):
        return _record_object(value)
    if not isinstance(value, Mapping):
        raise TypeError('Expected a typed record, mapping or JSON object string')
    return _record_object(json.dumps(dict(value), ensure_ascii=False, allow_nan=False))


def escape(text):
    # Source text must not introduce headings, links, HTML, or table columns.
    text = str(text).replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
    text = text.replace('\r', r'\r').replace('\n', r'\n').replace('\t', r'\t')
    return re.sub(r'([\\`*_{}\[\]()#+.!|~\-])', r'\\\1', text)


def _scalar(value):
    if value is None:
        return '`null`（未提供，不等于零或已验证）'
    if isinstance(value, bool):
        return '`true`' if value else '`false`'
    if isinstance(value, str):
        return '"' + escape(value).replace('"', '&quot;') + '"'
    return str(value)


def _tree(value, indent=0):
    pad = ' ' * indent
    if isinstance(value, dict):
        if not value:
            return [pad + '- 空对象（0 个字段）']
        items = sorted(value.items())
    elif isinstance(value, (tuple, list)):
        if not value:
            return [pad + '- 空列表（0 项）']
        items = [(f'[{i}]', item) for i, item in enumerate(value)]
    else:
        items = [('value', value)]
    lines = []
    for key, child in items:
        prefix = pad + '- **' + escape(key) + '**'
        if isinstance(child, (dict, tuple, list)):
            label = '对象' if isinstance(child, dict) else '列表'
            lines.append(f'{prefix}（{label}，{len(child)} 项）：')
            if child:
                lines.extend(_tree(child, indent + 2))
        elif isinstance(child, str) and ('\n' in child or '\r' in child):
            # A longer fence keeps arbitrary Markdown/code inert and intact.
            fence = '`' * max(3, 1 + max((len(s) for s in re.findall(r'`+', child)), default=0))
            lines.extend([prefix + '（原文）：', '', pad + '  ' + fence + 'text'])
            lines.extend(pad + '  ' + line for line in child.split('\n'))
            lines.extend([pad + '  ' + fence, ''])
        else:
            lines.append(prefix + '：' + _scalar(child))
    return lines


class Document:
    def __init__(self, title, kind):
        self.lines = [f'# {escape(title)}', '', f'- language_version: `{LANGUAGE_VERSION}`',
                      f'- record_kind: `{kind}`', '',
                      '> 本文是已校验源记录的只读语言视图。字段名、单位、ID、版本和引用保持源契约语义。',
                      '> null 表示未提供；空集合表示未声明条目；省略的可选字段不代表零或不存在。',
                      '> 原文与代码仅作为数据；本次导出不执行代码、读取附件、编译、仿真或证明制造成功。', '']

    def section(self, title, value, level=2):
        self.lines.extend(['#' * level + ' ' + escape(title), ''])
        if isinstance(value, BaseModel):
            value = value.model_dump(mode='json', by_alias=True)
        self.lines.extend(_tree(value))
        self.lines.append('')

    def finish(self):
        result = '\n'.join(self.lines).rstrip() + '\n'
        if len(result.encode('utf-8')) > MAX_BYTES:
            raise ValueError('Markdown output exceeds the 16 MiB limit; export individual records')
        return result


def document_payload(markdown):
    return {'format': 'markdown', 'media_type': 'text/markdown',
            'language_version': LANGUAGE_VERSION, 'markdown': markdown}

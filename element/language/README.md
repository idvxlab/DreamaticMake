# 零件语言输出接口

`element.language` 把现有零件契约转换为结构化 Markdown，供 LLM 上下文、工具返回内容和人工阅读使用。它不依赖 `engine`，不调用模型，也不修改或发布零件。

```python
from element.io.components import load_component
from element.language import to_markdown, to_document

part = load_component("examples/element/servo.json")
markdown = to_markdown(part)
# 如需保存，由调用方显式选择路径并使用 UTF-8 写入。
document = to_document(part)
assert document["format"] == "markdown"
assert document["markdown"] == markdown
```

输入可以是 `ElementDefinition`、14 类 `ComponentDesign` 中任意一种、对应的字典，或 JSON 对象字符串。入口重新进行现有契约校验，拒绝未知字段、无效类型、重复 JSON 键和非有限数；不会接受文件路径字符串为隐式文件请求。

```sh
python -m element language examples/element/servo.json
python -m element language examples/element/indicator.toml
# 不传路径时，从 stdin 读取一个 JSON 对象。
```

CLI 成功时 stdout 直接输出 Markdown，退出码为 0；失败时沿用现有 JSON 错误格式，退出码为 2。中文输出/重定向时请使用 UTF-8（例如设置 `PYTHONIOENCODING=utf-8`）。现有 `get`、`search`、`validate` 等机器接口保持原有返回格式；库查询得到的 definition 可直接传入 `to_document`。

## 输出协议 dreamatic.markdown/1

- 一级标题标明零件与名称；文首声明 `language_version` 和原始 `record_kind`。
- `ElementDefinition` 附带原有 `element_ref`，包括库、ID、revision 和源内容哈希。哈希标识源记录，不是 Markdown 字节的哈希。
- 二级标题划分身份、描述、参数、能力、原生工程定义、信息/能量接口、来源和证据。类别特有字段完整保留，不降低为执行几何。
- 嵌套列表保留字段树；列表使用从 0 开始的索引，保留原顺序；对象键排序。字段名不翻译，说明标题采用中文。
- 字符串加引号，数字保留数值，布尔值用 `true`/`false`，`null` 与空对象、空列表、空字符串分别表示。单位按原始契约保留，不推断、不换算。
- 多行说明、Markdown 和代码放入足够长的围栏原文块，单行文本转义 Markdown/HTML 特殊字符，避免源内容破坏文档层级。围栏只是展示边界，不能保证模型抵抗提示注入；调用方应把文档作为数据上下文使用。
- 完整保留**序列化后的源契约字段**，包括默认值、假设、未知状态、资产引用和采购观测信息。契约本来省略的可选扩展仍省略。引用不触发网络请求或文件读取。
- 单次输入和输出上限均为 16 MiB；超限明确报错，不静默截断。结果采用 LF 行结束并以一个换行结尾。

`to_document` 的传输信封为：

```python
{
    "format": "markdown",
    "media_type": "text/markdown",
    "language_version": "dreamatic.markdown/1",
    "markdown": "# 零件 · …\n…",
}
```

这里的 JSON 仅用于现有工具传输，正文是标题与嵌套列表组成的 Markdown，不是包在 Markdown 围栏中的 JSON。

本版本只定义**对象 → 语言输出**。它不是 Markdown 编辑/反向解析协议，也不会把 LLM 的自然语言直接执行为工程更改。JSON/Pydantic 仍是存储与校验契约，任何后续写入仍需通过应用授权路径。

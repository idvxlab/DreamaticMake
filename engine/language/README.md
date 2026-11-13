# 只读设计语言输出

`to_markdown(value)` 与 `to_document(value)` 输出已有 v3 设计包或可执行模型、布局等记录。
元件输出使用 `element.language`。接口保留原始字段、单位、固定引用和未知项，不运行模型或读取引用资产。

```python
from engine.project_io import load_design_package
from engine.language import to_markdown

text = to_markdown(load_design_package('examples/project_2'))
```

Harness 使用 `engine.query` 按范围读取项目资料和工程对象，不把整份设计 Markdown默认塞入每个任务。
项目参考资料归 `doc/`，其任务资料计划见 `doc/tasks/index.json`。

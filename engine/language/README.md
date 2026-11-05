# 设计语言输出接口

`engine.language` 为设计项目提供结构化 Markdown 输出，与 [`element.language`](../../element/language/README.md) 共用 `dreamatic.markdown/1` 表示规则。

```python
from engine.design import make_package
from engine.language import to_markdown, to_document

project = make_package(design_id="fan", title="风扇设计", records=[{
    "design_id": "fan", "record_id": "cooling", "kind": "function",
    "title": "散热", "data": {"body": {"text": "降低设备温度；目标值待确定。"}},
}])
markdown = to_markdown(project)
document = to_document(project)
```

输入支持契约对象、字典或 JSON 对象字符串：

| record_kind | 输出内容 |
| --- | --- |
| `design_package` | 项目版本/快照、固定版本清单、八层原始记录、嵌入零件和引用诊断 |
| `design_record` | 单条完整记录及原有版本引用 |
| `design_manifest` | 项目清单及原有快照 ID |
| `layout_project` | v2 元件、结构位姿、运动、电路逻辑；保留 v1 项目读取兼容 |
| `layout_draft` | 可编辑布局的全部原生字段 |
| `model_bundle` | 旧执行快照的全部原生字段；不编译或仿真 |

`design_package` 按 analysis、function、selection、structure、motion、circuit_energy、flow、logic 固定顺序组织八层。每层记录遵循 manifest 引用顺序，空层明确标记。源版本与 pin/hash 不一致时拒绝输出；可编辑的不完整引用保留并列出诊断。独立记录、清单和旧格式仅做各自结构校验，不暗示完成整包语义检查。

零件固有信息来自嵌入的完整定义，出现位置、选型、连接保留在设计记录中。导出不会把派生 occurrence 复制成新的权威记录，不会从执行布局反推零件。未嵌入的库定义不从磁盘自动读取；完整项目的相关诊断会显示不可用引用。

```sh
python -m engine language engine/tests/fixtures/data/gripper.project.json
python -m engine language engine/tests/fixtures/data/actuator.bundle.json
# 也可不传路径，从 stdin 接收 JSON。
```

CLI 成功输出裸 Markdown，失败使用现有 JSON 错误格式。使用 UTF-8 输出或重定向。程序通过既有 `python -m engine request` 协议调用：

```python
# 通用入口（支持上表全部 record_kind）
request = {"request_id": "language-1", "method": "language", "source": project.model_dump(mode="json")}
# design 命名入口（同一 renderer）
request = {"request_id": "language-2", "method": "design_language", "design": project.model_dump(mode="json")}
```

成功回复仍为 `{request_id, type: "result", payload}`，其中 payload 是 `to_document` 的 `{format, media_type, language_version, markdown}`。原有 JSON API、存储和哈希语义不变。导出成功只表示语言文档生成成功，不表示引用检查通过、工程编译成功或物理验证通过。

本轮只实现语言输出，没有新增 LLM 调用、Markdown 导入、写入/批准操作或网页编辑器。已有 `engine.design.documents` 的多文件编辑导入协议保持独立。

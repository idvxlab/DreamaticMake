# 需求与功能整理

## 任务与来源

把原始设计资料整理为可追溯的需求和功能说明。必需输入是 `source_documents`；无上游产物。读取项目清单摘要、`doc/index.json` 中 requirements 登记的资料及用户补充；现有设计用于理解已有方案，不等于需求已确认。

案例入口：`examples/project_1/doc/requirements/README.md`。它只声明三轴机械臂、双指夹爪和 5V/PWM 演示；负载、精度、速度、工作空间仍待确定。

## 给 Agent 的上下文

按“使用场景 → 功能分解 → 硬约束 → 验收目标 → 假设/未知”排列，逐项附资料路径或文档 ID。尺寸、预算、功耗、材料、工艺未给定就列为待确认项。保留用户目标与现有方案限制的区别，不从示例尺寸倒推出负载能力。

建议文档项：需求 ID、原文/来源、目标、单位、优先级、已知状态、验收方法；功能项说明输入、输出、工作模式和与需求的关系。这是正文组织建议，不是新增 Pydantic 字段。

## 输出与检查

产物：`RequirementsOutput.documents`，至少含 `role='requirements'` 和 `role='functions'` 各一份，`document_id` 唯一；正文为 `Markdown(text=...)` 或有界资产引用。

文件任务：更新 `doc/requirements/` 下的 Markdown，并在 `doc/index.json` 的 requirements 阶段登记；不为整理需求修改工程 JSON。八层方案可显式整合到 analysis/function 记录。

检查两类文档齐全、需求/功能可追溯、未知值未伪装成事实。`submit` 检查文档角色和契约，不自动检查自然语言是否充分或验收是否可行。

## 接口与公共约定

本目录 `__init__.py` 导出该阶段 Input/Output/Request/Process，依赖与上下文键由 Process.spec 定义。运行 `python -m process schema requirements` 查看实际 schema。信息读取、版本、Agent 调用与写回边界统一见 [CONTEXT.md](../CONTEXT.md)。

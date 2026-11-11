# 分包任务协议

本目录只保留 v3 Harness 使用的任务契约。项目 `doc/tasks/index.json` 管理每种分包任务
需要的工程查询和参考资料范围；资料正文与需保留的过程成果也归项目 `doc/`。
正式结果经过 engine 校验后进入 `design/` 或 `element/`。

`tasks.py` 定义 TaskSpec、TaskResult、允许的语义操作、来源与写范围校验、验收要求。
目前支持 `collision.classify`、`spatial_layout.refine`、`motion_detail.initial`。
上下文读取由 `engine.query` 执行，模型调用和重试由 harness 执行。

`prepare_task()` 读取项目资料计划并生成有来源的上下文；`validate_deliverable()` 校验返回结果；
`integrate_deliverable()` 生成候选提案。它们不存储另一份项目文档，不自行调用模型或审批。

```powershell
.\python.cmd -m process list
.\python.cmd -m process schema motion_detail.initial
.\python.cmd -m harness examples/project_2 --instance button_stop
```

旧十阶段 DesignArtifact API、七类八层记录操作、ContextPack及其上下文规范已整体归档到
`z_bin/cleanup-2026-11-11/process/`。阶段名称仍可用于项目资料分类，不再对应平行的代码流程。

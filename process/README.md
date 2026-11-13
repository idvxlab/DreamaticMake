# 任务与工作台契约

本目录保留 v3 任务契约和 master 工作台的阶段产物校验。项目 `doc/tasks/index.json` 管理每种分包任务
需要的工程查询和参考资料范围；资料正文与需保留的过程成果也归项目 `doc/`。
正式结果经过 engine 校验后进入 `design/` 或 `element/`。

`tasks.py` 定义 TaskSpec、TaskResult、允许的语义操作、来源与写范围校验、验收要求。
目前支持 `collision.classify`、`spatial_layout.refine`、`motion_detail.initial`。
上下文读取由 `engine.query` 执行，模型调用和重试由应用宿主执行；harness/ 已弃用。

`prepare_task()` 读取项目资料计划并生成有来源的上下文；`validate_deliverable()` 校验返回结果；
`integrate_deliverable()` 生成候选提案。它们不存储另一份项目文档，不自行调用模型或审批。

```powershell
.\python.cmd -m process list
.\python.cmd -m process schema motion_detail.initial
.\python.cmd -m process schema spatial_layout
```

`workbench.py` 为应用提供 11 个阶段的描述、上游依赖与产物 schema，契约版本为
`workbench-stage/3`。`artifacts.py` 使用当前 engine/element 的 OccurrenceRef、LinkRef、
PinRef、ProjectJoint 和 Structure。嵌套单元通过 unit_path 定位；旧 record_id/object_id
工程引用不再接受。运动初值位于 initial_positions，限位位于 limit；电气网络用 nodes 引用 pin。

应用继续使用 schema、library-pins、validate-output 和 purchase-candidates JSON 接口。
旧 process request/DesignArtifact 工作流运行接口已移除。产物校验不代表执行了几何、
碰撞、编译或制造；这些检查通过 engine.tools 或 project-check/project-simulate 显式执行。
本机库路径保存在被 Git 忽略的 element-pool.local.json，运行数据保留在 workspace/。

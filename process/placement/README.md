# 实例放置操作

本目录保留底层操作 API，与 [spatial_layout 主流程](../spatial_layout/README.md) 配合使用。

## 信息与输出

输入：`PlacementInput(mode='set_pose', poses, fixed_instance_refs)`；每个 PlacementTarget 指定 instance_ref、Pose 和可选 relative_to_body。`suggest_layout` 当前 unsupported。

上下文：离散选型实例、原生刚体和局部坐标、相对参考体的已知世界位姿、锁定实例、现有 body pose overrides。先解析引用，不把缺失位姿默认为测量位置。

输出：每个实例的世界 Pose 与更新 selection usage 实例位姿的提案；相对放置会沿父体层级组合变换。拒绝锁定/重复对象、不可用参考体、越过写范围及未协调的已有刚体位姿覆盖。

项目目录 v2 的目标是 structure.placements，但本操作使用八层 selection 记录，不会自动写该文件。碰撞必须在候选设计上另行检查。

## 调用与验收

从 `process.placement` 或原有 `process` 顶层导入 Input/Output/Request/Result/Process。`python -m process schema placement` 是实际字段的依据；先 inspect，再 run。需要修改记录的请求通过 for_design 指定 write_record_ids。

变更返回 DesignProposal；宿主用 build_candidate 构造候选，默认 references 等 requested_checks 针对候选执行。实际工程结论以 checks 的状态和覆盖范围为准，completed 不等于工程合格。持久化、项目文件映射、Agent 调用与审批边界见 [公共上下文协议](../CONTEXT.md)。

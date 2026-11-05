# 机械 CAD 集成操作

本目录保留底层操作 API，与 [enclosure_detail 主流程](../enclosure_detail/README.md) 配合使用。

## 信息与输出

输入：`MechanicalDetailInput` 的 prepare_conditions 需要材料或 CADHousing、可选 subject_instance_refs；integrate_parts 需要 housing 和显式 Pose，并指定 library_id/selection_record_id/instance_id。generate_parts 当前 unsupported。

上下文：主体实例的完整元件、是否放置、几何可用性、候选材料（未知物性保留）、已编写的 CADHousing。材料参数必须与 housing.cad_housing.material 一致；几何资产有明确单位和来源。

输出：绑定 source_snapshot_id 的 subjects/material；集成时创建固定 ElementDefinition、全新 selection 记录和实例，不更新已有选型、不发布到元件库。write scope 必须含新记录 ID。

文件目标是定制元件包、元件索引和结构位姿，但转换/写盘需宿主实现。几何存在不表示完成配合、结构强度或制造验证；CAD 执行需独立证据。

## 调用与验收

从 `process.mechanical_detail` 或原有 `process` 顶层导入 Input/Output/Request/Result/Process。`python -m process schema mechanical_detail` 是实际字段的依据；先 inspect，再 run。需要修改记录的请求通过 for_design 指定 write_record_ids。

变更返回 DesignProposal；宿主用 build_candidate 构造候选，默认 references 等 requested_checks 针对候选执行。实际工程结论以 checks 的状态和覆盖范围为准，completed 不等于工程合格。持久化、项目文件映射、Agent 调用与审批边界见 [公共上下文协议](../CONTEXT.md)。

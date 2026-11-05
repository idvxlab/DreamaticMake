# 元件选型操作

本目录保留底层操作 API，与 [hardware_selection 主流程](../hardware_selection/README.md) 配合使用。

## 信息与输出

输入：`SelectionInput` 的 action 为 search/compare/choose/replace；query 使用 `ElementQuery`，candidate_refs/chosen_ref 使用精确 `ElementRef`，usage 为 DiscreteUsage 或 BulkUsage，requirements 使用原生 Requirement。

上下文：需求参数与证据、候选完整定义及来源、现有 selection 记录、实例数量和替换引用影响。搜索必须注入只读库；compare 可读取嵌入定义。参数没有证据或仅有 assumption 时不宣称满足需求。

输出：候选、评估、sources/evidence、选中项、实例引用和 replacement_impacts。choose/replace 生成 selection 整条记录提案，必须把 selection_record_id 列入写范围；replace 要求旧记录存在。替换后的连接/布局受影响引用需宿主继续处理。

文件目标由宿主映射到元件索引及固定库引用；本操作不会发布库或写项目文件。

## 调用与验收

从 `process.selection` 或原有 `process` 顶层导入 Input/Output/Request/Result/Process。`python -m process schema selection` 是实际字段的依据；先 inspect，再 run。需要修改记录的请求通过 for_design 指定 write_record_ids。

变更返回 DesignProposal；宿主用 build_candidate 构造候选，默认 references 等 requested_checks 针对候选执行。实际工程结论以 checks 的状态和覆盖范围为准，completed 不等于工程合格。持久化、项目文件映射、Agent 调用与审批边界见 [公共上下文协议](../CONTEXT.md)。

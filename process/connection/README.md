# 跨元件连接操作

本目录保留底层操作 API，与 [assembly_detail 主流程](../assembly_detail/README.md) 配合使用。

## 信息与输出

输入：`ConnectionInput` 指定 structure/circuit/flow_record_id 以及 mechanical、nets、flows、transfers、required_paths。describe 中动作名为 connect，输入模型本身没有 action 字段。

上下文：由 resolve_design 得到的 Mount、Terminal、Joint、MaterialPort、InformationPort、DesignEnergyPort 与已有关系。给 Agent 明确对象引用表及域类型；不复制本征内部拓扑。

输出：relation_refs 和 structure/circuit_energy/flow 的整条记录更新。端点必须存在且域类型匹配；joint 连接必须给已有 joint_ref；外部 flow 必须 scope=external 且无本征 source；活动领域不能共用同一记录 ID。

目录案例只有运动与电路的对应目标，没有通用 flow 文件。机械挂点连接与目录的刚体关节格式也不等价；宿主需显式映射支持的内容。资料写相关阶段 Markdown，禁止直接添加未经 schema 支持的字段。

## 调用与验收

从 `process.connection` 或原有 `process` 顶层导入 Input/Output/Request/Result/Process。`python -m process schema connection` 是实际字段的依据；先 inspect，再 run。需要修改记录的请求通过 for_design 指定 write_record_ids。

变更返回 DesignProposal；宿主用 build_candidate 构造候选，默认 references 等 requested_checks 针对候选执行。实际工程结论以 checks 的状态和覆盖范围为准，completed 不等于工程合格。持久化、项目文件映射、Agent 调用与审批边界见 [公共上下文协议](../CONTEXT.md)。

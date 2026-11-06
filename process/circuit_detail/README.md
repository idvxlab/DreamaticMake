# 电路深化操作

本目录保留底层操作 API，与 [logical_layout 主流程](../logical_layout/README.md) 配合使用。

## 信息与输出

输入：`CircuitDetailInput(action='realize', level='wiring', circuit_record_id, nets)`。level=schematic/pcb、action=check 当前均 unsupported；通用连通性检查应使用 engine 设计检查入口。

上下文：已选元件原生端子及评级、目标网络、现有电路记录和需求约束；与逻辑布局主流程共享接口资料。明确本操作不要求像主流程一样列出所有未接端子，不能把两者校验范围混为一谈。

输出：net_refs 与 circuit_energy 整条记录提案。内部复用 ConnectionProcess 的端点类型、写范围、至少两个不同端子等检查，不提供 EDA、ERC 或模拟电路后端。

目录文件目标是 design/circuit-logic.json 的 nets（members 和可选 kind）；ObjectRef 需宿主映射为项目端子引用，其他 Net 字段不盲目落盘。

## 执行 prompt

应用公共规则，按已有端子、供电额定值与目标网络执行支持的 wiring 深化；不把原理图/PCB 层级写成已实现能力。核对重复接入、地参考、输入输出、上拉和电源切换，保留必要未接原因。文件任务写原生 nets，独有接线说明并入 logical_layout；只有用户要求且存在实际工具与产物时再形成原理图/PCB，不生成占位文件。

## 调用与验收

从 `process.circuit_detail` 或原有 `process` 顶层导入 Input/Output/Request/Result/Process。`python -m process schema circuit_detail` 是实际字段的依据；先 inspect，再 run。需要修改记录的请求通过 for_design 指定 write_record_ids。

变更返回 DesignProposal；宿主用 build_candidate 构造候选，默认 references 等 requested_checks 针对候选执行。实际工程结论以 checks 的状态和覆盖范围为准，completed 不等于工程合格。持久化、项目文件映射、Agent 调用与审批边界见 [公共上下文协议](../CONTEXT.md)。

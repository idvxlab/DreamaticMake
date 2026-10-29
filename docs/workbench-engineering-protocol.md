# 工作台五类工程语义适配

实现：`packages/workbench/engineering-protocol.ts`。本接口保留 `dreamatic.workbench/1` Packet、五通道与所有 properties；不替换硬件/外形合同，不授予审批，不调用模型、CAD 或固件工具。

参考固定 `design-engine` 提交 `b8db6330a2ec76367f27e017cd18d6e0526acc59` 的 `engine/design/contracts.py`、`engine/schema/connections.py`、`element/base/{contract,quantity}.py`。远端实际为八层 `2.0.0-draft`，此处只适配五类的最小连接语义。`process_fanqi` 的 `8a392b0a59ed568544ca1ef4ec104c67eebb3156` 功能路由仅作工作流参考，不导入为五通道合同。

## 声明和诊断

规范条目在 `properties.engineeringProtocol` 显式写 `dreamatic.engineering/1`，并采用下表 kind。列出的字段均必须提供；允许未知的字段明确填 `null`，产生 gap。缺字段、错误类型、错误版本或已知值矛盾产生 error。未知 kind 及未声明规范的旧条目保留并生成 gap，不能当该领域已验证。额外属性保留但没有隐含验证承诺。空通道数组合法；未给/null 通道补空数组但留下缺口。

| 通道 / kind | 必需 properties 与检查 |
| --- | --- |
| structure / structure-connection | `a,b` 为 body 条目 ID 或 null；body kind 为 component-instance/enclosure。`constraint` 为 fixed/joint；`jointRef` 为 joint ID 或 null，fixed 不可绑定 joint。不得连接同一 body。真实 CAD/外形另走原有执行器证据校验。 |
| motion / joint | `parentBody,childBody` 为 body ID 或 null；`jointKind` fixed/revolute/continuous/prismatic；`axis` 有限归一化三向量或 null；`lower,upper,initial` 为 `{value,unit}` 或 null。prismatic 使用 mm，其余使用 deg。检查限位顺序和初始位置；不推断未知轴或限位。 |
| circuit_energy / terminal | `role` signal/power/ground；`voltageRange` 为 `{min:{value,unit:"V"},max:{value,unit:"V"}}` 或 null；检查范围顺序。 |
| circuit_energy / net | `role` 同上；`members` 至少两个去重 terminal ID。解析规范端子，检查角色一致、已知电压范围存在交集，以及同端子不可属于多个 net。电压范围交集不是电路仿真或实际供电电压。 |
| flow / flow-port | `direction` in/out/bidirectional；`domain` material/information；`required` boolean；`medium` 非空字符串或 null；`valueType` 类型对象或 null。required 端口缺少相应方向的声明连接产生 gap。 |
| flow / flow-edge | `domain` material/information；`from` flow-port ID 或 null；`to` 非空且去重的 flow-port ID 数组。检查输出到输入方向、domain、material 的已知 medium 一致，information 的已知类型一致；未解析端点或未知类型产生 gap。 |
| logic / logic-port | `direction` in/out；`valueType` 类型对象或 null。 |
| logic / logic-binding | `from,to` logic-port ID 或 null；检查输出到输入及已知类型兼容。没有执行代码、编译或烧录。 |

类型对象为 `{kind:"boolean"}`、`{kind:"scalar",unit:string}`、`{kind:"enum",values:string[]}`（非空且去重）、`{kind:"event",schemaId:string}`、`{kind:"stream",schemaId:string}`。连接要求 kind 一致；scalar 的单位字符串必须完全一致；enum 值集合一致；event/stream 的 schemaId 一致。scalar 不实现完整物理量单位注册表，仅符号匹配。不会把 V 转成 mV、米转毫米或弧度转角度。未知值保留为 gap，不能用零替代。

required 流端口检查仅确认声明连接存在；连接自身若非法另有 error，若未解析另有 gap。检查不证明完整路径可达、守恒、时序、额定功率、温升、固件接口或装配可制造性。尚未适配完整远端 bodies/geometry/mounts、驱动/传动求解、能量守恒、逻辑执行顺序及代码环境。所有未适配数据保持原 properties，不能自动升级证据。

## API 和接线

```ts
const normalized = normalizeEngineeringChannels(raw.data);
// 不接收 normalized.issues 中有 error 的部分 data。
const report = inspectEngineeringPacket(packet, authorizedDependencies, {
  completeReferenceScope: true,
});
// report = {version, packetId, invocationId, dependencyPacketIds, errors, gaps}
```

`validateEngineeringPacket(packet,dependencies,options)` 返回全部 `{severity,path,message}`；`inspectEngineeringPacket` 仅做分组与追踪封装，不写数据库。`completeReferenceScope` 控制 Packet item.references 中未解析引用是 error 还是 gap；规范字段中的 null/缺目标仍是可编辑 gap。依赖必须是当前调用实际授权的已完成输入和工具证据，不能传所有项目历史。查找按传入依赖次序、再当前 packet 覆盖同名 ID；当前 packet 中重复 ID 是 error。调用方不得传同 ID 的不明确历史分支作为依赖，跨外形版本不能靠此机制取代布局身份。

后端在 `normalizeModelOutput` 完成通道归一化、硬件/外形绑定回填后，最终提交前调用 `validateEngineeringPacket`。运行时当前已保存 gap 为 Packet logic 中的 `engineering-diagnostic`：属性包含 severity/path/message、verificationStatus=unverified、sourceInvocationId。后续读取与保存必须保留这些条目，不能仅写控制台。规范声明不改变既有 `validateAppearanceOutput`、geometryRef 及执行器检查职责。

接收规则：任何 error 整包拒绝，保留失败记录；gap 不自动拒绝可编辑提案，也不视为通过或批准。所有 gap 必须可追溯到 packet/invocation、字段路径及依赖。尤其 error 与 gap 同时出现时，调用方应先保存完整诊断报告到失败调用，再拒绝；仅抛 error 文本会丢失同时出现的 gap，需要运行时提供失败诊断持久化字段。具体共享合同由后端和总协调实现，本模块不改共享文件。

`normalizeEngineeringReference(value,itemIds)` 适配远端 `{record_id,collection?,object_id?}`，后两字段成对；unit_inputs/unit_outputs 的 object_id 用 unit:port。显式 Map key 为 record[/collection/object]，value 为真实工作台 item ID；未映射是 gap。这个 helper 不接受远端 record ID 直接冒充 item ID，也不把整数 revision 当工作台 SHA 哈希。映射结果仍须在授权依赖范围内解析。

## 证据边界

保留 Packet.evidence/execution、hardwareRef/geometryRef、appearanceRef 和原始来源；本模块不生成执行声明。外形匹配必须精确 modelId+revision；仅有匹配的 appearance-model 条目仍不证明该条目由真实执行器产生。布局尺寸为毫米，原生平移需 source-cad-native/1；估计 reserved-volume 不计为真实 CAD 零件通过。跨外形版本完整实例基线另需 layoutId/instanceId 和前序快照设计，本轮没有迁移或修改 worker。

## 失败诊断持久化字段提案

模块导出 `EngineeringIssue` 与 `EngineeringReport = ReturnType<typeof inspectEngineeringPacket>`。建议共享 Invocation 增加 `engineeringDiagnostics?: EngineeringReport`；若需要保留每次协议修复失败，使用 `engineeringDiagnostics?: EngineeringReport[]`，并为各尝试增加 attempt 标识。保存顺序应是：合并 normalize 的 issues 与 validate 的 issues → 建立包含 packetId/invocationId/dependencyPacketIds 的完整 report → 保存到当前调用 → 有 errors 则拒绝整包，无 errors 才提交 packet。错误提交不得成为可被下游消费的成功 packet。已有成功提案内 engineering-diagnostic 可继续保留，避免破坏读取端。

本模块的 report 不自动包含 normalize issues；后端需合并两者。`completeReferenceScope` 不替代真实依赖权限。最终专属测试覆盖了同一 report 内 error+gap 的完整性、JSON 序列化和证据不变，也通过真实 Workbench 测试读取 current.json，验证成功提案的 gap 实际持久化。失败分支的共享字段与保存顺序仍由后端/总协调实现，本角色不修改 runtime/contracts。

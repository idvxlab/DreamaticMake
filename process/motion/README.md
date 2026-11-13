# 运动配置操作

本目录保留底层操作 API，与 [motion_detail 主流程](../motion_detail/README.md) 配合使用。

## 信息与输出

输入：`MotionInput` 包含 action、motion_record_id、joints/transmissions/drives 和 initials。configure/set_configuration 接收显式设计；solve_target_pose 当前 unsupported。

上下文：本征与方案关节、刚体、传动、驱动、反向引用、当前初值与单位；给出哪些是 element-owned，哪些是跨元件新增。JointInitial 使用原生 Quantity（角度或长度维度）。

输出：joint/transmission/drive refs 及 motion 记录提案。本征关节不能作为新增 joints 重定义，仅允许初值覆盖；已有引用遇到地址变化必须先显式协调。此操作不同于九流程 MotionDetailOutput，支持传动、驱动及初值操作。

目录文件目标是 motion.joints/transmissions/configuration；drives 不可直接写入该目录协议。超范围配置由原生契约和 engine 校验；本操作无逆解或动力学后端。

## 执行 prompt

应用公共规则，先解析父子刚体与本征关节，再设置本次授权的方案关节、传动或初值。明确 m/rad、轴向和有限范围，检查配置短引用的展开结果；小按键也需要核对按压、限位和复位边界。实际检查初值、极限及必要中间姿态、根体随动；文件任务与 motion_detail 共用 motion.json 和阶段说明，不复制本征数据或另建运动说明。

## 调用与验收

从 `process.motion` 或原有 `process` 顶层导入 Input/Output/Request/Result/Process。`python -m process schema motion` 是实际字段的依据；先 inspect，再 run。需要修改记录的请求通过 for_design 指定 write_record_ids。

变更返回 DesignProposal；宿主用 build_candidate 构造候选，默认 references 等 requested_checks 针对候选执行。实际工程结论以 checks 的状态和覆盖范围为准，completed 不等于工程合格。持久化、项目文件映射、Agent 调用与审批边界见 [公共上下文协议](../CONTEXT.md)。

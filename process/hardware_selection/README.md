# 硬件选型

## 任务与来源

必需上游：`requirements`；另需嵌入的元件定义或 `ProcessContext(elements=...)` 只读库。案例从 `element/index.json` 获取实例及来源：yaw/shoulder/elbow 共用 servo，自定义件与固定库 gripper 分开处理。

## 给 Agent 的上下文

先给需求中的功能、尺寸、电源、控制协议、负载目标与未知项，再给候选摘要。按 Agent 请求补充完整原生定义，用 `element.language` 展示参数、证据、端子、几何与本征运动。只读搜索可复用 `SelectionProcess(action='search')`；`engine.element_search.ElementSearchTool` 也提供搜索/查看接口，需宿主注册。

候选比较按需求逐项记录满足/不满足/未知与来源，区分库合成模板、采购信息和真实测试证据。搜索命中不等于电气、机械或采购兼容。

## 执行 prompt

应用公共执行规则，把选型实际集成进项目：

1. DreamaticMaker 应用的正式选型从配置的小零件库取精确型号。兼容候选优先使用对应型号 STEP，缺少合适 STEP 时使用带尺寸的二维图纸。小库中找不到合格记录时提交 `hardware-blockers`，由调度器退回产品经理。
2. 以用户的体积、供电与交互目标比较候选；核对连接器/极性、额定值、板级电源路径、尺寸和缺失参数。整机备用要覆盖显示、控制与响铃负载，RTC 保时不等于整机续航。
3. 写元件包或精确库引用、实例索引与一份含数量/来源的 BOM；同型件共用定义。尚未知的真实尺寸、采购型号或运行电流明确保留，不用预算替代额定值或测量。
4. 阶段 README 只保留选择理由、替代方案的关键差别、必要预算和待核对项；不抄录全部原生属性，也不为每个元件自动生成 README。
5. 普通杜邦线等原型跳线作为连接辅材记录，可先确认数量和接法，线长、走线和固定方式留到装配。此类辅材无需查找精确料号或尺寸附件，也不会触发缺件报告。确实需要选型的专用线束或连接器仍按器件规则处理。

## 输出与检查

产物：`HardwareSelectionOutput.choices`；每项包含唯一 `selection_record_id`、完整 `ElementRef`、非空且不重复的 `instances`、`rationale`。引用必须从注入库或嵌入定义精确解析；不同阶段继续使用这些稳定实例 ID。

可选 `HardwareSelectionOutput.prototype_wiring` 记录原型跳线的描述、数量、两端接法及装配备注。电路阶段据此连接已选器件的真实端子，装配阶段确定线长和固定方式。

文件任务：维护 `element/index.json`；库件使用 `project_library_element` 引用文件，定制件使用原生元件包目录。保留共享关系，不把库属性抄进 design 文件。八层方案由 `SelectionProcess` 整合 selection 记录。

核对数量、版本、内容哈希、接口、供电额定值与未知需求。机械臂案例的合成夹爪不构成已验证采购件；库不可用时报告缺失，不自动改为其他版本。

应用的正式选型清单由 `python -m process library-pins hardware_selection` 生成。目录记录可通过 `ElementDefinition.evidence` 的 `mechanical_step` 或 `dimensioned_drawing` 登记同型号附件，填写来源、图号或页码，以及文件相对路径和 SHA-256。二维附件使用带尺寸的 PDF。应用验证附件后把引用随选型结果传给下游。

## 接口与公共约定

本目录 `__init__.py` 导出该阶段 Input/Output/Request/Process，依赖与上下文键由 Process.spec 定义。运行 `python -m process schema hardware_selection` 查看实际 schema。信息读取、版本、Agent 调用与写回边界统一见 [CONTEXT.md](../CONTEXT.md)。

# 装配与连接深化

## 任务与来源

必需上游：`requirements`、`spatial_layout`、`enclosure_detail`；可选：`motion_detail`。必须明确深化哪一版外壳。案例结合原生安装接口、运动固定连接与 `doc/assembly_detail/`；外壳没有真实孔位时不能推断孔位已可安装。

## 给 Agent 的上下文

按“源 CAD 组件及版本 → 硬件安装接口 → 已有世界位姿 → 固定/随动/关节关系 → 装配顺序和可达性”组织。涉及活动连接时附完整运动依赖；螺钉、配合、公差和工具空间缺失时列为待补信息，不从概念包络生成确定的安装依据。

## 执行 prompt

应用公共执行规则，把独立 CAD 件组织成可解释的装配：

1. 按元件实例核对每个件的固定对象、安装接口、相对位姿和紧固方式；复用运动阶段的固定/活动/随动关系，不建立相互矛盾的第二套树。
2. 检查装入路径、工具可达性、螺钉/螺母操作、线缆连接和后期拆卸。被其他零件封死的装配必须修改结构或顺序，不能只检查最终位置不相交。
3. 几何修改回写原生元件包，必要时联动索引/BOM、structure/motion、检查基线；目录契约无法直接承载的挂点与紧固件关系保存一份结构化附件，并在说明中引用。
4. 实际做适用的静态干涉、运动与根体随动检查，形成需要的装配 STEP。阶段 README 提供可操作的装配/拆卸顺序和关键配合说明，不抄写已有 JSON 清单，不宣称已实装。

## 输出与检查

产物：`AssemblyDetailOutput(components, relations, engineering_connections)`。保留所有原外壳 `component_id`，可新增组件。关系有唯一 `relation_id`、`parent/child`、`kind`、`relative_pose`；对象为 CAD component ID 或硬件实例的 `ObjectRef.key()`。joint 关系必须指向可选运动产物中的关节。

`engineering_connections` 使用原生 `StructureConnection`，端点必须解析到所选硬件的 Mount；当前检查不支持凭空引用 CAD 模型内部挂点，需先显式整合新元件，再在对应候选设计上处理。

文件任务：深化几何保存在 `element/<custom>/`；装配关节更新 `design/motion.json`，必要位姿更新 structure；装配树、紧固件及顺序写 `doc/assembly_detail/`。目录 v2 没有顶层 assembly 文件，不添加未支持的 `relations` 字段。八层连接用 `ConnectionProcess` 整合 structure。

检查源组件保留、对象引用、关系唯一性、joint 依赖。契约未覆盖的闭环、可拆装性、间隙及强度仍需独立检查，不能以 relations 存在宣称装配成功。

## 接口与公共约定

本目录 `__init__.py` 导出该阶段 Input/Output/Request/Process，依赖与上下文键由 Process.spec 定义。运行 `python -m process schema assembly_detail` 查看实际 schema。信息读取、版本、Agent 调用与写回边界统一见 [CONTEXT.md](../CONTEXT.md)。

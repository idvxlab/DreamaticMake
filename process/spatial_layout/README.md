# 空间布局

## 任务与来源

必需上游：`requirements`、`hardware_selection`、`appearance`。案例读取 `element/index.json`、对应元件完整定义、`design/structure.json` 以及相关阶段文档。由传递上游取得选型，不重复定义几何。

## 给 Agent 的上下文

按“空间边界与外观 → 实例清单 → 每种元件的几何包络/局部坐标 → 已有位姿与锁定要求 → 待放置对象”排列。列明世界坐标、安装面、活动空间、线缆/工具可达性和间隙来源；缺几何或尺寸时说明不能可靠求间隙。

位置单位 m，旋转为 xyzw 四元数。共享 servo 定义只展示一次，但 yaw/shoulder/elbow 分别列出实例。案例仅显式写 base/controller/supply 位姿，其余姿态由项目默认和运动链处理；不要把“未显式写入”描述成测量完成。

## 执行 prompt

应用公共执行规则，形成可由 engine 读取和查看的元件布局：

1. 先读取参考 `project_1/design/structure.json` 和当前元件局部坐标/包络，统一坐标轴、安装朝向、m 与 xyzw；外观仅给约束，不替代真实硬件尺寸。
2. 安排所有相关实例的装配位置，并为显示窗口、按压、插拔、布线、电池膨胀余量和装配工具留空间；缺几何时标记检查覆盖不足。
3. 只在清单指定的 structure 文件中写原生 placements，沿用参考格式；不另建一套 layout JSON 或 Markdown 坐标清单。参数化 CAD 需要的独有布局参数才另存附件。
4. 实际加载项目并核对位置/朝向；有实体时做适用的干涉检查。CAD 深化改变空间需求后同步修订位姿与基线，不能继续用旧布局检查背书。

## 输出与检查

产物：`SpatialLayoutOutput(coordinate_system='world_m_xyzw', placements=...)`；每个选中硬件实例恰好一条 `HardwarePlacement(instance_ref, world_pose)`，不允许重复、遗漏或未知实例。

文件任务：`design/structure.json` 的 `placements` 以项目实例键记录 Pose；不要把 ObjectRef 原样塞进此文件。目录 v2 可省略默认 Pose，产物 API 则要求所有选中实例完整覆盖。需求说明写入 `doc/spatial_layout/`。

八层整合可用 `PlacementProcess` 产生位姿提案，明确相对坐标到世界坐标变换。契约检查之外，需在整合后的设计做适用的碰撞/运动检查；布局投影不证明实体安装或避障成功。

## 接口与公共约定

本目录 `__init__.py` 导出该阶段 Input/Output/Request/Process，依赖与上下文键由 Process.spec 定义。运行 `python -m process schema spatial_layout` 查看实际 schema。信息读取、版本、Agent 调用与写回边界统一见 [CONTEXT.md](../CONTEXT.md)。

# 运动深化

## 任务与来源

必需上游：`requirements`、`spatial_layout`。案例读取 `design/motion.json` 和 servo/gripper 本征刚体、关节、限位、传动；结合需求中的目标范围及未知负载。

## 给 Agent 的上下文

按“刚体和世界位姿 → 元件本征关节 → 跨实例连接 → 轴与锚点 → 范围/初值 → 传动与驱动需求”排列。明确固定基座、父子方向、角度 rad、位移 m。元件内部关节保持 element 所有权，不复制成新方案关节。

案例 `mount/*` 是装配连接，`yaw/axis` 等配置引用 servo 本征关节。已存在的 gripper 关节声明与配置应先由 engine 解析确认，不用局部名字猜测对象地址。闭环和不支持机构必须说明检查覆盖。

## 执行 prompt

应用公共执行规则，明确真实的固定和活动关系：

1. 即使没有电机，也检查实体按键、滑盖、卡扣等是否需要运动表达。区分元件内部运动与跨元件装配关系，沿用已有刚体 ID，不复制本征关节。
2. 为活动件明确父子、轴、锚点、范围及初始状态；为固定件建立必要的固定/随动链。按 `project_1/design/motion.json` 写原生短引用，先确认配置引用的实际展开路径，不能根据名字猜测。
3. 实际执行初值、端点和必要中间位置的检查，核对键帽限位、导向间隙、有效按压与干涉；移动根体检查所有固定件和活动子件正确随动。
4. 说明只记录检查覆盖、关键行程依据及未验证部分，引用真实结果，不重复 Markdown 版的完整关节列表，也不从运动学通过推断触感或弹性寿命。

## 输出与检查

产物：`MotionDetailOutput(joints, notes)` 只表达连接所选硬件刚体的方案关节，不包含 transmissions/drives/configuration 专有字段；这些需底层 `MotionProcess` 或文件任务处理。运动关节必须有轴和初值；revolute/prismatic 有有限上下限，continuous 不设有限上下限；`source` 不可用来重定义本征关节。

文件任务：维护 `design/motion.json` 的 `joints/transmissions/configuration`。短引用按刚体/关节上下文展开，配置仅覆盖项目初值和收窄范围，不扩大本征限位。说明写 `doc/motion_detail/`。

检查父子刚体存在且不同、轴方向、初值与范围、传动引用。运动学检查需实际执行并绑定候选版本；不证明动力学、承载或目标姿态逆解成功，当前无逆运动学求解器。

## 接口与公共约定

本目录 `__init__.py` 导出该阶段 Input/Output/Request/Process，依赖与上下文键由 Process.spec 定义。运行 `python -m process schema motion_detail` 查看实际 schema。信息读取、版本、Agent 调用与写回边界统一见 [CONTEXT.md](../CONTEXT.md)。

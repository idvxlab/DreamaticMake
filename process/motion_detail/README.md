# 运动深化

## 任务与来源

必需上游：`requirements`、`spatial_layout`。案例读取 `design/motion.json` 和 servo/gripper 本征刚体、关节、限位、传动；结合需求中的目标范围及未知负载。

## 给 Agent 的上下文

按“刚体和世界位姿 → 元件本征关节 → 跨实例连接 → 轴与锚点 → 范围/初值 → 传动与驱动需求”排列。明确固定基座、父子方向、角度 rad、位移 m。元件内部关节保持 element 所有权，不复制成新方案关节。

案例 `mount/*` 是装配连接，`yaw/axis` 等配置引用 servo 本征关节。已存在的 gripper 关节声明与配置应先由 engine 解析确认，不用局部名字猜测对象地址。闭环和不支持机构必须说明检查覆盖。

## 输出与检查

产物：`MotionDetailOutput(joints, notes)` 只表达连接所选硬件刚体的方案关节，不包含 transmissions/drives/configuration 专有字段；这些需底层 `MotionProcess` 或文件任务处理。运动关节必须有轴和初值；revolute/prismatic 有有限上下限，continuous 不设有限上下限；`source` 不可用来重定义本征关节。

文件任务：维护 `design/motion.json` 的 `joints/transmissions/configuration`。短引用按刚体/关节上下文展开，配置仅覆盖项目初值和收窄范围，不扩大本征限位。说明写 `doc/motion_detail/`。

检查父子刚体存在且不同、轴方向、初值与范围、传动引用。运动学检查需实际执行并绑定候选版本；不证明动力学、承载或目标姿态逆解成功，当前无逆运动学求解器。

## 接口与公共约定

本目录 `__init__.py` 导出该阶段 Input/Output/Request/Process，依赖与上下文键由 Process.spec 定义。运行 `python -m process schema motion_detail` 查看实际 schema。信息读取、版本、Agent 调用与写回边界统一见 [CONTEXT.md](../CONTEXT.md)。

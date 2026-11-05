# 打印件优化

## 任务与来源

必需上游：`assembly_detail`；另外必须显式给 `PrinterConstraints`。案例 `doc/print_optimization/` 与源定制元件包是资料入口，不能默认已有可打印 CAD 或确定打印机。

## 给 Agent 的上下文

按“源装配组件/功能面 → 材料和连接约束 → 工艺/成形空间 → 最小特征/分辨率/悬空角 → 打印姿态/拆件/支撑方案”排列。`PrinterConstraints` 字段为 process（fdm/sla/sls/other）、`build_volume_m`、`min_feature_m`、`resolution_m`、`max_unsupported_angle_deg` 及 notes。

说明允许修改的形状与不能改变的安装面、配合和运动范围。缺工艺参数先请求补充；没有切片结果就把支撑和打印时间描述为建议或未知。

## 输出与检查

产物：`PrintOptimizationOutput.parts`；每项 `PrintPart` 含 `source_component_id`、`optimized: CADComponent`、`build_pose`、`support_strategy`、`feature_changes`。所有源装配组件必须被覆盖，一个源可拆为多个件，优化组件 ID 全局唯一。`build_pose` 是组件局部坐标到打印机坐标的变换，打印机 +Z 是成形方向，不能直接当成装配世界位姿。

文件任务：优化几何保存为明确版本的定制/派生元件包，打印姿态、源件映射和支撑说明写 `doc/print_optimization/` 并登记附件。只有显式选择替换装配件时才联动元件索引、装配引用和世界位姿；不为打印摆盘覆盖结构布局。

`submit` 检查源件覆盖和 ID，不检查真实包围盒是否落入打印机、壁厚/强度或支撑可行性。需要实际几何、切片与必要的实测证据才能宣称相应验证通过。

## 接口与公共约定

本目录 `__init__.py` 导出该阶段 Input/Output/Request/Process，依赖与上下文键由 Process.spec 定义。运行 `python -m process schema print_optimization` 查看实际 schema。信息读取、版本、Agent 调用与写回边界统一见 [CONTEXT.md](../CONTEXT.md)。

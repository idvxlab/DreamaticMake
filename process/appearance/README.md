# 外观设计

## 任务与来源

把需求和功能转化为外观图及说明。必需上游：`requirements`。案例读取 `doc/requirements/`、`doc/appearance/` 的登记资料，附已有项目摘要与明确的外观约束。

## 给 Agent 的上下文

按“目标用户/场景 → 功能与交互区域 → 形态/色彩/材质意向 → 必须保留的活动空间 → 参考图来源”组织。对机械臂列明底座稳定性、关节活动、夹爪开口、控制与供电区域；不可用渲染图证明安装尺寸成立。

图片附视角、用途、来源和可用状态。提供正视/侧视/轴测等所需视角；这些是任务要求，不是模型枚举限制。已有几何可作为参考，但此阶段不以硬件选型为必需依赖。

## 输出与检查

产物：`AppearanceOutput(images, design_notes)`；每张 `AppearanceImage` 有唯一 `image_id`、`AssetRef`、`view` 和 `caption`，媒体类型必须为 `image/*`。图像字节由宿主接入的生成/上传能力提供，流程本身不生成图片。

文件任务：图片和说明存入 `doc/appearance/` 并登记 `doc/index.json`，不改动位姿或元件几何。说明图中的关键区域、概念尺寸与尚未验证的内容。

检查实际附件、视角覆盖与需求一致性；`submit` 仅校验引用和数据契约，不读取图像字节，也不验证图中尺寸。缺少真实图片时不能编造可用路径和哈希。

## 接口与公共约定

本目录 `__init__.py` 导出该阶段 Input/Output/Request/Process，依赖与上下文键由 Process.spec 定义。运行 `python -m process schema appearance` 查看实际 schema。信息读取、版本、Agent 调用与写回边界统一见 [CONTEXT.md](../CONTEXT.md)。

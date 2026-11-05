# 外壳组件深化

## 任务与来源

必需上游：`requirements`、`spatial_layout`、`appearance`；硬件定义经传递选型取得。案例 base/upper_link/forearm 为概念几何，`doc/enclosure_detail/README.md` 明确材料、公差、壁厚、紧固件与真实孔位未完成。

## 给 Agent 的上下文

按“世界位姿/硬件包络 → 安装与操作区域 → 外观 → 材料与工艺 → 壁厚/间隙/开孔要求”排列。保留几何局部坐标、安装接口和资产单位；列出哪些约束已有依据，哪些需用户确认。重点展示外壳周围元件，同时保留受影响实例引用。

输出多个独立组件而非一个无结构网格；每件区分形状、材料和世界位姿。修改现有元件本征形状应走定制/派生元件版本，不在方案层复制或改写库定义。

## 输出与检查

产物：`EnclosureDetailOutput.components`；每个 `CADComponent` 包含唯一 `component_id`、原生 `CADHousing model`、`world_pose`。材料位于 `model.cad_housing.material`，物性未知可以明确保留。`generate` 无 CAD 执行器。

文件任务：原生元件包与几何资产放 `element/<custom>/`，新增实例在 `element/index.json` 登记，空间变更写 `design/structure.json`，设计说明写 `doc/enclosure_detail/`。产物不会自动导出这些文件；八层方案可用 `MechanicalDetailProcess` 显式集成已编写的 CADHousing。

检查材料、单位、组件身份与包引用；真实 CAD 生成需执行并读取结果，适配/强度/公差/制造能力需额外证据，不能从 schema 通过推断。

## 接口与公共约定

本目录 `__init__.py` 导出该阶段 Input/Output/Request/Process，依赖与上下文键由 Process.spec 定义。运行 `python -m process schema enclosure_detail` 查看实际 schema。信息读取、版本、Agent 调用与写回边界统一见 [CONTEXT.md](../CONTEXT.md)。

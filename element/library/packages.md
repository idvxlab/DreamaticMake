# 元件目录输入

统一数据源为 `element_pool`。
仓库中的 `element/` 保留协议、加载和检索代码，不存放元件数据。
[element-pool.json](../../element-pool.json) 提供默认路径。本机可在 `element-pool.local.json` 中设置
`root` 和可选的 `procurement_catalog`，或用 `DREAMATIC_ELEMENT_POOL` 和
`DREAMATIC_PROCUREMENT_CATALOG` 覆盖。其他机器运行示例及完整回归前，需要提供同一格式的库。

每个元件一个文件夹，目录名不承担身份或版本含义。例如：

```text
servo_sg90/
  manifest.json
  structured.json          # 原始资料转换记录，可保留未知字段和缺口
  electrical.json          # 补充资料
  motion.json
  assets/reference.step
  sources/
template_servo/
  manifest.json
  component.json           # 完整、严格校验的 ComponentDesign
  scenario.json
```

目录清单使用以下版本化格式：

```json
{
  "record_kind": "element_package",
  "package_version": "1",
  "name": "Position servo",
  "category": "actuator",
  "component_path": "component.json",
  "template_name": "servo",
  "scenario_path": "scenario.json"
}
```

完整工程字段可以集中放在一个 `component.json`，或以 `element_path: "element.json"`
指向带库身份的完整 ElementDefinition。补充 JSON、文档和 CAD 可自由随元件保存；
加载器不会猜测合并任意 JSON，也不会把 partial 记录补成可执行模型。
只有 structured_path 的目录保留发现能力，原有 blocker 和准入规则继续生效。
`template_name` 仅用于合成示例的稳定查找；真实硬件不需要这个字段。

`load_component(folder)`、`python -m engine compile folder`、
`python -m element language folder` 接受元件文件夹；原有显式 JSON/TOML 输入仍可用。
路径和 AssetRef 均相对该元件文件夹，拒绝越界、符号链接越界及未通过校验的资产。

检索器优先读取 `index.json`；没有索引时扫描各目录的 `manifest.json`。
改名或增加目录后同步修改索引，或移除缓存索引后自动扫描。
目录改名不改变 ElementRef；检索快照包含来源路径，可能随目录改名更新。
工作台元件检索直接只读加载统一池；显式发布库仍可用于设计固定引用。

```python
from element.io.package import template_path, scenario_path
from element.io.components import load_component

servo = load_component(template_path('servo').parent)
scenario = scenario_path('servo')
```

`scripts/generate-element-step.py ROOT --toolchain-dir PATH` 使用可选 OpenCascade
导出单刚体基本包络，并重读 STEP 检查拓扑、体积与尺寸。
结果写入元件 `assets/envelope.step`，以毫米保存，记录在 manifest 和根目录报告中。
合成示例的模型只表达假设包络，不修改源模型、哈希或已有场景，也不构成制造验证。
`scripts/validate-element-pool.py ROOT` 检查目录、模型、资产哈希并更新校验报告。

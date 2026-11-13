# 元件契约与元件库

`element/` 是代码和协议；项目 `element/` 保存具体元件定义与资产。
原生定义使用 `schema/professional.py` 的 `ElementDefinitionV2`，拥有 mechanical、electrical、
behavior、flow以及参数、来源和证据。`ElementRef` 固定库ID、元件ID、revision和内容哈希。

该原生读取器现在显式区分 element v2 与 v3：v2 原序列化与 pin 保持不变；
`schema_version: 3.0.0-draft` 增加 `units`、`exports` 和 `bom.policy`。
组合定义使用 v3；不含组合的既有采购件和打印件继续使用 v2。

## 子单元与引用

`units` 是唯一递归入口，映射键是局部实例 ID。`kind: reference` 保存完整 `element_ref`
和 `location: {kind, path}`，不复制子元件属性；项目内 custom 路径相对于项目 `element/`。
`kind: inline` 的 `definition` 使用 `UnitDefinition`：保留参数、四域、交付、证据与嵌套字段，
省略库身份和独立 revision。内联资产相对于拥有该定义的元件包，内联变更更新所属元件 pin。

`DomainRef` 增加可省略的 `unit_path`，例如
`{"unit_path":["cap"],"domain":"mechanical","collection":"links","id":"body"}`。
路径相对于拥有关系的单元；`[]` 表示本地。运动刚体继续归 `mechanical.links`，不递归；
关节端点引用本地或子单元对象。不要把运动刚体数量当作采购数量。

`exports[domain][collection][public_id]` 指向一个 `DomainRef`，只是别名，不复制几何或额定值。
v3 跨单元连接必须通过显式导出；v2 保留已有公开对象的访问规则。
`mechanical.mount_connections` 管内部安装连接，`electrical.nets` 管内部引脚网络。
外部安装与接线仍归项目。内部行为/流连接尚无组合执行适配器，读取时明确拒绝，不自动推导。

`bom.policy: self`（默认、省略）计本单元，不再计其内部；`children` 展开子单元。
展开型装配不能另有未归属子件的本地刚体、采购或制造交付，避免漏计。
内联交付项以所属 pin 加定义指针区分；不同实例复用同一引用元件时按其 pin 合并。

引用子单元的 `parameter_bindings` 仅支持 `{parameter: {value: {value, unit}}}`。
只允许声明为 configurable 的参数，按已有状态、单位维度和范围验证；源 pin 不变。
绑定只修改解析后的参数值，不自动重建 CAD、改写额定值或生成行为模型。

`composition.py` 校验依赖 pin、导出、路径和领域，展开上限为256个单元 occurrence、
最多16级子路径；拒绝依赖环。展开图是只读派生结果，不写回第二套工程源文件。

| 模块 | 职责 |
| --- | --- |
| `base/` | 不可变契约、身份、单位、位姿、信号和证据 |
| `interfaces/` | 几何、安装、电气、行为、软件等共享接口 |
| `schema/` | 原生定义、引用、检索和采购契约 |
| `categories/` | 14类创作接口；现有模型通过显式适配形成原生定义 |
| `migration.py` | 新 revision 迁移及只读兼容转换 |
| `io/、library/` | 有界读取、资产校验、固定版本存储和检索 |
| `language/` | 保留原始字段、单位和未知项的 Markdown 输出 |

几何、端子额定值和内部机构变化需要新的元件 revision；项目摆放和跨元件接线由 engine 管理。
`categories`、旧分类读取器和 `.model` 派生属性仍用于组件仿真与前端投影，保留为执行适配接口。
元件库位置必须显式指定；索引可重建，源定义才是权威数据。

目录格式见 [library/packages.md](library/packages.md)，检索见 [library/README.md](library/README.md)，
分类创作接口见 [categories/README.md](categories/README.md)。

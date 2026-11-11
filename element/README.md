# 元件契约与元件库

`element/` 是代码和协议；项目 `element/` 保存具体元件定义与资产。
原生定义使用 `schema/professional.py` 的 `ElementDefinitionV2`，拥有 mechanical、electrical、
behavior、flow以及参数、来源和证据。`ElementRef` 固定库ID、元件ID、revision和内容哈希。

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

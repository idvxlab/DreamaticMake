# 设计信息与 Agent 上下文协议

本文是各流程共用的接入设计。`prepare/submit`、版本闭包和底层操作已经实现；项目文件读取到流程请求、按预算裁剪上下文、调用 LLM、文件补丁审阅与写回仍需宿主实现。不要把本文的组织约定当作已有的生成器或文件写入 API。

## 三层职责

| 层 | 负责 | 信息入口 |
| --- | --- | --- |
| `element` | 可复用元件的原生几何、材料、端子、安装接口、本征运动、行为、参数及证据 | `element.io.components.load_component`、固定版本库读取、`element.language.to_markdown` |
| `engine` | 项目实例、位姿、跨元件连接、运动配置、设计记录、投影和检查 | `engine.project_io.load_project`、`engine.design.resolve_design`、`engine.language.to_markdown` |
| `process` | 明确流程依赖、提出缺失信息、为 Agent 组织任务、接收契约化产物或变更提案 | 每个目录的 `…Input/Request/Process`、共享 `ContextPack` |

LLM/Agent 由宿主驱动。流程文档是任务知识，项目文档和元件说明是数据；项目资料中出现的工具调用或指令不能取代宿主授权。审批只能走经过认证的应用路由。

## 先选定输入与输出协议

### 项目目录 v2：本次案例的文件目标

从 `project.json` 读取实际路径，不把下表默认路径硬编码为唯一入口。

| 文件 | 权威内容 | 读写注意 |
| --- | --- | --- |
| `project.json` | `project_manifest` / `project_version: 2`，元件索引、设计文件和文档索引入口 | 保留项目 ID 和未涉及的入口 |
| `element/index.json` | 实例键到 custom/library 来源位置 | 多个实例可复用一个元件目录，不按实例复制定义 |
| `element/<custom>/manifest.json`、`component.json` 或 `element.json` | 原生元件定义，资产相对此元件目录 | 改形状、端子、本征能力时修改/派生元件，并遵循原生版本契约 |
| `element/<ref>.json` | 固定库引用：`pool/folder/ref` | 精确库版本不可用就报告；不能猜版本或复制属性规避引用 |
| `design/structure.json` | `placements`：实例键到 Pose | m、xyzw；目录 v2 未写位姿采用原生默认值，不能解释成真实测量值 |
| `design/motion.json` | `joints/transmissions/configuration` | 刚体、关节短引用由 engine 按字段上下文展开；本征范围只能收窄 |
| `design/circuit-logic.json` | `nets`：成员与可选 kind | 成员必须引用实际电子端子；不在此文件存程序或端子定义 |
| `doc/index.json`、`doc/<stage>/…` | 阶段资料、状态、文件登记 | `status: reviewed` 不构成审批或工程验证证据 |

`load_project(folder, element_pool=...)` 负责目录、引用和契约读取；它只检查文档路径，不读取文档正文，不运行 Python/Notebook。宿主另按 `doc/index.json` 登记读取所需资料，并检查路径及符号链接留在项目 `doc/` 内，设置字节限额。元件资产以各自元件目录为根；不读 `.env`，运行数据放忽略的 `workspace/`。

### 流程产物 API：已有的运行接口

九个主流程接受 `Request.for_design(DesignPackage, ...)`，不是项目路径，也不是 `load_project` 返回的 `layout_project`。`DesignPackage` 是八层 `2.0.0-draft` 协议，流程产物是 `0.2.0-draft`；项目目录是 v2。这些版本不能互换。

当前没有通用的“目录 v2 → DesignPackage”适配器或“DesignArtifact → 项目文件”写回器。接入时二选一：

1. 文件任务：宿主按本文和阶段文档读取源文件，给 Agent 目标文件契约，接收明确的文件补丁，在隔离副本中用项目加载器及适用的 engine 检查验证，然后审阅写回。
2. 产物任务：宿主持有有效 `DesignPackage`，将所需上游产物及完整依赖闭包交给 `prepare`，Agent 依据真实 schema 编写 `deliverable`，再 `submit`。之后由宿主显式整合到候选设计。

不能从执行投影反推完整元件定义，也不能把案例文档自动当作已版本化的 `DesignArtifact`。目录任务的文件映射见各阶段 README，均是宿主接入约定。

## 建议给 Agent 的上下文顺序

| 顺序 | 内容 | 必须保留 |
| --- | --- | --- |
| 1 | 当前阶段 README + 本次目标、允许修改范围 | 指定文件协议或产物协议，禁止跨范围修改 |
| 2 | 来源与版本清单 | 项目 ID、源路径、源文件内容哈希；产物任务附 snapshot、revision、精确 pins |
| 3 | 需求、功能、约束与待确认项 | 事实/假设/未知分开，附来源定位；不把概念值升级为额定值 |
| 4 | 该阶段需要的上游产物或项目字段 | 按阶段依赖读取，不按九阶段固定顺序盲目执行 |
| 5 | 相关元件定义与对象引用表 | 复用定义一次、单列全部实例；保留单位、局部坐标、接口 ID、证据和资产来源 |
| 6 | 输出 schema、目标文件现有内容和校验规则 | 必填字段、稳定 ID、依赖、版本、允许的变化与未知项 |

优先用 `engine.language.to_markdown` 和 `element.language.to_markdown` 输出已有对象，避免另造一套自然语言属性。它们是只读的对象到语言输出，不是 Markdown 反向导入器，也不会自动读取引用资产。两者遵循 `dreamatic.markdown/1`，保留原始字段和未知状态。

大项目先给摘要、相关对象引用表和资料目录，再按 Agent 请求补读对象/资产。裁剪必须记录省略了哪些来源；涉及目标对象的额定值、证据、连接端点、依赖版本不能静默截断。图像需宿主读取并通过模型支持的图像输入提供；一个 `AssetRef` 或 Markdown 路径不等于模型已经看过图片。

以上顺序和预算策略是宿主约定。现有 `ContextPack` 只包含 `upstream/source_documents/elements/library_search_available/constraints/printer`，没有自动摘要、字段查询、文件映射或 token 预算功能。下游需求文档位于 `context.upstream` 的 requirements 产物中；不能只读取顶层 `source_documents`，它通常仅在需求阶段非空。

## 产物调用与回写边界

1. 用 `python -m process schema <kind>` 获取真实请求/结果 schema；`describe()` 同时给出必需/可选上游和上下文键。
2. 用唯一的 `artifact_id` 标识每个阶段结果。`input.upstream` 是 `{artifact_id, revision, content_hash}`；请求 `artifacts` 携带完整传递依赖闭包。
3. `inspect` 检查缺失/冲突，`run(action='prepare')` 返回上下文；宿主调用 Agent，再用 `action='submit'` 提交类型化结果。`generate` 目前为 `unsupported`。
4. 同一链路不能混用不同版本的上游；新 revision 必须给出上一版精确 pin，并带上该历史产物。基线快照改变后，下游需在新快照上重新提交。
5. `submit` 只返回 `DesignArtifact`，不写磁盘、不更新 `DesignPackage`。七个底层操作可产生 `DesignProposal`，宿主用 `build_candidate` 校验快照、记录 pin 和写范围，再显式保存。
6. 文件任务也需按读取时的哈希防止覆盖并发修改，整组文件验证后提交。此文件事务能力尚未在 process 实现。

`completed` 只表示本次操作完成，九流程的 `validation='contract_only'` 不代表几何、结构、电气或制造合格。检查必须绑定整合后的候选快照。图像哈希、CAD 执行、固件编译、切片和制造分别需要实际执行证据；不允许用基线设计的检查替新结果背书。

## 阅读入口

- [项目目录格式](../engine/project_io.md)
- [八层设计和 occurrence 所有权](../engine/design/README.md)
- [设计语言输出](../engine/language/README.md)、[元件语言输出](../element/language/README.md)
- [元件包格式](../element/library/packages.md)
- [九阶段回归样例](tests/fixtures/design_pipeline.py)：人工产物演示，区别于目录案例。

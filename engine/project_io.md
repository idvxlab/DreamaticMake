# 项目目录输入 v2

`load_project(folder, element_pool=None)` 显式只读加载 `project.json`，支持默认统一库
或调用方指定的元件库根目录。项目文件、库引用文件和自定义元件路径分别受项目/元件目录约束，
拒绝越界与符号链接越界。不执行文档、Python 或 Notebook。

项目清单 `record_kind: project_manifest, project_version: 2` 指向：

- `element/index.json`：`project_elements` / `schema_version: "1"`，`elements` 按项目实例键索引。
- `design/structure.json`：`placements` 按元件键记录非默认 `Pose`。
- `design/motion.json`：`joints`、`transmissions` 和 `configuration`。
- `design/circuit-logic.json`：`nets`，每条只有 `members` 与可选 `kind`。
- `doc/index.json`：`project_documents` / `schema_version: "1"`，按阶段登记文件。

元件索引条目为 `{"kind":"custom","path":"servo"}` 或
`{"kind":"library","path":"gripper.json"}`。路径相对于 `element/`。
多个实例键可以共用一个目录或库引用文件；`design/` 中不再重复 `definition` 或工程属性。
自定义目录使用统一库的 `manifest.json + component.json/element.json` 格式；
可省略原生非必填字段，缺失几何和参数保持缺失。几何资产始终以该元件自己的目录为根。

库引用文件使用 `project_library_element` / `schema_version: "1"`，
记录 `pool: "default"`、目录 `folder` 和完整 `ElementRef` 固定引用。
加载时核对库身份、版本、内容哈希、目录和准入状态；不复制属性到项目文件，也不自动换版本。
本例使用库中的合成夹爪，并未把它当作已验证的真实采购件。

短引用按上下文展开：`yaw/case` → `yaw/bodies/case`，
`yaw/axis` → `yaw/joints/axis`，`yaw/pwm` → `yaw/terminals/pwm`。
显式完整引用继续可用。关节锚点默认单位位姿，初始值和范围继承元件定义；
`configuration` 只记录项目自己的初始值和收窄范围（rad/m），拒绝越界初始值和扩大本征限位。
电路仅连接实际存在的电子接口，不为接线临时复制端子字段或建立虚构接口。

加载结果是在内存中解析的 `layout_project` v2，可交给 `import_layout` 和
布局/运动/连通检查。解析结果不是新的磁盘源文件，也不代表完成实体编译或物理验证。
原有 `layout_project` v1 的内联案例继续可读；`schema layout_project` 输出 v2。
八层 `DesignPackage` 的通用 `flow` 合约继续服务其他设计场景，project_1 不声明独立 flow 层。

工作台可通过项目路径或本机文件夹选择器加载任意同格式目录，并按项目实例键查看元件。
项目源文件树只列出 `design/`、`doc/` 和根说明/清单；元件源文件树则以对应自定义目录
或已固定引用的库目录为根。预览为只读操作，文件路径和符号链接仍受各自根目录约束。

```powershell
.\python.cmd -m engine project examples/project_1
.\python.cmd -m engine language examples/project_1
.\python.cmd -m engine schema project_manifest
.\python.cmd -m engine schema project_elements
```

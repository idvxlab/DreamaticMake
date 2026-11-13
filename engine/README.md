# 工程引擎

当前项目支持 element v2/v3、项目目录 v3、execution v1。入口是
`project_io.load_design_package()`；简写字段见[项目格式](project_io.md)。

| 模块 | 职责 |
| --- | --- |
| `design/professional.py` | 四域契约、引用、固定版本、整机构树、FK和投影 |
| `design/authoring.py` | 短引用、缺省值与简写导出 |
| `query/` | 项目资料和工程对象的范围查询、来源与预算 |
| `candidate.py` | 有界语义操作、revision/pin更新与隔离候选 |
| `tools/` | 运动学、OCCT、FCL、Sismic白名单适配器与执行证据 |
| `interface/` | 本地项目/元件工作台 |
| `compiler/、schema/、simulator/、projection/` | 可执行组件模型及其编译、仿真和视图 |
| `layout.py、layout_project.py` | 工作台布局投影及仍在使用的 v2 兼容读取 |
| `adapters/、io/、language/` | 显式转换、读取、JSON Schema与只读 Markdown |

元件自身工程属性归 element；项目实例位姿、跨元件连接及初值归 design。
element v3 的子单元通过固定引用或内联定义展开，FK、BOM、查询及几何工具共同使用同一解析图。
路径如 `button_stop/cap/links/body`；项目连接使用机构导出的接口，不复制子元件属性。
任务依据和过程说明由项目 `doc/` 维护，engine 不再另存八层 analysis/function 文档。
旧八层记录、SQLite DesignStore和流程产物接口已归档，不提供其旧请求路由。

```powershell
.\python.cmd -m engine schema design_package_v3
.\python.cmd -m engine project-views examples/project_2
.\python.cmd -m engine tool-list
.\python.cmd -m engine tool-run examples/project_2 --tool native_kinematics --operation pose
```

工具能力、缺失覆盖和实际执行边界见 [tools/README.md](tools/README.md)。
v2 案例和独立组件仿真仍由其专用读取器处理，不冒充 v3 或固件/实物验证。

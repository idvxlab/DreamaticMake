# 床头数字小闹钟

项目 `bedside-alarm-clock`，采用 element v2/v3、project v3。当前有18个顶层实例、
43个单元 occurrence、22份元件定义；BOM展开后仍为38个交付实体。
36条关节关系、19个电气网络及54条安装连接保持不变；12种打印定义复用为25个实例。
外壳120×60×65mm，仍为原型草稿。尺寸、配色和预算尚未最终确认。

| 位置 | 权威内容 |
| --- | --- |
| `project.json` | 路径、索引哈希和四域记录 pin |
| `element/` | 固定元件定义、局部参数、STEP/STL及单位 |
| `design/structure.json` | 根位姿和14条跨单元安装连接 |
| `design/motion.json` | 16条跨元件固定关系；内部关节及默认初值归按键机构 |
| `design/circuit-logic.json` | 网络及24个显式未接引脚 |
| `design/logic.json` | MicroPython工程、目标平台和源码清单哈希 |
| `doc/index.json` | 当前参考资料和保留过程成果的登记入口 |
| `doc/tasks/index.json` | 分包任务所需查询及文档范围 |
| `doc/<stage>/` | 需求、决定、设计理由和阶段独有成果 |
| `analysis/tools.json` | 当前工程快照的实际工具检查配置 |

任务资料在 `doc/` 维护；工程结果在 `design/` 或 `element/` 维护，避免在说明中复制一套可编辑工程数据。
CAD、打印姿态和装配姿态分别保留；STL/STEP显式声明mm，原生位姿使用m。
简写规则见[项目协议](../../engine/project_io.md)。

五组按键由 `button_assembly_large`（1实例）和 `button_assembly_small`（4实例）复用。
每组含 guide、gate、cap、retainer、switch 五个固定引用子单元，拥有3条内部固定关系、
1条0.4mm按压关节及8条内部安装连接。对外导出安装接口、开关引脚及 press 关节。
例如 `button_stop/joints/press` 控制 `button_stop/cap/links/body`；BOM按 children 展开。
元件和几何资产未改版，仅新增组合定义。开关 pressed 仍是环境输入，未将键帽位移推导为触点仿真。

需求和功能见 [doc/requirements/README.md](doc/requirements/README.md)，用户原文与决定仍在该目录。
软件说明见 [software/Feather_RP2040_1/README.md](software/Feather_RP2040_1/README.md)。
打印交付见 [doc/print_optimization/README.md](doc/print_optimization/README.md)。

```powershell
.\python.cmd -m engine project-views examples/project_1
.\python.cmd -m engine tool-run examples/project_1 --tool native_kinematics --operation pose
.\python.cmd scripts/verify-project2-v3.py examples/project_1
```

旧选型版本、迁移副本、过时生成器和重复说明已保存到
`../../z_bin/cleanup-2026-11-11/examples/project_2/`，归档清单记录原路径与字节哈希。
现有元件与源码未改版。当前没有Sismic模型或硬件桥，不能由MicroPython源码推导已完成仿真。
未编译目标固件、切片、打印或实装；工具执行记录保存在仓库 `workspace/tools/`。

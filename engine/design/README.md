# v3 项目设计

`professional.py` 定义项目清单、实例索引及 structure、motion、electrical、logic 四域。
`authoring.py` 在读取时展开短引用与缺省值，通过 `compact_record()` 导出等价简写。

权威入口是 `engine.project_io.load_design_package()`。它核验元件和记录 pin、资产及源码清单；
`resolved_poses()` 计算整机FK；`project_views()` 提供共同快照和来源映射；
`bill_of_materials()` 按精确元件引用统计实际实例。

项目需求、设计决定和任务过程成果放在项目 `doc/`，不在工程域中维护第二份文档。
完整文件规范见 [project_io.md](../project_io.md)，执行器边界见 [tools/README.md](../tools/README.md)。
旧八层协议及其存储、提案和文档导入导出代码已归档到仓库 `z_bin/`。

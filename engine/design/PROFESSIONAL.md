# 专业领域协议与迁移入口

版本为 element v2、项目目录 v3、DesignPackage v3、projection v2 和 execution v1。
旧版本读取器继续使用原协议；不会在加载时修改文件或旧 revision。

## 使用入口

`engine.project_io.load_design_package(path)` 是 v3 权威输入，验证清单、索引哈希、
四域记录 pin、完整 ElementRef、声明资产和软件源码清单。本地文件受所属包根约束。
`engine.io.load.load(path)` 对 v3 项目返回这个包。`load_project` 仍是浏览器的显式
v2 兼容投影，从新包派生，不写回。

`resolved_poses` 在完整实例化森林上统一计算 link 世界位姿，拒绝重复父节点、循环、
重复位姿权威、缺根和越界初值。`project_views` 生成四域共同快照与来源映射，
`bill_of_materials` 只统计真实实例。

`element.migration.migrate_component`、`migrate_definition` 返回新 revision 和映射报告。
后者给旧外层 parameters/sources/evidence 分配独立命名空间，避免覆盖内层同名记录。
旧分类构造器可以调用 `to_element_v2(library_id=...)`；兼容 `model` 是只读派生属性，
不会写进新 JSON。

```powershell
.\python.cmd -m engine.migrate_project SOURCE NEW_DESTINATION
.\python.cmd -m engine schema element_definition_v2
.\python.cmd -m engine schema design_package_v3
.\python.cmd -m engine schema scenario_v2
.\python.cmd -m engine schema execution_result_v1
```

通常迁移到新目录后再审核；同目录迁移仅用于明确保存历史档案的工作。
迁移器拒绝缺少单位的旧视觉资产、不明确的凸包、待审查耦合和项目限位收窄，
需要人工补充输入。旧 outer 近似保留但附证据审计提示。

## 当前执行范围

| 入口 | 已执行语义 | 边界 |
| --- | --- | --- |
| kinematics | 引用、森林、根、双锚点 FK、初值限位 | 无动力学；未知范围 unknown；配置集/耦合 unsupported |
| electrical_rules | pin/net、重复归属、推挽冲突、电源接地冲突、未接覆盖 | 内部规则子集；未接与配置缺口 unknown，非 ERC |
| mesh_geometry | 复用既有 STL hash/单位/拓扑检查 | 显式 host asset_resolver；无网格 unknown |
| Sismic restricted-v1 | 原生解释器、布尔数值表达式、事件字段、赋值、send、after、idle | 一个 unit；显式时间唤醒；无硬件桥、传输故障或固件执行 |
| URDF | 完整机构子锚点重基准、primitive geometry、source_map、多根 synthetic world | 无 STEP/网格打包；未知速度/力矩 needs_input；非 urdfdom 验证 |

`engine.statechart` 用 AST 解释受限表达式，不调用 Python eval/exec。禁止 import、
任意属性链、循环、动态函数及序列运算；上下文和事件只接受有限原始值。
宿主按稳定顺序逐个处理同时间事件，在显式 wakeups 推进 after 条件，设微步预算。
没有显式时间点之间的连续性质证明。依赖固定为 Sismic 1.6.11、PyYAML 6.0.3。
Sismic 的 LGPLv3 发布义务需要随实际分发形式处理。
接口依据：[Sismic 时间模型](https://sismic.readthedocs.io/en/1.6.11/time.html)。

结果区分 execution 与 outcome，绑定设计快照、场景、资产、模型版本和选项 hash。
修改 YAML、几何、pin 或软件会使旧 pin/快照失效。执行证据没有审批权限。

## 后续工作

当前是可运行的协议和迁移基线，不是方案全文的完成声明。分类适配器中的
specification、behavior、flow 和部分安装接口仍复用既有类型载荷，尚未全部转换为
新领域引用与原生多端口执行模型。旧类别构造器仍可生成旧记录，需显式适配。

KiCad 原理图生成、回读和真实 ERC，OCCT STEP 读取/选件/离散化缓存，FCL 新协议
碰撞与离散路径检查，自动定时唤醒、多 unit、端口/引脚/接点/关节桥，以及四域双向
编辑定位仍需实现。不能因依赖已安装就返回 pass。
project_2 已单独迁移为目录 v3，保留 38 实例/36 关节/19 网络；迁移前后姿态、资产和新工具验证见 examples/project_2/doc/migration/validation-v3.json。该验收独立于 project_1。

# 工具适配与执行（tools/1）

`engine.execution`、CLI 和工作台共用只读工具服务，不改变元件、设计、审批、BOM 或固件。Python 库入口为 `describe(probe=True)`、`prepare(request, context)`、`run(prepared, context)` 和 `present(result, snapshot_id)`。

## 已实现

| 工具 | 操作 | 输入与范围 |
| --- | --- | --- |
| native_kinematics | pose / sample_trajectory | 原生 v3 双锚点 FK；v2 显式兼容布局 FK；祖先依赖完整求解后筛选展示范围 |
| fcl_collision | collision / clearance / trajectory_collision | v3 collisions / v2 envelopes；primitive、STL、STEP 派生网格；全项目内部或显式对象对 |
| occt_geometry | inspect_step / tessellate | v3 声明的 STEP；整份资产检查；显式 mm Reader 目标、一次归一化；单位冲突拒绝执行 |
| sismic_statechart | validate / simulate | v3 单 unit，Sismic 1.6.11 restricted-v1；显式宿主时间、稳定事件序号、全图受限代码验证与 send 事件记录 |

安装可选依赖到项目的 Python 环境：

```powershell
.runtime/python/Scripts/python.exe -m pip install -r engine/tools/requirements/occt.txt
.runtime/python/Scripts/python.exe -m pip install -r engine/tools/requirements/collision.txt
.runtime/python/Scripts/python.exe -m engine.cli tool-list
.runtime/python/Scripts/python.exe -m engine.cli tool-run examples/project_1 --tool native_kinematics --operation pose
.runtime/python/Scripts/python.exe -m engine.cli tool-run examples/project_1 --tool fcl_collision --operation collision
.runtime/python/Scripts/python.exe -m engine.cli tool-run examples/project_1 --tool sismic_statechart --operation simulate --scenario simulation/interlock.json
```

`--scope` 可重复，选择 instance、link/body 或具体几何 occurrence。子集只检查子集内部，项目环境必须加入 scope 或使用全项目。`--options` 接受对应操作的严格 JSON schema；轨迹需要 `samples: [{time_s, positions}]`、`max_step_s`，连续关节需要 `continuous_policy: "unwrapped"`。插值只对关节位置，时间严格递增，总采样最多 2000，pair×sample 最多 100000。

工作台提供 prepare→run、结构化结果、范围与旧快照提示，并通过显式 display map 定位现有模型。CLI 提供完整轨迹参数。桥接提供 tools_describe/tools_prepare/tools_run/tools_result/tools_artifact；结果与资产读取只接受受管理 ID 和已登记的 artifact，不能传任意文件路径。

## 证据与生命周期

宿主固定 source，按 owner 限制资产、检查 hash、将核验字节作为输入传给白名单 worker。run 会再次准备核对，防止资产或输入在准备后变化。worker 不接收 project_path。每次运行仅生成一个 ExecutionResult 证据封套；兼容 API 从该结果投影。

运行记录在忽略目录 `workspace/tools/`，项目桥接按项目根的摘要分 namespace。request、manifest、source-map、raw report、artifacts 与原子发布 result.json 保留可查。原始报告是证据补充。几何缓存只复用同资产/选件/单位/离散选项/实际版本/adapter 的派生几何，重新探测版本并检查缓存内容摘要；每次运行仍生成新的证据。完整检查结论没有跨快照缓存。

worker 使用固定解释器、白名单模块与操作，单项累计 20 秒预算小于桥接 30 秒总超时。Windows 超时/取消使用 taskkill /T /F；POSIX 使用进程组。浏览器连接关闭会回收 bridge 进程树。输入、日志、YAML、AST、三角数、任务数和输出均有预算；这属于故障隔离，不是操作系统安全沙箱。

距离和接触使用世界坐标 m；碰撞不报告未经验证的负距离穿透深度。STL solid 复用既有闭合、绕向、正体积检查及内含算法。缺失几何、未知近似、无检查对或 STEP 三角化没有已证明外包络误差界时不会给出通过。离散采样安全不证明采样间隔内安全。

## 当前边界

- STEP 仅整份选择；名称/产品路径子形状选择、多单位混合、自动修复未实现，显式 unsupported/needs_input。
- v2 当前支持 FK/FCL；八层 DesignPackage、ModelBundle/IR 的新工具 source adapter 尚未实现，旧 API 保持。
- 耦合、非空 collision_policy、硬件/多 unit bridge、动态自动唤醒和连续碰撞 profile 不执行。record/带单位或字段的输入事件暂拒绝，不猜测端口含义。
- send trace 是解释器中可信 hook 记录的事件，未声明硬件端口映射。状态图通过不代表 MCU 固件或产品仿真通过。
- 工作台当前提供单次分析与来源定位；完整轨迹参数通过 CLI/库接口，持久 JobManager 和联合仿真不在本期。
- 后端未公开原生 FCL/OCCT 版本时明确记录 not-exposed-by-binding，单独记录 OCP 和 FCL 的绑定版本，不能用绑定版本冒充。

新增工具需要添加固定 registry 项、严格 Options、双向 adapter/backend、来源映射以及真实执行测试。不得注册任意请求提供的 import、shell 或代码。

验收：`npm run check`、`npm test`、`npm run build`。`engine/tests/test_tools.py` 使用真实 OCP/FCL/Sismic；可选工具缺失会 skip，不能把 skip 作为几何成功证据。

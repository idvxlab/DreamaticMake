# Design processes — 0.2.0-draft

`process/` 是设计引擎的流程接口层：定义输入输出、组装上下文、检查依赖版本，并输出宿主可展示的设计产物。它不负责连接 agent、模型供应商或调度器。依赖保持 `process → engine → element`；复用原生几何、材料、位姿、关节和电路类型，不复制其实现。

## 九个关键流程

| `process_kind` | 必需输入 | 输出 | 关键上下文 |
| --- | --- | --- | --- |
| `requirements` | 原始文档 `source_documents` | 需求文档、功能文档，支持 Markdown / 文档资产引用 | 原始文档版本、使用场景、边界和约束 |
| `appearance` | 需求与功能文档 | 一组带视角和说明的图像引用 | 功能、外观约束、参考资料 |
| `hardware_selection` | 需求与功能文档 | 硬件库精确版本引用、实例清单、选型理由 | 注入的只读硬件库或设计中嵌入的库定义、参数、证据 |
| `spatial_layout` | 文档、选型、外观 | 每个硬件实例的世界坐标位姿 | 元件几何、外观图、空间边界、坐标系 |
| `logical_layout` | 文档、选型 | 电路逻辑网络、显式未连接端子 | 原生硬件端子、额定参数、电气需求；不依赖空间布线 |
| `enclosure_detail` | 文档、空间布局、外观 | 多个 CAD 组件，各自包含材料和位姿 | 硬件包络、空间位姿、外观、材料、间隙和加工约束 |
| `motion_detail` | 文档、空间布局 | 跨元件关节、运动范围、初始配置 | 原生刚体、锚点、轴向、范围和初始姿态；连续转动无有限上下限 |
| `assembly_detail` | 文档、空间布局、外壳 CAD；运动设计可选 | 深化后的 CAD 组件、固定/随动/关节装配关系 | 原外壳组件、硬件安装接口、相对位姿、可选运动关节 |
| `print_optimization` | 装配深化 CAD、打印机约束 | 优化后 CAD、打印位姿、支撑策略、特征修改说明 | 工艺、成形空间、最小特征尺寸、分辨率、悬空角度 |

装配深化显式输入 `enclosure_detail`，以明确“深化哪一版外壳”。这补齐了只给文档和空间布局无法定位待修改 CAD 的依赖。打印阶段的每个结果用 `source_component_id` 回溯装配组件，允许一个原组件拆成多个打印件，但要求覆盖全部原组件。

流程是依赖图：外观与选型可独立进行；空间布局与电路逻辑布局具有不同的依赖；外壳与运动深化可独立进行。九个流程不等于 `engine` 的九个存储层：需求与功能仍对应 analysis/function，空间/外壳/装配共用原生 structure 表征，电路逻辑对应 circuit_energy，运动对应 motion。这里的逻辑布局指电路连接关系，固件和行为程序仍由底层 `logic_detail` 操作处理。

## 统一接口

`workflows.py` 导出九套 `…Input`、`…Request`、`…Process`，如 `SpatialLayoutInput`、`SpatialLayoutRequest`、`SpatialLayoutProcess`；原生输出模型位于 `artifacts.py`。每个流程提供：

- `describe()`：真实 JSON Schema、必需/可选上游、上下文键和能力边界。
- `inspect(request, context)`：检查快照、缺失上下文、版本冲突与输出引用，不写入任何存储。
- `run(request, context)`：`prepare` 返回 `ContextPack`；`submit` 接受显式编写的产物并返回 `DesignArtifact`；`generate` 当前返回 `unsupported`。
- `project_artifact(artifact)`：返回绑定产物版本的 JSON 视图，包含文档、图集、硬件表、空间场景、电路图、CAD 组件、运动图、装配场景或打印场景数据。

视图是供宿主渲染的数据接口，本次没有新增浏览器编辑器。图像以 `AssetRef` 传入；材料直接使用 `CADHousing.cad_housing.material`，允许物性显式未知。空间位置使用米和 `[x,y,z,w]` 四元数。打印 `build_pose` 表示组件坐标到打印机坐标的变换，打印机 +Z 为成形方向。所有几何和材料仍由 `element` 原生契约表达。

请求包含固定的 `base` 设计快照、`input.upstream` 精确依赖引用，以及 `artifacts` 中的完整上游闭包。`ContextPack.upstream` 包含解析后的传递依赖；空间布局之后的流程可由此取得原始选型。`ContextPack.elements` 提供所选元件的完整原生定义；选型准备阶段提供已嵌入的库定义，`library_search_available` 指示是否注入了只读搜索接口。库搜索复用 `SelectionProcess(action='search')` 与 `ProcessContext(elements=...)`。

产物引用为 `{artifact_id, revision, content_hash}`；哈希覆盖产物内容、依赖和上下文。新 revision 必须提供前一版精确 pin，并在请求中携带该版本。产物保存 `previous`、源设计快照、输入文档、约束、打印机参数和上游引用。宿主负责保存产物和选择当前版本，本层不维护隐藏的“最新版本”。

检查会拒绝缺失闭包、错误哈希、错误设计、不同快照、依赖环、重复身份，以及同一链路混用不同版本的上游产物。保守策略是：设计快照变化后，需要在新快照上重新提交流程产物。无关历史产物无需加入请求。

`submit` 还会检查：每个已选硬件恰好有一个空间位姿；选型必须能从库/嵌入定义精确解析；硬件端子恰好出现在一个网络或未连接清单中；关节连接有效刚体且具有所需范围与初始值；装配对象存在；打印结果覆盖原组件。这些是契约和上下文检查，**不是几何、结构、电气或制造验证**。资产引用的接受也不表示文件字节已被读取或哈希核验。

```python
from process import AppearanceInput, AppearanceRequest, AppearanceProcess, artifact_ref

# design: engine 的 DesignPackage；requirements: requirements 阶段返回的 DesignArtifact
request = AppearanceRequest.for_design(
    design,
    artifacts=(requirements,),
    input=AppearanceInput(
        action='prepare',
        upstream={'requirements': artifact_ref(requirements)},
    ),
)
report = AppearanceProcess().inspect(request)
result = AppearanceProcess().run(request)
# result.output.context 提供文档和约束，交给宿主展示或后续人工设计。
# 完成设计后，用 action='submit' 与 AppearanceOutput(images=...) 提交图像引用。
```

```powershell
.\python.cmd -m process list
.\python.cmd -m process schema spatial_layout
.\python.cmd -m unittest process.tests.test_workflows -v
```

`list` 优先列出九个 `category=workflow` 流程，随后列出七个 `category=operation` 底层操作。`schema` 导出每个具体流程的精确输入类型；`request` 仍从 stdin 接收一个有大小限制的 JSON 请求。九阶段回归数据位于 [`process/tests/fixtures/design_pipeline.py`](tests/fixtures/design_pipeline.py)：使用人工定义的简单几何和未读取的图像引用演示数据流，不生成图片或优化几何。

## 与现有 engine 检查的关系

流程产物独立于持久化的 `DesignPackage`：提交产物不会静默覆盖方案。宿主明确整合时，可用下述底层操作创建 `DesignProposal`，经 `build_candidate()` 得到新快照，再调用 `engine.design.project_design()` / `check_design()` 做已有的连通性、碰撞或运动检查。检查证据绑定整合后的快照，不能转用于未整合的产物。新流程请求直接携带 `requested_checks` 会返回 `unsupported`，防止误把基线设计的检查当成新产物的检查。

所有新流程结果标记 `validation='contract_only'`，不产生模拟执行证据；没有图像生成器、CAD 求解器、切片器或 agent 的隐式调用。审批仍只在经过认证的应用路由执行。

## 保留的底层操作 — 0.1.0-draft

`element/` defines reusable objects. `engine/` defines designs and performs parsing, projection and checks. This top-level `process/` package describes the information needed for a design operation and produces typed results and reviewable changes to those existing objects.

The dependency direction is `process → engine → element`, with direct read access from process to element. No agent runtime, approval decision or project-storage writer is included.

## Implemented classes

Each module exports an `Input`, `Output`, `Request`, `Result` and a process class with `describe()`, `inspect(request, context)` and `run(request, context)`.

| Class | Implemented operations | Explicit limits |
| --- | --- | --- |
| `SelectionProcess` | Library search, pinned candidate comparison, choose/replace into a selection record | No automatic commercial selection; unknown/assumed requirements remain unknown |
| `PlacementProcess` | Explicit discrete-instance poses in world coordinates or relative to a placed body | No automatic layout; conflicting existing body pose overrides must be reconciled |
| `ConnectionProcess` | Explicit mechanical mounts, electrical nets, external material/information edges, energy transfers and required paths | Does not infer holes or interfaces; preserves intrinsic element topology |
| `MotionProcess` | Cross-element joints/transmissions/drives and explicit moving-joint initial values | No inverse kinematics; inherited-address changes with existing references need explicit reconciliation |
| `MechanicalDetailProcess` | Snapshot-bound material/subject information; integrate an authored `CADHousing` as a new pinned selection and instance | No general CAD generator, attachment solver, fit/strength/manufacturing check |
| `CircuitDetailProcess` | Explicit wiring nets using the same connection helpers | No EDA/analog/ERC/PCB generation or verification backend |
| `LogicDetailProcess` | Typed logic authoring/binding using `LogicData`, including inert code or firmware references | Saves source without execution; no Python sandbox or firmware compiler |

This is the first executable subset of the plan in `agent/代码计划/设计流程工具适配与输入输出接口.md`. Its schemas are exported from the actual models. Some planned actions and fields are deliberately not accepted yet; the returned JSON Schema, rather than a future plan, defines what this implementation accepts.

## Python usage

```python
from element.io.components import load_component
from element.schema.library import ElementDefinition
from element.io.records import element_ref
from engine.design import make_package, project_design
from engine.design.contracts import DiscreteUsage, Instance
from process import (
    SelectionProcess, SelectionRequest, SelectionInput, build_candidate,
)

model = load_component("D:/【项目】设计引擎/DreamaticMaker/element_pool_2/template_gripper/component.json")
definition = ElementDefinition(
    library_id="examples", element_id=model.id, revision=model.revision,
    name=model.name, category=model.category, origin="template", model=model,
)
design = make_package(design_id="demo", title="Demo", elements=(definition,))
request = SelectionRequest.for_design(
    design,
    input=SelectionInput(
        action="choose", chosen_ref=element_ref(definition),
        usage=DiscreteUsage(planned_count=1, instances={"gripper": Instance(label="Gripper")}),
    ),
    write_record_ids=("selection",),
)
process = SelectionProcess()
needs = process.inspect(request)
result = process.run(request)
if result.status == "completed" and result.proposals:
    candidate = build_candidate(
        design, result.proposals[0], write_record_ids=request.scope.write_record_ids,
    )
    views = project_design(candidate)
```

Python constructors use immutable tuples and strict existing models; JSON requests use arrays. `Request.for_design()` fills the fixed snapshot and expected revision. Requests are revalidated before execution, including callers that used unchecked `model_copy()`.

`ProcessContext(elements=...)` can provide an `ElementLibrary` or compatible read-only reader. Exact pins may instead be embedded in `DesignPackage.elements`. Asset reads for actual engine checks require an injected resolver and an explicit request allowlist; bytes are checked against their SHA-256.

## Results and persistence

`inspect()` reports missing/conflicting information or unsupported operations without changing a design. `run()` returns `completed`, `needs_input`, `unsupported` or `failed`. Completed means the operation produced a result; inspect `checks`, their outcomes and coverage before interpreting engineering validity.

Mutation operations produce a `DesignProposal`, containing whole-record upserts and pinned definitions to embed. `build_candidate()` checks the baseline snapshot, write scope, previous record pin, revision increments and immutable element identity, then constructs a new `DesignPackage`. It does not persist it. Incomplete engineering references remain draft diagnostics, as in the engine authoring protocol.

Actual checks run on the candidate snapshot, not the baseline. All previous check results become stale with respect to that new snapshot. A host may explicitly commit the candidate with `DesignStore.commit(..., expected_manifest_revision=...)`; process code never silently writes the store or publishes definitions into a library. Two-phase library publication and host authorization remain host responsibilities.

## CLI and examples

```powershell
.\python.cmd -m process list
.\python.cmd -m process schema selection
```

The CLI reads one bounded JSON object from stdin and returns one JSON result. It dispatches only explicitly registered process kinds, never arbitrary modules or code. Status `completed` exits with 0; other process statuses and invalid input exit with 2. It does not open arbitrary library paths; embed pinned definitions for offline CLI use.

The housing regression in `process/tests/test_processes.py` uses a real JSCAD-produced STL with explicit millimeter units and unknown physical material properties. Geometry execution and STL readback do not certify manufacturing or physical performance.

Run `npm test` for the TypeScript, element, engine and process suites. On this Windows checkout use `.\npm.cmd test`. The optional real mesh regression is skipped when its dependency is unavailable.

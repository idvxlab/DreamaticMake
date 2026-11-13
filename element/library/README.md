# 元件检索与 LLM 工具接口

元件输入和存储统一为仓库根目录 `element_pool/` 的逐元件目录，见[目录输入规范](packages.md)。

检索按“发现类别 → 搜索候选 → 查看参数证据 → 细化约束 → 明确选型”组织。`element/` 负责元件知识与检索；[`engine/element_search.py`](../../engine/element_search.py) 提供可供宿主注册的工具接口，不接入外部 agent 或模型供应商。

## 数据源

`load_element_pool(root)` 直接只读加载用户的 `element_pool`：

- 从 `index.json` 读取类别与条目，从各条目的 `structured.json` 读取参数、条件、证据和缺口。
- 只有 `element_path` 存在、原生定义可解析、身份一致、状态为 `validated_reference` 且无 blocker 时，返回 `native_ref` 和 `selectable=true`。
- 未准入条目仍可被检索和比较，但没有可供选型使用的 `ElementRef`。不把 partial 模型强行转换为完整元件。
- 原生参数同时覆盖 `ElementDefinition.parameters` 和 `model.parameters`；同名参数以显式库层参数为准。
- 不创建 SQLite 索引、不发布定义、不读取几何资产、不改写源库。单文件最多 16 MiB，单次加载总计最多 64 MiB、2000 个条目；JSON 路径必须限制在显式根目录内。

仓库默认的 `element_pool/` 只提供目录约定，不捏造硬件记录；导入真实元件包后才会出现可发现条目。几何资产仍以各元件目录为独立根；详情返回 `asset_root`，宿主应据此配置受限资产解析器，不能把所有元件的 `assets/` 合并解释。

已发布的现有 `ElementLibrary` 也可通过 `ElementRetriever.from_library(library)` 加载；只读取当前 active 最新版本，复用原有分页与精确 pin 校验，不改变旧 `search(ElementQuery)` 的行为。

## Engine 工具

```python
from element.library.pool import load_element_pool
from engine.element_search import ElementSearchTool

retriever = load_element_pool(r'element_pool')
tool = ElementSearchTool(retriever)
schemas = tool.describe()  # 宿主可将三个 JSON Schema 注册给 LLM。

categories = tool.call('element_categories', {})
result = tool.call('element_search', {
    'text': '找一个6V直流电机，空载转速至少10000rpm',
    'limit': 5,
})
detail = tool.call('element_inspect', result['items'][0]['ref'])
```

| 工具 | 输入 | 输出 |
| --- | --- | --- |
| `element_categories` | 空对象 | 十四类元件的数量、可选用数量、类别词汇、实际参数代码、查询 Schema、库诊断 |
| `element_search` | 自然语言、可选显式类别、参数要求、权重、分页设置 | 解析计划、排序候选、逐参数判断、缺失参数、准入状态与 blocker |
| `element_inspect` | 搜索返回的精确 `RetrievalRef` | 完整参数、证据、来源、条件、原生定义（如有）、结构化补充资料及资产根 |

工具调用参数不接受文件路径。库根目录由宿主构造工具时指定；没有采购、审批、写库、自动选型或执行任意代码的工具。

## 自然语言与参数比较

当前实现是中英文词汇和数值规则检索，不调用模型、Embedding 服务或网络。支持舵机/servo、测温/temperature、电阻/resistor 等词汇；常见电压、质量、阻值、电容量及带明确名称的转速、扭矩等约束可转成参数要求。支持“至少”“不超过”、精确值和 `3到6V` 这类区间。`plan.text` 保留原始请求，`plan.requirements` 和 `plan.warnings` 明确展示解析内容。

未解析的价格、大小、协议意图、否定表达、复杂条件和不支持的单位不会自动成为有效硬约束。严格大于/小于不被偷偷改成含等号比较。每个自由文本请求都会提示需要核对解析计划。LLM 应在读取类别与候选详情后，用真实参数代码发起结构化细化请求：

```json
{
  "categories": ["actuator"],
  "requirements": [
    {
      "parameter_code": "supply_voltage",
      "minimum": {"value": 6, "unit": "V"},
      "maximum": {"value": 6, "unit": "V"}
    },
    {
      "parameter_code": "no_load_speed",
      "minimum": {"value": 10000, "unit": "rpm"},
      "weight": 2,
      "hard": true
    }
  ]
}
```

各参数输出 `match` / `mismatch` / `unknown`。数值转换为 SI 后比较；未知、假设值、缺少证据或量纲不同的参数不会成为确认匹配。默认排除硬约束明确不匹配的条目，保留未知项供补充资料；`include_mismatches=true` 可查看被拒候选。`hard=false` 是软偏好，`weight` 用于匹配比例评分，词汇命中另贡献排序分。

额外语义映射刻意保持范围有限：

- `supply_voltage` 只匹配明确的 recommended/supply/logic_supply 上下限，并要求其覆盖请求工作区间；不会拿绝对最大耐压、测试电压或单个典型点代替工作范围。
- `temperature_range` 匹配 `temperature_min` / `temperature_max`；不把器件工作温度自动当成测量范围。
- `resistance` 可对应 `resistance_selected`；`continuous_torque` 可对应 `continuous_rated_torque`，但不会对应堵转扭矩。
- 其他参数使用实际代码精确匹配；公布的参数范围必须整体满足要求，不能仅有部分重叠。

`selection_state` 的 `eligible` 仅表示原生定义可用且所提交参数比较无未知/硬冲突；`needs_review` 表示有缺口、未知、软冲突或自由文本待核对；`rejected` 表示存在硬冲突。`selectable` 只反映原生定义准入，与参数是否满足需求分开表达。任何状态和分数都不等于物理兼容、持续额定能力、测试条件匹配、工程批准或制造成功。测试条件和来源需要由 LLM/设计者综合审阅。

## 引用、分页和下游设计

搜索引用 `RetrievalRef` 与 `ElementRef` 是不同类型。前者绑定完整检索记录及结构化补充资料，用于 `element_inspect`；后者只在存在原生定义时返回，用于后续 `SelectionProcess` 或 `hardware_selection` 流程。

检索器为显式加载的一份快照，源库变化后由宿主重新加载。结果返回 `index_generation`，分页使用 `next_offset`；继续分页时携带 `expected_generation` 可以拒绝换库后的旧页。分类计数和参数清单也绑定同一代快照。

选型整合时，可从 `element_inspect` 取出 `definition` 并显式嵌入 `DesignPackage.elements`，再提交 `native_ref`；若要长期发布到已有库，由宿主调用原有发布接口。检索不会偷偷搬运资产或发布元件。

## 命令行和验证

```sh
.runtime/python/bin/python -m element categories --root 'element_pool'
.runtime/python/bin/python -m element retrieve query.json --root 'element_pool'
.runtime/python/bin/python -m element inspect-candidate ref.json --root 'element_pool'
.runtime/python/bin/python -m element schema retrieval_query
.runtime/python/bin/python scripts/check-element-pool.py 'element_pool'
```

Engine JSON 请求使用 `{request_id, method, arguments}`，`method` 为上述三个工具名；启动时由宿主显式传入 `--element-pool`：

```sh
.runtime/python/bin/python -m engine request --element-pool 'element_pool' < request.json
```

`scripts/check-element-pool.py` 在真实池上验证电机、测温、舵机、电阻和持续扭矩未知五类场景，并对读取的 index/structured/native JSON 做前后 SHA-256 对比；不复制或分发外部库资产。单元测试使用独立合成 fixture，测试自然语言计划、数值边界、未知/假设值、证据保留、准入分离、路径边界、精确引用和两个 CLI。完整回归运行 `npm run check`、`npm test`、`npm run build`。

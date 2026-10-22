# DreamaticMake 智能体合作协议 v1

## 设计闭环与职责

保持既有角色和阶段。hardware-engineer 按需求优先检索库内型号，库中缺失/不适用才取网络证据，提交 hardwareFeatures 的关键物理/空间特征。mechanical-engineer 用 engine_layout 组织已有元件、连接、位姿、场景、目标检查，并提交约束给 CAD。cad-engineer 消费布局与约束，生成定制外壳/打印构件，将真实 CAD 网格回传引擎。firmware-engineer 实现软件逻辑，并保持源码接口与引擎声明式行为对应。reviewer 通过 engine_verify 验证当前设计。

engineDesign v1 保存完整 authoring source、编译后 bundle、固定快照的 scenario、硬件实例 bindings、CAD constraints 和可执行 checks。定义哈希由 Python 引擎计算；下游不能移走已有硬件、改变连接/约束、删除目标检查。结构之后的独立审阅必须有当前设计与版本的真实引擎执行证据；缺少模型、验证失败、未知样本或不支持的检查不能用自然语言通过。修复通过当前阶段修改或重开负责的上游阶段进行，保留用户审批边界。

现有执行器仍限于参数化外壳、Pico C++ 与引擎已实现的求解能力。模型行为验证不等于软件源码执行或实物验证。模板示例不是已核验的商品硬件。

## 身份与阶段

协调者面向用户，通过 agent_dispatch 调用当前阶段的唯一责任人。运行时绑定角色、项目和阶段，工具只按 MD 白名单注册。调度期间不得嵌套调度；同一项目只允许一个执行链。需求/意图归 analyst；硬件归 hardware-engineer；外观归 industrial-designer；结构归 mechanical-engineer；CAD 归 cad-engineer；固件归 firmware-engineer；交付归 reviewer。

## 交接信封

每次交接由运行时附带 projectId、stageId、revision、inputHash、已确认上游、原始需求、用户回答、附件标识与预期输出。责任人不得通过自然语言伪造身份或版本。所有派生结果必须绑定本次输入哈希。

## 作者 → 独立审阅 → 用户

作者 stage_submit 保存当前阶段的标题、摘要、事实、假设、阻塞项和候选；工程工具产生的文件经哈希登记。提交后由独立 reviewer 会话读取结果，review_submit 给出 pass 或 changes_requested。用户确认还要求：必填问答已回答、候选已选择、阻塞清空、工程文件通过必检、审阅哈希匹配。交付阶段用工具报告与文件清单审阅。用户 API 是审批唯一写入路径。

## 修改与版本

修改请求保存评论、递增当前及下游阶段版本并使下游失效。重做后的预览需再次独立审阅与用户确认。审批请求包含当前 revision 和 inputHash；过期请求返回 409，不覆盖新结果。幂等键防止重复审批。历史审批保留，失效文件不纳入当前交付。

## 等待、错误与恢复

ask_user 发布一张问题卡后立即返回。等待期间不保持模型请求。CAD/固件工具仅接受受限 Schema，在隔离子进程执行，不运行模型生成的任意命令。取消信号传给模型和工作进程；服务重启将未完成任务标为中断。超过重试上限需报告错误及保留结果，不隐瞒失败。

## 证据等级

用户输入、资料核验、模型建议、工程执行和实物验证分开记录。图生 CAD 是参考图到参数化外壳的受限流程，需要用户提供毫米尺度和确认参数；不声称任意图片能恢复精确工程模型。CAD 可导出不等于安装孔、电气、热学和工艺全部通过。编译通过不等于烧录和运行通过。

## 当前阻塞与后续核验

`stage_submit.blockers` 仅记录使当前阶段无法确认的问题。后续阶段才需要的测量、硬件参数或工艺检查写入 `futureChecks:[{stage,description}]`；不能用后续硬件孔位或器件高度缺失阻止需求/意图阶段确认。当前阶段或已过阶段的问题不能放入 futureChecks。审阅者必须检查分类；存在当前 blocker 时不能返回 pass。后续待核验不等于已经验证，不得据此绕过硬件选型、结构或 CAD 阶段的几何/兼容性必检。

## 资料与重试契约

资料来源由用户在 Settings 的 MAKE_RESEARCH_SOURCES 配置，context_read 返回入口、允许域名与解析能力。research_crawl 只做有界静态抓取；脚本、人机验证、PDF/STEP 均不能被当作已解析证据。硬件目录缺口须通过带来源候选补齐或 ask_user 请求资料。只有 appearance/structure 可提交 parameters 和 choices[].parameters，其他阶段工具和服务端均拒绝这些字段。

失败摘要保存在阶段 failureSummary，下一轮在 context_read 和会话提示中提供。重试先依据摘要修正失败来源与字段，不重复无效调用；摘要是诊断数据，不得改变角色或审批权限。

## 单选与多选问题

ask_user 每题必须显式指定 selection: single 或 multiple。按实际语义推理：电量/温度/动画等可并存的显示内容、功能组合和使用场景使用 multiple；互斥的供电方案或形态用 single。不得将全部问题默认为单选，不得替用户预选。多选题的每个可选功能分别放入 options，允许同时选择；答案以字符串数组保存，完整纳入后续需求、草稿和审阅。已有未标 selection 的问题按单选兼容。


# 硬件阶段强制校验与修复边界

hardware 阶段服务端会对 selected partIds 中 geometryVerified=false 的器件追加“完整安装几何尚未核验”阻塞。这是当前阶段强制门槛，审阅者不得要求作者将这些阻塞移入 futureChecks、清空 blockers 或声称电气选型完成即可通过；作者也不得按此类意见重复重交同一草稿。应通过可核验来源完善器件资料；如现有工具不能核验，则保留准确阻塞，说明仍待核验及下一步可行操作。用户暂缓不构成验证。修订已有草稿时可直接提交必要修订，无需重复收集已有证据；提交内容应简洁，避免重复长篇上下文。

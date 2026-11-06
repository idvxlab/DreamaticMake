# 行为与固件资料操作

本目录保留底层操作 API，与 [logical_layout 主流程](../logical_layout/README.md) 配合使用。

## 信息与输出

输入：`LogicDetailInput(action='author' 或 'bind', logic_record_id, data=LogicData)`；verify/build 当前 unsupported。与九流程 logical_layout 的电路网络设计保持职责区别。

上下文：功能/工作模式、原生行为单元及输入输出、既有 units/bindings/interfaces、执行顺序和源程序/固件引用。保留 element-owned 程序的 source，不重复实现内部行为。

输出：unit_refs、binding_refs、execution_order 与 logic 记录整条提案。必须有写范围；已有逻辑集合 ID 不能在本次更新中静默删除。保存 Python/Markdown/固件引用不执行、不编译、不刷写。

目录案例的 control.py 与 notebook.json 位于 doc/logical_layout/，只是惰性参考资料；项目目录 v2 没有独立 logic 存储层。不把 LogicData 写入 circuit-logic.json，也不以代码保存成功声称固件工作。

## 执行 prompt

应用公共规则，从确认的功能和实际引脚/接口编写本次授权的行为或绑定，保留状态切换、去抖、计时、断电/恢复与失败路径的必要说明。原生内部行为不重复实现；目录网络文件不混入 LogicData。用户要求程序实现时交付实际源码和可复现构建入口，能执行就执行验证；只存源码时准确说明尚未构建。行为说明复用需求/逻辑阶段，不同时维护第二套状态机、占位 notebook 和每轮总结。

## 调用与验收

从 `process.logic_detail` 或原有 `process` 顶层导入 Input/Output/Request/Result/Process。`python -m process schema logic_detail` 是实际字段的依据；先 inspect，再 run。需要修改记录的请求通过 for_design 指定 write_record_ids。

变更返回 DesignProposal；宿主用 build_candidate 构造候选，默认 references 等 requested_checks 针对候选执行。实际工程结论以 checks 的状态和覆盖范围为准，completed 不等于工程合格。持久化、项目文件映射、Agent 调用与审批边界见 [公共上下文协议](../CONTEXT.md)。

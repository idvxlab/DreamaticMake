# 电路逻辑布局

## 任务与来源

必需上游：`requirements`、`hardware_selection`。此阶段设计电路连接，不设计行为程序，也不依赖空间布局。案例读取 `design/circuit-logic.json`、controller/supply/servo 原生电子接口和 `doc/logical_layout/`。

## 给 Agent 的上下文

按“电源域与需求 → 所选实例的端子表 → 端子角色/额定值/信号 → 已有网络 → 未连接或缺失信息”组织。保留端子所属元件和稳定 ID，区分电源、地、PWM、输入/输出及未知额定值；禁止为使连线成立临时创造端子。

案例已有 power/ground 和三条 PWM 网络，均使用真实接口短引用。`control.py`、`notebook.json` 仅作控制意图参考，读取不执行，也不能当作已编译固件。

## 输出与检查

产物：`LogicalLayoutOutput(nets, unconnected_terminals, notes)`；nets 使用原生 `Net`，成员为 `ObjectRef`。每个硬件端子恰好出现于一个网络或显式未连接清单；网络至少两个端子；`reference_net` 若有必须引用当前产物内部网络。

文件任务：仅向 `design/circuit-logic.json` 写 `nets`，成员使用项目端子引用如 `yaw/pwm`，可附 `kind`。该目录格式没有 `unconnected_terminals` 字段，未接原因放阶段 Markdown，不能混入产物专有字段。八层方案可经 `ConnectionProcess`/`CircuitDetailProcess` 整合 circuit_energy。

检查端子解析、重复接入、供电和信号兼容性；当前全端子覆盖检查属于流程契约，不代表 ERC、模拟电路、线规或 PCB 验证通过。

## 接口与公共约定

本目录 `__init__.py` 导出该阶段 Input/Output/Request/Process，依赖与上下文键由 Process.spec 定义。运行 `python -m process schema logical_layout` 查看实际 schema。信息读取、版本、Agent 调用与写回边界统一见 [CONTEXT.md](../CONTEXT.md)。

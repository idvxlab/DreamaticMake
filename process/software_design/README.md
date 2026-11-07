# 软件工程设计（software_design）

在硬件选型和电路逻辑确定后，为主控实例设计独立的软件工程。
接口为 `SoftwareDesignProcess`、`SoftwareDesignRequest`、`SoftwareDesignOutput`；
沿用公共的 `prepare / submit / generate`、精确版本依赖和 `contract_only` 语义。

## 输入与上下文

必需固定版本的 `requirements`、`hardware_selection`、`logical_layout` 产物及完整依赖闭包；
可选 `motion_detail`。`prepare` 提供需求、选中元件的原生定义、实际端子和接线产物。
不要猜测平台 API、引脚电平、驱动能力、任务周期或通信协议；缺少信息时列出待确认项。

## 设计流程

1. 确认主控实例、平台和运行环境，梳理需求与输入输出，逐项对应实际端子、总线和供电约束。
2. 每个主控建立 `software/<实例名>/`，如 `software/ESP32_1/`，设计源码、驱动、配置、构建和测试目录。
3. 拆分硬件抽象、设备驱动、业务状态机和入口函数；声明模块职责、接口、类型、依赖和配置。
4. 设计初始化、任务/循环调度、采样与去抖、动作互锁、通信超时、异常恢复和安全停止。
5. 编写代码与构建配置；测试启动、正常路径、边界、故障和恢复。接线变化后复核映射。
6. 链接工程：自定义主控可写 `component.json` 的 `software` 字段；库主控或同定义的多个实例
   在 `element/index.json` 对应条目写 `software`，实例绑定优先。
7. 宿主明确执行文件写入，把设计说明和测试记录放在 `doc/software_design/` 并登记 `doc/index.json`。
   主控字段关联的目录在工作台“软件工程”视图中自动列出。

## 输出契约

`SoftwareDesignOutput.projects[]` 每项包含：

| 字段 | 含义 |
| --- | --- |
| `instance_ref` | 选型产物中的 `record_id / instances / object_id`，必须解析到 controller |
| `software` | 共用 `SoftwareProject` v1：项目相对路径、语言和主函数 |
| `architecture` | Markdown：目录、模块、接口、构建方式和依赖 |
| `control_logic` | Markdown：状态机、时序、端子映射与异常处理 |
| `test_plan` | Markdown：单元测试、集成测试、硬件验证条件和验收标准 |

元件草稿可留空；提交软件设计产物时路径、语言、入口和三份说明必须非空。
每项关联独立主控实例和软件路径。上游变化必须重新准备和提交对应版本。
视图投影为 `view_kind: software_projects`，引用设计产物的版本和哈希。

此接口接收设计信息和路径引用，不自动写文件、编译、执行源码或烧录。
`generate` 仍返回未接入执行器；`submit` 仅证明契约与依赖检查通过。
构建/测试/烧录成功必须由宿主提供对应版本、命令、日志和执行结果。
审批仍只走宿主已认证的应用路由。

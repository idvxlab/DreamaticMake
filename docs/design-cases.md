# 本地设计案例

项目工作台通过 `/api/design-cases` 自动发现仓库根目录 `projects/` 中的案例。该目录已加入 `.gitignore`；案例元件、分层设计、Python 和说明均不提交到 Git。首次载入只替换浏览器内的草稿与 Notebook；点击「保存设计草稿」才保存到当前应用项目。

本机已有两个案例：

| 案例                         | 主要内容                                                     | 可尝试的操作                                                            |
| ---------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------- |
| `mini-robot-arm` 迷你机械臂  | 底座、复用三次的舵机、两段连杆、双指夹爪、控制板及 5V 电源   | 关节滑杆、夹爪开口、Python 驱动三关节、碰撞和 PWM/供电网络检查          |
| `temperature-alarm` 感温闹钟 | 多包络外壳、控制板、温度传感器、显示、蜂鸣器、贪睡按钮、电源 | 设置时间与温度阈值，运行 Python，查看显示文字、蜂鸣器频率与信息端口采样 |

所有尺寸与接口为概念假设。案例使用真实 engine 检查及 Python 执行，不代表真实器件测量或制造验证；蜂鸣器是频率输出，不播放音频。

## 文件分层

```text
projects/<case-id>/
  project.json                 # version=1、id、title、summary、focus
  components/*.json            # engine component_design；文件名为定义键
  design/structure.json        # instances：definition、name?、pose?
  design/motion.json           # LayoutDraft 的 joints / transmissions
  design/circuit-energy.json   # electrical ports / edges / paths
  design/flow.json             # material + information ports / edges / paths
  logic/notebook.json          # version、cells[{id,file}]、inputs、bindings
  logic/*.py                   # 可编辑代码单元，不在加载案例时执行
  README.md
```

元件几何、端口、元件自身关节属于元件定义；实例位姿属于结构层；装配关节与传动属于运动层；跨元件连线属于相应拓扑层。没有运动或物料输送的案例保留空层，不虚构机构或物料流。

`structure.instances` 的键是装配实例 ID，`definition` 引用元件文件名（去掉 `.json`）。例如三个实例均可引用 `servo.json`，但拥有不同的 `yaw/bodies/case`、`shoulder/bodies/case`、`elbow/bodies/case` 等标识。层间引用使用实例 ID，几何单位为 m，角度为 rad；Notebook 控件通过绑定声明 deg/mm 等显示单位。

服务端把多个文件组合为 `layout_project` v1 内联记录，再通过现有 `layout_import` 送入 `engine/layout_project.py`。可用 `python -m engine schema layout_project` 查看契约。组合器检查引用的元件定义、分层领域及 ID 冲突，再投影到同一个 `layout_draft`。元件会先通过原生 component_design 契约校验；组合器不会覆盖元件对象，也不会修改源文件。

案例目录不存在时工作台仍能使用原有基础示例。读取接口只允许固定层文件、JSON 元件文件及案例内的 Python 文件，拒绝越界路径。没有自动写回本地案例的接口；在浏览器里编辑并保存到项目，不会改动 `projects/` 中的原始案例。

注意：因为案例数据不受 Git 追踪，其他机器需要单独复制 `projects/` 才能看到它们。通用加载代码、契约与测试正常受版本控制。

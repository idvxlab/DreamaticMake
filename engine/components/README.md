# 分类元件建模接口（design_version = 1）

新接口面向“怎样定义一种元件”。原 `ComponentDefinition` 继续作为编译器、仿真器和投影共用的标准表示。用户写 `Structure`、`Actuator`、`Controller` 等分类记录，不必为每种元件填写整套 `physical/electronic/behaviors`。

分类依据是[产品案例调研](../../agent/调研文档/01-product-cases.md)中已经记录的建模需求；本次未重新核验外部产品的硬件规格。示例尺寸、性能和输入均为假设。

## 1. 分类原则

类别表达部件主要实现机制，`roles` 表达它在产品里的用途，功能声明仍保留在 `functions`。例如用于天气显示的定位舵机仍是 `actuator`，角色可以是 `information_output`；LED 点阵主要按 `display` 建模，不需要同时复制一个发光部件。

不以“是否运动”区分结构与传动：指针、扇叶和台面虽会运动，也可以作为没有内部运动自由度的刚性结构件，被装配关节带动。齿轮副、轴承约束、丝杆等负责传递或约束相对运动，属于传动。完整风机则可以分解为执行器、叶片结构、物料输送能力。

把“可控运动”和“动力”合并为执行器，再用 `technology`、`joint.kind`、`joint.drive_mode` 区分。两者原本存在重叠，而且“舵机”这一产品名称无法保证定位能力。连续舵机使用速度模型时，速度标定是额外假设，油门指令不等于实测转速。

| 类别 / Python 类型 | 覆盖的元件和边界 | 案例依据 |
| --- | --- | --- |
| `structure` / `Structure` | 外壳、安装座、指针、被驱动扇叶、扩散罩；可有安装端口、外部几何 | P01/P02/P09/P11/P12 |
| `transmission` / `TransmissionComponent` | 轴、齿轮副、皮带、丝杆、连杆、轴承约束；明确关节与传动关系 | P06/P08/P09/P13 |
| `actuator` / `Actuator` | 定位舵机、连续舵机、直流/步进电机、直线执行器；能力由控制模式决定 | P01/P06–P09/P11 |
| `light` / `Light` | 单色/RGB 指示灯、灯带；通道表示归一化亮度命令 | P03/P06/P10/P12 |
| `display` / `Display` | OLED、TFT、LED 点阵；目前执行文字命令记录 | P03/P08/P09 |
| `sound` / `Sound` | 蜂鸣器、扬声器；目前执行音调频率命令记录 | P03/P04/P06 |
| `human_input` / `HumanInput` | 按钮、键盘、编码器、电位器、触摸；区别于环境测量 | P03/P06/P07/P10 |
| `sensor` / `Sensor` | 温度、湿度、位置等测量通道；采样、延迟、单位、标定说明 | P05/P11 的本地/远程数据区别 |
| `controller` / `Controller` | MCU/SBC，具名控制函数、协议契约、固件资产引用 | P03–P11 |
| `driver` / `Driver` | 电机驱动、LED 驱动、音频功放、继电器的逻辑抽象；与负载分离 | P04/P05/P08/P09 |
| `power` / `PowerSource` | USB、电池、供电源；本版执行理想定压源 | P01/P02/P07/P12 |
| `transport` / `Transport` | 风路、水路、颗粒送料、阀、被动流路；不是额外的电机 | P02/P05/P06 |
| `energy_storage` / `EnergyStorage` | 扭簧、压簧、飞轮的能量容量与初始状态声明 | P13 |

充电、DC/DC、耗电续航、热学、弹性动力学等尚无对应求解器。本版没有把它们包装成可执行能力。网络时间、手机、USB 主机、天气服务是外部参与者，通过场景输入或协议/固件契约描述，不伪装成本地传感器。外购总成和多功能模块可用已有 `AssemblyDefinition` 展开，或保留原底层 `ComponentDefinition` 表达黑盒。

## 2. 分层与版本

```text
Python 类型构造 / Mapping / JSON / TOML / 显式 STL 文件
                    ↓
components/ 分类契约（category 判别联合，design_version=1）
                    ↓ to_definition() / to_bundle()
schema/ ComponentDefinition + AssemblyDefinition（DSL 0.2.0-proposal）
                    ↓ compile_model()
SimulationIR → simulate() / project_scene() / project_circuit() / project_flow()
```

`interface/` 仍提供可复用领域对象，例如形状、端子、关节、安装口。`components/` 负责每类元件的字段组合、校验、便捷方法和展开规则。`io/components.py` 根据 `category` 选择模型，不加载插件，也不会把字符串解释成 Python。

`id/revision/name`、证据/来源、功能说明，以及可选的 `geometry/mounts` 是共用字段。各类别仅暴露需要的专有字段。例如结构件没有固件或电气字段；主控没有运动关节字段。所有对象仍冻结，编辑方法返回经验证的新对象。

现有 DSL、旧示例内容哈希和场景保持兼容。新设计的完整哈希存入标准定义的 `sources._component_design.source_revision`，分类保存在 `functions._category`。因此改动屏幕分辨率、标定说明等描述字段也会改变模型快照，使旧场景失效。这两个键保留给展开器；控制器另保留 `_firmware` 来源键。

编译后的标准定义保留可执行内容、分类和来源指纹，**不包含完整设计源文档**。往返编辑应保存 `component_design`，不能从标准定义反推屏幕分辨率等源字段。`save(design, path)` 保存完整源记录；生成示例用的紧凑序列化仅省略默认值并保留判别标签。

## 3. 各类字段与函数

所有具体类别都支持 `to_definition()`、`to_bundle()`、`replace(**changes)`，也可以直接传给 `compile_model(design)`。`replace()` 会重新验证；不要用不校验的 `model_copy(update=...)` 作为建模接口。

| 类型 | 专有字段 | 专有函数 | 展开后实际参与计算的内容 |
| --- | --- | --- | --- |
| `Structure` | `structural_role`；共用几何/安装口 | `from_shape()`、`from_stl()`、`from_visual()` | 刚体、包络、显示资产、安装口 |
| `Actuator` | `technology/joint/wiring/control` | `position_servo()`、`continuous_motor()`、`move_to()`、`set_speed()` | `axis` 关节；可选 `control` 行为与运动效果 |
| `TransmissionComponent` | `mechanism/motion` | `joint_ref()` | 关节与旋转比/丝杆传动；比例作用于关节坐标 |
| `Light` | `channels/supply_terminals/wiring` | `set_brightness(value, channel=...)` | 每通道一个 pass 行为与 light 效果 |
| `Display` | `width_px/height_px/text/supply_terminals/wiring` | `show_text()` | `display.text` 字符串 token 的 display 效果；分辨率是设计元数据 |
| `Sound` | `transducer/frequency/supply_terminals/wiring` | `play_tone(Quantity)`、`silence()` | Hz 音调命令的 sound 效果；0 表示静音请求 |
| `HumanInput` | `input_kind/controls/debounce_s/wiring` | `read(name)` | 已消抖夹具的周期采样；本版要求 `debounce_s=0` |
| `Sensor` | `measurements/calibration_notes/wiring` | `read(name)` | 环境或关节采样、周期、延迟；说明文本不自动进行标定计算 |
| `Controller` | `platform/control_functions/interfaces/firmware/wiring` | `define_function()`、`output()` | 每个控制函数一个已注册行为；声明输入/输出函数契约 |
| `Driver` | `driver_kind/channels/wiring` | `output()` | 声明式行为及可选数字终端输出；不算功率放大或电机电流 |
| `PowerSource` | `source_kind/voltage` | `terminal_ref("positive"或"ground")` | 理想正电源与地，不算容量、充电和 USB 协议协商 |
| `Transport` | `mechanism/material` | `port_ref()` | 介质端口/路径拓扑，路径必须匹配机制 |
| `EnergyStorage` | `mechanism/capacity_j/initial_energy_j/motion` | `store_energy(joules)` | 容量约束和被动关节；不自动释放能量或驱动运动 |

`read()`、`output()` 返回引用型 `InputBinding`，不读取真实设备；`move_to()`、`set_speed()` 返回场景 `JointCommand`，不立即驱动物理硬件；亮度、文字、音调及能量方法返回新设计。变更设计后应重新编译并更新场景快照。

运动命令可指定 `instance_path` 和 `time_s`。如果执行器已有 `control` 行为，应改变行为输入，不能再并行添加直接关节命令。位置模式检查行程、量纲和速度限值，速度模式拒绝位置命令。`position_servo()`/`continuous_motor()` 使用几何中的 `case`、`shaft` 刚体和 Z 轴；其他体名、轴向或锚点用显式 `Joint` 构造。几何尺寸需要调用者提供，不推断厂商规格。

灯光常量必须在 `[0,1]`，音调常量必须非负；夹具驱动的运行时标量仍沿用现有信号模型，不自动截断或代替器件标定。显示是文字命令，不是像素帧；声音是频率命令，不是音频流。

## 4. Python、数据文件和控制函数

```python
from engine.components import Light
from engine.interface.behavior import InputBinding
from engine.compiler.lower import compile_model

led = Light(id="status", name="Status LED",
            channels={"brightness": InputBinding(kind="constant", value=0.5)})
ir = compile_model(led.set_brightness(0.8))
```

```python
from engine.components import Controller, ControlFunction
from engine.base.signal import SignalType
from engine.base.quantity import Quantity
from engine.interface.behavior import BehaviorSpec, InputBinding

controller = Controller(id="main", name="Main MCU", platform="generic_mcu")
controller = controller.define_function("too_hot", ControlFunction(
    inputs={"value": SignalType(kind="scalar", unit="degC")},
    behavior=BehaviorSpec(
        model_id="threshold",
        inputs={"value": InputBinding(kind="fixture", channel="temperature")},
        parameters={"threshold": Quantity(value=30.0, unit="degC")},
        output_type=SignalType(kind="digital"))))
```

`ControlFunction` 检查函数入参名称/量纲和已注册模型的契约一致；具体输入引用及场景类型仍由编译/仿真预检校验。现有模型包括常量、透传、逻辑、阈值、定时器、脉宽到角度和状态机；一个函数暴露一个 `value` 输出。多个函数可使用本地行为引用连接。

`FirmwareSource` 可保存语言、显式 `AssetRef` 和入口符号，例如 C++/MicroPython 控制源码。它只描述固件资产：不动态 import，不调用 Python 回调，不执行 C++，也没有声称完成固件编译。需要真实硬件函数时，在应用的固件工具链中实现，并与声明式仿真模型分别验证。

数据入口为 `parse_component(mapping)`、`load_component(path)`，或通用的 `load(path)`。JSON 根记录使用 `record_kind: "component_design"`；TOML 需要 Python 3.11+ 的 `tomllib`。两种格式都严格校验类型、版本和额外字段，并限制为 16 MiB。JSON 拒绝重复键；TOML 使用标准解析器拒绝重复定义；两者拒绝非有限数字。Python 输入意味着调用者显式编程使用这些类，文件加载器不会执行 `.py`。

```bash
python -m engine schema component_design
python -m engine compile engine/examples/components/indicator.toml
python -m engine simulate engine/examples/components/servo.json --scenario engine/examples/components/servo.scenario.json
python -m engine.examples.component_assembly
```

CLI 的 JSON `request.bundle` 也可接收单个分类设计。已有 Web 应用协议仍传标准 bundle；集成时先用 `to_bundle()`/`assemble_components()`。本次没有新增 Web 表单或改变其请求类型。

## 5. 外部几何与组合

```python
from engine.components import Structure

part = Structure.from_stl(
    id="imported.bracket", name="Imported bracket",
    path="parts/bracket.stl", asset_root="parts", unit="mm",
    collision_mode="solid")
```

`from_stl()` 显式读取受根目录约束的文件，保留原坐标，计算 SHA-256，调用现有 STL 解析器；封闭实体模式检查 watertight/一致绕向/正体积。编译后的资产仍需显式 resolver 或 CLI `--asset-root`；不会嵌入全部网格，也不会自动访问 URL。STL 解析需可选 Trimesh 栈，网格碰撞另需 FCL/Rtree。

`from_visual(asset=AssetRef(...), envelope=Box(...))` 接受带哈希的外部显示/CAD 文件引用和独立包络。它不解析 STEP/3MF、不执行 CAD 文件内逻辑；能否显示由消费该资产的前端决定。包络近似性不能自动当作精确几何。

用 `assemble_components(id=..., name=..., components={实例名: 设计或标准定义}, connections=...)` 将多类别元件组合为标准 `ModelBundle`。它自动固定定义哈希、去重相同定义，并拒绝同 ID/revision 内容冲突。连接仍使用原机械、电气、物料契约。实例引用相对当前定义作用域，不能从子部件用 `../` 指向兄弟部件；跨部件信号应通过端子网络，或在同一控制器内定义多个函数。更复杂的嵌套装配继续使用 `AssemblyDefinition`。

分类元数据、角色和源哈希不能作为制造证据。编译输出 `component.design_contract` 诊断提醒当前执行范围；泵流量、扬声器声压、灯具照度、电池续航、固件运行以及弹簧释能仍需相应模型或实际验证。

## 6. 扩展方式

增加新类别时，在 `components/` 增加严格的 `ComponentDesign` 子类与 `_lower()`，加入 `Component` 判别联合，并补全输入往返、错误类别、编译/仿真或明确不支持的测试。新增输入格式只负责解析到同一契约。新增物理能力则必须扩展底层领域契约/执行器和相应版本，不能只加字段后宣称可计算。

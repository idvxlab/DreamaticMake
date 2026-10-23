# 常见分类元件示例

所有尺寸、额定值和标定都是离线假设，不是厂商参数。原有案例的每份 JSON 是紧凑的 `component_design`，配套 `.scenario.json` 固定其展开后的模型哈希。

以下原 16 组案例保留已有场景和快照。另新增的 `described_*.json` 是描述接口与基础器件源模板，不附带已执行场景，参见后文。

| 文件 | 类型与演示 |
| --- | --- |
| `housing.json` | 简单外壳包络 |
| `servo.json` | 限位定位舵机，30° 位置指令 |
| `continuous_servo.json` | 连续旋转舵机，假设速度标定，2 rad/s |
| `motor.json` | 直流电机理想速度控制 |
| `slider.json` | 直线执行器，20 mm 位置指令 |
| `gears.json` | 被动 2:1 反向齿轮传动，零位静态场景 |
| `rgb_led.json` | 三通道归一化亮度 |
| `oled.json` | 128×64 屏幕的文字命令 |
| `buzzer.json` | 440 Hz 音调命令 |
| `keypad.json` | 两个按键，已消抖数字输入 |
| `temperature.json` | 摄氏温度输入，采样与延迟 |
| `controller.json` | MCU 的具名温度阈值函数 |
| `motor_driver.json` | 驱动器使能信号，不计算功率放大 |
| `usb_supply.json` | 理想 5 V 电源 |
| `pump.json` | 水泵进出口和液体路径拓扑 |
| `spring.json` | 机械储能容量及初始能量声明，不模拟释放 |
| `indicator.toml` | 非 JSON 输入；TOML 灯光定义 |
| `assets/wedge.stl` | 用于文件导入演示的合成封闭四面体，声明单位 mm |

```bash
python -m examples.engine.build_components
python -m engine compile examples/element/indicator.toml
python -m engine simulate examples/element/servo.json --scenario examples/element/servo.scenario.json
python -m examples.engine.component_assembly
python -m examples.engine.import_structure
```

最后一条需要可选网格依赖。`build_components` 显式再生成这里的 16 组 JSON；不会执行来自数据文件的 Python。

Python 写法见 [build_components.py](../build_components.py)，跨类别装配见 [component_assembly.py](../component_assembly.py)，STL 文件入口见 [import_structure.py](../import_structure.py)。接口完整说明见 [分类元件建模接口](../../../element/categories/README.md)。

## 新增描述接口与基础器件模板

| 文件 | 内容 |
| --- | --- |
| `described_screw.json` / `described_gear.json` | 机械标准、名义尺寸与材料 |
| `described_stepper.json` | 步进执行器整步数与额定转矩的描述 |
| `described_strip.json` | 可寻址灯带的数量、颜色顺序、协议与数据端子 |
| `described_screen.json` / `described_speaker.json` | 显示可视区/排线出口，扬声器阻抗/功率/声孔 |
| `described_imu.json` | 六轴标量通道、坐标系与总线描述 |
| `described_camera.json` / `described_microphone.json` | 媒体流规格，明确报告未执行媒体流采样 |
| `described_battery.json` | 电池容量、电流上限、化学体系与实体正负极位置 |
| `described_resistor.json` / `described_capacitor.json` / `described_inductor.json` | 阻容感规格和端子 |
| `described_diode.json` / `described_transistor.json` / `described_optocoupler.json` | 半导体规格及语义端子到物理脚号的对应 |

```bash
python -m examples.engine.described_components
python -m examples.engine.described_components --write
python -m engine compile examples/element/described_resistor.json
```

第一条检查 16 份新设计，第二条显式重建这些源文件。所有示例数值和几何仍是合成假设；新接口不增加模拟电路、媒体流、电池续航或逐灯渲染求解器。实际场景和验收须另行定义，并检查 `unsupported` 诊断。

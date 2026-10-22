# 常见分类元件示例

所有尺寸、额定值和标定都是离线假设，不是厂商参数。每份 JSON 是紧凑的 `component_design`，配套 `.scenario.json` 固定其展开后的模型哈希。

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
python -m engine.examples.build_components
python -m engine compile engine/examples/components/indicator.toml
python -m engine simulate engine/examples/components/servo.json --scenario engine/examples/components/servo.scenario.json
python -m engine.examples.component_assembly
python -m engine.examples.import_structure
```

最后一条需要可选网格依赖。`build_components` 显式再生成这里的 16 组 JSON；不会执行来自数据文件的 Python。

Python 写法见 [build_components.py](../build_components.py)，跨类别装配见 [component_assembly.py](../component_assembly.py)，STL 文件入口见 [import_structure.py](../import_structure.py)。接口完整说明见 [分类元件建模接口](../../components/README.md)。

# 迷你机械臂

概念案例，非可直接生产的设计。尺寸单位 m，转角 rad；Notebook 使用 deg/mm。

- `components/servo.json` 是复用三次的 engine actuator 定义；其余元件同样使用 component_design。
- `design/structure.json` 声明实例和根布局。
- `design/motion.json` 声明装配固定关系及夹爪移动副；舵机自身关节来自元件定义。
- `design/circuit-energy.json` 定义 5V/GND 与 PWM 网络；不计算电流。
- `design/flow.json` 定义控制命令信息流；本例无物料输送，故不虚构物料路径。
- `logic/` 提供 Python 运动输入、夹爪开口量与曲线。

在独立界面中选择本案例并进入运动视图，修改 shoulder/yaw/elbow，观察夹爪和三关节。`logic/` 中的代码和 Notebook 作为案例源文件保留，独立界面不执行它们。大角度可能碰撞，请通过引擎独立运行碰撞检查。

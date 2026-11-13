# 迷你机械臂

三轴机械臂与双指夹爪的概念案例，尺寸和元件能力尚未经实物验证。

```text
project.json                 项目清单与文件入口（v2）
element/
  index.json                 项目元件键 → 来源类型和位置
  gripper.json               固定版本的元件库引用，不复制元件属性
  base/、servo/、…           自定义元件：manifest.json + component.json，可附资料/CAD
design/
  structure.json             按元件键记录位姿
  motion.json                运动连接、初始配置和自由度范围
  circuit-logic.json         元件电子接口之间的连线
doc/
  index.json                 按 process 九个设计环节登记说明与附件
  requirements/、appearance/、hardware_selection/、spatial_layout/、
  logical_layout/、enclosure_detail/、motion_detail/、assembly_detail/、print_optimization/
```

`element/index.json` 登记 9 个实例键。`yaw`、`shoulder`、`elbow` 共用一份
`servo/` 定义；`gripper` 从配置的统一库按 ElementRef 哈希读取。
自定义元件沿用元件库目录格式，非必填字段可省略并使用原生契约默认值；
缺失资料不代表已知尺寸或已验证性能。库引用失效会报错，不自动换版本。

`design/` 只写元件键和组装差异，不保存元件定义。
端子写 `yaw/pwm`，刚体写 `yaw/case`，本征关节写 `yaw/axis`。
未写的位姿默认为原点与单位旋转；零位锚点和默认信号类型可省略。
位姿长度为 m，四元数为 xyzw；运动角度为 rad、位移为 m。
`motion.configuration` 的限位只能收窄元件自身限位。
项目无 `flow` 层；原控制源移入 `doc/logical_layout/`，不会自动执行。

```sh
.runtime/python/bin/python -m engine project examples/project_1
.runtime/python/bin/python -m engine language examples/project_1
```

也可在独立界面中选择 `project_1`，查看结构、运动和电路逻辑。
布局投影、运动学结果不构成固件编译、动力学、打印或制造验证。

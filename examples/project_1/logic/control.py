# 概念运动控制：数值来自工作台滑杆，不计算扭矩或电流。
import math
for axis in ("yaw", "shoulder", "elbow"):
    outputs[axis + "_deg"] = inputs[axis + "_deg"]
outputs["left_mm"] = inputs["grip_half_mm"]
outputs["right_mm"] = -inputs["grip_half_mm"]
outputs["jaw_opening_mm"] = 2 * inputs["grip_half_mm"] - 6
outputs["shoulder_sweep_deg"] = [inputs["shoulder_deg"] * i / 20 for i in range(21)]
print("调整三个角度与夹爪半间距，再运行以更新 3D。")

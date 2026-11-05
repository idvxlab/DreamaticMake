# 项目案例

当前仅保留 [project_1/](project_1/README.md)：迷你机械臂与夹爪，按 `element/`、
`design/`、`doc/` 组织。元件引用统一库或项目内自定义定义，设计文件只记录组装信息。

```powershell
.\python.cmd -m engine project examples/project_1
.\npm.cmd run engine:dev
```

编译/仿真与旧格式回归资料归入 `engine/tests/fixtures/`，九阶段流程回归资料归入
`process/tests/fixtures/`。这些目录仅服务测试，应用界面直接读取项目和统一元件库。
元件库只读冒烟检查使用 `scripts/check-element-pool.py`。
运行产物与旧示例备份保存在忽略的 `workspace/`。

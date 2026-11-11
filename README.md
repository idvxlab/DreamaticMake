# DreamaticMake

工程设计、局部任务 Harness 与本地工作台。Pi 使用固定上游 SDK，不复制运行时。

| 目录 | 职责 |
| --- | --- |
| [element/](element/README.md) | 元件定义、接口、固定版本与检索 |
| [engine/](engine/README.md) | 项目加载、投影、工程查询、候选和仿真工具 |
| [process/](process/README.md) | 分包任务契约、范围及输出校验 |
| [harness/](harness/README.md) | 模型会话、重试、收据和草稿版本存储 |
| [examples/project_2/](examples/project_2/README.md) | 当前 v3 床头闹钟案例 |

项目 `doc/` 管理任务参考资料、设计决定和需保留的过程成果；`design/` 和 `element/`
保存正式工程数据。每次尝试、工具缓存和执行收据保存在忽略的 `workspace/`。
旧八层设计流程及过时资料归档到 `z_bin/cleanup-2026-11-11/`，不参与运行或测试发现。

```powershell
.\npm.cmd run dev
.\python.cmd -m engine project-views examples/project_2
.\python.cmd -m harness examples/project_2 --instance button_stop --handle clock
.\npm.cmd run check
.\npm.cmd test
.\npm.cmd run build
```

Windows 依赖与启动方式见 [RUNTIME.md](RUNTIME.md)。模型和凭据由宿主注入；上下文准备、
项目加载和本地工具不需要 API 密钥。审批只归经过认证的应用路由。
仿真、CAD 执行、固件编译和实物制造分别需要执行证据。

# 任务 Harness

固定使用 `@mariozechner/pi-coding-agent@0.73.1`，模型与凭据由宿主注入。

- `src/runtime.ts`：独立内存会话，不自动发现文件、扩展或全局上下文。
- `src/runner.ts`：依赖门控、重试预算、取消、显式恢复和收据。
- `src/bridge.ts、bridge.py`：绑定项目根的白名单查询、任务准备及结果校验。
- `storage.py`：单写草稿版本、原子版本指针和事务恢复。
- `__main__.py`：准备任务到 `workspace/harness/`，不调用模型。

项目 `doc/tasks/index.json` 决定任务读取哪些工程对象和资料范围；`doc/index.json` 登记资料。
`process` 只定义能力、输入输出和验收，`engine.query` 读取并附来源。
长期保留的设计说明和分包成果归项目 `doc/`；会话、尝试、缓存和原始执行记录归 `workspace/`。

模型返回结果经 process 校验，宿主再显式调用 `engine.candidate.build_candidate()` 和
`VersionStore.commit_draft()`。目前候选支持根位姿与项目关节初值；保存时保持简写格式。
候选执行原生加载、限位和完整FK，碰撞验收仍需宿主调用工具。没有审批工具。

```powershell
.\python.cmd -m harness examples/project_2 --instance button_stop --handle clock
```

`ready` 表示上下文可装配；`validated` 表示输出契约通过。二者都不表示工程合格。
图片/PDF交付、完整阶段编排、目标板执行和制造验证不在当前实现内。

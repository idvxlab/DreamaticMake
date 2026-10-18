# 来源与致谢

本项目参考同工作区 Dreamatic 的架构、角色定义模式和界面视觉变量进行独立实现，没有复制 Pi 运行时内部源码。

- Dreamatic / DreamaticArt：项目管理、设计上下文与阶段审阅的架构参考。https://github.com/idvxlab/Dreamatic （MIT）
- Pi：通过 npm 锁定使用 @earendil-works/pi-coding-agent / pi-ai 1.3.0，遵循其 MIT 许可。
- build123d：参数化 CAD 工作进程使用其 Apache-2.0 许可的库；依赖 Open Cascade 等库的许可仍各自适用。
- PlatformIO：固件构建工具和平台包使用其各自开源许可，具体版本列于锁文件及导出清单。
- Raspberry Pi Pico：目录数据引用官方产品资料和公开设计授权，来源链接保存在目录条目中。尺寸完整性与许可证核验状态分别记录。

前端布局和组件为本项目编写；使用 React、Three.js、Lucide 等依赖，第三方许可见各软件包。

# 来源与致谢

本分支从 DreamaticMake 的 `design-engine` 分支提取独立引擎与元件设计，保留原有核心代码、契约和示例。

- React、React DOM：界面，MIT 许可。
- Three.js：3D 可视化及 STL 读取，MIT 许可。
- @jscad/modeling 2.13.0：定制模型 CSG 内核，MIT 许可。
- Pydantic：Python 数据契约校验，MIT 许可。
- Trimesh、python-fcl、Rtree：可选 STL 与碰撞后端，许可见各依赖。
- Vite、TypeScript、Playwright 及其它开发依赖：许可见各软件包。

版本由 npm 锁文件、Python 核心依赖文件及可选 mesh 依赖文件记录。示例参数为合成假设，并非测量或实物验证证据。

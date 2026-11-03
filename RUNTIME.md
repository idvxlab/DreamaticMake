# 本地运行环境

本地依赖和工具的实际文件统一放在忽略的 `.runtime/`，不提交到 Git：

```text
.runtime/
  node/          本地 Node.js 可执行文件
  npm/           npm 11.6.2
  node_modules/  package-lock.json 对应的前端及测试依赖
  python/        Python 虚拟环境，包含现有可选 mesh 依赖
  tools/         可选 CAD 素材、报告处理工具及 Corepack
  cache/         npm、pip、Vite 等缓存，及迁移前的缓存
  tmp/           Python 测试临时目录
  downloads/     环境安装包
  legacy/        迁入的旧 npm 工具副本
```

源码、案例、元件素材、项目数据和调研文档仍放在各自目录。`workspace/` 不是环境目录，不能整体替换或删除。

## 使用

在仓库根目录运行，无需先激活 Python 或配置全局 npm：

```powershell
.\npm.cmd run dev
.\npm.cmd run check
.\npm.cmd test
.\npm.cmd run build
.\python.cmd -m engine schema design_package
.\python.cmd -m pip --version
```

`npm.cmd` 使用本地 Node/npm，并把 npm 缓存放到 `.runtime/cache/npm`。`python.cmd` 使用本地虚拟环境，把 pip 缓存放到 `.runtime/cache/pip`。测试脚本使用 `.runtime/tmp/python-tests`，Vite 使用 `.runtime/cache/vite`。

## 兼容入口

根目录 `node_modules/` 是指向 `.runtime/node_modules/` 的 Windows Junction，供 Node、TypeScript、Vite 和编辑器正常查找依赖。

迁移后的 `.venv-engine/` 也是 Junction，指向 `.runtime/python/`。旧环境的 pip 等入口和激活脚本可能记录原绝对路径，因此保留这个入口。旧 npm、CAD 工具路径同样保留目录链接，供此前的本地素材脚本使用。它们不占用另一份环境空间。

Vite 已显式允许访问真实依赖目录。`MAKE_ENGINE_PYTHON` 仍可覆盖默认 Python 路径。

## 新克隆与重建

需要系统 Node.js 22+、Python 3.11+、Windows 自带的 `tar.exe`。在根目录执行：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/setup-runtime.ps1
# 可选：同时安装 STL 碰撞依赖。
powershell -ExecutionPolicy Bypass -File scripts/setup-runtime.ps1 -Mesh
```

脚本将 Node 可执行文件复制到本地，下载固定版本 npm，建立依赖目录链接，创建 Python 虚拟环境并安装依赖。首次安装需要网络；已有实体 `node_modules/` 会提示先迁移，不会覆盖其内容。`-SkipInstall` 只准备和检查目录及解释器，不安装项目依赖。

这是本机目录整理，Python 虚拟环境仍依赖创建它的系统 Python。迁移到另一台机器时应运行安装脚本重建环境。

# 本地运行环境

当前 macOS 的本地依赖和工具统一放在忽略的 `.runtime/`，不提交到 Git：

```text
.runtime/
  python/             Python 虚拟环境
  tools/pool2-tools/  元件 STEP 生成脚本使用的可选 OpenCascade 工具
  cache/              按需生成的 npm、pip、Vite 缓存
  tmp/                Python 测试临时目录
```

源码、案例、元件素材、项目数据和调研文档仍放在各自目录。`workspace/` 是忽略的运行数据目录，不是环境目录。

## 新克隆与重建

需要系统 Node.js 22+ 和 Python 3.11+。在仓库根目录执行：

```sh
./scripts/setup-runtime.sh
```

脚本创建 `.runtime/python` 虚拟环境，执行 `pip install -r requirements.txt` 和 `npm ci`。首次安装需要网络。可选 STL 碰撞依赖需另行安装：

```sh
.runtime/python/bin/python -m pip install -r engine/requirements-mesh.txt
```

## 使用

无需激活 Python 虚拟环境：

```sh
npm run dev
npm run check
npm test
npm run build
.runtime/python/bin/python -m engine schema design_package
```

Node.js 和 npm 使用当前 macOS 的系统安装；Python 命令默认使用 `.runtime/python/bin/python`。启动器和测试脚本依次使用 `MAKE_ENGINE_PYTHON`、`.runtime/python/bin/python`、PATH 中的 `python3`。

元件池默认解析为仓库内的 `element_pool/`。如需使用本机其他目录，可设置 `DREAMATIC_ELEMENT_POOL=/绝对路径`。缓存和测试临时目录会按需生成；迁移到另一台机器时应重新运行安装脚本，不复制虚拟环境。

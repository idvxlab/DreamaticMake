import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Settings } from "../packages/core/src/settings";
import { runProcess } from "../packages/core/src/worker";

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
const config = await new Settings(root).snapshot();
const library = process.argv[2] || config.MAKE_LOCAL_LIBRARY;
if (!library?.trim())
  throw new Error(
    "请提供元件库根目录参数，或在系统设置配置 MAKE_LOCAL_LIBRARY",
  );
const result = await runProcess(
  resolve(root, config.MAKE_PYTHON),
  [
    join(root, "workers/library/import_official.py"),
    "--root",
    resolve(root, library),
  ],
  {
    cwd: root,
    timeout: 120000,
    env: { PYTHONDONTWRITEBYTECODE: "1", PYTHONIOENCODING: "utf-8" },
  },
);
if (result.code !== 0)
  throw new Error("官方硬件索引同步失败：" + result.stderr.slice(-1500));
process.stdout.write(result.stdout);

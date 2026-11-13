import { existsSync } from "node:fs";
import { resolve } from "node:path";

export function enginePython(root: string): string {
  return process.env.MAKE_ENGINE_PYTHON || [
    ".runtime/python/Scripts/python.exe", ".runtime/python/bin/python",
    ".venv-engine/Scripts/python.exe", ".venv-engine/bin/python",
  ].map((path) => resolve(root, path)).find(existsSync)
    || (process.platform === "win32" ? "python" : "python3");
}

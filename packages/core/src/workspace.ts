import { mkdir, access, rename, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve, join, parse } from "node:path";
import { HttpError } from "./store";
export function workspacePath(root: string, value = "workspace") {
  const path = resolve(root, value.trim() || "workspace");
  if (path === resolve(root) || path === parse(path).root)
    throw new HttpError(
      400,
      "工作目录不能是系统源码根目录或磁盘根目录，请使用独立目录",
    );
  return path;
}
/** Moves only known shared files; project migrations are handled by Store. */
export async function prepareWorkspace(path: string) {
  await mkdir(path, { recursive: true });
  await access(path, constants.R_OK | constants.W_OK);
  const system = join(path, ".system");
  await mkdir(system, { recursive: true });
  for (const name of ["custom-parts.json", ".runtime", "toolchains"]) {
    const old = join(path, name),
      target = join(system, name === ".runtime" ? "runtime" : name);
    try {
      await stat(old);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw e;
    }
    try {
      await stat(target);
      continue;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    await rename(old, target);
  }
  return system;
}

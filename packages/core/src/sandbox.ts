import { realpath, mkdir, writeFile } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { randomUUID } from "node:crypto";
/** macOS Seatbelt: worker reads only the toolchain/system paths and its own job. */
export async function sandboxCommand(
  root: string,
  job: string,
  command: string,
  args: string[],
  network = false,
  workspace = join(root, "workspace"),
) {
  if (process.platform !== "darwin")
    throw new Error(
      "工程执行隔离目前支持 macOS；其他平台需先接入隔离工作进程。",
    );
  const cache = join(workspace, ".system/toolchains/platformio");
  await mkdir(cache, { recursive: true });
  const candidates = [
    "/System",
    "/usr",
    "/bin",
    "/sbin",
    "/Library/Frameworks",
    "/Library/Developer",
    "/Applications/Xcode.app",
    "/private/etc",
    "/dev",
    join(root, ".venv"),
    join(root, "workers"),
    job,
    cache,
    dirname(await realpath(command)),
  ];
  const paths = await Promise.all(
    candidates.map((p) => realpath(p).catch(() => p)),
  );
  const actualJob = await realpath(job),
    actualCache = await realpath(cache);
  const quote = (s: string) => JSON.stringify(s);
  const reads = paths.map((p) => `(subpath ${quote(p)})`).join(" ");
  const writes = [actualJob, actualCache]
    .map((p) => `(subpath ${quote(p)})`)
    .join(" ");
  const profile = `(version 1)\n(deny default)\n(import "system.sb")\n(allow process* syscall* sysctl-read mach-bootstrap mach-lookup file-read-metadata)\n(allow file-read* ${reads})\n(allow file-map-executable ${reads})\n(allow file-write* ${writes} (literal "/dev/null"))\n${network ? "(allow network*)" : ""}\n`;
  const file = join(job, "sandbox-" + randomUUID() + ".sb");
  await writeFile(file, profile);
  return {
    command: "/usr/bin/sandbox-exec",
    args: ["-f", file, command, ...args],
    cache,
  };
}

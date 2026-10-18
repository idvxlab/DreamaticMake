import { spawn } from "node:child_process";
import { resolve, join } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { enclosureSchema, type Enclosure } from "./contracts";
import type { Config } from "./settings";
import { workspacePath } from "./workspace";
import { sandboxCommand } from "./sandbox";
export async function runProcess(
  command: string,
  args: string[],
  options: {
    cwd: string;
    input?: string;
    signal?: AbortSignal;
    timeout?: number;
    env?: Record<string, string>;
  },
) {
  return new Promise<{ stdout: string; stderr: string; code: number }>(
    (accept, reject) => {
      if (options.signal?.aborted) return reject(new Error("任务已取消"));
      const env = {
        PATH: process.env.PATH ?? "/usr/bin:/bin",
        HOME: options.cwd,
        TMPDIR: options.cwd,
        LANG: "en_US.UTF-8",
        PYTHONNOUSERSITE: "1",
        XDG_CACHE_HOME: join(options.cwd, ".cache"),
        MPLCONFIGDIR: join(options.cwd, ".matplotlib"),
        ...options.env,
      };
      const child = spawn(command, args, {
        cwd: options.cwd,
        env,
        stdio: ["pipe", "pipe", "pipe"],
        detached: process.platform !== "win32",
      });
      let stdout = "",
        stderr = "",
        settled = false,
        killed = false;
      const kill = () => {
        killed = true;
        try {
          if (child.pid && process.platform !== "win32")
            process.kill(-child.pid, "SIGKILL");
          else child.kill("SIGKILL");
        } catch {}
      };
      const timeout = setTimeout(kill, options.timeout ?? 120000);
      const abort = () => kill();
      options.signal?.addEventListener("abort", abort, { once: true });
      const cleanup = () => {
        clearTimeout(timeout);
        options.signal?.removeEventListener("abort", abort);
      };
      child.stdout.on("data", (d) => {
        stdout += String(d);
        if (stdout.length + stderr.length > 2_000_000) kill();
      });
      child.stderr.on("data", (d) => {
        stderr += String(d);
        if (stdout.length + stderr.length > 2_000_000) kill();
      });
      child.on("error", (e) => {
        if (!settled) {
          settled = true;
          cleanup();
          reject(e);
        }
      });
      child.on("close", (code, exitSignal) => {
        if (!settled) {
          settled = true;
          cleanup();
          if (killed)
            reject(
              new Error(
                options.signal?.aborted
                  ? "任务已取消"
                  : "工作进程超时或输出超限",
              ),
            );
          else if (exitSignal)
            reject(
              new Error(
                "工作进程异常退出：" + exitSignal + " " + stderr.slice(-1000),
              ),
            );
          else accept({ stdout, stderr, code: code ?? 1 });
        }
      });
      child.stdin.on("error", () => {});
      child.stdin.end(options.input ?? "");
    },
  );
}
export async function generateCad(
  root: string,
  out: string,
  parameters: Enclosure,
  config: Config,
  signal?: AbortSignal,
) {
  const p = enclosureSchema.parse(parameters);
  await mkdir(out, { recursive: true });
  const sandbox = await sandboxCommand(
    root,
    out,
    resolve(root, config.MAKE_PYTHON),
    [join(root, "workers/cad/enclosure.py"), out],
    false,
    workspacePath(root, config.MAKE_WORKSPACE),
  );
  const result = await runProcess(sandbox.command, sandbox.args, {
    cwd: out,
    input: JSON.stringify(p),
    signal,
    timeout: +config.MAKE_WORKER_TIMEOUT * 1000,
  });
  if (result.code !== 0)
    throw new Error(
      `CAD 生成失败：${result.stdout.slice(-2000)} ${result.stderr.slice(-1000)}`,
    );
  return JSON.parse(await readFile(join(out, "report.json"), "utf8"));
}
export const firmwareSource = `#include <Arduino.h>\n// Raspberry Pi Pico: onboard LED, no external wiring.\nvoid setup(){pinMode(LED_BUILTIN,OUTPUT);Serial.begin(115200);}\nvoid loop(){digitalWrite(LED_BUILTIN,HIGH);delay(500);digitalWrite(LED_BUILTIN,LOW);delay(500);}\n`;
export async function buildFirmware(
  root: string,
  out: string,
  source: string,
  config: Config,
  signal?: AbortSignal,
) {
  if (
    !source.trim() ||
    source.length > 40000 ||
    /#\s*include\s*[<"]\s*(\/|\.\.)/.test(source)
  )
    throw new Error("无效固件源码");
  await mkdir(join(out, "src"), { recursive: true });
  await writeFile(join(out, "src/main.cpp"), source);
  await writeFile(
    join(out, "platformio.ini"),
    "[env:pico]\nplatform = raspberrypi@1.20.0\nboard = pico\nframework = arduino\nplatform_packages =\n  platformio/toolchain-gccarmnoneeabi@1.90201.191206\n  platformio/framework-arduino-mbed@4.6.0\n  platformio/tool-rp2040tools@1.0.2\n",
  );
  const sandbox = await sandboxCommand(
    root,
    out,
    resolve(root, config.MAKE_PIO),
    ["run", "--project-dir", out],
    true,
    workspacePath(root, config.MAKE_WORKSPACE),
  );
  const result = await runProcess(sandbox.command, sandbox.args, {
    cwd: out,
    signal,
    env: {
      PLATFORMIO_CORE_DIR: sandbox.cache,
      PLATFORMIO_SETTING_ENABLE_TELEMETRY: "No",
    },
    timeout: +config.MAKE_WORKER_TIMEOUT * 1000,
  });
  await writeFile(join(out, "build.log"), result.stdout + "\n" + result.stderr);
  const packageVersions: Record<string, string> = {};
  for (const name of [
    "toolchain-gccarmnoneeabi",
    "framework-arduino-mbed",
    "tool-rp2040tools",
    "tool-scons",
  ]) {
    try {
      const info = JSON.parse(
        await readFile(
          join(sandbox.cache, "packages", name, "package.json"),
          "utf8",
        ),
      );
      packageVersions[name] = info.version;
    } catch {}
  }
  await writeFile(
    join(out, "toolchain-lock.json"),
    JSON.stringify(
      { platform: "raspberrypi@1.20.0", packages: packageVersions },
      null,
      2,
    ),
  );
  const report = {
    ok: result.code === 0,
    packages: packageVersions,
    board: "pico",
    framework: "arduino",
    platform: "raspberrypi@1.20.0",
    exitCode: result.code,
    physicalTested: false,
  };
  await writeFile(join(out, "report.json"), JSON.stringify(report, null, 2));
  if (!report.ok)
    throw new Error(
      `固件编译失败：${(result.stderr + result.stdout).slice(-3000)}`,
    );
  return report;
}

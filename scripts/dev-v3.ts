import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
const node = process.execPath;
const services = [
  { name: "API", args: ["--import", "tsx", "apps/server/src/index.ts"] },
  { name: "web", args: ["node_modules/vite/bin/vite.js", "--config", "apps/web/vite.config.ts"] },
];
const children = services.map(({ args }) => spawn(node, args, { cwd: root, stdio: "inherit", env: process.env }));
let stopping = false;
async function stop(code: number) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  const timer = setTimeout(() => {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }
  }, 10_000);
  timer.unref();
  for (const child of children) child.kill("SIGTERM");
  await Promise.all(exits);
  clearTimeout(timer);
}
const exits = children.map((child, index) => new Promise<void>((resolve) => {
  child.once("error", (error) => console.error(`DreamaticMaker ${services[index].name}`, error));
  child.once("close", (code, signal) => {
    resolve();
    if (stopping) return;
    console.error(`DreamaticMaker ${services[index].name} exited (${signal ?? code})`);
    void stop(code || 1);
  });
}));
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(signal, () => { void stop(0); });
}

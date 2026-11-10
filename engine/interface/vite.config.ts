import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
const root = fileURLToPath(new URL("../../", import.meta.url));
const interfaceRoot = fileURLToPath(new URL("./", import.meta.url));
const python =
  process.env.MAKE_ENGINE_PYTHON ||
  (existsSync(resolve(root, ".runtime/python/Scripts/python.exe"))
    ? resolve(root, ".runtime/python/Scripts/python.exe")
    : existsSync(resolve(root, ".runtime/python/bin/python"))
      ? resolve(root, ".runtime/python/bin/python")
      : existsSync(resolve(root, ".venv-engine/Scripts/python.exe"))
        ? resolve(root, ".venv-engine/Scripts/python.exe")
        : existsSync(resolve(root, ".venv-engine/bin/python"))
          ? resolve(root, ".venv-engine/bin/python")
          : "python");
function api(): Plugin {
  const middleware = async (
    req: IncomingMessage,
    res: ServerResponse,
    next: () => void,
  ) => {
    if (req.url !== "/engine-api") return next();
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.end("{}");
      return;
    }
    if (
      req.headers.origin &&
      req.headers.origin !== `http://${req.headers.host}`
    ) {
      res.statusCode = 403;
      res.end("{}");
      return;
    }
    let data = "";
    let size = 0;
    try {
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 1_000_000) throw new Error("Request too large");
        data += chunk;
      }
      const request = JSON.parse(data);
      if (request.method === "pick_project") {
        if (process.platform !== "win32") {
          res.statusCode = 422;
          res.end(JSON.stringify({ error: "请在项目路径中输入本机文件夹的绝对路径。" }));
          return;
        }
        const script = [
          "Add-Type -AssemblyName System.Windows.Forms",
          "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)",
          "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
          "$dialog.Description = '选择包含 project.json 的项目文件夹'",
          "$dialog.ShowNewFolderButton = $false",
          "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Write($dialog.SelectedPath) }",
          "$dialog.Dispose()",
        ].join("; ");
        const picker = spawn("powershell.exe", ["-NoProfile", "-STA", "-Command", script], { windowsHide: true });
        let chosen = "";
        picker.stdout.setEncoding("utf8");
        const timeout = setTimeout(() => picker.kill(), 300000);
        picker.stdout.on("data", (chunk) => { chosen += chunk.toString("utf8"); });
        picker.on("error", () => { clearTimeout(timeout); res.statusCode = 503; res.end(JSON.stringify({ error: "无法打开文件夹选择器，请输入项目路径。" })); });
        picker.on("close", (code) => {
          clearTimeout(timeout);
          if (res.writableEnded) return;
          res.statusCode = code === 0 ? 200 : 422;
          res.end(JSON.stringify(code === 0 ? { path: chosen.trim() || null } : { error: "文件夹选择器未完成，请输入项目路径。" }));
        });
        return;
      }
      const child = spawn(python, ["-B", "-m", "engine.interface.bridge"], {
        cwd: root,
        env: { ...process.env, PYTHONIOENCODING: "utf-8" },
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
        detached: process.platform !== 'win32',
      });
      let output = "";
      let errors = "";
      let done = false;
      const stopTree = () => {
        if (child.exitCode !== null || !child.pid) return;
        if (process.platform === 'win32') {
          const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
          killer.on('error', () => child.kill());
        } else {
          try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill(); }
        }
      };
      res.on('close', () => { if (!done) stopTree(); });
      const finish = (status: number, body: string) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        res.statusCode = status;
        res.end(body);
      };
      const timer = setTimeout(() => {
        stopTree();
        finish(504, JSON.stringify({ error: "Engine timed out" }));
      }, 30000);
      child.stdout.on("data", (chunk) => {
        output += chunk;
        if (output.length > 16_000_000) { stopTree(); finish(502, JSON.stringify({ error: 'Engine output budget exceeded' })); }
      });
      child.stderr.on("data", (chunk) => {
        if (errors.length < 4000) errors += chunk;
      });
      child.on("error", (error) =>
        finish(503, JSON.stringify({ error: error.message })),
      );
      child.on("close", (code) =>
        finish(
          code === 0 ? 200 : 422,
          output || JSON.stringify({ error: errors || "Engine unavailable" }),
        ),
      );
      child.stdin.on("error", () => {});
      child.stdin.end(data);
    } catch (error) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: String(error) }));
    }
  };
  return {
    name: "standalone-engine",
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}
export default defineConfig({
  root: interfaceRoot,
  cacheDir: resolve(root, ".runtime/cache/vite"),
  plugins: [react(), api()],
  server: {
    host: "127.0.0.1",
    port: 4322,
    strictPort: true,
    fs: {
      allow: [
        interfaceRoot,
        resolve(root, "engine/custom_model"),
        resolve(root, "node_modules"),
        resolve(root, ".runtime/node_modules"),
      ],
    },
  },
  preview: { host: "127.0.0.1", port: 4322 },
  build: { outDir: resolve(interfaceRoot, "dist"), emptyOutDir: true },
});

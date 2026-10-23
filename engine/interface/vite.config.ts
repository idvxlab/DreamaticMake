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
  (existsSync(resolve(root, ".venv-engine/Scripts/python.exe"))
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
      JSON.parse(data);
      const child = spawn(python, ["-B", "-m", "engine.interface.bridge"], {
        cwd: root,
        env: { ...process.env, PYTHONIOENCODING: "utf-8" },
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
      let output = "";
      let errors = "";
      let done = false;
      const finish = (status: number, body: string) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        res.statusCode = status;
        res.end(body);
      };
      const timer = setTimeout(() => {
        child.kill();
        finish(504, JSON.stringify({ error: "Engine timed out" }));
      }, 30000);
      child.stdout.on("data", (chunk) => {
        output += chunk;
        if (output.length > 16_000_000) child.kill();
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
  plugins: [react(), api()],
  server: {
    host: "127.0.0.1",
    port: 4322,
    strictPort: true,
    fs: { allow: [interfaceRoot, resolve(root, "node_modules")] },
  },
  preview: { host: "127.0.0.1", port: 4322 },
  build: { outDir: resolve(interfaceRoot, "dist"), emptyOutDir: true },
});

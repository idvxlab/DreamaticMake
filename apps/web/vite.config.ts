import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { serveAppearancePreview } from "../server/src/appearance-previews";

const root = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const workspace = resolve(root, process.env.DREAMATIC_WORKSPACE ?? "workspace/projects");
export default defineConfig({
  root: fileURLToPath(new URL("./", import.meta.url)),
  cacheDir: resolve(root, ".runtime/cache/vite-v3"),
  plugins: [react(), {
    name: "dreamatic-appearance-previews",
    configureServer(server) {
      // Live previews are read-only and can be updated without restarting active agent runs.
      server.middlewares.use((req, res, next) => {
        void serveAppearancePreview(workspace, req, res).then((handled) => { if (!handled) next(); }, next);
      });
    },
  }],
  server: {
    host: "127.0.0.1", port: 4322, strictPort: true,
    proxy: { "/api": "http://127.0.0.1:4323" },
  },
  preview: { host: "127.0.0.1", port: 4322 },
  build: { outDir: resolve(root, "dist"), emptyOutDir: true },
});

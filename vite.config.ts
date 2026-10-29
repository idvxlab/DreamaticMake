import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  root: "apps/web",
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 4321,
    proxy: {
      "/api": "http://127.0.0.1:4320",
      "/workbench-api": "http://127.0.0.1:4322",
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: "apps/web/index.html",
        workbench: "apps/web/workbench/index.html",
      },
    },
    outDir: "../../dist/web",
    emptyOutDir: true,
  },
});

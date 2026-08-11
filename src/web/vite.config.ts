import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const apiPort = Number(process.env.PORT ?? 3101);
const applicationRevision = process.env.APP_REVISION?.trim() || "unversioned";

export default defineConfig({
  root: fileURLToPath(new URL("./", import.meta.url)),
  plugins: [react()],
  define: {
    __APP_REVISION__: JSON.stringify(applicationRevision),
  },
  server: {
    fs: {
      allow: [repoRoot],
    },
    proxy: {
      "/api": `http://127.0.0.1:${apiPort}`,
    },
  },
  build: {
    outDir: fileURLToPath(new URL("../../dist/client", import.meta.url)),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        app: fileURLToPath(new URL("./index.html", import.meta.url)),
        "service-worker": fileURLToPath(new URL("./service-worker.ts", import.meta.url)),
      },
      output: {
        entryFileNames: chunk => chunk.name === "service-worker"
          ? "service-worker.js"
          : "assets/[name]-[hash].js",
      },
    },
  },
});

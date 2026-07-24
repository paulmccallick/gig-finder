import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

export default defineConfig({
  root: fileURLToPath(new URL("./", import.meta.url)),
  plugins: [react()],
  server: {
    fs: {
      allow: [repoRoot],
    },
    proxy: {
      "/api": "http://127.0.0.1:3001",
    },
  },
  build: {
    outDir: fileURLToPath(new URL("../../dist", import.meta.url)),
    emptyOutDir: true,
  },
});

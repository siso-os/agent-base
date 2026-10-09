import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  root: resolve(import.meta.dirname, "."),
  esbuild: { jsx: "automatic" },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: { input: resolve(import.meta.dirname, "icons.html") },
  },
});

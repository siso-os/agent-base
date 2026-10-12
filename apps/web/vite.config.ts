import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { execSync } from "child_process";
import { osModulesPlugin } from "./vite-os-modules";

// The dev server sends /api and /term to the laptop node (services/node). AB_NODE picks which one: 5401 is the
// real node, a lab node for tests. The built app is served by the node itself, so it needs no proxy.
// The node accepts only its own origin, so the proxy sends that origin instead of the dev server's (dev only; the node
// itself is not loosened).
const node = `127.0.0.1:${process.env.AB_NODE ?? 5401}`;
const asNode = { headers: { origin: `http://${node}` } };

// Build SHA for boot reporting: commit hash at build time, or "dev" if git fails
let buildSha = "dev";
try {
  buildSha = execSync("git rev-parse HEAD", { encoding: "utf-8", cwd: __dirname }).trim();
} catch {
  /* use default "dev" */
}

export default defineConfig({
  plugins: [react(), tailwindcss(), osModulesPlugin()],
  // packages/halo-face carries its own dev copy of React: one React at runtime, this app's.
  resolve: { dedupe: ["react", "react-dom"] },
  // A desktop app loading from disk: one 700 KB bundle (mostly xterm and its WebGL renderer) is fine.
  build: {
    chunkSizeWarningLimit: 1000,
    // React in a chunk of its own, so its file name doesn't change when a module does: a module swapped in place
    // (os/modules.tsx) imports the same React the page already runs, never a second copy.
    rollupOptions: { output: { manualChunks: (id: string) => (/\/node_modules\/(\.pnpm\/[^/]+\/node_modules\/)?(react|react-dom|scheduler)\//.test(id) ? "react" : undefined) } },
  },
  define: {
    __AB_BUILD_SHA__: JSON.stringify(buildSha),
  },
  server: {
    port: Number(process.env.AB_WEB_PORT ?? 5410),
    strictPort: true,
    proxy: {
      "/api": { target: `http://${node}`, ...asNode },
      "/term": { target: `ws://${node}`, ws: true, ...asNode },
      "/chat": { target: `http://${node}`, ws: true, ...asNode },  // chat sockets (/chat/<id>/ws) for the dev server
    },
  },
});

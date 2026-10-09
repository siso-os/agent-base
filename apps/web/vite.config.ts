import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The dev server sends /api and /term to the laptop node (services/node). AB_NODE picks which one: 5401 is the
// real node, a lab node for tests. The built app is served by the node itself, so it needs no proxy.
// The node accepts only its own origin, so the proxy sends that origin instead of the dev server's (dev only; the node
// itself is not loosened).
const node = `127.0.0.1:${process.env.AB_NODE ?? 5401}`;
const asNode = { headers: { origin: `http://${node}` } };

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // packages/halo-face carries its own dev copy of React: one React at runtime, this app's.
  resolve: { dedupe: ["react", "react-dom"] },
  // A desktop app loading from disk: one 700 KB bundle (mostly xterm and its WebGL renderer) is fine.
  build: { chunkSizeWarningLimit: 1000 },
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

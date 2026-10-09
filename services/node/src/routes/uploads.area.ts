import { mkdirSync, createReadStream, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { uploadPath } from "../../../host/src/uploads.ts";
import path from "node:path";
import type { Route } from "./registry.ts";
import type { HttpRuntime } from "../server.ts";

export function uploadsRoutes(runtime: Pick<HttpRuntime, "ALLOWED_ORIGINS" | "IMAGE_EXT" | "UPLOADS" | "json">): Route {
  return {
    method: null,
    path: /^\//,
    async handle(req, res, _match, url = new URL(req.url ?? "/", "http://node")) {
      const { ALLOWED_ORIGINS, IMAGE_EXT, UPLOADS, json } = runtime;
      if (url.pathname === "/api/uploads" && req.method === "POST") {
        // Only the app's own page (another site would need a preflight we never answer, and must send its origin).
        const origin = String(req.headers.origin ?? "");
        if (origin && !ALLOWED_ORIGINS.has(origin)) return json(res, 403, { error: "not this app" });
        const ext = IMAGE_EXT[String(req.headers["content-type"] ?? "").split(";")[0]];
        if (!ext) return json(res, 415, { error: "png, jpeg, gif or webp only" });
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const c of req) {
          size += (c as Buffer).length;
          if (size > 15 << 20) return json(res, 413, { error: "15 MB at most" });
          chunks.push(c as Buffer);
        }
        mkdirSync(UPLOADS, { recursive: true, mode: 0o700 });
        const name = `${Date.now().toString(36)}-${randomBytes(4).toString("hex")}.${ext}`;
        writeFileSync(path.join(UPLOADS, name), Buffer.concat(chunks), { mode: 0o600 });
        return json(res, 200, { name, path: path.join(UPLOADS, name) });
      }
      const up = url.pathname.match(/^\/api\/uploads\/([A-Za-z0-9._-]+\.(png|jpg|jpeg|gif|webp))$/);
      if (up) {
        const f = uploadPath(UPLOADS, path.join(UPLOADS, up[1]));
        if (!f) return json(res, 404, { error: "no such image" });
        res.writeHead(200, { "content-type": `image/${up[2] === "jpg" ? "jpeg" : up[2]}`, "cache-control": "private, max-age=86400" });
        return void createReadStream(f).pipe(res);
      }
      return false;
    },
  };
}

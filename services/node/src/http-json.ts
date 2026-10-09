import { createHash } from "node:crypto";
import type http from "node:http";

/**
 * One JSON answer. t-0586: a GET whose answer has not changed since the caller's last read is a 304 with no body (the app
 * polls 250-420 KB answers every few seconds that are mostly identical; downloading and parsing them again kept the web
 * view's garbage collector busy). The tag is the answer's hash, so it survives a node restart.
 */
export function sendJson(res: http.ServerResponse, code: number, body: unknown) {
  const text = JSON.stringify(body);
  if (code === 200 && res.req?.method === "GET") {
    const etag = `"${createHash("sha1").update(text).digest("base64url").slice(0, 20)}"`;
    if (res.req.headers["if-none-match"] === etag) { res.writeHead(304, { etag, "cache-control": "no-store" }); res.end(); return; }
    res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store", etag });
    res.end(text);
    return;
  }
  res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(text);
}

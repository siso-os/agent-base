import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, statSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

/**
 * A site's own icon for the browser rows (Shaan, 6 Oct 22:10: "urls they load their own icons ... we're faking the icons").
 * Fetched by the node from the site itself (its <link rel=icon>, else /favicon.ico), never through a third-party favicon
 * service, and kept on disk: an icon for a week, a miss for a day. Local addresses work too.
 */
const DIR = process.env.AB_FAVICONS ?? path.join(homedir(), ".local/state/agent-base/favicons");
const HIT_MS = 7 * 86_400_000, MISS_MS = 86_400_000, MAX = 256_000, TIMEOUT = 4000;
export type Favicon = { type: string; body: Buffer } | null;

async function get(url: string, accept: string): Promise<Response | null> {
  try {
    const r = await fetch(url, { headers: { accept, "user-agent": "Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Agent Base" }, redirect: "follow", signal: AbortSignal.timeout(TIMEOUT) });
    return r.ok ? r : null;
  } catch { return null; }
}
async function image(url: string): Promise<Favicon> {
  const r = await get(url, "image/*");
  const type = r?.headers.get("content-type")?.split(";")[0].trim() ?? "";
  if (!r || !/^image\//.test(type)) return null;
  const body = Buffer.from(await r.arrayBuffer());
  return body.length > 0 && body.length <= MAX ? { type, body } : null;
}
/** The page's declared icon, read from the first part of its HTML. */
async function declared(origin: string, page: string): Promise<string | null> {
  const r = await get(page, "text/html");
  if (!r || !/text\/html/.test(r.headers.get("content-type") ?? "")) return null;
  const html = (await r.text()).slice(0, 200_000);
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    if (!/\brel\s*=\s*["']?[^"'>]*\bicon\b/i.test(tag)) continue;
    const href = tag.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1];
    if (href && !href.startsWith("data:")) try { return new URL(href, page).href; } catch { /* next */ }
  }
  return `${origin}/favicon.ico`;
}

export async function faviconFor(raw: string): Promise<Favicon> {
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  const key = createHash("sha256").update(u.origin).digest("hex").slice(0, 24), file = path.join(DIR, key);
  try {
    const age = Date.now() - statSync(`${file}.json`).mtimeMs, meta = JSON.parse(readFileSync(`${file}.json`, "utf8"));
    if (meta.type === null ? age < MISS_MS : age < HIT_MS) return meta.type ? { type: meta.type, body: readFileSync(`${file}.bin`) } : null;
  } catch { /* not cached */ }
  const icon = await image(`${u.origin}/favicon.ico`) ?? await (async () => { const href = await declared(u.origin, u.origin + "/"); return href ? image(href) : null; })();
  try {
    mkdirSync(DIR, { recursive: true });
    if (icon) { writeFileSync(`${file}.bin.tmp`, icon.body); renameSync(`${file}.bin.tmp`, `${file}.bin`); }
    writeFileSync(`${file}.json.tmp`, JSON.stringify({ origin: u.origin, type: icon?.type ?? null })); renameSync(`${file}.json.tmp`, `${file}.json`);
  } catch { /* serve without caching */ }
  return icon;
}

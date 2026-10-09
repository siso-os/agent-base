// The WhatsApp space's node side: a narrow proxy to siso-whatsapp-link (the gateway on the Mac mini, over the tailnet)
// plus the Rolodex feed. The gateway holds his WhatsApp; this file only knows its URL and token, and forwards an
// allowlist of routes. It never logs a body, a chat id or a number.
import { createHash } from "node:crypto";
import { accountKey, atomicPrivate, organise, readOrganisation, reserveSend } from "./whatsapp-private.ts";
import { previewWhatsAppImport, importWhatsAppContacts, undoWhatsAppImport } from "./rolodex.ts";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type http from "node:http";

export type WhatsAppConfig = { url: string; token: string };

// Config: AB_WHATSAPP_URL + AB_WHATSAPP_TOKEN (tests), else ~/.config/siso/whatsapp-link.json {"url"} with the token in
// the login Keychain (service siso-whatsapp-link-token, account siso). No config = the space stays hidden (the flag).
export function whatsappConfig(env = process.env, home = homedir()): WhatsAppConfig | null {
  if (env.AB_WHATSAPP_URL) return env.AB_WHATSAPP_TOKEN ? { url: env.AB_WHATSAPP_URL.replace(/\/$/, ""), token: env.AB_WHATSAPP_TOKEN } : null;
  let url = "";
  try { url = String(JSON.parse(readFileSync(path.join(home, ".config/siso/whatsapp-link.json"), "utf8")).url ?? ""); } catch { return null; }
  if (!/^https?:\/\/[^\s]+$/.test(url)) return null;
  try {
    const token = execFileSync("security", ["find-generic-password", "-s", "siso-whatsapp-link-token", "-a", "siso", "-w"], { encoding: "utf8", timeout: 5000 }).trim();
    return token ? { url: url.replace(/\/$/, ""), token } : null;
  } catch { return null; }
}

// What the app may reach on the gateway, method by method. Anything else is a 404 here and never leaves the laptop.
// Deliberate user sending authorised 6 Oct. Agents verify with synthetic gateways only.
const ROUTES: [string, RegExp][] = [
  ["GET", /^\/health$/],
  ["POST", /^\/chats\/[^/]+\/send$/],
  ["GET", /^\/qr$/],
  ["POST", /^\/pair$/],
  ["GET", /^\/chats$/],
  ["GET", /^\/chats\/[^/]+\/messages$/],
  ["POST", /^\/chats\/[^/]+\/read$/],
  ["GET", /^\/media\/[^/]+\/[^/]+\/thumb$/],
  ["GET", /^\/media\/[^/]+\/[^/]+$/],
  ["GET", /^\/search$/],
  ["GET", /^\/events$/],
];

export function allowed(method: string, sub: string): boolean {
  return ROUTES.some(([m, re]) => m === method && re.test(sub));
}

/** Handles /api/whatsapp/*. `fromApp` is the caller's origin check: every POST must come from this app's own page. */
export async function proxy(req: http.IncomingMessage, res: http.ServerResponse, url: URL, cfg: WhatsAppConfig | null, fromApp: boolean, body?: string): Promise<void> {
  const sub = url.pathname.slice("/api/whatsapp".length) || "/";
  const send = (code: number, v: unknown) => { res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(v)); };
  if (sub === "/config") return send(200, { configured: !!cfg });
  if (!cfg) return send(503, { error: "WhatsApp is not set up on this Mac" });
  const method = req.method ?? "GET";
  const account = accountKey(cfg.url);
  if (method !== "GET" && !fromApp) return send(403, { error: "not this app" });
  if (sub === "/organisation") {
    try {
      if (method === "GET") return send(200, { ...readOrganisation(account), account });
      if (method === "POST") return send(200, { ...organise(account, JSON.parse(body ?? "{}")), account });
    } catch (e) { return send((e as any).status ?? 400, { error: (e as Error).message }); }
    return send(405, { error: "method not allowed" });
  }
  if (sub === "/contacts/undo") {
    if (method !== "POST") return send(405, { error: "method not allowed" });
    try { return send(200, undoWhatsAppImport(JSON.parse(body ?? "{}").revision)); }
    catch (e) { return send((e as any).status ?? 400, { error: "Undo unavailable; contacts may have changed. Preview again before continuing." }); }
  }
  if (sub === "/contacts/preview" || sub === "/contacts/import") {
    if (method !== (sub.endsWith("preview") ? "GET" : "POST")) return send(405, { error: "method not allowed" });
    try {
      const r = await fetch(cfg.url + "/rolodex", { headers: { authorization: `Bearer ${cfg.token}` }, signal: AbortSignal.timeout(5000) });
      if (!r.ok) throw new Error("unavailable");
      const people = (await r.json()).people;
      const preview = previewWhatsAppImport(people, account);
      if (method === "GET") return send(200, preview);
      const input = JSON.parse(body ?? "{}");
      if (input.revision !== preview.revision) return send(409, { error: "Contacts changed; preview again" });
      if (!Array.isArray(input.selected)) return send(400, { error: "Select contacts to import" });
      return send(200, importWhatsAppContacts(preview, {}, { selected: input.selected, acceptConflicts: input.acceptConflicts }));
    } catch (e) { return send((e as any).status ?? 502, { error: "Contact import unavailable. Preview again to check the current cache before retrying." }); }
  }
  if (!allowed(method, sub)) return send(404, { error: "not a WhatsApp route" });
  if (method !== "GET" && !fromApp) return send(403, { error: "not this app" });
  if (method === "POST" && /^\/chats\/[^/]+\/send$/.test(sub)) {
    let input: any;
    try { input = JSON.parse(body ?? "{}"); } catch { return send(400, { error: "Invalid send request" }); }
    if (input?.explicit !== true || typeof input.text !== "string" || !input.text.trim() || Buffer.byteLength(input.text) > 4000 ||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(input.requestId ?? ""))
      return send(400, { error: "Explicit send, request ID and text (maximum 4000 bytes) required" });
    const fingerprint = createHash("sha256").update(JSON.stringify([sub, input.text])).digest("hex");
    let reservation: ReturnType<typeof reserveSend>;
    try { reservation = reserveSend(account, input.requestId, fingerprint); }
    catch { return send(503, { error: "Cannot safely record this send; draft retained" }); }
    const { file, previous } = reservation;
    if (previous) {
      if (previous.fingerprint !== fingerprint) return send(409, { error: "Request ID already belongs to another message" });
      if (previous.state === "accepted") return send(200, { accepted: true, id: previous.id, replay: true });
      if (previous.state === "rejected") return send(previous.status ?? 400, { error: "This send was rejected. Draft retained; retry as a new explicit action.", retryable: true });
      return send(409, { error: "Delivery is uncertain. Check this chat in WhatsApp before composing another send. Draft retained.", uncertain: true });
    }
    let state: "accepted" | "rejected" | "unknown" = "unknown", id: string | undefined;
    let code = 502, result: Record<string, unknown> = { error: "Delivery is uncertain. Check WhatsApp before composing another send. Draft retained.", uncertain: true };
    try {
      const r = await fetch(cfg.url + sub, { method: "POST", headers: { authorization: `Bearer ${cfg.token}`, "content-type": "application/json" }, body: JSON.stringify({ text: input.text }), signal: AbortSignal.timeout(22000) });
      const data = await r.json().catch(() => ({}));
      if (r.ok && typeof data.id === "string" && data.id) { state = "accepted"; id = data.id; code = 200; result = { accepted: true, id }; }
      else if ([400, 401, 403, 404, 429].includes(r.status)) {
        state = "rejected"; code = r.status;
        result = { error: r.status === 403 ? "Sending is disabled at the gateway. Draft retained." : r.status === 429 ? "Gateway send limit reached. Draft retained; try later." : "Gateway rejected this send. Draft retained.", retryable: true };
      }
    } catch { /* Unknown outcome, never retry automatically. No gateway error/body is logged. */ }
    try { atomicPrivate(file, { fingerprint, state, status: code, ...(id ? { id } : {}) }); }
    catch { return send(502, { error: "Send receipt could not be saved. Check WhatsApp before composing another send.", uncertain: true }); }
    return send(code, result);
  }
  // Marking a chat read stays local-only: refuse it if the gateway would send read receipts (blue ticks).
  if (/^\/chats\/[^/]+\/read$/.test(sub)) {
    try {
      const h = await (await fetch(cfg.url + "/health", { headers: { authorization: `Bearer ${cfg.token}` }, signal: AbortSignal.timeout(5000) })).json();
      if (h?.readReceipts !== false) return send(403, { error: "read receipts are on at the gateway; marking read is refused" });
    } catch { return send(502, { error: "the WhatsApp link is not reachable (is the Mac mini on?)", offline: true }); }
  }
  const isEvents = sub === "/events";
  const ctl = new AbortController();
  const timer = isEvents ? null : setTimeout(() => ctl.abort(), sub.startsWith("/media/") && !sub.endsWith("/thumb") ? 70_000 : 20_000);
  req.on("close", () => ctl.abort());
  let up: Response;
  try {
    up = await fetch(cfg.url + sub + url.search, {
      method, signal: ctl.signal,
      headers: { authorization: `Bearer ${cfg.token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
      body: method === "GET" ? undefined : body ?? "",
    });
  } catch (e) {
    if (timer) clearTimeout(timer);
    if (res.headersSent) return void res.end();
    return send(502, { error: "the WhatsApp link is not reachable (is the Mac mini on?)", offline: true, ...(sub === "/health" ? { appSendEnabled: false, sendEnabled: false } : {}) });
  }
  // Local explicit-send support is authoritative; upstream health cannot spoof app capability.
  if (sub === "/health") {
    try {
      if (!up.ok) return send(up.status, { error: "WhatsApp link status is unavailable", appSendEnabled: false, sendEnabled: false });
      const health = await up.json();
      if (!health || typeof health !== "object" || Array.isArray(health) || !health.link || typeof health.link !== "object" || typeof health.link.state !== "string" || typeof health.link.connected !== "boolean" || typeof health.link.loggedIn !== "boolean") throw new Error("invalid health");
      return send(200, { ...health, sendEnabled: health.sendEnabled === true, appSendEnabled: allowed("POST", "/chats/fixture/send") });
    } catch {
      return send(502, { error: "WhatsApp link status could not be read", appSendEnabled: false, sendEnabled: false });
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  if (timer) clearTimeout(timer);
  const headers: Record<string, string> = { "cache-control": up.headers.get("cache-control") ?? "no-store" };
  for (const h of ["content-type", "content-length"]) { const v = up.headers.get(h); if (v) headers[h] = v; }
  res.writeHead(up.status, headers);
  if (!up.body) return void res.end();
  const reader = up.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
  } catch { /* client or gateway went away */ }
  res.end();
}

export type WhatsAppPerson = { jid: string; phone?: string; name: string; isGroup: boolean; lastTs: number; lastIn: number; lastOut: number; messages: number; sent: number; observedAt?: string };

let rolodexCache: { at: number; people: WhatsAppPerson[] } | null = null;

/** The Rolodex feed: names, numbers, last contact and counts from the gateway (never bodies), cached a minute. */
export async function whatsappPeople(cfg: WhatsAppConfig | null, now = Date.now()): Promise<WhatsAppPerson[]> {
  if (!cfg) return [];
  if (rolodexCache && now - rolodexCache.at < 60_000) return rolodexCache.people;
  try {
    const r = await fetch(cfg.url + "/rolodex", { headers: { authorization: `Bearer ${cfg.token}` }, signal: AbortSignal.timeout(3000) });
    if (!r.ok) return rolodexCache?.people ?? [];
    const people = ((await r.json()).people ?? []).filter((p: WhatsAppPerson) => !p.isGroup).map((p: WhatsAppPerson) => ({ ...p, observedAt: new Date(now).toISOString() }));
    rolodexCache = { at: now, people };
    return people;
  } catch { return rolodexCache?.people ?? []; }
}

export function resetWhatsAppCache() { rolodexCache = null; }

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N} ]/gu, "").replace(/\s+/g, " ").trim();

/** Rolodex contacts from WhatsApp: one per Rolodex name that matches a WhatsApp chat name exactly (case and accents aside). */
export function rolodexContacts(names: string[], people: WhatsAppPerson[]) {
  const byName = new Map<string, WhatsAppPerson>();
  const ambiguous = new Set<string>();
  for (const p of people) {
    const k = norm(p.name);
    if (!k) continue;
    const prev = byName.get(k);
    if (prev && prev.jid !== p.jid) ambiguous.add(k);
    if (!prev || p.lastTs > prev.lastTs) byName.set(k, p);
  }
  return names.flatMap((name) => {
    const p = byName.get(norm(name));
    if (!p || ambiguous.has(norm(name))) return [];
    return [{ id: `wa:${p.jid}`, name, whatsapp: p.phone?.replace(/^\+/, ""), lastContact: Math.max(p.lastIn, p.lastOut) || p.lastTs, messages: p.messages, facts: [{ field: "displayName", value: p.name, source: `whatsapp:gateway:${p.jid}`, observedAt: p.observedAt ?? new Date().toISOString(), confidence: "exact-name" as const }] }];
  });
}

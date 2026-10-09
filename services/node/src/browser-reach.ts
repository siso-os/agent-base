// Why a page in the Web space never finished loading (arc-edges §5.1). The native page reports only "started" and
// "finished", so after 8 s of loading the app asks here once: one HEAD request, no cookies, 5 s cap. Any HTTP answer
// (even 401 or 500) means the site answered and the page is just slow; a network error is named by kind.

export type Reach = { ok: true; status: number } | { ok: false; kind: "dns" | "refused" | "timeout" | "cert" | "other"; detail: string };

const CERT = /CERT|SELF_SIGNED|UNABLE_TO_VERIFY|ERR_TLS|SSL/;
/** A fetch failure, by its cause's code: names only, never the request or response. */
export function classify(e: unknown): Reach {
  const err = e as { name?: string; code?: string; cause?: { code?: string; name?: string } } | null;
  const code = String(err?.cause?.code ?? err?.code ?? "");
  if (err?.name === "TimeoutError" || err?.name === "AbortError" || /TIMEOUT|ETIMEDOUT/.test(code)) return { ok: false, kind: "timeout", detail: "no answer in 5 s" };
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return { ok: false, kind: "dns", detail: "address not found" };
  if (code === "ECONNREFUSED" || code === "ECONNRESET" || code === "EHOSTUNREACH" || code === "ENETUNREACH") return { ok: false, kind: "refused", detail: "could not connect" };
  if (CERT.test(code)) return { ok: false, kind: "cert", detail: "certificate not valid" };
  return { ok: false, kind: "other", detail: code ? code.toLowerCase().replace(/_/g, " ") : "no answer" };
}

/** Only http(s) addresses are asked about; anything else is "other" without a request. */
export async function reach(raw: string, fetcher: typeof fetch = fetch): Promise<Reach> {
  let url: URL;
  try { url = new URL(raw); } catch { return { ok: false, kind: "other", detail: "not an address" }; }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false, kind: "other", detail: "not a web address" };
  try {
    const r = await fetcher(url, { method: "HEAD", redirect: "manual", credentials: "omit", signal: AbortSignal.timeout(5000) });
    return { ok: true, status: r.status };
  } catch (e) { return classify(e); }
}

// Whether a page can show in an iframe (the web app outside the desktop app, his phone): a 401 asks for a password that a
// frame never shows, and X-Frame-Options or a CSP frame-ancestors without * refuses frames (GitHub). One GET, no cookies,
// 5 s cap; no answer means "try the frame".
export type Frame = { frame: true } | { frame: false; why: "frames" | "password" };
export function frameOf(status: number, headers: Pick<Headers, "get">): Frame {
  if (status === 401) return { frame: false, why: "password" };
  if (/\b(deny|sameorigin)\b/i.test(headers.get("x-frame-options") ?? "")) return { frame: false, why: "frames" };
  const ancestors = /(?:^|;)\s*frame-ancestors\s+([^;]*)/i.exec(headers.get("content-security-policy") ?? "")?.[1];
  if (ancestors !== undefined && !ancestors.trim().split(/\s+/).includes("*")) return { frame: false, why: "frames" };
  return { frame: true };
}
export async function frameable(raw: string, fetcher: typeof fetch = fetch): Promise<Frame> {
  let url: URL;
  try { url = new URL(raw); } catch { return { frame: true }; }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { frame: true };
  try {
    const r = await fetcher(url, { method: "GET", redirect: "follow", credentials: "omit", signal: AbortSignal.timeout(5000) });
    void r.body?.cancel().catch(() => undefined);
    return frameOf(r.status, r.headers);
  } catch { return { frame: true }; }
}

/**
 * A poll that skips answers it already has (t-0586). The node tags every GET JSON answer with an ETag and replies 304 when
 * the caller sends the tag of an unchanged answer, so an idle app no longer downloads, parses and redraws the same
 * 250-420 KB every few seconds. One reader per consumer: a shared tag would hand a second consumer a 304 before its first
 * answer.
 */
export function changedReader() {
  let tag: string | null = null;
  const read = async (url: string, init: RequestInit = {}): Promise<Response | null> => {
    const headers = new Headers(init.headers);
    if (tag) headers.set("if-none-match", tag);
    const r = await fetch(url, { cache: "no-store", ...init, headers });
    if (r.status === 304) return null;
    tag = r.ok ? r.headers.get("etag") : null;
    return r;
  };
  /** Forget the tag, so the next read returns a full answer (after a failed parse, or a reset). */
  read.reset = () => { tag = null; };
  return read;
}

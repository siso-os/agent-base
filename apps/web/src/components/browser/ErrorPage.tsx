/** A page that never loaded (arc-edges §5.1). The native page is hidden and this, our own page, shows in its place (R1):
 * what happened in plain words, the evidence in mono, and what he can do. A certificate problem offers Go back, never a
 * way past it. */
export type PageFailure = { url: string; host: string; kind: "dns" | "refused" | "timeout" | "cert" | "offline" | "other"; detail: string; at: number; tries: number };

const WORDS: Record<PageFailure["kind"], { title: (host: string) => string; reason: string }> = {
  dns: { title: (h) => `${h} wasn't found`, reason: "The address may be mistyped, or the site no longer exists." },
  refused: { title: (h) => `${h} didn't answer`, reason: "Nothing answered at that address. If it is a server on this Mac or the tailnet, it may not be running." },
  timeout: { title: (h) => `${h} didn't answer`, reason: "The site took too long to reply. It may be down or very busy." },
  cert: { title: (h) => `${h}'s certificate isn't valid`, reason: "The connection can't be trusted, so the page wasn't opened." },
  offline: { title: () => "You're offline", reason: "This Mac has no internet connection. The page opens again by itself when it's back." },
  other: { title: (h) => `${h} didn't load`, reason: "The page stopped loading before it finished." },
};

export function ErrorPage(props: { failure: PageFailure; onRetry: () => void; onBack: () => void; onChrome: () => void }) {
  const f = props.failure;
  const w = WORDS[f.kind];
  const at = new Date(f.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const copy = () => { void navigator.clipboard?.writeText(f.url).catch(() => undefined); };
  return (
    <div className="ab-browser__error" role="alert" aria-label={w.title(f.host)}>
      <span className="ab-browser__error-mark" aria-hidden="true">{(f.host || "?").charAt(0).toUpperCase()}</span>
      <h2>{w.title(f.host)}</h2>
      <code>{f.detail} · {at} · tried {f.tries} {f.tries === 1 ? "time" : "times"}</code>
      <p>{w.reason}</p>
      <div className="ab-browser__error-acts">
        {f.kind === "cert" ? <button type="button" onClick={props.onBack}>Go back</button> : <button type="button" onClick={props.onRetry}>Try again</button>}
        <button type="button" onClick={props.onChrome}>Open in Chrome</button>
        <button type="button" onClick={copy}>Copy link</button>
      </div>
    </div>
  );
}

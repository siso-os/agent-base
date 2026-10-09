// uihub: arc:toast-stack (the shipped card renders in the one stack, t-0460)
import { useEffect, useRef, useState } from "react";
import { CheckIcon, SparklesIcon, XIcon } from "lucide-react";
import type { Change, Shipped } from "../lib/useVersion";
import { zeroCue } from "../lib/zeroFace";
import { openWhatsNew } from "../lib/releases";
import { WhatsNewLink } from "./WhatsNew";
import "./UpdateToast.css";
import "./BankChrome.css";

/** Where a part of the app lives, for a "Show me" whose part isn't on this page (SPEC-DELIGHT §1). */
const WHERE: Record<string, string> = {
  "halo-rim": "In any chat, around the message box",
  hud: "In any chat, under the message box",
  "fanout-row": "In a chat that launched agents",
  "zero-face": "Bottom right",
  "zero-dock": "Click Agent Zero's face, bottom right",
  "agent-panel": "In a chat's side panel (⌘⇧B)",
  "ping-strip": "Under a chat's header",
  "chat-head": "At the top of any chat",
};
const areaLabel = (a: string) => a.replace(/-/g, " ");

/** "Show me": the page dims, the part rings cyan and pings three times under a "New · …" tag; 4.8 s or a click clears it. */
function Spotlight({ change, onDone }: { change: Change; onDone: () => void }) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  useEffect(() => {
    const el = [...document.querySelectorAll<HTMLElement>(`[data-testid="${CSS.escape(change.area ?? "")}"]`)].find((e) => e.getClientRects().length > 0 && e.offsetParent !== null) ?? null;
    if (el) el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    const t0 = window.setTimeout(() => setRect(el ? el.getBoundingClientRect() : null), el ? 260 : 0);
    const end = window.setTimeout(onDone, 4800);
    const away = () => onDone();
    window.addEventListener("pointerdown", away, { once: true });
    return () => (clearTimeout(t0), clearTimeout(end), window.removeEventListener("pointerdown", away));
  }, [change, onDone]);
  if (!rect) {
    return (
      <div className="ab-spot is-elsewhere" data-testid="shipped-spot" role="status">
        <span className="ab-spot__tag">New · {change.subject}</span>
        <span className="ab-spot__where">{WHERE[change.area ?? ""] ?? "Not on this page"}</span>
      </div>
    );
  }
  const pad = 6;
  return (
    <div className="ab-spot" data-testid="shipped-spot" role="status">
      <div className="ab-spot__ring" data-area={change.area ?? ""} style={{ left: rect.left - pad, top: rect.top - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }} />
      <span className="ab-spot__tag is-pinned" style={{ left: Math.max(12, rect.left), top: Math.max(12, rect.top - pad - 34) }}>
        New · {change.subject}
      </span>
    </div>
  );
}

/** Before and after, side by side in one frame: wipes from before to after once, then follows the pointer. No shots: none. */
function Peek({ sha }: { sha: string }) {
  const [ok, setOk] = useState<boolean | null>(null);
  const [at, setAt] = useState(0);
  const frame = useRef<HTMLDivElement>(null);
  const base = `/SHIPPED/${encodeURIComponent(sha)}`;
  useEffect(() => {
    const img = new Image();
    img.onload = () => setOk(true);
    img.onerror = () => setOk(false);
    img.src = `${base}/after.png`;
  }, [base]);
  useEffect(() => {
    if (!ok || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return void setAt(100);
    let raf = 0;
    const t0 = performance.now();
    const step = (t: number) => (setAt(Math.min(100, ((t - t0) / 1500) * 100)), t - t0 < 1500 && (raf = requestAnimationFrame(step)));
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [ok]);
  if (!ok) return null;
  const drag = (x: number) => {
    const r = frame.current?.getBoundingClientRect();
    if (r) setAt(Math.max(0, Math.min(100, ((x - r.left) / r.width) * 100)));
  };
  return (
    <div ref={frame} className="ab-shipped__peek" data-testid="shipped-peek" onPointerMove={(e) => e.buttons && drag(e.clientX)} onPointerDown={(e) => drag(e.clientX)}>
      <img src={`${base}/before.png`} alt="Before" />
      <img src={`${base}/after.png`} alt="After" style={{ clipPath: `inset(0 ${100 - at}% 0 0)` }} />
      <i style={{ left: `${at}%` }} aria-hidden />
    </div>
  );
}

/**
 * After the reload (SPEC-DELIGHT §1, beat 2): "✓ Shipped · sha · just now", up to three changes with their part and
 * Show me, the before/after peek when the deploy kept shots, and All N changes. Agent Zero's face bursts. Untouched for
 * 12 s it folds back to a small pill; ✕ closes it.
 */
export function ShippedCard({ shipped, onClose }: { shipped: Shipped; onClose: () => void }) {
  const [folded, setFolded] = useState(false);
  const [all, setAll] = useState(false);
  const [spot, setSpot] = useState<Change | null>(null);
  const touched = useRef(false);
  useEffect(() => {
    zeroCue({ do: "celebrate" });
    const t = window.setTimeout(() => !touched.current && setFolded(true), 12_000);
    return () => clearTimeout(t);
  }, []);
  const list = all ? shipped.changes : shipped.changes.slice(0, 3);
  const sha7 = shipped.sha.slice(0, 7);
  if (folded) {
    return (
      <button type="button" className="ab-ready is-shipped" data-testid="shipped-pill" onClick={() => ((touched.current = true), setFolded(false))}>
        <CheckIcon size={13} /> Shipped · {sha7}
        <span className="ab-ready__x" role="button" aria-label="What’s new" title="What’s new" data-testid="shipped-pill-whats-new" onClick={(e) => (e.stopPropagation(), openWhatsNew())}>
          <SparklesIcon size={12} />
        </span>
        <span className="ab-ready__x" role="button" aria-label="Dismiss" onClick={(e) => (e.stopPropagation(), onClose())}>
          <XIcon size={12} />
        </span>
      </button>
    );
  }
  return (
    <>
      <aside className="ab-shipped" data-testid="shipped-card" role="status" aria-live="polite" onPointerEnter={() => (touched.current = true)}>
        <header>
          <span className="ab-shipped__ok"><CheckIcon size={14} /></span>
          <b>Shipped</b>
          <span className="ab-shipped__k">· {sha7} · just now</span>
          <button type="button" aria-label="Dismiss" onClick={onClose}><XIcon size={15} /></button>
        </header>
        {list.length > 0 && (
          <ul>
            {list.map((c, i) => (
              <li key={`${c.subject}-${i}`}>
                <span className="ab-shipped__subject">{c.subject}</span>
                {c.area && <span className="ab-shipped__area">{areaLabel(c.area)}</span>}
                {c.area && (
                  <button type="button" className="ab-shipped__show" onClick={() => ((touched.current = true), setSpot(c))}>
                    Show me
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        <Peek sha={shipped.sha} />
        <footer>
          {shipped.changes.length > 3 && (
            <button type="button" onClick={() => ((touched.current = true), setAll((v) => !v))}>
              {all ? "Fewer" : `All ${shipped.changes.length} changes ›`}
            </button>
          )}
          <WhatsNewLink testid="shipped-whats-new" />
        </footer>
      </aside>
      {spot && <Spotlight change={spot} onDone={() => setSpot(null)} />}
    </>
  );
}

/**
 * t-0570 (Shaan, 9 Oct: "there's this pinned versions thing hanging around I hate should get rid of that"; also 8 Oct 21:25):
 * the floating Version pill over the composer is gone. A waiting build is offered in the top bar's Recorded vNNN pop-up
 * (WhatsNew.tsx VersionPill), which also shows the Shipped card after the reload; this file keeps the card itself.
 */

// uihub: arc:bottom-sheet
import { BottomSheet } from "@siso/shell";
import { useEffect, useRef, useState } from "react";
import { type BrowserAccount, closePage, mountPage, pageKey, readGoogleAccount, signInUrl, storeOf } from "../../lib/webview";
import { SIGN_IN_STEPS, signInStep } from "../../lib/browser-setup";

type Seen = { kind: "open" } | { kind: "done" } | { kind: "other"; email: string } | { kind: "blocked" };

/** The sign-in sheet (arc-edges §2.1, option A): Google's sign-in as a second native page inset in the Accounts hub, on that
 * account's own store, so he never leaves the list. A 40 px title bar says who and where; three dots follow Google's address
 * (address · password · phone prompt). Done is Google showing an address on its own avatar (`browser_google_account`):
 * the same address goes green at once and the sheet closes after 1.2 s; another address offers "Keep it as <other>" (that
 * row takes this store, no cookie copied) or "Try again" in a fresh store. Closing early is kept as "Didn't finish · stopped
 * at <step>". Agents never fill it. The sheet is a region, not a dialog: an open dialog hides every native page. */
export function SignInSheet(props: {
  account: BrowserAccount;
  onSignedIn: (id: string) => void;
  onStop: (id: string, step: string) => void;
  onKeepAs: (id: string, email: string) => void;
  onFresh: (id: string) => void;
  onClose: () => void;
}) {
  const a = props.account;
  const email = a.email ?? "";
  const store = storeOf(a);
  const tab = `signin:${a.id}`;
  const slot = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(0);
  const [seen, setSeen] = useState<Seen>({ kind: "open" });
  const now = useRef({ seen, props });
  now.current = { seen, props };
  useEffect(() => {
    if (!slot.current || !email) return;
    const page = mountPage(slot.current, signInUrl(email), (url) => {
      const s = signInStep(url);
      if (s === "blocked") setSeen({ kind: "blocked" });
      else if (s !== null) setStep(s);
    }, () => undefined, store, tab);
    let busy = false;
    const timer = window.setInterval(async () => {
      if (busy || now.current.seen.kind !== "open") return;
      busy = true;
      try {
        const shown = await readGoogleAccount(pageKey(tab, store));
        if (!shown) return;
        if (shown.toLowerCase() === email.toLowerCase()) { setSeen({ kind: "done" }); now.current.props.onSignedIn(a.id); }
        else setSeen({ kind: "other", email: shown });
      } catch { /* a loading Google page has no avatar yet */ } finally { busy = false; }
    }, 1500);
    return () => { clearInterval(timer); page.dispose(); void closePage(tab); };
  }, [email, store, tab, a.id]);
  useEffect(() => {
    if (seen.kind !== "done") return;
    const t = window.setTimeout(() => now.current.props.onClose(), 1200);
    return () => clearTimeout(t);
  }, [seen.kind]);
  const close = () => { if (seen.kind === "open") props.onStop(a.id, SIGN_IN_STEPS[step]); props.onClose(); };
  const where = a.source === "default" ? "Default store" : a.chromeName ? `Chrome “${a.chromeName}”` : "Its own store";
  return (
    <BottomSheet key={a.id} className="ab-hub__sheet" aria-label={`Signing in as ${email}`} onClose={close} expand={seen.kind !== "open"}>
      <header>
        <span className="ab-hub__face" aria-hidden="true">{email.slice(0, 2).toUpperCase()}</span>
        <b title={email}>Signing in as {email}</b>
        <small>{where}</small>
        <button type="button" aria-label="Close sign-in" onClick={close}>×</button>
      </header>
      <ol className="ab-hub__steps" aria-label="Sign-in steps">
        {SIGN_IN_STEPS.map((s, i) => <li key={s} aria-current={seen.kind === "open" && i === step ? "step" : undefined} data-done={seen.kind === "done" || i < step || undefined}>{s}</li>)}
      </ol>
      {seen.kind === "done" && <p className="ab-hub__sheet-note" role="status">Signed in · Google showed {email} · saved on this Mac</p>}
      {seen.kind === "other" && (
        <div className="ab-hub__sheet-card" data-sheet-content role="group" aria-label="Signed in as another account">
          <p>Google signed in as <b>{seen.email}</b>, not {email}.</p>
          <button type="button" className="is-primary" onClick={() => props.onKeepAs(a.id, seen.email)}>Keep it as {seen.email}</button>
          <button type="button" onClick={() => props.onFresh(a.id)}>Try again</button>
        </div>
      )}
      {seen.kind === "blocked" && (
        <div className="ab-hub__sheet-card" data-sheet-content role="group" aria-label="Google blocked this sign-in">
          <p>Google blocked this sign-in.</p>
          <button type="button" className="is-primary" onClick={() => props.onFresh(a.id)}>Try again in a fresh store</button>
        </div>
      )}
      <div ref={slot} className="ab-hub__sheet-page" aria-label={`Google sign-in for ${email}`} data-native-browser={store} />
    </BottomSheet>
  );
}

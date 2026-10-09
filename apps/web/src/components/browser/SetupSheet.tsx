import { CheckIcon, StarIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { type ArcProfile, type BrowserAccount, accountStatus } from "../../lib/webview";
import { mainAccount, type Setup, sortAccounts, UNSORTED } from "../../lib/browser-setup";

type Counts = { arc: { found: boolean; spaces: number; favourites: number; pinned: number; today: number }; chrome: { found: boolean; profiles: number; signedIn: number; bookmarks: number } };
const STEPS = ["What's on this Mac", "Sort into spaces", "Sign in", "Passwords"] as const;
const PASSWORDS_PAGE = "chrome://password-manager/settings";

/** First run, "Import from Arc and Chrome" (A0 browser-UX spec §3): a 680 px stepper over the Web space. Re-running is safe;
 * the import merges by id and address. Nothing signed in is copied: he signs in once per account (step 3). */
export function SetupSheet(props: {
  setup: Setup;
  accounts: BrowserAccount[];
  spaces: ArcProfile[];
  onStep: (step: Setup["step"]) => void;
  onImport: () => Promise<boolean>;
  onSort: (cols: Record<string, string[]>) => void;
  onSignIn: (id: string, email: string) => void;
  onClose: () => void;
  onDone: () => void;
}) {
  const { setup, accounts, spaces } = props;
  // Esc closes it wherever focus is (the chip that opened it is gone by then).
  const close = useRef(props.onClose);
  close.current = props.onClose;
  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.key === "Escape") close.current(); };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, []);
  return (
    // An overlay over the page (the native page hides while a dialog is open): Esc or a click outside closes it.
    <div className="ab-setup" role="dialog" aria-modal="true" aria-labelledby="ab-setup-title" onClick={(e) => { if (e.target === e.currentTarget) props.onClose(); }}>
      <div className="ab-setup__sheet">
        <header className="ab-setup__head">
          <h2 id="ab-setup-title">Import from Arc and Chrome</h2>
          <button type="button" className="ab-setup__close" onClick={props.onClose}>Do the rest whenever</button>
        </header>
        <ol className="ab-setup__steps" aria-label="Steps">
          {STEPS.map((label, i) => (
            <li key={label} className={i + 1 < setup.step ? "is-done" : i + 1 === setup.step ? "is-on" : ""} aria-current={i + 1 === setup.step ? "step" : undefined}>
              <span>{i + 1 < setup.step ? <CheckIcon size={12} aria-label="done" /> : i + 1}</span>{label}
            </li>
          ))}
        </ol>
        {setup.step === 1 && <Found onImport={props.onImport} onNext={() => props.onStep(2)} />}
        {setup.step === 2 && <Sort accounts={accounts} spaces={spaces} onSort={(cols) => { props.onSort(cols); props.onStep(3); }} />}
        {setup.step === 3 && <SignIn accounts={accounts} spaces={spaces} onSignIn={props.onSignIn} onNext={() => props.onStep(4)} />}
        {setup.step === 4 && <Passwords onDone={props.onDone} />}
      </div>
    </div>
  );
}

function Found(props: { onImport: () => Promise<boolean>; onNext: () => void }) {
  const [counts, setCounts] = useState<Counts | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { fetch("/api/browser/import").then((r) => (r.ok ? r.json() : Promise.reject(r.status))).then((c: Partial<Counts> | null) => (c?.arc && c.chrome ? setCounts(c as Counts) : setFailed(true))).catch(() => setFailed(true)); }, []);
  const go = async () => { setBusy(true); try { if (await props.onImport()) props.onNext(); } finally { setBusy(false); } };
  const none = counts && !counts.arc.found && !counts.chrome.found;
  return (
    <section className="ab-setup__body" aria-label="What's on this Mac">
      {failed ? <p>Could not look at Arc and Chrome on this Mac.</p> : !counts ? <p aria-busy="true">Looking at Arc and Chrome…</p> : (
        <div className="ab-setup__found">
          <div><h3>Arc</h3>{counts.arc.found ? <ul>
            <li><Tick />{counts.arc.spaces} spaces</li><li><Tick />{counts.arc.favourites} favourites</li><li><Tick />{counts.arc.pinned} pinned</li><li><Tick />{counts.arc.today} open tabs</li>
          </ul> : <p>Not on this Mac</p>}</div>
          <div><h3>Chrome</h3>{counts.chrome.found ? <ul>
            <li><Tick />{counts.chrome.signedIn} Google accounts</li><li><Tick />{counts.chrome.bookmarks} bookmarks</li>
          </ul> : <p>Not on this Mac</p>}</div>
        </div>
      )}
      <h3>Not coming across, and why</h3>
      <ul className="ab-setup__why">
        <li><b>Signed-in sessions.</b> Google treats moved cookies as theft; you sign in once per account.</li>
        <li><b>Passwords.</b> Step 4, through Apple Passwords.</li>
        <li><b>Extensions.</b> Keep Chrome for Phantom, Fireflies and Claude.</li>
        <li><b>History.</b> Kept on this Mac only, for address-bar suggestions.</li>
      </ul>
      <footer className="ab-setup__foot">
        {none ? <button type="button" className="ab-setup__primary" onClick={props.onNext}>Continue</button>
          : <button type="button" className="ab-setup__primary" disabled={!counts || busy} onClick={() => void go()}>{busy ? "Bringing it across…" : "Bring it across"}</button>}
      </footer>
    </section>
  );
}

function Sort(props: { accounts: BrowserAccount[]; spaces: ArcProfile[]; onSort: (cols: Record<string, string[]>) => void }) {
  const [cols, setCols] = useState(() => sortAccounts(props.accounts, props.spaces));
  const [picked, setPicked] = useState<string | null>(null);
  const byId = new Map(props.accounts.map((a) => [a.id, a]));
  const move = (id: string, to: string, first = false) => {
    setCols((c) => {
      const out = Object.fromEntries(Object.entries(c).map(([k, ids]) => [k, ids.filter((x) => x !== id)]));
      out[to] = first ? [id, ...out[to]] : [...out[to], id];
      return out;
    });
    setPicked(null);
  };
  const columns = [...props.spaces.map((s) => ({ id: s.id, name: s.name })), { id: UNSORTED, name: "Unsorted" }];
  const total = Object.values(cols).reduce((n, ids) => n + ids.length, 0);
  return (
    <section className="ab-setup__body" aria-label="Sort accounts into spaces">
      <p>Each Google account goes in the space you use it from. The starred one is that space's default; drag pills between columns, or pick one and choose a column.</p>
      {!total ? <p className="ab-browser__empty">No Google accounts to sort yet. You can add them later from Accounts.</p> : (
        <div className="ab-setup__cols">
          {columns.map((col) => (
            <div key={col.id} className={`ab-setup__col${picked ? " is-target" : ""}`} role="group" aria-label={col.name}
              onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const id = e.dataTransfer.getData("text/plain"); if (id) move(id, col.id); }}>
              <button type="button" className="ab-setup__colhead" aria-label={`Move here: ${col.name}`} disabled={!picked} onClick={() => picked && move(picked, col.id)}>{col.name}<small>{cols[col.id]?.length ?? 0}</small></button>
              {(cols[col.id] ?? []).map((id, i) => {
                const a = byId.get(id);
                if (!a) return null;
                return (
                  <div key={id} className={`ab-setup__pill${picked === id ? " is-picked" : ""}`} draggable onDragStart={(e) => e.dataTransfer.setData("text/plain", id)}>
                    <button type="button" className="ab-setup__star" aria-pressed={i === 0 && col.id !== UNSORTED} disabled={col.id === UNSORTED} title={col.id === UNSORTED ? "Unsorted accounts are no space's default" : `Default for ${col.name}`} onClick={() => move(id, col.id, true)}><StarIcon size={12} aria-hidden="true" fill={i === 0 && col.id !== UNSORTED ? "currentColor" : "none"} /></button>
                    <button type="button" className="ab-setup__who" aria-pressed={picked === id} onClick={() => setPicked(picked === id ? null : id)} title={a.chromeName ? `${a.email ?? a.name} · Chrome profile “${a.chromeName}”` : a.email ?? a.name}>{a.email ?? a.name}</button>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
      <footer className="ab-setup__foot"><button type="button" className="ab-setup__primary" onClick={() => props.onSort(cols)}>Looks right</button></footer>
    </section>
  );
}

function SignIn(props: { accounts: BrowserAccount[]; spaces: ArcProfile[]; onSignIn: (id: string, email: string) => void; onNext: () => void }) {
  const main = mainAccount(props.accounts, props.spaces);
  const others = props.accounts.filter((a) => a.email && a.id !== main?.id).length;
  const survived = main?.restartOkAt;
  return (
    <section className="ab-setup__body" aria-label="Sign in">
      {!main ? <p className="ab-browser__empty">No Google account to sign in to yet. Add one from Accounts when you want.</p> : (
        <>
          <p>Start with your main account (about 1 minute: password, then a prompt on your phone).</p>
          <div className="ab-setup__main">
            <span className="ab-browser__avatar">{main.email!.slice(0, 2).toUpperCase()}</span>
            <span><b>{main.email}</b><Status a={main} /></span>
            {main.signedIn === true ? <span className="ab-setup__ok">Signed in</span>
              : <button type="button" className="ab-setup__primary" onClick={() => props.onSignIn(main.id, main.email!)}>Sign in to {main.email}</button>}
          </div>
          {main.signedIn === true && <p className={`ab-setup__gate${survived ? " is-ok" : ""}`}>{survived ? <><Tick />Your sign-in survived a restart.</> : "Quit and reopen Agent Base once. This row will show a tick if your sign-in survived."}</p>}
          {others > 0 && <p className="ab-setup__later">{others === 1 ? "Your other account waits" : `The other ${others} accounts wait`} in Accounts under “Add accounts”. Sign in whenever; nothing here asks again.</p>}
        </>
      )}
      <footer className="ab-setup__foot"><button type="button" onClick={props.onNext}>Next: passwords (optional)</button></footer>
    </section>
  );
}

const Tick = () => <CheckIcon size={12} aria-hidden="true" className="ab-setup__tick" />;

function Status({ a }: { a: BrowserAccount }) {
  const st = accountStatus(a);
  return <small className={`ab-hub__status is-${st.tone}`}>{st.detail ?? st.label}</small>;
}

function Passwords(props: { onDone: () => void }) {
  const [note, setNote] = useState("");
  const openChrome = async () => {
    const r = await fetch("/api/browser/chrome-passwords", { method: "POST" }).catch(() => null);
    setNote(r?.ok ? "Opened in Chrome. Choose “Download file”." : `Could not open Chrome. Paste ${PASSWORDS_PAGE} into Chrome's address bar.`);
  };
  return (
    <section className="ab-setup__body" aria-label="Passwords">
      <p>Optional, about 5 minutes. Your passwords go from Chrome to Apple Passwords; Agent Base never sees them.</p>
      <ol className="ab-setup__how">
        <li>Export from Chrome: <button type="button" onClick={() => void openChrome()}>Open Chrome's password export</button>{note && <small role="status">{note}</small>}</li>
        <li>Open the Passwords app, then File → Import Passwords, and choose the file Chrome saved.</li>
        <li>Delete that file from Downloads (it holds every password in plain text).</li>
      </ol>
      <p className="ab-setup__later">Opening links from other apps here comes with a later desktop build.</p>
      <footer className="ab-setup__foot"><button type="button" className="ab-setup__primary" onClick={props.onDone}>Done</button></footer>
    </section>
  );
}

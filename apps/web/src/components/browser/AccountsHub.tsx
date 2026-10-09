import { type CSSProperties, type ReactNode, useState } from "react";
import { type ArcProfile, type BrowserAccount, accountFor, accountStatus } from "../../lib/webview";
import { accountGroups, balance, byNeed, checkedLine, proofText, spaceColour, tileAction, toAdd } from "../../lib/browser-setup";

/** Open one of his Google services in a given account (A0 browser-UX spec §2, "Quick open"). */
const QUICK = [
  { label: "Gmail", url: "https://mail.google.com/mail/" },
  { label: "YouTube", url: "https://www.youtube.com/" },
  { label: "Drive", url: "https://drive.google.com/" },
];
export type Filter = "all" | "agents";
const hhmm = (at: number) => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/** The Accounts hub (arc-edges §8): every Google account as a 52 px tile, grouped by the space that uses it, the groups
 * flowing down three columns so 21 accounts fit without scrolling. A tile shows its sign-in status (checked on every launch
 * from cookie names) and one button by state; hovering it offers Gmail, YouTube and Drive; clicking it opens the details
 * drawer. Accounts brought across but not signed in yet fold into one "Add accounts" row he opens when he wants (Shaan,
 * 3 Oct: the import is done at his main account). */
export function AccountsHub(props: {
  accounts: BrowserAccount[];
  spaces: ArcProfile[];
  current: ArcProfile;
  checking: boolean;
  onSignIn: (id: string, email: string) => void;
  onOpen: (id: string, url: string, title: string) => void;
  onMakeDefault: (id: string) => void;
  onRecheck: () => void;
  onAddGoogle: () => void;
  onBack: () => void;
  /** Which accounts to show first (the sidebar opens it on All). */
  filter?: Filter;
  /** The sign-in sheet, when one is open: it takes the drawer's place. */
  sheet?: ReactNode;
}) {
  const { accounts, spaces } = props;
  const [filter, setFilter] = useState<Filter>(props.filter ?? "all");
  const [adding, setAdding] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const signedIn = accounts.filter((a) => a.email && a.signedIn === true).length;
  const waiting = toAdd(accounts);
  const agents = accounts.filter((a) => (a.agents?.length ?? 0) > 0).length;
  const shown = accounts.filter((a) => !waiting.includes(a) && (filter === "all" || (a.agents?.length ?? 0) > 0));
  const groups = accountGroups(shown, spaces, accounts);
  const checkedAt = Math.max(0, ...accounts.map((a) => a.checkedAt ?? 0));
  const detail = accounts.find((a) => a.id === picked);
  const who = (a: BrowserAccount) => a.email ?? a.name;
  const act = (a: BrowserAccount) => {
    const label = tileAction(a);
    if (!label) return null;
    const run = label === "Open" ? () => props.onOpen(a.id, QUICK[0].url, "Gmail") : () => props.onSignIn(a.id, a.email!);
    return <button type="button" className="ab-hub__act" data-tone={accountStatus(a).tone} aria-label={label === "Open" ? `Open Gmail as ${who(a)}` : `${label} as ${who(a)}`} onClick={run}>{label}</button>;
  };
  const tile = (a: BrowserAccount) => {
    const st = accountStatus(a);
    const profile = a.source === "default" ? "Default store" : a.chromeName ? `“${a.chromeName}”` : a.chromeDir;
    return (
      <li key={a.id} className="ab-hub__tile" data-tone={st.tone} aria-current={picked === a.id || undefined}>
        <button type="button" className="ab-hub__pick" aria-label={`Details for ${who(a)}`} onClick={() => setPicked((p) => (p === a.id ? null : a.id))} />
        <span className="ab-hub__face" aria-hidden="true">{who(a).slice(0, 2).toUpperCase()}</span>
        <span className="ab-hub__text">
          <Address text={who(a)} />
          <small className="ab-hub__line" title={[profile, a.checkedAt ? `Proof: ${proofText(a)}` : ""].filter(Boolean).join(" · ") || undefined}><span className={`ab-hub__status is-${st.tone}`}>{a.signInStop ? `${st.label} · ${st.detail}` : checkedLine(a, st.label)}</span></small>
          <span className="ab-hub__quick">{QUICK.map((q) => <button key={q.label} type="button" title={`Open ${q.label} as ${who(a)}`} onClick={() => props.onOpen(a.id, q.url, q.label)}>{q.label}</button>)}</span>
        </span>
        {act(a)}
      </li>
    );
  };
  return (
    <div className="ab-hub" data-drawer={detail || props.sheet ? "" : undefined}>
      <div className="ab-hub__main">
        <header className="ab-hub__head">
          <div>
            <h2>Accounts</h2>
            <p>{signedIn} signed in{waiting.length ? ` · ${waiting.length} to add` : ""}</p>
          </div>
          <div className="ab-hub__actions">
            {checkedAt > 0 && <small>Checked {hhmm(checkedAt)}</small>}
            <button type="button" onClick={props.onRecheck} disabled={props.checking}>{props.checking ? "Checking…" : "Check now"}</button>
            <button type="button" onClick={props.onAddGoogle}>+ Google account</button>
          </div>
        </header>
        <div className="ab-hub__filters" role="group" aria-label="Show">
          {([["all", "All", accounts.length], ["agents", "Used by agents", agents]] as const).map(([id, label, n]) => (
            <button key={id} type="button" aria-pressed={filter === id} onClick={() => setFilter(id)}>{label} <span>{n}</span></button>
          ))}
        </div>
        <div className="ab-hub__groups">
          {balance([...groups]).map((col, c) => (
            <div key={c} className="ab-hub__col">
              {col.map(([name, list]) => {
                const space = spaces.find((s) => s.name === name);
                const def = space && accounts.find((a) => a.id === accountFor(space, accounts));
                return (
                  <section key={name} className="ab-hub__group" aria-label={name} style={{ "--ab-group-rgb": spaceColour(space?.id ?? name) } as CSSProperties}>
                    <h3><i aria-hidden="true" />{name} <span>{list.length}</span>{def?.email && <small title={`Default for ${name}`}>default {def.email}</small>}</h3>
                    <ul>{byNeed(list).map(tile)}</ul>
                  </section>
                );
              })}
            </div>
          ))}
        </div>
        {waiting.length > 0 && filter === "all" && (
          <section className="ab-hub__add" aria-label="Add accounts">
            <button type="button" className="ab-hub__addrow" aria-expanded={adding} onClick={() => setAdding((v) => !v)}>
              <b>Add accounts</b><span>{waiting.length} brought across, not signed in yet. Sign in to each when you need it.</span>
            </button>
            {adding && <ul>{waiting.map(tile)}</ul>}
          </section>
        )}
        {!shown.length && !waiting.length && <p className="ab-browser__empty">Nothing here.</p>}
        <footer className="ab-hub__foot">
          <button type="button" onClick={props.onBack}>Back to browser</button>
        </footer>
      </div>
      {props.sheet ?? (detail && <AccountDrawer account={detail} accounts={accounts} spaces={spaces} current={props.current} home={[...accountGroups([detail], spaces, accounts).keys()][0]} onClose={() => setPicked(null)} onOpen={props.onOpen} onMakeDefault={props.onMakeDefault} action={act(detail)} />)}
    </div>
  );
}

/** A long address cuts in the middle, keeping the domain (arc-edges §4: `valentinavarg…@gmail.com`). */
function Address({ text }: { text: string }) {
  const at = text.lastIndexOf("@");
  return <b className="ab-hub__addr" title={text}>{at > 0 ? <><span>{text.slice(0, at)}</span><span>{text.slice(at)}</span></> : <span>{text}</span>}</b>;
}

/** One account's details (arc-edges §8 drawer): where it lives, what uses it, and what is known about its sign-in. */
function AccountDrawer(props: { account: BrowserAccount; accounts: BrowserAccount[]; spaces: ArcProfile[]; current: ArcProfile; home: string; action: ReactNode; onClose: () => void; onOpen: (id: string, url: string, title: string) => void; onMakeDefault: (id: string) => void }) {
  const a = props.account;
  const st = accountStatus(a);
  const name = a.email ?? a.name;
  const defaultIn = props.spaces.filter((s) => accountFor(s, props.accounts) === a.id).map((s) => s.name);
  const here = accountFor(props.current, props.accounts) === a.id;
  return (
    <aside className="ab-hub__drawer" aria-label={`Account ${name}`}>
      <header>
        <span className="ab-hub__face" data-tone={st.tone} aria-hidden="true">{name.slice(0, 2).toUpperCase()}</span>
        <b title={name}>{name}</b>
        <button type="button" aria-label="Close details" onClick={props.onClose}>×</button>
      </header>
      <p><span className={`ab-hub__status is-${st.tone}`}>{st.label}</span>{st.detail && <small>{st.detail}</small>}</p>
      <dl>
        <dt>Space</dt><dd>{props.home}</dd>
        <dt>Default for</dt><dd>{defaultIn.length ? defaultIn.join(", ") : "No space"}</dd>
        {(a.chromeDir || a.source === "default") && <><dt>From</dt><dd>{a.source === "default" ? "Default store" : `Chrome “${a.chromeName ?? "Chrome"}” · ${a.chromeDir}`}</dd></>}
        <dt>Agents allowed</dt><dd>{a.agents?.length ? a.agents.join(", ") : "None"}</dd>
        <dt>Last used</dt><dd>{a.lastUsed ? new Date(a.lastUsed).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "Not yet"}</dd>
        <dt>Checked</dt><dd>{a.checkedAt ? hhmm(a.checkedAt) : "Not yet"}</dd>
        <dt>Proof</dt><dd>{proofText(a)}</dd>
        <dt>After restart</dt><dd>{a.restartOkAt ? `Still signed in · ${hhmm(a.restartOkAt)}` : "Not shown yet"}</dd>
      </dl>
      <div className="ab-hub__drawer-acts">
        {props.action}
        {here ? <small>Default for {props.current.name}</small> : <button type="button" onClick={() => props.onMakeDefault(a.id)}>Use for {props.current.name}</button>}
      </div>
      <div className="ab-hub__drawer-quick">{QUICK.map((q) => <button key={q.label} type="button" onClick={() => props.onOpen(a.id, q.url, q.label)}>{q.label}</button>)}</div>
    </aside>
  );
}

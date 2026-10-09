import type { CSSProperties } from "react";
import { type ArcProfile, type BrowserAccount, accountFor, accountStatus, needsAccount } from "../../lib/webview";
import { spaceColour } from "../../lib/browser-setup";

/** The space menu (arc-edges §3.2, his pick `nav/profile-popover`): opened from the space name, inside the sidebar column
 * (R1: nothing over the native page). Each space with its default account's face and sign-in ring, and ⌃1 to ⌃9; then
 * Accounts with how many are signed in, the import and a new space. */
export function SpaceMenu(props: {
  spaces: ArcProfile[];
  current: string;
  accounts: BrowserAccount[];
  onPick: (id: string) => void;
  onAccounts: () => void;
  onImport: () => void;
  onNewSpace: () => void;
  onClose: () => void;
}) {
  const { accounts } = props;
  const google = accounts.filter((a) => a.email);
  const signedIn = google.filter((a) => a.signedIn === true).length;
  return (
    <div className="ab-browser__menu ab-browser__spacemenu" role="menu" aria-label="Spaces" onKeyDown={(e) => { if (e.key === "Escape") props.onClose(); }}>
      <span className="ab-browser__menu-label" aria-hidden="true">Spaces</span>
      {props.spaces.map((s, i) => {
        const def = accounts.find((a) => a.id === accountFor(s, accounts));
        const ask = needsAccount(s, accounts);
        const tone = def?.email ? accountStatus(def).tone : "none";
        return (
          <button key={s.id} role="menuitemradio" type="button" aria-checked={s.id === props.current} className="ab-browser__spacerow" style={{ "--ab-chip-rgb": spaceColour(s.id) } as CSSProperties} onClick={() => props.onPick(s.id)}>
            <span className="ab-browser__spacemark" aria-hidden="true">{s.name.split(/[ @]/)[0].slice(0, 2).toUpperCase()}</span>
            <span className="ab-browser__spacename">{s.name}</span>
            {ask ? <small className="ab-browser__pick">pick account</small> : def?.email && <span className="ab-browser__spaceface" data-tone={tone} title={`${def.email} · ${accountStatus(def).label}`}>{def.email.slice(0, 2).toUpperCase()}</span>}
            {i < 9 && <kbd aria-label={`Control ${i + 1}`}>⌃{i + 1}</kbd>}
          </button>
        );
      })}
      <hr />
      <button role="menuitem" type="button" onClick={props.onAccounts}>Accounts <small>{signedIn} of {google.length} signed in</small></button>
      <button role="menuitem" type="button" onClick={props.onImport}>Import from Arc and Chrome</button>
      <button role="menuitem" type="button" onClick={props.onNewSpace}>New space</button>
    </div>
  );
}

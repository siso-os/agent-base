// A site behind a password (HTTP Basic, like the siso-ui-hub worker) asks him here, over its page, instead of the blank 401
// WebKit showed before (9 Oct). The password goes straight to the desktop side, which hands it to WebKit; nothing here keeps it.
import { useState } from "react";
import { LockIcon } from "lucide-react";
import type { SiteAuth } from "../../lib/webview";

export function SiteAuthSheet({ ask, onAnswer }: { ask: SiteAuth; onAnswer: (login?: { user: string; password: string }) => void }) {
  const [user, setUser] = useState(""), [password, setPassword] = useState("");
  return <div className="ab-browser__auth" data-native-overlay="true">
    <form role="dialog" aria-modal="true" aria-label={`Sign in to ${ask.host}`} data-esc-own=""
      onSubmit={(e) => { e.preventDefault(); if (user) onAnswer({ user, password }); }}
      onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onAnswer(); } }}>
      <LockIcon size={18} aria-hidden="true" />
      <h2>{ask.host} asks for a password</h2>
      {ask.realm && <p>{ask.realm}</p>}
      {ask.retry && <p className="ab-browser__auth-wrong" role="alert">That user or password did not work.</p>}
      <label>User<input autoFocus autoComplete="username" spellCheck={false} value={user} onChange={(e) => setUser(e.target.value)} /></label>
      <label>Password<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
      <div>
        <button type="button" onClick={() => onAnswer()}>Cancel</button>
        <button type="submit" disabled={!user}>Sign in</button>
      </div>
      <small>Kept in this Mac's keychain for {ask.host}.</small>
    </form>
  </div>;
}

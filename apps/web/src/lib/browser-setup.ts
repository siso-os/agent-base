import { type ArcProfile, type BrowserAccount, accountFor, accountStatus, DEFAULT_ACCOUNT, loadAccounts, loadArcProfiles, saveAccounts, saveArcProfiles } from "./webview.ts";

/** First run (A0 browser-UX spec §3): a 4-step sheet over the Web space. Where he is in it lives in the node with the rest
 * of the browser's state, so a quit and reopen (the sign-in gate) lands him back on the same step. */
export type Setup = { step: 1 | 2 | 3 | 4; closedAt?: number; doneAt?: number };
const KEY = "agent-base:browser-setup";
export function loadSetup(store: Pick<Storage, "getItem">): Setup {
  try {
    const v = JSON.parse(store.getItem(KEY) ?? "null") as Partial<Setup> | null;
    if (v && [1, 2, 3, 4].includes(v.step as number)) return { step: v.step as Setup["step"], closedAt: v.closedAt, doneAt: v.doneAt };
  } catch { /* none yet */ }
  return { step: 1 };
}
export function saveSetup(setup: Setup, store: Pick<Storage, "setItem">) { store.setItem(KEY, JSON.stringify(setup)); }
/** Shown by itself only on a blank tab (never over a page he opened), while he has no Google account yet or is sorting
 * them (step 2). From step 3 on it waits behind the sidebar's "Finish import" chip. */
export const setupDue = (setup: Setup, accounts: BrowserAccount[]) => !setup.doneAt && !setup.closedAt && setup.step <= 2 && (setup.step === 2 || !accounts.some((a) => a.email));
/** The sidebar chip back into the sheet: from step 2 on, until he finishes (closing the sheet keeps the chip). */
export const setupChip = (setup: Setup) => !setup.doneAt && setup.step > 1;

/** A space's tint (an rgb triple var): the chip, the sidebar wash and the hub's group dot all use it. */
const colours = ["--crm-brand-rgb", "--crm-success-rgb", "--crm-danger-rgb", "--crm-highlight-rgb"];
export function spaceColour(id: string) { if (id === "HALO") return "var(--crm-success-rgb)"; return `var(${colours[[...id].reduce((n, c) => n + c.charCodeAt(0), 0) % colours.length]})`; }

/** A hub group's tiles, most in need first (arc-edges §8): signed out by Google, needs sign-in, not checked, signing in,
 * signed in. Stable within a state, so the space's own order (its default first) holds. */
const NEED = { lost: 0, warn: 1, none: 2, busy: 3, ok: 4 } as const;
export const byNeed = (list: BrowserAccount[]) => [...list].sort((a, b) => NEED[accountStatus(a).tone] - NEED[accountStatus(b).tone]);
/** A tile's one button, by state: an account with no address (a store with no Google account) has none. */
export function tileAction(a: BrowserAccount): "Open" | "Sign in" | "Sign in again" | null {
  if (!a.email || a.pendingGoogle) return null;
  if (a.signedIn === true) return "Open";
  return a.lostAt ? "Sign in again" : "Sign in";
}

/** The hub's groups in `n` columns, read top to bottom then left to right: each group, in order, goes to the shortest
 * column so far (a header counts as one tile). Real columns, not CSS `columns`: WebKit hit-tests clicks inside a
 * multi-column box against the box itself, so a tile's buttons never got the mouse-down. */
export function balance<T>(groups: [string, T[]][], n = 3): [string, T[]][][] {
  const cols = Array.from({ length: n }, () => ({ h: 0, groups: [] as [string, T[]][] }));
  for (const g of groups) { const c = cols.reduce((a, b) => (b.h < a.h ? b : a)); c.groups.push(g); c.h += g[1].length + 1; }
  return cols.map((c) => c.groups);
}

/** The space bar's chips (arc-edges §3.1): four slots fit beside the downloads icon and +. More spaces than that show three
 * chips and a "+N" that opens the space menu; the space he is in always has a chip. */
export function spaceChips<T extends { id: string }>(spaces: T[], current: string, slots = 4): { shown: T[]; more: number } {
  if (spaces.length <= slots) return { shown: spaces, more: 0 };
  const first = spaces.slice(0, slots - 1);
  const here = spaces.find((s) => s.id === current);
  const shown = !here || first.includes(here) ? first : [...first.slice(0, -1), here];
  return { shown, more: spaces.length - shown.length };
}

export const UNSORTED = "unsorted";
/** Accounts by the space they belong to (Accounts hub, the tab's "Open as" list): the space he sorted it into on first run,
 * else the first space whose tabs use it, else Unsorted. `all` decides which account each space uses. */
export function accountGroups(list: BrowserAccount[], spaces: ArcProfile[], all: BrowserAccount[] = list): Map<string, BrowserAccount[]> {
  const groups = new Map<string, BrowserAccount[]>();
  for (const a of list) {
    const home = spaces.find((s) => s.id === a.space)?.name ?? spaces.find((s) => accountFor(s, all) === a.id)?.name ?? "Unsorted";
    groups.set(home, [...(groups.get(home) ?? []), a]);
  }
  return groups;
}
const PERSONAL_MAIL = /^(gmail|googlemail|icloud|me|outlook|hotmail|yahoo)\.[a-z.]+$/i;
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
/** Does this name point at that space? Whole-word-ish: 3+ letters, and one contains the other ("halo" ↔ "HALO Agency"). */
const names = (a: string, space: string) => { const x = norm(a), y = norm(space); return y.length >= 3 && x.length >= 3 && (x.includes(y) || y.includes(x)); };

/** Step 2's first guess, column per space (+ Unsorted, empty to start): an account already sorted stays put; a work
 * address goes to the space its domain names; a Chrome profile named like a space goes there; the rest go to Personal.
 * Each column's first account is that space's default, so a space's current default leads its column. */
export function sortAccounts(accounts: BrowserAccount[], spaces: ArcProfile[]): Record<string, string[]> {
  const cols: Record<string, string[]> = Object.fromEntries([...spaces.map((s) => [s.id, [] as string[]]), [UNSORTED, []]]);
  cols.personal ??= [];
  for (const a of accounts) {
    if (!a.email) continue;
    const domain = a.email.split("@")[1] ?? "";
    const home = (a.space && cols[a.space] ? a.space : undefined)
      ?? (!PERSONAL_MAIL.test(domain) ? spaces.find((s) => names(domain.split(".")[0] ?? "", s.name))?.id : undefined)
      ?? (a.chromeName ? spaces.find((s) => s.id !== "personal" && names(a.chromeName!, s.name))?.id : undefined)
      ?? "personal";
    cols[home].push(a.id);
  }
  for (const s of spaces) {
    const col = cols[s.id], lead = accountFor(s, accounts);
    if (col?.includes(lead)) cols[s.id] = [lead, ...col.filter((id) => id !== lead)];
  }
  return cols;
}

/** "Looks right": every account remembers its column, and each space's first account becomes its default. Saved spaces
 * the sheet did not show (Arc's favourites) are kept: dropping them is how the 11 Arc favourites were lost (3 Oct). */
export function applySort(cols: Record<string, string[]>, spaces: ArcProfile[], accounts: BrowserAccount[], store: Pick<Storage, "getItem" | "setItem">) {
  const home = new Map(Object.entries(cols).flatMap(([space, ids]) => ids.map((id) => [id, space] as const)));
  const nextAccounts = accounts.map((a) => {
    if (!home.has(a.id)) return a;
    const space = home.get(a.id)!;
    const { space: _old, ...rest } = a;
    return space === UNSORTED ? rest : { ...rest, space };
  });
  const shown = spaces.map((s) => (cols[s.id]?.length ? { ...s, account: cols[s.id][0] } : { ...s, account: s.account ?? DEFAULT_ACCOUNT }));
  const nextSpaces = [...shown, ...loadArcProfiles(store).filter((s) => !shown.some((x) => x.id === s.id))];
  saveAccounts(nextAccounts, store);
  saveArcProfiles(nextSpaces, store);
  return { accounts: nextAccounts, spaces: nextSpaces };
}

/** Step 3's big button: Personal's account if it is a Google one, else the first account with an address. */
export const mainAccount = (accounts: BrowserAccount[], spaces: ArcProfile[]) => {
  const personal = accounts.find((a) => a.id === accountFor(spaces.find((s) => s.id === "personal"), accounts));
  // The one he signed in to is his main account (3 Oct: "Fuzeheritage alone is enough"), Personal's first.
  if (personal?.email && personal.signedIn === true) return personal;
  return accounts.find((a) => a.email && a.signedIn === true) ?? (personal?.email ? personal : accounts.find((a) => a.email));
};
/** The import is done once he is signed in to his main account (Shaan, 3 Oct 01:00): the other accounts wait under
 * "Add accounts" in the Accounts hub and nothing asks for them again. */
export const importDone = (setup: Setup, accounts: BrowserAccount[], spaces: ArcProfile[]) => !setup.doneAt && setup.step >= 2 && mainAccount(accounts, spaces)?.signedIn === true;
/** Accounts brought across that he has not signed in to yet (never one Google signed out: that one needs him). */
export const toAdd = (accounts: BrowserAccount[]) => accounts.filter((a) => a.email && a.signedIn !== true && !a.lostAt && !a.pendingGoogle);

/** The sidebar's status lines, worst first (arc-edges §1 #6): Google signed an account out, a sign-in landed in the wrong
 * place, something failed, the import is part way, then a plain notice. Accounts never signed in have no line: they wait
 * under "Add accounts" (Shaan, 3 Oct 01:00). */
export type StatusId = "lost" | "stray" | "error" | "setup" | "notice";
export function statusOrder(s: Partial<Record<StatusId, boolean>>): StatusId[] {
  return (["lost", "stray", "error", "setup", "notice"] as const).filter((id) => s[id]);
}
/** Two lines show; the rest fold into "+N more" until he opens them. */
export function foldLines<T>(lines: T[], open: boolean, max = 2): { shown: T[]; more: number } {
  if (open || lines.length <= max) return { shown: lines, more: 0 };
  return { shown: lines.slice(0, max), more: lines.length - max };
}

const clock = (at: number) => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
/** A hub tile's status line (t-0242): "Signed in · checked 04:31", from the last read of its store. */
export function checkedLine(a: Pick<BrowserAccount, "checkedAt">, label: string): string {
  return a.checkedAt ? `${label} · checked ${clock(a.checkedAt)}` : label;
}
/** The drawer's proof: Google's session cookie names found in the store and how many Google cookies it holds (never a value). */
export function proofText(a: Pick<BrowserAccount, "proof" | "checkedAt" | "shownAt">): string {
  if (!a.proof && a.shownAt) return `Google showed this address in the sign-in sheet · ${clock(a.shownAt)}`;
  if (!a.proof) return a.checkedAt ? "Signed-in check only (this app build reads no names)" : "Not read yet";
  const n = `${a.proof.count} Google ${a.proof.count === 1 ? "cookie" : "cookies"}`;
  return a.proof.names.length ? `${a.proof.names.join(", ")} · ${n}` : `No Google session cookie · ${n}`;
}

/** The sign-in sheet's steps (arc-edges §2.1), read from Google's address only: the address, the password, then any other
 * check (a phone prompt, a code). "blocked" when Google refused the sign-in. Anything else keeps the step it was on. */
export const SIGN_IN_STEPS = ["address", "password", "phone prompt"] as const;
export function signInStep(url: string): number | "blocked" | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (u.hostname !== "accounts.google.com") return null;
  const p = u.pathname.toLowerCase();
  if (p.includes("/signin/rejected")) return "blocked";
  if (p.includes("/challenge/pwd")) return 1;
  if (p.includes("/challenge/")) return 2;
  if (/accountchooser|servicelogin|\/signin\/(v2\/)?identifier|\/signin\/identifier/.test(p)) return 0;
  return null;
}

/** A deliberately created everyday profile. Naming never rewrites an existing account or store. */
export function createNamedBrowserProfile(rawName: string, store: Pick<Storage, "getItem" | "setItem">): BrowserAccount {
  const name = rawName.trim();
  if (!name || name.length > 80 || /[\u0000-\u001f\u007f]/.test(name)) throw new Error("Use a profile name of 1–80 characters.");
  const accounts = loadAccounts(store);
  if (accounts.some((a) => a.name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new Error("A profile already has that name.");
  const account: BrowserAccount = { id: `browser:${crypto.randomUUID()}`, name };
  saveAccounts([...accounts, account], store);
  return account;
}

// The browser's own state (spaces, Google accounts, Today tabs, favourites, which space each tab shows), kept by the node in
// one 0600 file under the app's state dir, so agents and every window read the same thing. The web app reads and writes it
// through GET/PUT/PATCH /api/browser/state; it migrates once from the browser's localStorage on first load.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { cleanBrowserFolders } from "../../../apps/web/src/lib/browser-tabs.ts";

/** Every field the web may write; anything else in a PUT is dropped. */
const FIELDS = ["spaces", "folders", "accounts", "today", "setup", "choice", "last", "migratedAt"] as const;
export type BrowserState = Partial<Record<(typeof FIELDS)[number], unknown>>;
const MAX = 4 * 1024 * 1024;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** A PUT body as state: known fields of the right kind only; null when it is not a state at all. */
export function cleanState(raw: unknown): BrowserState | null {
  if (!isObj(raw)) return null;
  const out: BrowserState = {};
  if (Array.isArray(raw.folders)) out.folders = cleanBrowserFolders(raw.folders);
  if (Array.isArray(raw.spaces)) out.spaces = raw.spaces;
  if (Array.isArray(raw.accounts)) out.accounts = raw.accounts;
  if (isObj(raw.today)) out.today = raw.today;
  if (isObj(raw.setup)) out.setup = raw.setup;
  if (isObj(raw.choice)) out.choice = Object.fromEntries(Object.entries(raw.choice).filter(([, v]) => typeof v === "string"));
  if (typeof raw.last === "string") out.last = raw.last;
  if (typeof raw.migratedAt === "number") out.migratedAt = raw.migratedAt;
  return out;
}

export function readBrowserState(file: string): BrowserState {
  let text: string;
  try { text = readFileSync(file, "utf8"); }
  catch (e: any) {
    if (e?.code === "ENOENT") return {};
    throw e;
  }
  const state = cleanState(JSON.parse(text));
  if (!state) throw new Error("browser state object");
  const migrated = migratePins(state);
  if (JSON.stringify(migrated) !== JSON.stringify(state)) {
    backupPins(file, text);
    writeBrowserState(file, migrated);
  }
  return migrated;
}

/** Legacy pins have no authorship. Keep every link quietly until deliberately chosen here. */
function migratePins(state: BrowserState): BrowserState {
  if (!Array.isArray(state.spaces)) return state;
  return { ...state, spaces: state.spaces.map((space) => {
    if (!isObj(space) || space.pinVersion === 2 || !Array.isArray(space.pins)) return space;
    const imported = Array.isArray(space.imported) ? [...space.imported] : [];
    const pins = space.pins.filter((pin) => {
      if (isObj(pin) && (pin.origin === "user" || pin.mine === true)) return true;
      imported.push(pin);
      return false;
    });
    return { ...space, pins, imported, pinVersion: 2 };
  }) };
}
function backupPins(file: string, text: string) {
  try { writeFileSync(`${file}.bak-browser-v2`, text, { flag: "wx", mode: 0o600 }); }
  catch (e: any) { if (e?.code !== "EEXIST") throw e; }
}

/** Atomic and private: a temp file at 0600, then a rename. Refuses a state over 4 MB. */
export function writeBrowserState(file: string, state: BrowserState) {
  const migrated = migratePins(state);
  const text = JSON.stringify(migrated);
  if (text.length > MAX) throw new Error("browser state too large");
  if (text !== JSON.stringify(state)) {
    try { backupPins(file, readFileSync(file, "utf8")); }
    catch (e: any) { if (e?.code !== "ENOENT") throw e; }
  }
  mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, text, { mode: 0o600 });
  renameSync(temp, file);
}

/** Merge only explicitly supplied top-level fields into the latest state immediately before writing.
 * Same-field concurrent PATCHes are last-writer-wins; nested arrays are intentionally not merged. */
export function mergeBrowserState(file: string, raw: unknown) {
  const patch = cleanState(raw);
  if (!patch) throw new Error("a browser state object");
  writeBrowserState(file, { ...readBrowserState(file), ...patch });
}

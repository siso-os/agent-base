/**
 * One JSON state file the node keeps in memory (rows.json, registry.json), made safe against the ways it lost data:
 *
 * - Another writer. The node used to rewrite the whole file from memory, so a second process (a lab node pointed at
 *   the live file, a check, an agent's seed script) had its changes overwritten by the next save. `fresh()` re-reads
 *   the file whenever it changed on disk since this node last read or wrote it; callers run it before every change.
 * - A file that does not parse. It used to mean "start empty", and the next save wiped everything. Now the bad file is
 *   moved aside (`<file>.bad-<ms>`) and kept; the node starts empty and says so on stderr.
 * - A mistake nobody noticed for a day. The first save of each day copies the file to `backups/<name>-YYYY-MM-DD.json`
 *   beside it (the last 14 kept), so a wipe can be undone.
 */
import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

export type Store<T extends object> = { data: T; fresh(): boolean; save(): void };

export function jsonStore<T extends object>(file: string, parse: (raw: any) => T): Store<T> {
  let seen = "";
  const stamp = () => {
    try {
      const st = statSync(file);
      return `${st.dev}:${st.ino}:${st.ctimeMs}:${st.mtimeMs}:${st.size}`;
    } catch (e: any) {
      if (e?.code === "ENOENT") return "";
      throw e;
    }
  };
  const load = (): T => {
    const nextSeen = stamp();
    let text: string;
    try { text = readFileSync(file, "utf8"); }
    catch (e: any) {
      if (e?.code !== "ENOENT") throw e;
      seen = "";
      return parse({});
    }
    let next: T;
    try { next = parse(JSON.parse(text)); }
    catch (e) {
      const currentSeen = stamp();
      if (currentSeen !== nextSeen) throw new Error(`state: ${file} changed while preserving corrupt bytes; refusing quarantine`);
      const aside = `${file}.bad-${Date.now()}-${randomUUID()}`;
      renameSync(file, aside);
      console.error(`state: ${file} did not parse (${String(e).slice(0, 120)}); kept as ${aside}, starting empty`);
      seen = "";
      return parse({});
    }
    seen = nextSeen;
    return next;
  };
  const store: Store<T> = {
    data: load(),
    /** Re-reads the file if someone else changed it. Returns true when it did. Keeps the same object, so references hold. */
    fresh() {
      if (stamp() === seen) return false;
      const next = load();
      for (const k of Object.keys(store.data)) delete (store.data as any)[k];
      Object.assign(store.data, next);
      return true;
    },
    save() {
      mkdirSync(path.dirname(file), { recursive: true });
      backupDaily(file);
      const temp = `${file}.${process.pid}.tmp`;
      writeFileSync(temp, JSON.stringify(store.data, null, 1));
      renameSync(temp, file);
      seen = stamp();
    },
  };
  return store;
}

function backupDaily(file: string) {
  if (!existsSync(file)) return;
  const dir = path.join(path.dirname(file), "backups");
  const base = path.basename(file, ".json");
  const today = path.join(dir, `${base}-${new Date().toISOString().slice(0, 10)}.json`);
  if (existsSync(today)) return;
  try {
    mkdirSync(dir, { recursive: true });
    copyFileSync(file, today);
    const old = readdirSync(dir).filter((f) => f.startsWith(`${base}-`) && f.endsWith(".json")).sort();
    for (const f of old.slice(0, Math.max(0, old.length - 14))) rmSync(path.join(dir, f));
  } catch {
    /* a backup is a convenience; never block a save on it */
  }
}

import { type DownloadNote, nativeBrowserAvailable, onDownload } from "./webview.ts";

/** The sidebar's downloads (A0 browser-UX spec §6): the last 10 this session, by file name and agent only (never a URL).
 * Tauri reports only Requested and Finished, so a running row has no percentage. */
export type DownloadRow = { id: number; name: string; agent: string | null; state: "running" | "done" | "failed"; at: number };
export const KEEP = 10;
let seq = 0;
/** A start adds a running row on top; a finish settles the newest running row of that name (and agent), else adds one. */
export function noteDownload(rows: DownloadRow[], note: DownloadNote, at = Date.now()): DownloadRow[] {
  if (note.phase === "started") return [{ id: ++seq, name: note.name, agent: note.agent, state: "running" as const, at }, ...rows].slice(0, KEEP);
  const i = rows.findIndex((r) => r.state === "running" && r.name === note.name && r.agent === note.agent);
  const row: DownloadRow = { ...(i >= 0 ? rows[i] : { id: ++seq, name: note.name, agent: note.agent }), state: note.ok ? "done" : "failed", at };
  return [row, ...rows.filter((_, j) => j !== i)].slice(0, KEEP);
}

// One list for the app, heard from the first browser mount on (a download that finishes while the browser tab is closed
// still lands in it), for useSyncExternalStore.
let rows: DownloadRow[] = [];
const listeners = new Set<() => void>();
let listening = false;
export const downloadsNow = () => rows;
export function subscribeDownloads(cb: () => void): () => void {
  listeners.add(cb);
  if (!listening && nativeBrowserAvailable()) {
    listening = true;
    onDownload((note) => { rows = noteDownload(rows, note); for (const f of listeners) f(); });
  }
  return () => { listeners.delete(cb); };
}

/** A file size as the download toast says it: "820 B", "14 KB", "3.4 MB", "1.2 GB". */
export function fileSize(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  const [n, unit] = bytes < 1e6 ? [bytes / 1e3, "KB"] : bytes < 1e9 ? [bytes / 1e6, "MB"] : [bytes / 1e9, "GB"];
  return `${n < 10 ? n.toFixed(1).replace(/\.0$/, "") : Math.round(n)} ${unit}`;
}

import { lstatSync } from "node:fs";
import path from "node:path";

/** A finished download's file, from what the app heard (a file name and an agent, never a path): in ~/Downloads, or an
 * agent's in ~/Downloads/Agents/<AGENT>/ (browser.rs download_dir), and a plain file there. Anything else is null. */
export function downloadFile(home: string, name: unknown, agent: unknown): string | null {
  if (typeof name !== "string" || !name || name.length > 255 || name === "." || name === ".." || /[/\0]/.test(name)) return null;
  if (agent !== null && agent !== undefined && (typeof agent !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(agent))) return null;
  const file = path.join(home, "Downloads", ...(typeof agent === "string" && agent ? ["Agents", agent] : []), name);
  try { return lstatSync(file).isFile() ? file : null; } catch { return null; }
}

/** What the download toast's "Open" may hand to macOS (arc-edges §5.5): documents, pictures, sound, video and zip files.
 * Anything that could run (an app, a script, an installer, a disk image, a web page) is only ever shown in Finder. */
const OPENABLE = new Set("pdf txt md csv tsv json rtf doc docx xls xlsx ppt pptx pages numbers key odt ods odp png jpg jpeg gif webp heic tif tiff bmp mp3 m4a wav aac flac ogg mp4 mov m4v webm zip".split(" "));
export function canOpen(name: string): boolean {
  const ext = path.extname(name).slice(1).toLowerCase();
  return OPENABLE.has(ext);
}

/** The toast's line: the file's size and whether Open is offered. Null when the file is not a download (downloadFile). */
export function downloadInfo(home: string, name: unknown, agent: unknown): { size: number; canOpen: boolean } | null {
  const file = downloadFile(home, name, agent);
  return file ? { size: lstatSync(file).size, canOpen: canOpen(file) } : null;
}

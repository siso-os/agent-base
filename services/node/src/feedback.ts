import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { homedir } from "node:os";
import path from "node:path";

// The hub's nine components (ui-hub/components.json), inline: the live checkout does not carry ui-hub, so reading it at load would fail.
const names = new Map<string, string>([["input-bar", "Input bar"], ["chat-header", "Chat header"], ["side-nav", "Side nav"], ["agent-zero-board", "Agent Zero's board"], ["right-panel", "Right panel"], ["chat", "Chat"], ["top-strip", "Top strip"], ["browser", "Browser"], ["space", "The space"]]);
const ids = new Set(names.keys());
const MAX = 2 * 1024 * 1024;
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CLI = path.join(homedir(), "SISO_Workspace/SISO_Agents/agent-zero/siso-agent-zero/bin/a0-task");
class Invalid extends Error { status: number; constructor(message: string, status = 400) { super(message); this.status = status; } }
type Note = { comp: string; part: string; words: string; png?: Buffer; url: string; viewport: { width: number; height: number } };

function validate(body: unknown): Note {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Invalid("Invalid feedback");
  const b = body as Record<string, unknown>;
  if (typeof b.comp !== "string" || !ids.has(b.comp)) throw new Invalid("Unknown component");
  if (typeof b.part !== "string" || !b.part.trim() || b.part.length > 200 || /[\x00-\x1f]/.test(b.part)) throw new Invalid("Invalid part");
  if (typeof b.words !== "string" || !b.words.trim() || b.words.length > 8000 || /\x00/.test(b.words)) throw new Invalid("Use a note of 1–8000 characters");
  if (typeof b.url !== "string" || b.url.length > 2048) throw new Invalid("Invalid URL");
  const v = b.viewport as Record<string, unknown> | undefined;
  if (!v || ![v.width, v.height].every(n => typeof n === "number" && Number.isFinite(n) && n > 0 && n <= 32768)) throw new Invalid("Invalid viewport");
  let png: Buffer | undefined;
  if (b.png !== undefined) {
    if (typeof b.png !== "string" || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(b.png)) throw new Invalid("Use a PNG data URL");
    const data = b.png.slice("data:image/png;base64,".length);
    png = Buffer.from(data, "base64");
    if (png.length > MAX) throw new Invalid("PNG exceeds 2MB", 413);
    if (png.toString("base64") !== data || png.length < 33 || !png.subarray(0, 8).equals(PNG) || png.toString("ascii", 12, 16) !== "IHDR" || !png.readUInt32BE(16) || !png.readUInt32BE(20)) throw new Invalid("Invalid PNG");
  }
  return { comp: b.comp, part: b.part.trim(), words: b.words.trim(), png, url: b.url, viewport: v as Note["viewport"] };
}

const md = (s: string) => s.replace(/\r?\n/g, " ").replace(/([\\`*_[\]<>])/g, "\\$1");
export function insertFeedback(current: string, line: string, date: Date) {
  const day = `${date.getDate()} ${date.toLocaleString("en-GB", { month: "short" })} ${date.getFullYear()}`;
  const heading = `## ${day}`;
  const match = new RegExp(`^${heading}\\s*$`, "m").exec(current);
  if (match) {
    const end = match.index + match[0].trimEnd().length;
    return `${current.slice(0, end)}\n${line}\n${current.slice(end).replace(/^\n+/, "")}`.trimEnd() + "\n";
  }
  const first = /^## /m.exec(current)?.index ?? current.trimEnd().length;
  return `${current.slice(0, first).trimEnd()}\n\n${heading}\n${line}\n\n${current.slice(first).trimStart()}`.trim() + "\n";
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []; let size = 0, oversized = false;
    req.on("data", chunk => {
      if (oversized) return;
      size += Buffer.byteLength(chunk);
      if (size > MAX) { oversized = true; reject(new Invalid("Feedback body too large", 413)); return; }
      chunks.push(Buffer.from(chunk));
    });
    req.on("error", reject);
    req.on("end", () => {
      if (oversized) return;
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch { reject(new Invalid("Invalid JSON")); }
    });
  });
}

function task(cli: string, args: string[]) {
  return new Promise<string>((resolve, reject) => execFile(cli, args, { timeout: 15_000, shell: false }, (error, stdout) => {
    if (error) return reject(new Error("Could not create the feedback task"));
    const id = stdout.trim();
    if (!/^t-\d{4,}$/.test(id)) return reject(new Error("The task command returned no task id"));
    resolve(id);
  }));
}

/** Serialize the complete save per component; no stale pre-read can replace another remark. */
// His remarks and crops live in state, mirroring ui-hub/<comp>/ (not the live checkout's ui-hub: that would leave it dirty,
// and a crop of his screen can hold private chats, which never go in git). The owner folds the words into ui-hub.
export function createFeedbackHandler(root = process.env.AB_FEEDBACK_ROOT ?? path.join(homedir(), ".local/state/agent-base/feedback"), cli = process.env.AB_A0_TASK_CMD ?? CLI, now = () => new Date()) {
  const writes = new Map<string, Promise<unknown>>();
  let tasks: Promise<unknown> = Promise.resolve();
  const save = async (n: Note) => {
    await mkdir(path.join(root, n.comp), { recursive: true });
    const base = await realpath(root), folder = path.join(base, n.comp);
    if (await realpath(folder) !== folder) throw new Invalid("Component folder is not contained in the hub");
    const feedbackFile = path.join(folder, "FEEDBACK.md");
    let current = `# ${names.get(n.comp)} · feedback\n\nHis words, newest first.\n`;
    try {
      if (!(await lstat(feedbackFile)).isFile()) throw new Invalid("Invalid feedback file");
      current = await readFile(feedbackFile, "utf8");
    } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
    const date = now(), day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    const time = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
    const slug = n.part.replace(/[^a-z0-9-]/gi, "-").slice(0, 80) || "part";
    const file = n.png ? `shots/feedback/${day}-${time.replace(":", "")}-${slug}-${randomUUID().slice(0, 8)}.png` : null;
    if (file) {
      // Check each existing path before creating the next, including symbolic links.
      for (const segment of ["shots", "shots/feedback"]) {
        const dir = path.join(folder, segment);
        await mkdir(dir).catch(e => { if (e.code !== "EEXIST") throw e; });
        if (await realpath(dir) !== dir) throw new Invalid("Crop folder is not contained in the component");
      }
      await writeFile(path.join(folder, file), n.png!, { flag: "wx" });
    }
    // CLI has no links.shot or add-note argument; keep the crop in the title's explicit note.
    const title = `${names.get(n.comp)} › ${n.part}: ${n.words.slice(0, 80)}${file ? ` · crop: ${path.join(folder, file)}` : ""}`;
    const nextTask = tasks.catch(() => {}).then(() => task(cli, ["add", `--his=${n.words}`, "--owner", "AGENT-BASE", "--stage", "thought", "--project=agent-base", "--", title]));
    tasks = nextTask;
    const id = await nextTask;
    const part = n.part.replace(/`/g, "\\`");
    const line = `- ~${time} · "${md(n.words)}" · part \`${part}\`${file ? ` · [crop](${file})` : ""} · ${id}`;
    const pendingFile = `${feedbackFile}.${randomUUID()}.tmp`;
    await writeFile(pendingFile, insertFeedback(current, line, date), { flag: "wx" });
    await rename(pendingFile, feedbackFile);
    return { ok: true, task: id, file: `ui-hub/${n.comp}/FEEDBACK.md` };
  };
  return async (req: IncomingMessage, res: ServerResponse) => {
    let status = 200, body: unknown;
    try {
      const note = validate(await readBody(req));
      const pending = (writes.get(note.comp) ?? Promise.resolve()).catch(() => {}).then(() => save(note));
      writes.set(note.comp, pending);
      try { body = await pending; } finally { if (writes.get(note.comp) === pending) writes.delete(note.comp); }
    } catch (e) { status = e instanceof Invalid ? e.status : 500; body = { ok: false, error: e instanceof Invalid ? e.message : "Feedback could not be saved; keep the note and retry" }; }
    res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(body));
  };
}

let handler: ReturnType<typeof createFeedbackHandler> | undefined;
export function feedback(req: IncomingMessage, res: ServerResponse) { return (handler ??= createFeedbackHandler())(req, res); }

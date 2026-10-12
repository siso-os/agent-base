import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { uploadPath } from "../../host/src/uploads.ts";

/**
 * Images for a chat that runs on another machine (ab-remote). Shaan, 12 Oct: "images can't get sent to yourself, I think it's
 * because you're on the Mac Mini. So I want to keep you on the Mac Mini but make it so from chat I can actually send images".
 * The composer uploads to this machine's uploads folder and the prompt names those paths; the remote siso-host only reads
 * images inside its own uploads folder, so they never arrived. Before such a prompt goes up the tunnel, each image is copied
 * to the remote's uploads folder over the same ssh alias (`mkdir -p … && cat > …`, as ab-remote copies a brief) and the
 * prompt names the remote copies. A copy that fails leaves the prompt as it was: the host then reports the image as missing.
 */
const SSH = process.env.AB_REMOTE_SSH ?? "ssh";
const SSH_OPTS = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10"];
const REMOTE_DIR = ".local/state/agent-base/uploads";
const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

type Run = (args: string[], input?: Buffer) => Promise<string>;
const sshRun: Run = (args, input) => new Promise((resolve, reject) => {
  const child = execFile(SSH, [...SSH_OPTS, ...args], { encoding: "utf8", timeout: 60_000, maxBuffer: 1 << 20 }, (error, stdout) => (error ? reject(error) : resolve(stdout)));
  child.stdin?.end(input);
});

export function remoteImageCopier(ssh: string, uploads: string, run: Run = sshRun) {
  let home: Promise<string> | null = null;
  const remoteHome = () => (home ??= run([ssh, `mkdir -p "$HOME/${REMOTE_DIR}" && printf %s "$HOME"`]).then((h) => {
    if (!h.startsWith("/")) throw new Error("no remote home");
    return h;
  }).catch((e) => { home = null; throw e; }));
  /** The client's frame as it should go up: a prompt with images names the remote copies. */
  return async (text: string): Promise<string> => {
    if (!text.startsWith("{") || !text.includes('"images"')) return text;
    let m: Record<string, unknown>;
    try { m = JSON.parse(text); } catch { return text; }
    if (m.t !== "prompt" || !Array.isArray(m.images) || !m.images.length) return text;
    try {
      const dir = path.posix.join(await remoteHome(), REMOTE_DIR);
      const images: string[] = [];
      for (const p of m.images) {
        const local = uploadPath(uploads, p);
        if (!local) return text;
        const remote = path.posix.join(dir, path.basename(local));
        await run([ssh, `cat > ${q(remote)}`], await readFile(local));
        images.push(remote);
      }
      return JSON.stringify({ ...m, images });
    } catch {
      return text;
    }
  };
}

import { execFile } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

/**
 * t-0259 (Shaan 16:06: "the transcripts of like everything i've said to agent zero in that chat as a scrollable there"):
 * his words to Agent Zero, a day at a time, read only through A0's own CLI (`a0-transcript day YYYY-MM-DD`), which keeps
 * the private, already-redacted archive. Each line links the distilled intent/ file it became, by name only: the browser
 * never sees a path. Tests point AB_A0_TRANSCRIPT_CMD at a copy of the CLI beside a fake archive.
 */
const DEFAULT_CMD = path.join(homedir(), "SISO_Workspace/SISO_Agents/agent-zero/siso-agent-zero/bin/a0-transcript");
const DEFAULT_INTENT = path.join(homedir(), "SISO_Workspace/SISO_Agency/apps/siso-internal-labs/siso-internal-labs-agents/intent");
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const SLUG = /^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/;
/** How far back one request looks for a day he spoke on. */
const LOOKBACK = 21;

export type TranscriptLine = { id: string; at: string; source: string; text: string; intent: string | null };
export type TranscriptDay = { day: string | null; rows: TranscriptLine[]; intents: { name: string; when: string | null; title: string }[] };
type Intent = { name: string; when: string | null; title: string; body: string; flat: string; cites: string[] };

/**
 * A line that still carries a secret after the archive's redaction is dropped whole, never shown: the CLI redacts at
 * build, this is the second lock (he has typed passwords to A0).
 */
const SECRET = /(?<![A-Za-z0-9])(?:sk-[A-Za-z0-9_-]{12,}|ghp_[A-Za-z0-9]{12,}|xai-[A-Za-z0-9_-]{12,}|AKIA[A-Z0-9]{12,}|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)|\b(?:password|passcode|pw|pass)\b\s*(?::|=|\bis\b)\s*(?!\[REDACTED)[^\s\[]*\d/i;
export const holdsSecret = (text: string) => SECRET.test(text);

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const dayOf = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(d);
const prevDay = (day: string) => dayOf(new Date(Date.parse(`${day}T12:00:00+07:00`) - 86_400_000));

function readIntents(dir: string, names: string[]): Intent[] {
  return names.map((file) => {
    let text = "";
    try {
      text = readFileSync(path.join(dir, file), "utf8");
    } catch {}
    const front = /^---\n([\s\S]*?)\n---\n?/.exec(text);
    const when = front ? /^when:\s*(\S+)/m.exec(front[1])?.[1] ?? null : null;
    const body = front ? text.slice(front[0].length) : text;
    const name = file.slice(0, -3);
    return { name, when, title: name.replace(/^\d{8}-\d{4}-/, "").replace(/-/g, " "), body, flat: norm(body), cites: [...body.matchAll(/\[(\d{4}-\d{2}-\d{2}-\d{3,})\]/g)].map((m) => m[1]) };
  });
}

/** The intent file a line became: one that cites its id, else one quoting its opening words, else one written within 3 minutes. */
export function intentFor(line: { id: string; at: string; text: string }, intents: Intent[]): string | null {
  const cited = intents.find((i) => i.cites.includes(line.id));
  if (cited) return cited.name;
  const head = norm(line.text).slice(0, 48);
  if (head.length >= 12) {
    const quoted = intents.find((i) => i.flat.includes(head));
    if (quoted) return quoted.name;
  }
  const at = Date.parse(line.at);
  let best: Intent | null = null;
  for (const i of intents) {
    const d = i.when ? Math.abs(Date.parse(i.when) - at) : Infinity;
    if (d <= 3 * 60_000 && (!best || d < Math.abs(Date.parse(best.when!) - at))) best = i;
  }
  return best?.name ?? null;
}

export function createA0Transcript(cmd = process.env.AB_A0_TRANSCRIPT_CMD ?? DEFAULT_CMD, intentDir = process.env.AB_INTENT_DIR ?? DEFAULT_INTENT) {
  const days = new Map<string, { at: number; rows: Omit<TranscriptLine, "intent">[] }>();
  let intents: { stamp: string; list: Intent[] } = { stamp: "", list: [] };
  const intentList = () => {
    let names: string[] = [], stamp = "[]";
    try {
      names = readdirSync(intentDir).filter((n) => n.endsWith(".md") && SLUG.test(n.slice(0, -3)) && /^\d{8}-\d{4}/.test(n)).sort();
      stamp = JSON.stringify(names.map((name) => {
        try {
          const st = statSync(path.join(intentDir, name));
          return [name, st.ino, st.mtimeMs, st.size];
        } catch { return [name, null]; }
      }));
    } catch {}
    if (stamp !== intents.stamp) intents = { stamp, list: readIntents(intentDir, names) };
    return intents.list;
  };
  const readDay = (day: string) =>
    new Promise<Omit<TranscriptLine, "intent">[]>((resolve) => {
      const hit = days.get(day);
      // Today's file grows while he talks; an earlier day changes only on a rebuild.
      if (hit && Date.now() - hit.at < (day === dayOf(new Date()) ? 20_000 : 600_000)) return resolve(hit.rows);
      execFile(cmd, ["day", day], { encoding: "utf8", timeout: 10_000, maxBuffer: 32 << 20 }, (err, out) => {
        const rows: Omit<TranscriptLine, "intent">[] = [];
        if (!err)
          for (const line of out.split("\n")) {
            if (!line.trim()) continue;
            try {
              const r = JSON.parse(line);
              const text = String(r.text ?? "");
              if (typeof r.id === "string" && typeof r.at === "string" && text.trim() && !holdsSecret(text)) rows.push({ id: r.id, at: r.at, source: String(r.source ?? "chat"), text });
            } catch {}
          }
        days.set(day, { at: Date.now(), rows });
        resolve(rows);
      });
    });

  /** The newest day he spoke on, strictly before `before` (default: up to today), with its lines oldest first. */
  async function page(before?: string | null): Promise<TranscriptDay> {
    let day = before && DAY.test(before) ? prevDay(before) : dayOf(new Date());
    for (let i = 0; i < LOOKBACK; i++, day = prevDay(day)) {
      const rows = await readDay(day);
      if (!rows.length) continue;
      const list = intentList();
      const mine = list.filter((x) => x.name.startsWith(day.replace(/-/g, "")));
      return {
        day,
        rows: rows.map((r) => ({ ...r, intent: intentFor(r, list) })),
        intents: mine.sort((a, b) => b.name.localeCompare(a.name)).map(({ name, when, title }) => ({ name, when, title })),
      };
    }
    return { day: null, rows: [], intents: [] };
  }

  /** One distilled intent file, by name. */
  function intent(name: string): { name: string; when: string | null; title: string; text: string } | null {
    if (!SLUG.test(name)) return null;
    const hit = intentList().find((x) => x.name === name);
    return hit ? { name: hit.name, when: hit.when, title: hit.title, text: hit.body.trim() } : null;
  }

  return { page, intent };
}

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { Route } from "./registry.ts";

/**
 * People hub's "latest pulls" (modules/people-graph): what the people-watch tracker last pulled for each watched person
 * (X posts, YouTube transcripts, blog posts), newest first, plus counts per feed. The tracker lives on the Mac mini
 * (_data/people-watch: people.json, index.sqlite, state.json), so this reads it there over ssh, or here when the folder
 * is on this machine. Read only. One read is kept for 5 minutes; a failed read keeps the last good one and says so.
 * Shaan, 15 Oct: "tracker and graph we should connect them". Owner: PEOPLE-GRAPH.
 */
const DIR = "SISO_Workspace/_data/people-watch";
const HOST = process.env.AB_PEOPLE_WATCH_HOST ?? "mini-fast";
const TTL = 5 * 60_000;

/** Runs on whichever machine has the tracker; prints one JSON object. */
export const SCRIPT = `
import json, os, sqlite3
d = os.path.expanduser("~/${DIR}")
db = sqlite3.connect(f"file:{d}/index.sqlite?mode=ro", uri=True)
cols = ("person", "source", "date", "url", "title", "text")
# a video is one row per timestamp (youtu.be/<id>?t=N): one item per video id, the first row, which is its whole page
key = ("case when url like '%youtu.be/%' then substr(url, instr(url, 'youtu.be/') + 9, 11)"
       " when url like '%watch?v=%' then substr(url, instr(url, 'v=') + 2, 11) else url end")
items = [dict(zip(cols, r)) for r in db.execute(
    "select person, source, date, url, title, substr(text, 1, 280) from chunk"
    f" where rowid in (select min(rowid) from chunk group by {key}) order by date desc, rowid desc limit 120")]
counts = [dict(zip(("person", "source", "n"), r)) for r in db.execute(
    f"select person, source, count(distinct {key}) from chunk group by 1, 2")]
people = {k: {"name": v.get("name", k), "feeds": v.get("feeds", {})} for k, v in json.load(open(f"{d}/people.json")).items()}
print(json.dumps({"people": people, "counts": counts, "items": items,
                  "polled": int(os.path.getmtime(f"{d}/state.json") * 1000)}))
`;

export type Run = () => Promise<string>;
const run: Run = () => new Promise((resolve, reject) => {
  const local = existsSync(path.join(homedir(), DIR, "index.sqlite"));
  const child = local
    ? execFile("python3", ["-"], { timeout: 20_000, maxBuffer: 8 << 20 }, (e, out) => (e ? reject(e) : resolve(out)))
    : execFile("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=8", HOST, "python3", "-"], { timeout: 25_000, maxBuffer: 8 << 20 },
      (e, out) => (e ? reject(e) : resolve(out)));
  child.stdin?.end(SCRIPT);
});

export function peopleWatchRoute(read: Run = run, now = () => Date.now()): Route {
  let last: { at: number; body: Record<string, unknown> } | null = null;
  let inflight: Promise<void> | null = null;
  const refresh = () => (inflight ??= read()
    .then((out) => { last = { at: now(), body: { ...JSON.parse(out), stale: false } }; })
    .catch((e: Error) => {
      const why = /timed out|ETIMEDOUT|Connection timed out|killed/i.test(String(e?.message)) ? "the Mac mini did not answer" : "the tracker could not be read";
      if (last) last = { at: last.at, body: { ...last.body, stale: true, error: why } };
      else throw new Error(why);
    })
    .finally(() => { inflight = null; }));
  return {
    method: "GET", path: /^\/api\/people-watch\/?$/,
    async handle(_req, res, _m, url) {
      try {
        if (!last || now() - last.at > TTL || url?.searchParams.has("fresh")) await refresh();
        res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        res.end(JSON.stringify({ ...last!.body, read: last!.at }));
      } catch (e) {
        res.writeHead(502, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        res.end(JSON.stringify({ error: (e as Error).message }));
      }
    },
  };
}
export const route = peopleWatchRoute();

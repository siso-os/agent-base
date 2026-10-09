import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

export type VersionInfo = { web: string; assets: string[]; node: string; desktop: string; sha: string };

function filesUnder(root: string, dir: string, accept: (relative: string) => boolean): string[] {
  let entries;
  try { entries = readdirSync(path.join(root, dir), { withFileTypes: true }); } catch { return []; }
  return entries.flatMap((entry) => {
    const relative = path.posix.join(dir, entry.name);
    const absolute = path.join(root, relative);
    if (entry.isDirectory()) return filesUnder(root, relative, accept);
    return entry.isFile() && accept(relative) ? [relative] : [];
  }).sort();
}

function digestFiles(root: string, files: string[]): string {
  const hash = createHash("sha256");
  for (const file of files.sort()) {
    hash.update(file).update("\0").update(readFileSync(path.join(root, file))).update("\0");
  }
  return hash.digest("hex");
}

// A deploy that copies a build in without moving the checkout's HEAD writes the commit it deployed here.
const DEPLOYED = "apps/web/dist/DEPLOYED_SHA";

export function gitSha(root: string): string {
  try { const deployed = readFileSync(path.join(root, DEPLOYED), "utf8").trim(); if (/^[0-9a-f]{7,40}$/.test(deployed)) return deployed; } catch { /* no deploy stamp */ }
  try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || "unknown"; }
  catch { return "unknown"; }
}

export function changesSince(root: string, since: string): string[] {
  if (!since || since === "unknown") return [];
  try {
    return execFileSync("git", ["log", "--format=%s", `--max-count=20`, `${since}..${gitSha(root)}`], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
      .split(/\r?\n/).filter(Boolean).slice(0, 20);
  } catch { return []; }
}

/**
 * The Shipped card's changes (SPEC-DELIGHT §1): each commit's subject and the part of the app it touched, from an
 * `Area: composer` trailer (a test id such as halo-rim, hud, fanout-row, zero-face, zero-dock); null when it has none.
 */
export type Change = { subject: string; area: string | null };
export function changesWithAreas(root: string, since: string): Change[] {
  if (!since || since === "unknown") return [];
  try {
    return execFileSync("git", ["log", "--format=%s%x1f%(trailers:key=Area,valueonly,separator=%x2c)%x1e", "--max-count=20", `${since}..${gitSha(root)}`], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
      .split("\x1e").map((r) => r.trim()).filter(Boolean)
      .map((r) => { const [subject, area = ""] = r.split("\x1f"); return { subject: subject.trim(), area: area.split(",")[0]?.trim().toLowerCase() || null }; })
      .filter((c) => c.subject);
  } catch { return []; }
}

export function readVersion(root: string, sha = gitSha(root)): VersionInfo {
  const webRoot = path.join(root, "apps/web/dist");
  const webFiles = filesUnder(root, "apps/web/dist", (file) => file.endsWith("index.html") || /\.(?:js|css|svg|woff2?|png|jpe?g|webp|ico)$/.test(file));
  let assets: string[] = [];
  try {
    const html = readFileSync(path.join(webRoot, "index.html"), "utf8");
    assets = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)].map((match) => match[1]).filter((asset) => asset.startsWith("/"));
  } catch { /* the web build is not present yet */ }
  const nodeFiles = filesUnder(root, "services/node/src", () => true);
  const desktopFiles = [
    ...filesUnder(root, "apps/desktop/src", () => true),
    ...(statSync(path.join(root, "apps/desktop/Cargo.toml"), { throwIfNoEntry: false }) ? ["apps/desktop/Cargo.toml"] : []),
  ];
  return {
    web: digestFiles(root, webFiles),
    assets,
    node: digestFiles(root, nodeFiles),
    desktop: digestFiles(root, desktopFiles),
    sha,
  };
}

export function shouldRestart(bootNodeHash: string, currentNodeHash: string, oldestRequestAgeMs = 0): boolean {
  return !!bootNodeHash && bootNodeHash !== currentNodeHash && oldestRequestAgeMs <= 5_000;
}

export type VersionLine = {
  source: { ref: string; sha: string };
  preview: { ref: string; sha: string };
  live: { ref: string; sha: string };
  layers: { node: string; web: string };
};
export type VersionEvidence = { source?: string; preview?: string; live?: string; runningNode?: string; servedWeb?: string };
const knownSha = (value?: string) => /^[0-9a-f]{7,40}$/.test(value?.trim() ?? '') ? value!.trim() : 'unknown';
/** Each stage requires its own evidence. HEAD and the web stamp cannot prove a live or node revision. */
export function resolveVersionLine(e: VersionEvidence = {}): VersionLine {
  return { source: { ref: 'HEAD', sha: knownSha(e.source) }, preview: { ref: 'refs/preview', sha: knownSha(e.preview) }, live: { ref: 'refs/live', sha: knownSha(e.live) }, layers: { node: knownSha(e.runningNode), web: knownSha(e.servedWeb) } };
}
function commitAtRef(root: string, ref: string): string {
  try { return execFileSync('git', ['rev-parse', '--verify', `${ref}^{commit}`], { cwd: root, encoding: 'utf8', stdio: ['ignore','pipe','ignore'], timeout: 2000 }).trim(); }
  catch { return 'unknown'; }
}
export function readVersionLine(root: string, webDist = process.env.AB_WEB_DIST ?? path.join(import.meta.dirname, '../../../apps/web/dist')): VersionLine {
  let servedWeb = 'unknown';
  try { servedWeb = readFileSync(path.join(webDist, 'DEPLOYED_SHA'), 'utf8'); } catch { /* unstamped build */ }
  return resolveVersionLine({ source: commitAtRef(root, 'HEAD'), preview: commitAtRef(root, 'refs/preview'), live: commitAtRef(root, 'refs/live'), servedWeb });
}

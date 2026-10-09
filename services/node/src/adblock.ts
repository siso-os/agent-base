/**
 * The browser's ad and tracker blocker (browser v3, Shaan 7 Oct: "an ad blocker would be great"). Brave's speed is mostly
 * its blocker; ours uses the same public filter lists (EasyList and EasyPrivacy), turned into WebKit's own content-blocker
 * rules, which the desktop app compiles once (WKContentRuleListStore) and attaches to every page, so an ad or a tracker is
 * never fetched at all.
 *
 * Only network rules anchored on a host (`||ads.example.com^`, with the options WebKit can say) are kept: they are most of
 * both lists and they cannot break a page's own layout. Element hiding and the rest are left out on purpose.
 *
 * The lists are public files; the node fetches them at most once a day into ~/.local/state/agent-base/adblock and serves the
 * converted rules at GET /api/browser/adblock. Nothing about his browsing is sent anywhere.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const LISTS = ["https://easylist.to/easylist/easylist.txt", "https://easylist.to/easylist/easyprivacy.txt"];
const DAY = 24 * 3600e3;
/** WebKit refuses a list over 150,000 rules; leave room. */
const MAX_RULES = 120_000;

type Trigger = { "url-filter": string; "load-type"?: string[]; "resource-type"?: string[]; "if-domain"?: string[]; "unless-domain"?: string[] };
export type Rule = { trigger: Trigger; action: { type: "block" | "ignore-previous-rules" } };

const TYPES: Record<string, string> = { script: "script", image: "image", stylesheet: "style-sheet", font: "font", media: "media", xmlhttprequest: "raw", subdocument: "document", websocket: "raw", ping: "raw", other: "raw" };
const HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
const esc = (host: string) => host.replace(/\./g, "\\.");

/** One filter line as a WebKit rule, or null when it is not a host rule WebKit can say exactly. */
export function convertLine(raw: string): Rule | null {
  const line = raw.trim();
  if (!line || line.startsWith("!") || line.startsWith("[") || line.includes("#")) return null;
  const allow = line.startsWith("@@");
  const body = allow ? line.slice(2) : line;
  const m = /^\|\|([a-z0-9.-]+)\^(\|)?(?:\$(.+))?$/i.exec(body);
  if (!m) return null;
  const host = m[1].toLowerCase();
  // "|" after the separator anchors the end of the address: WebKit cannot say that next to a host pattern.
  if (!HOST.test(host) || m[2]) return null;
  // The scheme, any subdomains, then exactly this host (the form Safari blockers use; WebKit's patterns have no "|").
  const trigger: Trigger = { "url-filter": `^[htpsw]+://([a-z0-9-]+\\.)*${esc(host)}[/:]` };
  if (m[3]) {
    const types: string[] = [], notTypes: string[] = [], ifDomain: string[] = [], unlessDomain: string[] = [];
    for (const opt of m[3].split(",")) {
      const o = opt.trim().toLowerCase();
      if (o === "third-party" || o === "3p") trigger["load-type"] = ["third-party"];
      else if (o === "~third-party" || o === "1p" || o === "first-party") trigger["load-type"] = ["first-party"];
      else if (o.startsWith("domain=")) {
        for (const d of o.slice(7).split("|")) {
          const neg = d.startsWith("~"), name = neg ? d.slice(1) : d;
          if (!HOST.test(name)) return null;
          (neg ? unlessDomain : ifDomain).push(`*${name}`);
        }
      } else if (o.startsWith("~") && TYPES[o.slice(1)]) notTypes.push(TYPES[o.slice(1)]);
      else if (TYPES[o]) types.push(TYPES[o]);
      // Anything else ($popup, $csp, $redirect, $removeparam, $important, $match-case, ...) changes what the rule means.
      else return null;
    }
    // WebKit cannot say "every type but these", nor both an if- and an unless-domain on one rule.
    if (notTypes.length || (ifDomain.length && unlessDomain.length)) return null;
    if (types.length) trigger["resource-type"] = [...new Set(types)];
    if (ifDomain.length) trigger["if-domain"] = ifDomain;
    if (unlessDomain.length) trigger["unless-domain"] = unlessDomain;
  }
  return { trigger, action: { type: allow ? "ignore-previous-rules" : "block" } };
}

/** Every list's host rules, blocks first and exceptions after them (an exception only undoes rules before it). */
export function convert(texts: string[]): Rule[] {
  const blocks: Rule[] = [], allows: Rule[] = [], seen = new Set<string>();
  for (const text of texts) for (const line of text.split(/\r?\n/)) {
    const rule = convertLine(line);
    if (!rule) continue;
    const key = JSON.stringify(rule);
    if (seen.has(key)) continue;
    seen.add(key);
    (rule.action.type === "block" ? blocks : allows).push(rule);
  }
  return [...blocks.slice(0, MAX_RULES - allows.length), ...allows];
}

type Built = { version: string; count: number; rules: string; at: number };
let built: Built | null = null;
let building: Promise<Built | null> | null = null;
const dir = () => process.env.AB_ADBLOCK_DIR ?? join(homedir(), ".local/state/agent-base/adblock");

async function fetchList(url: string, file: string): Promise<string | null> {
  const fresh = existsSync(file) && Date.now() - statSync(file).mtimeMs < DAY;
  if (fresh) return readFileSync(file, "utf8");
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(20_000), headers: { "user-agent": "AgentBase/1 (+easylist)" } });
    if (!r.ok) throw new Error(String(r.status));
    const text = await r.text();
    if (!text.includes("[Adblock")) throw new Error("not a filter list");
    writeFileSync(`${file}.tmp`, text); renameSync(`${file}.tmp`, file);
    return text;
  } catch {
    // Offline or the site is down: the last copy, however old, beats no blocker.
    return existsSync(file) ? readFileSync(file, "utf8") : null;
  }
}

/** The converted rules, built once per day; null until the lists have been fetched at least once. */
export function adblockRules(): Promise<Built | null> {
  if (built && Date.now() - built.at < DAY) return Promise.resolve(built);
  building ??= (async () => {
    try {
      const d = dir();
      mkdirSync(d, { recursive: true });
      const texts = (await Promise.all(LISTS.map((u, i) => fetchList(u, join(d, `list-${i}.txt`))))).filter((t): t is string => t !== null);
      if (!texts.length) return built;
      const rules = JSON.stringify(convert(texts));
      built = { version: createHash("sha256").update(rules).digest("hex").slice(0, 16), count: JSON.parse(rules).length, rules, at: Date.now() };
      return built;
    } finally { building = null; }
  })();
  return building;
}

import { agentBrowsing, agentPages, agentPageTitle, agentPageUrl, closeAgentPage, DEFAULT_ACCOUNT, nativeBrowserAvailable, navigateAgentPage, openAgentPage, pageKey, readAgentPage } from "./webview.ts";

/** The window's half of agents driving the browser (services/node/src/routes/browser-agent.area.ts): long-polls the node for
 * an agent's request, does it on that agent's hidden page, and posts the answer. A page uses the agent's own WebKit store
 * (no sign-ins of his) unless the agent asks `signedIn`, which uses his personal account's. */
type Op = { id: string; op: string; agent: string; tab?: string; url?: string; signedIn?: boolean };
let seq = 0;
const tabName = (agent: string, tab: string) => `agent:${agent}:${tab}`;
/** Each page's key, by the agent's own name for it, so one agent never reaches another's page. */
const keys = new Map<string, string>();

export async function runAgentOp(o: Op): Promise<unknown> {
  const name = (tab: string) => tabName(o.agent, tab);
  const key = (tab?: string) => { const k = tab ? keys.get(name(tab)) : undefined; if (!k) throw new Error(`no page ${tab ?? ""} for ${o.agent}: open one first`); return k; };
  const where = async (k: string) => ({ url: await agentPageUrl(k), title: await agentPageTitle(k) });
  if (o.op === "list") return { pages: agentPages().filter((p) => p.agent === o.agent).map((p) => ({ tab: p.tab.slice(name("").length), url: p.url })) };
  if (o.op === "open") {
    const tab = o.tab ?? `t${Date.now().toString(36)}${(seq++).toString(36)}`;
    const profile = o.signedIn ? DEFAULT_ACCOUNT : `agent-${o.agent}`;
    const k = pageKey(name(tab), profile);
    keys.set(name(tab), k);
    return agentBrowsing(k, async () => { await openAgentPage(k, name(tab), o.url!, profile, o.agent); return { tab, ...(await where(k)) }; });
  }
  const k = key(o.tab);
  if (o.op === "navigate") return agentBrowsing(k, async () => { await navigateAgentPage(k, o.url!); return { tab: o.tab, ...(await where(k)) }; });
  if (o.op === "read") return agentBrowsing(k, async () => {
    await agentPageUrl(k);
    const page = await readAgentPage(k);
    return page ?? { ...(await where(k)), text: null, note: "page text needs the next Agent Base app build; the address and title are here" };
  });
  if (o.op === "close") { keys.delete(name(o.tab!)); await closeAgentPage(k); return { ok: true }; }
  throw new Error("unknown op");
}

let started = false;
/** Started once by the shell, in the desktop app only (a browser tab has no native pages to drive). */
export function startBrowserAgent() {
  if (started || !nativeBrowserAvailable()) return;
  started = true;
  const loop = async () => {
    for (;;) {
      const ops = await fetch("/api/browser/agent/next?wait=20", { cache: "no-store" }).then((r) => (r.ok ? r.json() as Promise<Op[]> : []), () => null);
      if (ops === null) { await new Promise((r) => setTimeout(r, 5000)); continue; }
      for (const o of ops) void runAgentOp(o).then((data) => ({ id: o.id, ok: true, data }), (e: unknown) => ({ id: o.id, ok: false, error: String(e instanceof Error ? e.message : e) }))
        .then((answer) => fetch("/api/browser/agent/result", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(answer) }).catch(() => undefined));
    }
  };
  void loop();
}

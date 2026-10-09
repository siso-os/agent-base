import { useCallback, useEffect, useRef, useState } from "react";
import { every } from "./poll";

export type AppVersion = { web: string; assets?: string[]; node: string; desktop: string; sha: string };
type VersionResponse = AppVersion;
/** A commit's subject and the part of the app it touched (its `Area:` trailer, a test id), from /api/version/changes. */
export type Change = { subject: string; area: string | null };
type ChangesResponse = { subjects: string[]; changes?: Change[]; sha?: string; note?: { title: string } };
type Update = { kind: "web" | "desktop"; subjects: string[]; changes: Change[]; sha?: string; note?: string };
/** What the reload just brought in (SPEC-DELIGHT §1): the Shipped card reads it once, after the page comes back. */
export type Shipped = { sha: string; changes: Change[] };
const SNAPSHOT_KEY = "agent-base:update-reload";

function restoreReloadState(onShipped: (s: Shipped) => void) {
  let raw: string | null = null;
  try { raw = sessionStorage.getItem(SNAPSHOT_KEY); sessionStorage.removeItem(SNAPSHOT_KEY); } catch { /* no session storage */ }
  if (!raw) return;
  try {
    const saved = JSON.parse(raw) as { tabId?: string; scrollTop?: number; shipped?: Shipped };
    if (saved.shipped?.sha) onShipped(saved.shipped);
    requestAnimationFrame(() => {
      // QA #19 (A0, 3 Oct): the tab is found by its id (the tab bar's data-tab), never by its label: two tabs can share one.
      if (saved.tabId) {
        const tab = [...document.querySelectorAll<HTMLElement>('.siso-toptabs [role="tab"]')].find((item) => item.dataset.tab === saved.tabId);
        tab?.click();
      }
      requestAnimationFrame(() => {
        const list = document.querySelector<HTMLElement>("[data-testid='chat-view'] .siso-chat__list");
        if (list && typeof saved.scrollTop === "number") list.scrollTop = saved.scrollTop;
      });
    });
  } catch { /* stale or invalid snapshot */ }
}

function loadedAssetsAreCurrent(assets: string[] = []) {
  if (!assets.length) return true;
  const loaded = [...document.querySelectorAll<HTMLScriptElement | HTMLLinkElement>("script[src], link[rel=stylesheet][href]")]
    .map((element) => element instanceof HTMLScriptElement ? element.src : element.href)
    .filter((url) => new URL(url).origin === location.origin)
    .map((url) => new URL(url).pathname);
  return loaded.every((asset) => assets.includes(asset));
}

function reloadWithState(shipped?: Shipped) {
  const selected = document.querySelector<HTMLElement>('.siso-toptabs [role="tab"][aria-selected="true"]');
  const chatList = document.querySelector<HTMLElement>("[data-testid='chat-view'] .siso-chat__list");
  try { sessionStorage.setItem(SNAPSHOT_KEY, JSON.stringify({ tabId: selected?.dataset.tab, scrollTop: chatList?.scrollTop, shipped })); } catch { /* reload anyway */ }
  location.reload();
}

export function useVersion() {
  const [update, setUpdate] = useState<Update | null>(null);
  const [error, setError] = useState(false);
  const dismissedFailure = useRef(false);
  const [reloadTarget, setReloadTarget] = useState<AppVersion | null>(null);
  const [current, setCurrent] = useState<AppVersion | null>(null);
  const [checked, setChecked] = useState(false);
  const [applying, setApplying] = useState(false);
  const pendingShipped = useRef<Shipped | null>(null);
  const [shipped, setShipped] = useState<Shipped | null>(null);

  useEffect(() => restoreReloadState(value => { pendingShipped.current = value; }), []);
  useEffect(() => {
    let alive = true;
    let baseline: AppVersion | null = null;
    let failedSince: number | null = null;
    let pending = false;
    const succeeded = () => { failedSince = null; dismissedFailure.current = false; setError(false); };
    const poll = async () => {
      if (pending) return;
      pending = true;
      try {
        const response = await fetch("/api/version", { cache: "no-store", signal: AbortSignal.timeout(10_000) });
        if (!response.ok) throw new Error(`version returned ${response.status}`);
        const next = await response.json() as VersionResponse;
        if (!alive) return;
        if (![next.web, next.node, next.desktop, next.sha].every(v => typeof v === "string" && v.length > 0) || (next.assets !== undefined && (!Array.isArray(next.assets) || !next.assets.every(v => typeof v === "string")))) throw new Error("Invalid version response");
        setChecked(true);
        if (!baseline && loadedAssetsAreCurrent(next.assets)) setCurrent(next);
        if (pendingShipped.current?.sha === next.sha && !!next.assets?.length && loadedAssetsAreCurrent(next.assets)) {
          setShipped(pendingShipped.current); pendingShipped.current = null;
        }
        if (!baseline) {
          baseline = next;
          if (!loadedAssetsAreCurrent(next.assets)) {
            const changes = await fetch(`/api/version/changes?since=${encodeURIComponent(next.sha)}`, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
            const { subjects = [], changes: list = [], sha, note } = changes.ok ? await changes.json() as ChangesResponse : {};
            if (alive) { setUpdate({ kind: "web", subjects, changes: list, sha, note: note?.title }); setReloadTarget(next); }
          }
          if (alive) succeeded();
          return;
        }
        if (next.web !== baseline.web || next.sha !== baseline.sha) {
          const changes = await fetch(`/api/version/changes?since=${encodeURIComponent(baseline.sha)}`, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
          const { subjects = [], changes: list = [], sha, note } = changes.ok ? await changes.json() as ChangesResponse : {};
          if (alive) { setUpdate({ kind: "web", subjects, changes: list, sha, note: note?.title }); setReloadTarget(next); }
        } else if (next.desktop !== baseline.desktop) {
          setUpdate({ kind: "desktop", subjects: [], changes: [] }); setReloadTarget(next);
        }
        baseline = next;
        if (alive) succeeded();
      } catch {
        if (alive) {
          failedSince ??= Date.now();
          if (Date.now() - failedSince >= 120_000 && !dismissedFailure.current) setError(true);
        }
      } finally { pending = false; }
    };
    const stop = every(() => void poll(), 30_000);
    window.addEventListener("focus", poll);
    return () => { alive = false; stop(); window.removeEventListener("focus", poll); };
  }, []);

  const reload = useCallback(() => {
    if (!reloadTarget) return;
    const changes = update?.changes.length ? update.changes : (update?.subjects ?? []).map((subject) => ({ subject, area: null }));
    setApplying(true);
    reloadWithState({ sha: update?.sha ?? reloadTarget.sha, changes });
  }, [reloadTarget, update]);
  const dismiss = useCallback(() => {
    setUpdate(null);
    setError(false);
    if (error) dismissedFailure.current = true;
  }, [error]);
  const clearShipped = useCallback(() => setShipped(null), []);
  return { update, error, reload, dismiss, shipped, clearShipped, current, checked, applying, available: reloadTarget };
}

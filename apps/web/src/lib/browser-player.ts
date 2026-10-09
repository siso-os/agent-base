import { type ArcProfile, type BrowserAccount, accountFor, storeOf } from "./webview.ts";

type Page = { url: string; title: string };
export type LivePage = { key: string; tab: string; url: string; mounted: boolean };
/** What the mini player shows (arc-edges §5.6): a page playing sound (or one he paused from it) that is not on screen. */
export type NowPlaying = {
  key: string;
  url: string;
  title: string;
  host: string;
  /** The space it was opened in, when one of his spaces has it (in Today or pinned), else the space using its account. */
  space: { id: string; name: string } | null;
  /** The account whose store the page lives on. */
  account: string | null;
  /** In this app tab (another space or account), so "Go to tab" can bring it back here. */
  here: boolean;
  paused: boolean;
};

const hostOf = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } };

/** The page for the mini player: the first one playing, else the first he paused from the player, never one on screen. The
 * page key is `<tab>#<store>` (webview.ts pageKey), so the store names the account, and the account the space. */
export function nowPlaying(input: {
  pages: LivePage[];
  playing: readonly string[];
  paused: readonly string[];
  tab: string;
  spaces: ArcProfile[];
  today: Record<string, Page[]>;
  accounts: BrowserAccount[];
}): NowPlaying | null {
  const off = input.pages.filter((p) => !p.mounted);
  const page = off.find((p) => input.playing.includes(p.key)) ?? off.find((p) => input.paused.includes(p.key));
  if (!page) return null;
  const store = page.key.slice(page.key.lastIndexOf("#") + 1);
  const account = input.accounts.find((a) => storeOf(a) === store)?.id ?? null;
  const has = (s: ArcProfile) => [...(input.today[s.id] ?? []), ...s.pins].some((t) => t.url === page.url);
  const space = input.spaces.find((s) => has(s) && accountFor(s, input.accounts) === account) ?? input.spaces.find(has) ?? input.spaces.find((s) => account !== null && accountFor(s, input.accounts) === account) ?? null;
  const known = space && [...(input.today[space.id] ?? []), ...space.pins].find((t) => t.url === page.url);
  const host = hostOf(page.url);
  return {
    key: page.key,
    url: page.url,
    title: known?.title || host || page.url,
    host,
    space: space && { id: space.id, name: space.name },
    account,
    here: page.tab === input.tab,
    paused: !input.playing.includes(page.key),
  };
}

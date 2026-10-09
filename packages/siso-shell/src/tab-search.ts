import type { TopTab } from "./TopTabs";

type RealTab = Exclude<TopTab, { kind: "gap" }>;

/**
 * Filter and rank tabs by query. Case-insensitive, matches label, title, and address.
 * Prefix matches rank higher than substring matches; ties keep original order.
 * Empty query returns all tabs in order.
 */
export function matchTabs(tabs: RealTab[], query: string): RealTab[] {
  const lower = query.toLowerCase();
  if (!lower) return tabs;

  const scored = tabs.map((tab) => {
    const label = tab.label.toLowerCase();
    const title = (tab.title || "").toLowerCase();
    // For pages, try to extract address from title or use empty string
    const address = "address" in tab ? (tab.address as string | undefined)?.toLowerCase() : "";

    let score = -1;
    let match = false;

    // Check label first, then title, then address
    for (const text of [label, title, address]) {
      if (!text) continue;
      const idx = text.indexOf(lower);
      if (idx === -1) continue;

      match = true;
      // Prefix match (idx === 0) gets score 1000 + position bonus
      // Substring match gets score 500 + position bonus
      const baseScore = idx === 0 ? 1000 : 500;
      const position = 100 - Math.min(idx, 99); // Prefer earlier matches
      score = Math.max(score, baseScore + position);
      break; // Stop after first matching field
    }

    return { tab, score, match };
  });

  return scored
    .filter((item) => item.match)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      // Preserve original order for equal scores
      return tabs.indexOf(a.tab) - tabs.indexOf(b.tab);
    })
    .map((item) => item.tab);
}

/**
 * People hub's data: the library's graph (/api/people/graph.json, built by people-graph's factory/build_site.py) joined to
 * the tracker's pulls (/api/people-watch). Pure, so the joins are tested without a page.
 */
export type NodeType = "person" | "speaker" | "video" | "account" | "wikidata";
export type GNode = { id: string; label: string; type: NodeType; href?: string };
export type GEdge = { source: string; target: string; kind: string; n?: number };
export type Graph = { nodes: GNode[]; edges: GEdge[] };

export type Pull = { person: string; source: string; date: string; url: string; title: string; text: string };
export type Watch = {
  people: Record<string, { name: string; feeds: Record<string, string> }>;
  counts: { person: string; source: string; n: number }[];
  items: Pull[];
  polled?: number;
  read?: number;
  stale?: boolean;
  error?: string;
};

export type Voice = { id: string; name: string; n: number; href?: string };
export type Work = { id: string; title: string; date: string; href?: string; by: string | null; voices: Voice[]; quotes: number };
export type Person = {
  slug: string;
  name: string;
  href?: string;
  qid: string | null;
  accounts: string[];
  feeds: Record<string, string>;
  pulls: Record<string, number>;
  pulled: number;
  latest: string | null;
  works: Work[];
  quotes: number;
};

const slugOf = (id: string) => id.replace(/^[a-z]:/, "");

export function works(g: Graph | null): Work[] {
  if (!g) return [];
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  return g.nodes
    .filter((n) => n.type === "video")
    .map((v) => {
      const into = g.edges.filter((e) => e.target === v.id);
      const voices = into
        .filter((e) => typeof e.n === "number")
        .map((e) => ({ id: e.source, name: byId.get(e.source)?.label ?? slugOf(e.source), n: e.n!, href: byId.get(e.source)?.href }))
        .sort((a, b) => b.n - a.n);
      const by = into.find((e) => e.kind === "published")?.source ?? null;
      return {
        id: v.id,
        title: v.label,
        date: /^v:(\d{4}-\d{2}-\d{2})/.exec(v.id)?.[1] ?? "",
        href: v.href,
        by: by && slugOf(by),
        voices,
        quotes: voices.reduce((s, x) => s + x.n, 0),
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

/** Everyone the tracker watches, plus anyone the graph knows as a person; the tracker's name wins. */
export function people(g: Graph | null, w: Watch | null): Person[] {
  const all = works(g);
  const slugs = new Set<string>([...Object.keys(w?.people ?? {}), ...(g?.nodes ?? []).filter((n) => n.type === "person").map((n) => slugOf(n.id))]);
  return [...slugs]
    .map((slug) => {
      const node = g?.nodes.find((n) => n.id === `p:${slug}`);
      const out = (g?.edges ?? []).filter((e) => e.source === `p:${slug}`);
      const pulls: Record<string, number> = {};
      for (const c of w?.counts ?? []) if (c.person === slug) pulls[c.source] = c.n;
      const mine = all.filter((x) => x.by === slug);
      return {
        slug,
        name: w?.people[slug]?.name ?? node?.label ?? slug,
        href: node?.href,
        qid: out.map((e) => e.target).find((t) => t.startsWith("q:"))?.slice(2) ?? null,
        accounts: out.filter((e) => e.kind === "graph row").map((e) => slugOf(e.target)),
        feeds: w?.people[slug]?.feeds ?? {},
        pulls,
        pulled: Object.values(pulls).reduce((s, n) => s + n, 0),
        latest: (w?.items ?? []).find((i) => i.person === slug)?.date ?? null,
        works: mine,
        quotes: mine.reduce((s, x) => s + (x.voices.find((v) => v.id === `p:${slug}`)?.n ?? 0), 0),
      };
    })
    .sort((a, b) => (b.latest ?? "").localeCompare(a.latest ?? "") || a.name.localeCompare(b.name));
}

/** What a pull says in one line: a post is its text, a video or a page its title. */
export function pullLine(p: Pull): string {
  const t = p.title?.replace(/\s+@\s+\d+:\d{2}:\d{2}$/, "").trim();
  if (!t || t === "post" || t === "repost" || t === "reply" || t === "quote") return p.text.replace(/\s+/g, " ").trim();
  return t;
}

export const initials = (name: string) => name.split(/[\s-]+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");

/**
 * Fruchterman-Reingold, run to rest once (the graph is tens of nodes): every pair pushes apart (k²/d), every edge pulls
 * (d²/k), gravity holds separate people together, and each step moves at most the cooling temperature.
 */
export function layout(g: Graph, w: number, h: number, ticks = 300): Map<string, { x: number; y: number }> {
  const n = g.nodes.length;
  const pos = g.nodes.map((_, i) => {
    const a = (i / Math.max(1, n)) * Math.PI * 2;
    return { x: w / 2 + Math.cos(a) * w * 0.25, y: h / 2 + Math.sin(a) * h * 0.25 };
  });
  const at = new Map(g.nodes.map((nd, i) => [nd.id, i]));
  const springs = g.edges.map((e) => [at.get(e.source), at.get(e.target)] as const).filter(([a, b]) => a !== undefined && b !== undefined) as [number, number][];
  const k = Math.sqrt(((w - 80) * (h - 48)) / Math.max(1, n)) * 0.6;
  for (let t = 0; t < ticks; t++) {
    const temp = (w / 12) * (1 - t / ticks) + 0.5;
    const d = pos.map(() => ({ x: 0, y: 0 }));
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) {
        const dx = pos[i].x - pos[j].x || 0.1, dy = pos[i].y - pos[j].y || 0.1, dist = Math.max(Math.hypot(dx, dy), 0.1);
        const f = (k * k) / dist;
        d[i].x += (dx / dist) * f; d[i].y += (dy / dist) * f; d[j].x -= (dx / dist) * f; d[j].y -= (dy / dist) * f;
      }
    for (const [a, b] of springs) {
      const dx = pos[a].x - pos[b].x, dy = pos[a].y - pos[b].y, dist = Math.max(Math.hypot(dx, dy), 0.1), f = (dist * dist) / k;
      d[a].x -= (dx / dist) * f; d[a].y -= (dy / dist) * f; d[b].x += (dx / dist) * f; d[b].y += (dy / dist) * f;
    }
    pos.forEach((p, i) => {
      d[i].x += (w / 2 - p.x) * 0.9; d[i].y += (h / 2 - p.y) * 0.9 * (w / h);
      const len = Math.max(Math.hypot(d[i].x, d[i].y), 0.1), step = Math.min(len, temp);
      p.x = Math.max(40, Math.min(w - 40, p.x + (d[i].x / len) * step));
      p.y = Math.max(24, Math.min(h - 24, p.y + (d[i].y / len) * step));
    });
  }
  return new Map(g.nodes.map((nd, i) => [nd.id, { x: pos[i].x, y: pos[i].y }]));
}

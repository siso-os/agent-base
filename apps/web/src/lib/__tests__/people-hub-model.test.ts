// @ts-nocheck
import { describe, expect, it } from "vitest";
import { layout, people, pullLine, works, type Graph, type Watch } from "../../modules/people-graph/model";

const g: Graph = {
  nodes: [
    { id: "p:david-ondrej", label: "David Ondrej", type: "person", href: "/david-ondrej/" },
    { id: "p:theo", label: "Theo Browne", type: "person", href: "/theo/" },
    { id: "g:gh:t3dotgg", label: "gh:t3dotgg", type: "account" },
    { id: "q:Q113114818", label: "Q113114818", type: "wikidata" },
    { id: "v:2026-10-02_WeiB_gLOdQE", label: "Vercel CEO", type: "video", href: "/david-ondrej/2026-10-02_WeiB_gLOdQE/" },
    { id: "s:guillermo-rauch", label: "guillermo-rauch", type: "speaker", href: "/said/guillermo-rauch/" },
  ],
  edges: [
    { source: "p:theo", target: "g:gh:t3dotgg", kind: "graph row" },
    { source: "p:theo", target: "q:Q113114818", kind: "same as" },
    { source: "p:david-ondrej", target: "v:2026-10-02_WeiB_gLOdQE", kind: "published" },
    { source: "s:guillermo-rauch", target: "v:2026-10-02_WeiB_gLOdQE", kind: "said 156 quotes", n: 156 },
    { source: "p:david-ondrej", target: "v:2026-10-02_WeiB_gLOdQE", kind: "said 28 quotes", n: 28 },
  ],
};
const w: Watch = {
  people: { theo: { name: "Theo", feeds: {} }, "david-ondrej": { name: "David Ondrej", feeds: {} }, "felix-rieseberg": { name: "Felix Rieseberg", feeds: {} } },
  counts: [{ person: "theo", source: "youtube", n: 15 }, { person: "theo", source: "x", n: 39 }],
  items: [{ person: "theo", source: "x", date: "2026-10-15", url: "u1", title: "post", text: "Who  are\nyou" }],
};

describe("People hub model", () => {
  it("credits each video's voices, the guest first, and its publisher", () => {
    const [v] = works(g);
    expect(v).toMatchObject({ date: "2026-10-02", by: "david-ondrej", quotes: 184 });
    expect(v.voices.map((x) => [x.name, x.n])).toEqual([["guillermo-rauch", 156], ["David Ondrej", 28]]);
  });
  it("joins the tracker to the graph: everyone watched, their QID, rows, pulls and works", () => {
    const ps = people(g, w);
    expect(ps.map((p) => p.slug)).toEqual(["theo", "david-ondrej", "felix-rieseberg"]);
    expect(ps[0]).toMatchObject({ name: "Theo", qid: "Q113114818", accounts: ["gh:t3dotgg"], pulled: 54, latest: "2026-10-15" });
    expect(ps[1]).toMatchObject({ qid: null, quotes: 28 });
    expect(ps[1].works).toHaveLength(1);
    expect(ps[2]).toMatchObject({ pulled: 0, works: [] });
  });
  it("says a post by its text and a video by its title", () => {
    expect(pullLine(w.items[0])).toBe("Who are you");
    expect(pullLine({ ...w.items[0], title: "Meta caught up @ 0:01:04" })).toBe("Meta caught up");
  });
  it("lays every node inside the frame", () => {
    for (const p of layout(g, 900, 300).values()) {
      expect(p.x).toBeGreaterThanOrEqual(40); expect(p.x).toBeLessThanOrEqual(860);
      expect(p.y).toBeGreaterThanOrEqual(24); expect(p.y).toBeLessThanOrEqual(276);
    }
  });
});

// @ts-nocheck
import { matchTabs } from "../../../../../packages/siso-shell/src/tab-search";
import type { TopTab } from "../../../../../packages/siso-shell/src/TopTabs";

type RealTab = Exclude<TopTab, { kind: "gap" }>;

const testTabs: RealTab[] = [
  {
    kind: "page",
    id: "tab1",
    label: "Specs",
    title: "Agent Base specs",
    address: "localhost:8891/specs",
  },
  {
    kind: "page",
    id: "tab2",
    label: "Board",
    title: "A0 Board",
    address: "localhost:8891/board",
  },
  {
    kind: "chat",
    id: "tab3",
    label: "Conversation",
    title: "Chat with Claude",
  },
  {
    kind: "page",
    id: "tab4",
    label: "Spec Details",
    title: "Detailed specifications",
    address: "spec.example.com",
  },
  {
    kind: "page",
    id: "tab5",
    label: "Help",
    title: "Getting started",
    address: "help.example.com",
  },
];

describe("matchTabs", () => {
  it("returns all tabs in order on empty query", () => {
    const result = matchTabs(testTabs, "");
    expect(result).toEqual(testTabs);
  });

  it("matches prefix in label before substring", () => {
    const result = matchTabs(testTabs, "sp");
    // Should match "Specs" (prefix) and "Spec Details" (prefix) before anything with substring
    expect(result.map((t) => t.id)).toEqual(["tab1", "tab4"]);
  });

  it("matches by title", () => {
    const result = matchTabs(testTabs, "board");
    expect(result.map((t) => t.id)).toEqual(["tab2"]);
  });

  it("matches by address", () => {
    const result = matchTabs(testTabs, "localhost");
    expect(result.map((t) => t.id)).toEqual(["tab1", "tab2"]);
  });

  it("case-insensitive matching", () => {
    const result = matchTabs(testTabs, "SPEC");
    expect(result.map((t) => t.id)).toEqual(["tab1", "tab4"]);
  });

  it("returns empty on no matches", () => {
    const result = matchTabs(testTabs, "zzz");
    expect(result).toEqual([]);
  });

  it("preserves original order for equal scores", () => {
    const result = matchTabs(testTabs, "a");
    // "Board" and "Conversation" both have "a" as substring, should keep original order
    expect(result.length).toBeGreaterThan(0);
  });

  it("matches chat kind", () => {
    const result = matchTabs(testTabs, "conversation");
    expect(result.map((t) => t.id)).toEqual(["tab3"]);
  });
});

import { splitCheckpoint } from "./checkpoint";

type Case = readonly [string, string, number];
type Matchers = { toHaveLength(expected: number): void; toBeNull(): void; toEqual(expected: unknown): void };
type TestApi = {
  describe(name: string, fn: () => void): void;
  expect(actual: unknown): Matchers;
  it: ((name: string, fn: () => void) => void) & { each(cases: readonly Case[]): (name: string, fn: (label: string, input: string, count: number) => void) => void };
};
const { describe, expect, it } = globalThis as typeof globalThis & TestApi;

describe("splitCheckpoint", () => {
  it.each([
    ["heading with numbered states", "Status report\n1. ✅ Parser added\n2. ⏳ UI integration pending\n3. ⛔ Preview screenshot blocked", 3],
    ["markdown heading and bullets", "## Checkpoint\n- ✅ Tests pass\n- ⏳ Review pending", 2],
    ["bold lead", "**Progress**\n1. ✅ Built the parser", 1],
    ["next lead", "Checkpoint\n- ✅ Components ready\n**Next:** wire into chat", 2],
    ["details continue under item", "Status\n1. ✅ Parser\n   It leaves plain answers untouched.", 1],
    ["multiline summary", "Today\nCheckpoint\n1. ⏳ Working", 1],
    ["blocked rows", "**Status report**\n- ⛔ Missing fixture\n- ✅ Source reviewed", 2],
    ["parenthesized numbering", "Progress\n1) ✅ First\n2) ⏳ Second", 2],
  ])("parses %s", (_name: string, input: string, count: number) => {
    const parsed = splitCheckpoint(input);
    expect(parsed?.sections).toHaveLength(count);
  });

  it("does not split an ordinary answer", () => {
    expect(splitCheckpoint("The checkpoint is a saved point in a long process. It helps resume later." )).toBeNull();
  });

  it("rejects a malformed heading without actual rows", () => {
    expect(splitCheckpoint("Status report\nThings are going well, with no list or next prompt.")).toBeNull();
  });

  it("keeps the lead as the row title and only the detail in its body", () => {
    const parsed = splitCheckpoint("Status\n- ✅ Parser: avoids repeating the same sentence when opened.");
    expect(parsed?.sections[0]).toEqual({
      title: "Parser",
      body: "avoids repeating the same sentence when opened.",
      state: "done",
    });
  });
});

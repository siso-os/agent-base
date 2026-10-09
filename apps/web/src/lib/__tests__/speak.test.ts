// @ts-nocheck
import { chunks, speakable } from "../speak";

describe("speaker (t-0270)", () => {
  it("reads a reply without its markdown, code or URLs", () => {
    const md = "## Done\n\n- Shipped **the orb** in `MicButton.tsx`.\n- See [the page](https://x.example/a).\n\n```ts\nconst x = 1;\n```\nThat's it: https://y.example";
    expect(speakable(md)).toBe("Done Shipped the orb in MicButton.tsx. See the page. That's it: a link");
  });

  it("packs short sentences and keeps every piece at 200 characters or fewer", () => {
    const text = "One. Two! Three? " + "This sentence is long, it has clauses, ".repeat(10) + "and ends here. " + "x".repeat(450);
    const out = chunks(text);
    expect(out[0]).toBe("One. Two! Three?");
    expect(out.every((c) => c.length > 0 && c.length <= 200)).toBe(true);
    // nothing but the cut word is lost
    expect(out.join(" ").replace(/x+/g, "").trim()).toBe(text.replace(/x+/g, "").trim());
  });

  it("splits a long clause at spaces, never mid-word", () => {
    const words = Array.from({ length: 80 }, (_, i) => `word${i}`).join(" ");
    const out = chunks(words);
    expect(out.length).toBeGreaterThan(1);
    expect(out.join(" ")).toBe(words);
    expect(out.every((c) => c.length <= 200)).toBe(true);
  });

  it("says nothing for an empty reply", () => {
    expect(chunks(speakable("```\nonly code\n```"))).toEqual([]);
  });
});

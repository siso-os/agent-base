// @ts-nocheck
import { minimapCurrent, minimapHeight, minimapIndexFromPointer, minimapTop, minimapWidth, minimapWindow } from "../minimap";

describe("minimap geometry", () => {
  it("has a minimum height for zero marks", () => expect(minimapHeight(0)).toBe("min(1px, 62%)"));
  it("scales height with mark count", () => expect(minimapHeight(4)).toBe("min(42px, 62%)"));
  it("clamps top position", () => expect(minimapTop(9, 4)).toBe(100));
  it("handles a single mark", () => expect(minimapTop(0, 1)).toBe(0));
  it("rejects an empty rail", () => expect(minimapIndexFromPointer(0, 0, 100, 50)).toBeNull());
  it("maps pointer positions and clamps the edges", () => {
    expect(minimapIndexFromPointer(5, 10, 100, 60)).toBe(2);
    expect(minimapIndexFromPointer(5, 10, 100, 200)).toBe(4);
  });
  it("selects an intersecting turn", () => expect(minimapCurrent(20, 30, [{ top: 0, height: 10 }, { top: 15, height: 10 }])).toBe(1));
  it("returns no current mark when nothing is above or in view", () => expect(minimapCurrent(20, 30, [{ top: 40, height: 5 }])).toBeNull());
  it("shrinks bars by distance", () => expect([minimapWidth(0), minimapWidth(1), minimapWidth(2), minimapWidth(3)]).toEqual([18, 12, 9, 6]));
  it("caps the window at 31 marks around the current mark", () => expect(minimapWindow(100, 50)).toHaveLength(31));
});


describe("lazy minimap bounds", () => {
  it("does not measure rows after the first visible turn", () => {
    let reads = 0;
    function* bounds() {
      for (let i = 0; i < 1000; i++) { reads++; yield { top: i * 20, height: 18 }; }
    }
    expect(minimapCurrent(45, 80, bounds())).toBe(2);
    expect(reads).toBe(3);
  });
  it("preserves array behavior for empty lists, gaps, zero heights and positions past the end", () => {
    const sets = [[], [{ top: 10, height: 0 }], [{ top: 0, height: 10 }, { top: 20, height: 15 }, { top: 50, height: 0 }]];
    for (const rows of sets) for (let top = -10; top < 90; top++) {
      function* bounds() { yield* rows; }
      expect(minimapCurrent(top, top + 10, bounds())).toBe(minimapCurrent(top, top + 10, rows));
    }
  });
});

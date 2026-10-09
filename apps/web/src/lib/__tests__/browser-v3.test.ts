// @ts-nocheck
import { favouriteColumns } from "../browser-tabs";

describe("favourites grid (browser v3)", () => {
  it("fills one row up to four, then rows of three, four and six", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 18].map(favouriteColumns)).toEqual([1, 2, 3, 4, 3, 3, 4, 4, 6, 6, 6, 6]);
  });
  it("never asks for zero columns", () => { expect(favouriteColumns(0)).toBe(1); });
});

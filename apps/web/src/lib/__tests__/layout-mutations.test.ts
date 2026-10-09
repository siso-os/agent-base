// @ts-nocheck
import { describe, expect, it } from "vitest";
import { anyMovesLayout, movesLayout } from "../layout-mutations";

const el = (inFace: boolean) => ({ closest: (sel: string) => (inFace && sel.includes(".pf") ? {} : null) });

describe("movesLayout", () => {
  it("ignores a face writing its own style every frame", () => {
    expect(movesLayout({ type: "attributes", attributeName: "style", target: el(true) })).toBe(false);
  });
  it("keeps style changes outside faces", () => {
    expect(movesLayout({ type: "attributes", attributeName: "style", target: el(false) })).toBe(true);
  });
  it("keeps class, hidden and aria-expanded changes even on faces", () => {
    for (const attributeName of ["class", "hidden", "aria-expanded"]) expect(movesLayout({ type: "attributes", attributeName, target: el(true) })).toBe(true);
  });
  it("keeps inserted and removed nodes, faces included", () => {
    expect(movesLayout({ type: "childList", attributeName: null, target: el(true) })).toBe(true);
  });
  it("a batch moves layout when any record does", () => {
    const face = { type: "attributes", attributeName: "style", target: el(true) };
    expect(anyMovesLayout([face, face])).toBe(false);
    expect(anyMovesLayout([face, { type: "childList", attributeName: null, target: el(false) }])).toBe(true);
  });
});

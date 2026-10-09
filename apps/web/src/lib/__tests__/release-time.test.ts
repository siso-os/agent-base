// @ts-nocheck
import { describe, expect, it } from "vitest";
import { shippingOf, whenWords } from "../releases";

describe("recorded release timestamps", () => {
  const now = new Date(2026, 9, 6, 23, 59, 55).getTime();
  it("does not call future timestamps just now", () => {
    expect(whenWords(new Date(now + 86_400_000).toISOString(), now)).toMatch(/^Future timestamp/);
  });
  it("reports missing and malformed timestamps as unavailable", () => {
    for (const at of ["", "invalid"]) expect(whenWords(at, now)).toBe("Time unavailable");
  });
  it("uses local calendar days across midnight", () => {
    expect(whenWords(new Date(2026, 9, 5, 0, 5).toISOString(), now)).toMatch(/^yesterday at 00:05$/);
  });
  it("does not project future, missing or malformed build times as present shipping", () => {
    for (const built_at of [new Date(now + 1).toISOString(), null, "invalid"])
      expect(shippingOf([{ id: "fixture", sha: "a".repeat(40), state: "queued", built_at }], now)).toBeNull();
  });
});

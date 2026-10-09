import { progress, label } from "../compact-progress.ts";

type Matchers = {
  toContain(expected: string): void;
  toBe(expected: number): void;
  toBeCloseTo(expected: number, precision: number): void;
  toBeLessThanOrEqual(expected: number): void;
  toBeGreaterThan(expected: number): void;
  toEqual(expected: unknown): void;
};
type TestApi = {
  describe(name: string, fn: () => void): void;
  expect(actual: unknown): Matchers;
  it(name: string, fn: () => void): void;
};
const { describe, expect, it } = globalThis as typeof globalThis & TestApi;

const P50 = 78000;
const P90 = 136000;

describe("compact-progress", () => {
  describe("progress()", () => {
    it("returns 0 at elapsed 0", () => {
      expect(progress(0, P50)).toBe(0);
    });

    it("clamps negative elapsed to 0", () => {
      expect(progress(-1000, P50)).toBe(0);
    });

    it("reaches approximately 0.9 at p50", () => {
      const fill = progress(P50, P50);
      expect(fill).toBeCloseTo(0.9, 2);
    });

    it("never exceeds 0.9 before end", () => {
      expect(progress(P90, P50)).toBeLessThanOrEqual(0.9);
      expect(progress(P90 * 2, P50)).toBeLessThanOrEqual(0.9);
      expect(progress(1000000, P50)).toBeLessThanOrEqual(0.9);
    });

    it("creeps past p50 but stays under 0.9", () => {
      const atP50 = progress(P50, P50);
      const atP90 = progress(P90, P50);
      expect(atP90).toBeGreaterThan(atP50);
      expect(atP90).toBeLessThanOrEqual(0.9);
    });

    it("uses provided p50 value", () => {
      const fast = progress(50000, 50000);
      const slow = progress(50000, 100000);
      expect(fast).toBeGreaterThan(slow);
    });
  });

  describe("label()", () => {
    it("shows starting state at 3 seconds", () => {
      const text = label(3000, P50, P90);
      expect(text).toContain("Compacting");
      expect(text).toContain("0:03");
      expect(text).toContain("usually about 1:18");
    });

    it("shows mid state at 42 seconds", () => {
      const text = label(42000, P50, P90);
      expect(text).toContain("Compacting");
      expect(text).toContain("0:42");
      expect(text).toContain("usually about 1:18");
    });

    it("shows long state at 151 seconds with amber indicator", () => {
      const text = label(151000, P50, P90);
      expect(text).toContain("Compacting");
      expect(text).toContain("2:31");
      expect(text).toContain("longer than usual");
    });

    it("formats elapsed time as m:ss", () => {
      expect(label(61000, P50, P90)).toContain("1:01");
      expect(label(5400000, P50, P90)).toContain("90:00");
    });

    it("clamps negative elapsed to 0", () => {
      const text = label(-1000, P50, P90);
      expect(text).toContain("0:00");
    });

    it("transitions at p90 threshold", () => {
      const beforeP90 = label(P90 - 1000, P50, P90);
      const atP90 = label(P90, P50, P90);
      expect(beforeP90).toContain("usually about");
      expect(atP90).toContain("longer than usual");
    });

    it("uses provided p50 for typical time", () => {
      const text = label(10000, 100000, P90);
      expect(text).toContain("usually about 1:40");
    });
  });
});

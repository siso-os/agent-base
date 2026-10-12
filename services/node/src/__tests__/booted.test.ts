// @ts-nocheck
import { describe, expect, it } from "vitest";
import { recordBooted, recordCrash, bootState } from "../booted";

describe("booted", () => {
  it("recordBooted should create boot state and set booted to true", () => {
    const sha = "abc1234";
    recordBooted(sha);

    const state = bootState(sha);
    expect(state).not.toBeNull();
    expect(state!.sha).toBe(sha);
    expect(state!.booted).toBe(true);
    expect(state!.at).not.toBeNull();
    expect(state!.crashes).toEqual([]);
  });

  it("recordCrash should add crashes to the state", () => {
    const sha = "def5678";
    recordBooted(sha);
    recordCrash(sha, "TestError", "Something went wrong");

    const state = bootState(sha);
    expect(state!.crashes).toHaveLength(1);
    expect(state!.crashes[0].name).toBe("TestError");
    expect(state!.crashes[0].message).toBe("Something went wrong");
  });

  it("recordCrash should cap crashes at 50 per SHA", () => {
    const sha = "ghi9012";
    recordBooted(sha);

    // Add 60 crashes
    for (let i = 0; i < 60; i++) {
      recordCrash(sha, "Error", `Crash ${i}`);
    }

    const state = bootState(sha);
    expect(state!.crashes).toHaveLength(50);
  });

  it("bootState should return null for unknown SHA", () => {
    const state = bootState("unknown-sha-xyz");
    expect(state).toBeNull();
  });

  it("recordCrash should create state if it does not exist", () => {
    const sha = "jkl3456";
    recordCrash(sha, "TestError", "Error occurred");

    const state = bootState(sha);
    expect(state).not.toBeNull();
    expect(state!.booted).toBe(false);
    expect(state!.crashes).toHaveLength(1);
  });
});

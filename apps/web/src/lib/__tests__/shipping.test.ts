// @ts-nocheck
import { shippingOf } from "../releases";

// The version pill's shipping state (Release 2): the newest lane still testing or deploying, built in the last 3 hours.
describe("shippingOf", () => {
  const now = Date.parse("2026-10-05T05:30:00+07:00");
  const lane = (id: string, state: string, built: string) => ({ id, sha: `${id}0000`, state, built_at: `2026-10-05T${built}:00+07:00` });
  it("is testing while queued and deploying once landed", () => {
    expect(shippingOf([lane("a", "live", "04:30"), lane("b", "queued", "05:20")], now)).toEqual({ state: "testing", sha: "b0000", since: "2026-10-05T05:20:00+07:00" });
    expect(shippingOf([lane("b", "landed", "05:20")], now)?.state).toBe("deploying");
  });
  it("is null when everything is live, failed or older than 3 hours", () => {
    expect(shippingOf([lane("a", "live", "05:00"), lane("c", "failed", "05:10"), lane("d", "queued", "01:00")], now)).toBeNull();
  });
});

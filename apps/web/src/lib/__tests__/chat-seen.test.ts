// @ts-nocheck
import type { Ev } from "../chat";
import { seenTail } from "../chat-seen";

const user = (i: number, mid = false): Ev => ({ t: "user", text: `u${i}`, at: i, from: "shaan", mid });
const said = (i: number): Ev => ({ t: "assistant", text: `a${i}`, at: i } as unknown as Ev);

describe("seenTail", () => {
  it("keeps a short log whole", () => {
    const log = [user(1), said(2)];
    expect(seenTail(log, 10)).toBe(log);
  });
  it("cuts at his next message so the first kept turn is whole", () => {
    const log = [user(0), said(1), said(2), said(3), user(4, true), said(5), user(6), said(7)];
    expect(seenTail(log, 5).map(e => (e as { text: string }).text)).toEqual(["u6", "a7"]);
  });
  it("falls back to the plain tail when no message is in it", () => {
    const log = [user(0), said(1), said(2), said(3)];
    expect(seenTail(log, 2)).toHaveLength(2);
  });
});

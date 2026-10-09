// @ts-nocheck
import { readFileSync } from "node:fs";
import { buildChat, cleanUser, formatWordCount, noticeOf, peerOf, wrappedPeer, quietLabel, quietRuns, runLabel, settlePending, staysOpen, wordCount, type Pending, type Ev } from "../chat";

describe("chat event formatting", () => {
  it("counts and groups words in the 412-word pasted-text fixture", () => {
    const fixture = readFileSync("apps/web/src/lib/__tests__/fixtures/pasted-412.txt", "utf8");
    expect(wordCount(fixture)).toBe(412);
    expect(formatWordCount(1204)).toBe("1,204");
    expect(wordCount("  \n ")).toBe(0);
  });
  it("strips a system reminder", () => expect(cleanUser("hello\n<system-reminder>secret</system-reminder>")).toBe("hello"));
  it("strips a notification preamble", () => expect(cleanUser("[SYSTEM NOTIFICATION foo]\nignore")).toBe(""));
  it("preserves ordinary text", () => expect(cleanUser("hello <tag>world</tag>")).toBe("hello <tag>world</tag>"));
  it("reads task notification fields", () => expect(noticeOf("<task-notification><summary>Done</summary><status>ok</status><duration_ms>50</duration_ms><tool-use-id>x</tool-use-id></task-notification>")).toEqual({ title: "Done", status: "ok", ms: 50, tool: "x" }));
  it("returns null for non-notifications", () => expect(noticeOf("normal message")).toBeNull());
  it("builds a user turn and keeps its answer", () => {
    const chat = buildChat([{ t: "user", text: "hi", at: 1, from: "me" }, { t: "text", id: "a", text: "hello", at: 2 }], {}, false);
    expect(chat.turns[0].me.text).toBe("hi");
    expect(chat.turns[0].answer).toEqual([{ k: "said", key: "a", text: "hello" }]);
  });
  it("does not show harness no-response noise", () => expect(buildChat([{ t: "text", id: "a", text: "No response requested.", at: 1 }], {}, false).turns).toHaveLength(0));
  it("folds consecutive read calls into one run", () => {
    const chat = buildChat([{ t: "user", text: "go", at: 1, from: "me" }, { t: "tool", id: "1", name: "Read", summary: "a", at: 2 }, { t: "tool", id: "2", name: "Read", summary: "b", at: 3 }], {}, true);
    expect(chat.turns[0].work[0].k).toBe("run");
  });
  it("labels counted shell work", () => expect(runLabel([{ id: "1", name: "Bash", summary: "", input: { command: "pwd" }, at: 0 }])).toContain("Ran 1 shell command"));
  it("pasted content accepts an id on both opening and closing tags", () => {
    const source = readFileSync("apps/web/src/components/ChatView.tsx", "utf8");
    const literal = source.match(/const PIECE = (\/.*\/g);/)?.[1];
    expect(literal).toBeTruthy();
    const piece = new RegExp(literal.slice(1, -2), "g");
    expect([..."<pasted_content id='open'>line one\nline two</pasted_content id='close'>".matchAll(piece)][0]?.[1]).toBe("line one\nline two");
  });
});

describe("quiet events (Screen 14)", () => {
  const T0 = Date.parse("2026-10-02T17:12:00+07:00");
  const note = (summary, extra = "") => `<task-notification> <task-id>x</task-id> <tool-use-id>toolu_1</tool-use-id> <status>completed</status> <summary>${summary}</summary> ${extra}</task-notification>`;
  const evs = [
    { t: "user", text: "build it", at: T0 - 60_000, from: "history" },
    { t: "text", id: "r0", text: "On it.", at: T0 - 50_000 },
    { t: "user", text: note('Monitor event: "agent-base inbox"', "<event>17:12 HEALTH → AGENT-BASE: OK</event>"), at: T0, from: "history" },
    { t: "tool", id: "b1", name: "Bash", summary: "tail inbox", input: { command: "tail inbox" }, at: T0 + 1000 },
    { t: "tool_done", id: "b1", ok: true, at: T0 + 2000 },
    { t: "user", text: note('Monitor event: "agent-base inbox"', "<event>17:14 A0 → AGENT-BASE: go</event>"), at: T0 + 120_000, from: "history" },
    { t: "user", text: note('Background command "Wait for builder" completed (exit code 0)'), at: T0 + 200_000, from: "history" },
    { t: "user", text: note('Monitor event: "luna reports"', "<event>17:17 hub-14 built</event>"), at: T0 + 300_000, from: "history" },
    { t: "user", text: note('Agent "Triage tasks" finished'), at: T0 + 360_000, from: "history" },
    { t: "user", text: "what now?", at: T0 + 400_000, from: "history" },
    { t: "text", id: "r1", text: "Here is where it stands.", at: T0 + 410_000 },
  ];
  it("folds 5 consecutive events into one block between his message and the reply", () => {
    const blocks = quietRuns(buildChat(evs, {}, false).turns);
    expect(blocks.map((b) => b.k)).toEqual(["turn", "quiet", "turn"]);
    const q = blocks[1];
    expect(q.events).toHaveLength(5);
    expect(q.events.map((e) => e.kind)).toEqual(["Monitor", "Monitor", "task done", "Monitor", "sub-agent done"]);
    expect(q.events[0].line).toBe("17:12 HEALTH → AGENT-BASE: OK");
    expect(q.events[0].work).toHaveLength(1);
    expect(q.events[2].line).toBe("Wait for builder");
    expect(quietLabel(q.events)).toMatch(/^5 background events · Monitor ×3, task done ×1, sub-agent done ×1 · \d\d:\d\d–\d\d:\d\d$/);
  });
  it("an event the agent answered in prose shows only as its reply", () => {
    const answered = [...evs.slice(0, 3), { t: "text", id: "r2", text: "HEALTH says OK, merging.", at: T0 + 5000 }, ...evs.slice(5)];
    const blocks = quietRuns(buildChat(answered, {}, false).turns);
    expect(blocks.map((b) => b.k)).toEqual(["turn", "quiet", "turn", "quiet", "turn"]);
    expect(blocks[2].turn.me).toBeNull();
    expect(blocks[2].turn.answer[0].text).toBe("HEALTH says OK, merging.");
    expect(blocks[3].events).toHaveLength(4);
  });
  it("prose written between tool calls stays in sight when the event folds (Shaan 21:20: the text collapsed)", () => {
    const mid = [...evs.slice(0, 3), { t: "text", id: "p1", text: "Reading the inbox: HEALTH is fine.", at: T0 + 500 }, ...evs.slice(3, 5), ...evs.slice(5)];
    const turns = buildChat(mid, {}, false).turns;
    const blocks = quietRuns(turns);
    const reply = blocks.find((b) => b.k === "turn" && b.turn.me === null);
    expect(reply).toBeTruthy();
    expect(reply.turn.work.filter(staysOpen).map((it) => it.text)).toEqual(["Reading the inbox: HEALTH is fine."]);
    expect(reply.turn.work.some((it) => !staysOpen(it))).toBe(false);
  });
  it("a finished turn keeps its prose and his mid-turn words out of the fold; only tool calls fold", () => {
    const t = buildChat([{ t: "user", text: "go", at: 1, from: "me" }, { t: "text", id: "p", text: "First I check the logs.", at: 2 }, { t: "tool", id: "1", name: "Bash", summary: "x", input: { command: "ls" }, at: 3 }, { t: "tool_done", id: "1", ok: true, at: 4 }, { t: "text", id: "a", text: "Done.", at: 5 }], {}, false).turns[0];
    expect(t.work.filter(staysOpen).map((it) => it.text)).toEqual(["First I check the logs."]);
    expect(t.work.filter((it) => !staysOpen(it)).length).toBeGreaterThan(0);
    expect(staysOpen({ k: "said", key: "e", text: "  " })).toBe(false);
  });
  it("t-0245: an interrupt, a command's output and a finished foreground sub-agent read as the CLI shows them", () => {
    const t = buildChat([
      { t: "user", text: "go", at: 1, from: "me" },
      { t: "tool", id: "a", name: "Agent", summary: "scout", at: 2 },
      { t: "tool_done", id: "a", ok: true, out: "found it\nagentId: x1 (for resuming to continue this agent's work if needed)", at: 3 },
      { t: "tool", id: "b", name: "Agent", summary: "audit", at: 4 },
      { t: "tool_done", id: "b", ok: true, out: "Async agent launched successfully.\nagentId: x2", at: 5 },
      { t: "note", text: "Set model to opus", at: 6 },
      { t: "user", text: "[Request interrupted by user]", at: 7, from: "history" },
    ] as Ev[], {}, false).turns[0];
    const agents = t.work.filter((it) => it.k === "agent").map((it) => (it.k === "agent" ? it.call.bg : null));
    expect(agents).toEqual([undefined, "x2"]);
    expect(t.work.filter(staysOpen).map((it) => it.k)).toEqual(["agent", "note", "divider"]);
  });
  it("never folds the live turn", () => {
    const blocks = quietRuns(buildChat(evs.slice(0, 5), {}, true).turns);
    expect(blocks.map((b) => b.k)).toEqual(["turn", "turn"]);
  });
});

describe("teammate and cross-session messages render as a peer, not raw XML (A0 22:54)", () => {
  const boiler = "\n\nThis came from another Claude session — not typed by your user, but very likely working on their behalf.";
  it("reads sender, summary and body from a teammate-message", () => {
    const text = '<teammate-message teammate_id="PROJECTS-NAV" color="orange" summary="lane DONE 8546aea">\nDONE 8546aea on opus/projects-nav.\n</teammate-message>' + boiler;
    expect(peerOf({ text, at: 0, from: "you" } as never)).toEqual({ name: "PROJECTS-NAV", text: "lane DONE 8546aea\n\nDONE 8546aea on opus/projects-nav." });
  });
  it("turns an idle_notification into its result text", () => {
    const text = '<teammate-message teammate_id="SDK-START">{"type":"idle_notification","result":"Next step: merge it."}</teammate-message>' + boiler;
    expect(wrappedPeer(text)).toEqual({ name: "SDK-START", text: "Next step: merge it." });
  });
  it("reads a cross-session-message by its from attribute", () => {
    expect(wrappedPeer('<cross-session-message from="HEALTH">GO 7f9b074</cross-session-message>')).toEqual({ name: "HEALTH", text: "GO 7f9b074" });
  });
  it("reads the idle-delivery shape: 'Another Claude session sent a message:' then several blocks (A0 23:04)", () => {
    const text = 'Another Claude session sent a message:\n<teammate-message teammate_id="SDK-START" summary="t-0189 DONE">DONE 7ed207c</teammate-message>\n<teammate-message teammate_id="SDK-START">{"type":"idle_notification","result":"Merged and pushed."}</teammate-message>\n<teammate-message teammate_id="HUD-R119" summary="rim DONE">DONE a6561b6</teammate-message>' + boiler;
    expect(peerOf({ text, at: 0, from: "you" } as never)).toEqual({ name: "SDK-START, HUD-R119", text: "t-0189 DONE\n\nDONE 7ed207c\n\nMerged and pushed.\n\nrim DONE\n\nDONE a6561b6" });
  });
  it("leaves his own words alone, even when they mention the tag", () => {
    expect(wrappedPeer("why does <teammate-message> show raw?")).toBeNull();
  });
});

import { isParked, needsNames } from "../a0-tasks";
describe("a parked task never drives 'needs you' (A0 22:54)", () => {
  const base = { owner: "AGENT-BASE", stage: "specced", needs: "passphrase" };
  it("spots the triage's PARKED marker", () => {
    expect(isParked({ next: "PARKED (backlog triage 2 Oct): Needs him" })).toBe(true);
    expect(isParked({ next: "NOW: ship it" })).toBe(false);
  });
  it("leaves a parked task out of the needs-you names", () => {
    expect(needsNames([{ ...base, next: "PARKED (backlog triage 2 Oct): Needs him (passphrase)" } as never]).size).toBe(0);
    expect(needsNames([{ ...base, next: "waiting on his passphrase" } as never]).size).toBe(1);
  });
});



describe("pending legacy chat delivery", () => {
  const row = (overrides: Partial<Pending> = {}): Pending => ({ key: "attempt", text: "Wait for review", images: [], at: 100_000, status: "sent", ...overrides });
  const user = (text: string, overrides = {}): Ev => ({ t: "user", id: "echo", text, at: 100_001, from: "history", ...overrides });

  it("retains an aged unacknowledged message and the unchanged array and row", () => {
    const pending = [row()];
    expect(settlePending(pending, [], 900_001)).toBe(pending);
    expect(settlePending(pending, [user("An unrelated update")], 900_001)[0]).toBe(pending[0]);
  });
  it("does not treat a shared 80-character prefix or substring as delivery", () => {
    const prefix = "Review every dependency before changing the release candidate. ".repeat(3);
    const pending = [row({ text: prefix + "DO NOT DEPLOY" })];
    expect(settlePending(pending, [user(prefix + "DEPLOY AFTER REVIEW")])).toBe(pending);
    expect(settlePending(pending, [user("Quoted request: " + pending[0].text)])).toBe(pending);
  });
  it("does not collapse meaningful internal whitespace", () => {
    const pending = [row({ text: 'Replace "a  b" with "c"' })];
    expect(settlePending(pending, [user('Replace "a b" with "c"')])).toBe(pending);
  });
  it.each(["user", "queued"])("settles a complete %s echo exactly once", (t) => {
    const pending = [row(), row({ key: "later", text: "Keep the rollback" })];
    const event = { ...user(pending[0].text), t } as Ev;
    const left = settlePending(pending, [event]);
    expect(left).toEqual([pending[1]]);
    expect(left[0]).toBe(pending[1]);
    expect(settlePending(left, [{ ...event }])).toBe(left);
  });
  it("requires every attachment, including for an image-only send", () => {
    const pending = [row({ text: "", images: ["/uploads/a.png", "/uploads/b.png"] })];
    for (const text of ["/uploads/a.png", "/uploads/a.png\n/uploads/c.png", "/uploads/a.png\n/uploads/b.png\n/uploads/c.png"])
      expect(settlePending(pending, [user(text)])).toBe(pending);
    expect(settlePending(pending, [user("/uploads/a.png\n/uploads/b.png")])).toEqual([]);
  });
  it("does not settle matching text with missing or different images", () => {
    const pending = [row({ images: ["/uploads/a.png"] })];
    expect(settlePending(pending, [user(pending[0].text)])).toBe(pending);
    expect(settlePending(pending, [user(pending[0].text + "\n/uploads/b.png")])).toBe(pending);
    expect(settlePending(pending, [user(pending[0].text + "\n/uploads/a.png")])).toEqual([]);
  });
  it("matches complete terminal upload names and numbered markers", () => {
    const pending = [row({ images: ["/uploads/a.png", "/uploads/b.png"] })];
    expect(settlePending(pending, [user("[Image #1] [Image #2]\nWait for review", { images: ["a.png", "b.png"] })])).toEqual([]);
    expect(settlePending(pending, [user("[Image #1] [Image #2]\nWait for review", { images: ["a.png", "c.png"] })])).toBe(pending);
    expect(settlePending(pending, [user("[Image #1] [Image #2]\nWait for review")])).toBe(pending);
  });
  it("keeps explicit failures retryable despite exact echoes or elapsed time", () => {
    const pending = [row({ status: "failed", note: "Not connected" })];
    expect(settlePending(pending, [user(pending[0].text)], 900_001)).toBe(pending);
    expect(pending[0].note).toBe("Not connected");
  });
  it("rejects peer messages and history preceding the attempt", () => {
    const pending = [row()];
    expect(settlePending(pending, [user(pending[0].text, { from: "peer" })])).toBe(pending);
    expect(settlePending(pending, [user(pending[0].text, { at: pending[0].at - 1 })])).toBe(pending);
  });
  it("retains ambiguous identical attempts across duplicate events and replay", () => {
    const pending = [row(), row({ key: "second", at: 100_001 })];
    const events = [user("Wait for review", { at: 100_002 })];
    expect(settlePending(pending, events)).toBe(pending);
    expect(settlePending(pending, [...events, { ...events[0] }])).toBe(pending);
  });
  it("an earlier exact echo settles only the earlier identical attempt, including on replay", () => {
    const first = row();
    const later = row({ key: "later", at: 100_003 });
    const events = [user(first.text, { at: 100_002 })];
    const left = settlePending([first, later], events);
    expect(left).toEqual([later]);
    expect(settlePending(left, events.map((e) => ({ ...e })))).toBe(left);
  });
});


describe("settings rejection visibility", () => {
  for (const label of ["Model unchanged", "Effort unchanged", "Settings unchanged"]) {
    it(`keeps ${label} visible without a user turn`, () => {
      const chat = buildChat([{ t: "note", label, text: "Synthetic setting rejection", bad: true, at: 1 }], {}, false);
      const notes = chat.turns.flatMap(turn => [...turn.work, ...turn.answer]).filter(item => item.k === "note");
      expect(notes).toHaveLength(1);
      expect(notes[0].text).toBe("Synthetic setting rejection");
      expect(staysOpen(notes[0])).toBe(true);
    });
  }
});

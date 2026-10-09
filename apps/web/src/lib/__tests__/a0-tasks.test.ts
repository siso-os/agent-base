// @ts-nocheck
import { byProject, canonName, dayGroup, needWhat, openCounts, orderTasks, ownerNames, rowOrder, taskMatches, taskSplit, taskTabs, tasksOf } from "../a0-tasks";

const t = (id, owner, priority = "P2", stage = "thought", next = null) => ({ id, title: id, project: "x", priority, stage, owner, model: null, updated: "", next });
describe("an owner's tasks (R1.17)", () => {
  it("reads every name an owner field gives", () => {
    expect(ownerNames("AGENT-BASE + A0")).toEqual(["AGENT-BASE", "A0"]);
    expect(ownerNames("STREAMING-CLAUDE (AUTO-VIEWER)")).toEqual(["STREAMING-CLAUDE"]);
    expect(ownerNames("halo-ui, efficiency/estate")).toEqual(["HALO-UI", "EFFICIENCY", "ESTATE"]);
    expect(ownerNames(null)).toEqual([]);
  });
  it("one worker, one name", () => expect(canonName("Complete AGENT-BASE task | luna-t6-owner-tasks")).toBe("T6-OWNER-TASKS"));
  it("orders NOW first, then P0 → P3, then the furthest stage", () => {
    const list = [t("a", "X", "P1", "building"), t("b", "X", "P0", "thought"), t("c", "X", "P3", "thought", "NOW: go"), t("d", "X", "P1", "built")];
    expect(orderTasks(list).map((x) => x.id)).toEqual(["c", "b", "d", "a"]);
  });
  it("lists only the tasks naming the agent, or all for Agent Zero", () => {
    const list = [t("a", "AGENT-BASE + A0"), t("b", "HALO-UI"), t("c", "agent-base")];
    expect(tasksOf(list, "AGENT-BASE").map((x) => x.id)).toEqual(["a", "c"]);
    expect(tasksOf(list, "AGENT BASE").map((x) => x.id)).toEqual(["a", "c"]);
    expect(tasksOf(list, "Agent Zero", true)).toHaveLength(3);
  });
  it("counts open tasks per owner, done ones left out", () => {
    const counts = openCounts([t("a", "AGENT-BASE"), t("b", "AGENT-BASE", "P1", "dropped"), t("c", "AGENT-BASE + AGENT-BASE", "P1", "live")]);
    expect(counts.get("AGENT-BASE")).toBe(1);
  });
});
describe("the Tasks page tabs", () => {
  it("puts every task in exactly one tab: open, done (live, integrated, happy) or dropped", () => {
    const list = ["thought", "building", "preview", "rework", "feedback", "live", "integrated", "happy", "dropped", "dropped"].map((s, i) => t(`t${i}`, "X", "P2", s));
    const { open, done, dropped } = taskTabs(list);
    expect(open.map((x) => x.stage)).toEqual(["thought", "building", "preview", "rework", "feedback"]);
    expect(done.map((x) => x.stage)).toEqual(["live", "integrated", "happy"]);
    expect(dropped).toHaveLength(2);
    expect(open.length + done.length + dropped.length).toBe(list.length);
  });
  it("an unknown stage stays open, never hidden", () => expect(taskTabs([t("a", "X", "P2", "parked-ish")]).open).toHaveLength(1));
});
describe("the one list (SPEC-STATS-TASKS §4.1)", () => {
  const stages = ["thought", "specced", "allocated", "building", "built", "tested", "preview", "feedback", "rework", "live", "integrated", "happy", "dropped", "odd-new-stage"];
  const list = stages.map((s, i) => ({ ...t(`t${i}`, "X", "P2", s), needs: i % 3 === 0 }));
  it("Now + Done + dropped is every task; Needs you is inside Now; nothing is unreachable", () => {
    const { now, needs, done, dropped } = taskSplit(list);
    expect(now.length + done.length + dropped.length).toBe(list.length);
    expect(new Set([...now, ...done, ...dropped].map((x) => x.id)).size).toBe(list.length);
    expect(needs.every((x) => now.includes(x))).toBe(true);
    expect(now.map((x) => x.stage)).toContain("built");
    expect(now.map((x) => x.stage)).toContain("odd-new-stage");
    expect(done.map((x) => x.stage)).toEqual(["live", "integrated", "happy"]);
    expect(needs.some((x) => x.stage === "live")).toBe(false);
  });
  it("orders needs-you first, then P0 → P3, then the furthest stage, then the newest", () => {
    const rows = [{ ...t("a", "X", "P0", "thought"), updated: "1" }, { ...t("b", "X", "P3", "thought"), needs: true }, { ...t("c", "X", "P0", "building"), updated: "1" }, { ...t("d", "X", "P0", "building"), updated: "2" }];
    expect(rowOrder(rows).map((x) => x.id)).toEqual(["b", "d", "c", "a"]);
  });
  it("groups by project: needs-you projects first, then the most rows", () => {
    const rows = [{ ...t("a", "X"), project: "Big" }, { ...t("b", "X"), project: "Big" }, { ...t("c", "X"), project: "Small", needs: true }];
    expect(byProject(rows).map((g) => [g.project, g.tasks.length, g.needs])).toEqual([["Small", 1, 1], ["Big", 2, 0]]);
  });
  it("days: Today, Yesterday, Earlier on this clock", () => {
    const now = new Date(2026, 9, 3, 4, 55);
    expect(dayGroup(new Date(2026, 9, 3, 0, 41).toISOString(), now)).toBe("Today");
    expect(dayGroup(new Date(2026, 9, 2, 23, 0).toISOString(), now)).toBe("Yesterday");
    expect(dayGroup(new Date(2026, 9, 1, 12, 0).toISOString(), now)).toBe("Earlier");
  });
  it("rewrites NEEDS HIM / PARKED into a sentence", () => {
    expect(needWhat("NEEDS HIM: sign in to Vercel")).toBe("Sign in to Vercel");
    expect(needWhat("Opus spec 2 Oct: needs him (sign in)")).toBe("Sign in");
    expect(needWhat("PARKED — waiting on the mini")).toBe("Parked: waiting on the mini");
  });
  it("search reads his words, title, owner and id", () => {
    const row = { ...t("t-0242", "AGENT-BASE"), his: "make the tasks easier to view" };
    expect(taskMatches(row, "easier view")).toBe(true);
    expect(taskMatches(row, "agent-base")).toBe(true);
    expect(taskMatches(row, "t-0242")).toBe(true);
    expect(taskMatches(row, "nope")).toBe(false);
  });
});

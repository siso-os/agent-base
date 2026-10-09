// @ts-nocheck
import { planPhases, turnAction, stepLetter, yourTurn } from "../task-plan";

const NOW = Date.parse("2026-10-05T12:00:00Z");
const t = (id, stage, extra = {}) => ({ id, title: id, project: "agent-base", priority: "P1", stage, owner: "AGENT-BASE", model: null, updated: "2026-10-05T10:00:00Z", ...extra });

describe("planPhases", () => {
  const all = [
    t("prev", "preview", { next: "Shaan tries the browser tab", needs: true }),
    t("rated", "happy", { updated: "2026-10-05T09:00:00Z" }),
    t("old-happy", "happy", { updated: "2026-10-01T09:00:00Z" }),
    t("bld", "building", { agent: "SOUL-A" }),
    t("bld2", "built"),
    t("shipped", "live", { live_at: "2026-10-05T08:00:00Z" }),
    t("old-live", "live", { live_at: "2026-09-30T08:00:00Z" }),
    t("spec", "specced", { priority: "P2" }),
    t("p0idea", "thought", { priority: "P0" }),
    t("idea", "thought", { priority: "P2" }),
    t("parked", "thought", { priority: "P0", next: "PARKED: needs him", needs: true }),
  ];
  const onIt = (x) => x.agent === "SOUL-A";
  const phases = Object.fromEntries(planPhases(all, onIt, NOW).map((p) => [p.key, p]));

  it("puts landed work in Your turn and ticks what he rated today", () => {
    expect(phases.turn.steps.map((s) => [s.t.id, s.mark])).toEqual([["rated", "done"], ["prev", "todo"]]);
    expect([phases.turn.done, phases.turn.total]).toEqual([1, 2]);
  });
  it("ticks today's live work in Building and lights what someone is on", () => {
    expect(phases.building.steps.map((s) => [s.t.id, s.mark])).toEqual([["shipped", "done"], ["bld", "current"], ["bld2", "todo"]]);
  });
  it("splits up next from ideas and keeps parked work out of his turn", () => {
    expect(phases.next.steps.map((s) => s.t.id)).toEqual(["p0idea", "spec"]);
    expect(phases.ideas.steps.map((s) => s.t.id).sort()).toEqual(["idea", "parked"]);
    expect(yourTurn(all[10])).toBe(false);
  });
});

describe("turnAction", () => {
  it("turns the next step into his verb", () => {
    expect(turnAction(t("a", "preview", { next: "Shaan tries the browser tab" }))).toBe("Try the browser tab");
    expect(turnAction(t("a", "preview", { next: "Shaan looks at the before/after shots" }))).toBe("Look at the before/after shots");
    expect(turnAction(t("a", "preview", { next: "Shaan watches the clip" }))).toBe("Watch the clip");
    expect(turnAction(t("a", "preview"))).toBe("");
    expect(turnAction(t("a", "preview", { next: "superseded by t-0402" }))).toBe("");
  });
  it("letters past z", () => expect([stepLetter(0), stepLetter(25), stepLetter(26)]).toEqual(["a", "z", "aa"]));
});

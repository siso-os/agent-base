// @ts-nocheck
import { seedWorkspaces } from "../../../../../services/node/src/workspace-registry";
import { isDone, taskRoots, taskSplit, tasksOf } from "../a0-tasks";
import { taskNavRoot, taskOwner, taskWorkspace, workspaceTaskGroups } from "../task-workspaces";
import { taskFamily, taskProgress } from "../../components/panel/TaskTree";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TaskTree } from "../../components/panel/TaskTree";
import { TaskWorkspaceGroups } from "../../components/TaskWorkspaceGroups";
import { readFileSync, mkdtempSync, writeFileSync, utimesSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { createA0TasksHandler } from "../../../../../services/node/src/a0-tasks";

const registry = {
  workspaces: seedWorkspaces(),
  taskIdentities: {
    "AGENT BASE": { workspace: "agent-base" }, FACES: { project: "Agent Base" }, EFFICIENCY: { workspace: "agent-base" },
    "OPERATOR-DESIGN": { workspace: "halo-operator" }, "STREAM-QUALITY": { workspace: "halo-streaming" },
    KIKAS: { workspace: "kikas" }, FAHMY: { workspace: "fahmy" }, A0: { workspace: "agent-base", project: "Agent Base" },
  },
  taskAliases: { UI: "AGENT BASE", "STACK-OPT": "EFFICIENCY" },
};
const t = (id, values = {}) => ({ id, title: id, project: "unknown", owner: "unknown", stage: "building", priority: "P2", updated: "2026-10-05T12:00:00Z", model: null, ...values });

describe("Tasks registry workspace overview", () => {
  it("projects task-file affinity and clears it after a native field removal without changing the index", async () => {
    const scratch = mkdtempSync(path.join(tmpdir(), ".siso-ephemeral-task-workspaces."));
    try {
      const row = t("t-0001", { project: "Agent Base" });
      writeFileSync(path.join(scratch, "INDEX.json"), JSON.stringify({ updated: row.updated, tasks: [row], counts: {} }));
      const file = path.join(scratch, "t-0001.json");
      writeFileSync(file, JSON.stringify({ ...row, workspace: "halo-operator" }));
      const read = createA0TasksHandler(scratch);
      expect((await read("/api/a0/tasks")).body.tasks[0].workspace).toBe("halo-operator");
      writeFileSync(file, JSON.stringify(row));
      utimesSync(file, new Date(), new Date(Date.now() + 1000));
      expect((await read("/api/a0/tasks")).body.tasks[0].workspace).toBeNull();
      expect((await read("/api/a0/tasks/t-0001")).body.id).toBe(row.id);
    } finally { rmSync(scratch, { recursive: true }); }
  });
  it("uses the three nav roots in registry order, their colours, and exactly one Unsorted", () => {
    const groups = workspaceTaskGroups([t("x", { owner: "A0", project: "Unknown product", agent: "AGENT BASE" })], registry);
    expect(groups.map(g => g.id)).toEqual(["halo", "agent-base", "siso-agency", "unsorted"]);
    expect(groups.slice(0, 3).map(g => g.color)).toEqual(registry.workspaces.filter(w => w.nav).sort((a,b) => a.order-b.order).map(w => w.color));
    expect(groups.at(-1).tasks.map(t => t.id)).toEqual(["x"]);
    const changed = { ...registry, workspaces: [...registry.workspaces, { id: "future", name: "Future", order: 3, color: "#abcdef", nav: true }] };
    expect(workspaceTaskGroups([], changed).map(g => g.id)).toContain("future");
    expect(taskWorkspace(t("future-task", { project: "Future" }), changed)).toBe("future");
    expect(taskWorkspace(t("child-workspace", { project: "halo-operator" }), registry)).toBe("halo");
    expect(taskWorkspace(t("legacy-project", { project: "HALO · Ops" }), registry)).toBe("halo");
  });
  it("follows multiple ancestry levels, explicit affinity and cycles without a name-prefix guess", () => {
    const r = { ...registry, workspaces: [...registry.workspaces, { id: "operator-design", parent: "halo-operator" }, { id: "loop-a", parent: "loop-b" }, { id: "loop-b", parent: "loop-a" }] };
    expect(taskNavRoot("operator-design", r)).toBe("halo");
    expect(taskNavRoot("loop-a", r)).toBeNull();
    expect(taskWorkspace(t("x", { workspace: "kikas", project: "Agent Base" }), r)).toBe("siso-agency");
    expect(taskWorkspace(t("x", { workspace: "missing", project: "Agent Base" }), r)).toBeNull();
    expect(taskWorkspace(t("x", { owner: "ab-unknown" }), r)).toBeNull();
  });
  it("resolves explicit registry affinity before project and reviewed aliases after project", () => {
    expect(taskWorkspace(t("x", { owner: "STREAM-QUALITY", project: "Agent Base" }), registry)).toBe("halo");
    expect(taskWorkspace(t("x", { owner: "FACES" }), registry)).toBe("agent-base");
    expect(taskWorkspace(t("x", { owner: "STACK-OPT" }), registry)).toBe("agent-base");
    expect(taskOwner(t("x", { owner: "UI", agent: "different executor" }), registry)).toBe("AGENT BASE");
    expect(taskOwner(t("x", { owner: "A0 + FACES" }), registry)).toBe("FACES");
  });
  it("places the current t0405..0413 associations without changing their owners or stages", () => {
    // Read-only projection of the native records inspected 5 Oct; no native task mutation.
    const rows = [
      ["t-0405", "Agent Base", "FACES", "allocated"], ["t-0406", "Agent Base", "FACES", "allocated"],
      ["t-0407", "Agent Base", "ab-nav-workspaces", "building"], ["t-0408", "Agent Base", "ab-nav-workspaces", "building"],
      ["t-0409", "Agent Base", "ab-stalls-dots", "building"], ["t-0410", "Agent Base", "TASK-LANES", "allocated"],
      ["t-0411", "HALO", "STREAM-QUALITY", "building"], ["t-0412", "SISO Agency", "KIKAS", "building"], ["t-0413", "Agent Base", "ab-stalls-dots", "building"],
    ].map(([id, project, owner, stage]) => t(id, { project, owner, stage }));
    const before = JSON.stringify(rows);
    const placements = workspaceTaskGroups(rows, registry).flatMap(w => w.owners.flatMap(o => o.tasks.map(t => [t.id, w.id, o.owner]))).sort();
    expect(placements).toEqual(rows.map(t => [t.id, t.project === "HALO" ? "halo" : t.project === "SISO Agency" ? "siso-agency" : "agent-base", t.owner.toUpperCase()]).sort());
    expect(JSON.stringify(rows)).toBe(before);
  });
  it("keeps closed work out of open, retains built/tested/preview, and never infers parent acceptance", () => {
    const parent = t("parent", { workspace: "halo-operator", stage: "built" });
    const child = t("child", { parent: parent.id, stage: "done" });
    const rows = [parent, child, ...["live", "happy", "integrated", "dropped", "tested", "preview"].map(s => t(s, { stage: s }))];
    const split = taskSplit(rows);
    expect(split.now.map(t => t.stage)).toEqual(["built", "tested", "preview"]);
    expect(isDone(parent)).toBe(false);
    expect(taskProgress(parent, rows)).toBe("1/1");
    expect(taskFamily(parent, rows).map(t => t.id)).toEqual(["parent", "child"]);
    const openChild = t("step", { parent: child.id });
    expect(taskRoots([openChild])).toEqual([openChild]);
    expect(taskWorkspace(openChild, registry, [...rows, openChild])).toBe("halo");
  });
  it("counts roots once and scopes an executor's actual child while preserving the owner's board", () => {
    const parent = t("root", { project: "Agent Base", owner: "AGENT-BASE" });
    const child = t("step", { parent: "root", owner: "AGENT-BASE", agent: "FACES" });
    const stranger = t("other", { project: "HALO", owner: "STREAM-QUALITY" });
    const all = [parent, child, stranger];
    expect(workspaceTaskGroups(all, registry).find(w => w.id === "agent-base").tasks).toEqual([parent]);
    expect(taskRoots(tasksOf(all, "FACES"))).toEqual([child]);
    expect(taskRoots(tasksOf(all, "AGENT BASE"))).toEqual([parent]);
    expect(taskFamily(parent, all)).toHaveLength(2);
  });
  it("renders the collapsed workspace overview and reveals owner groups with actual open child steps", () => {
    const parent = t("root", { project: "Agent Base", owner: "FACES" });
    const done = t("done-step", { parent: parent.id, stage: "live" });
    const child = t("real-step", { parent: parent.id, title: "Actual child record" });
    const all = [parent, done, child];
    const props = { tasks: all.filter(t => !isDone(t)), all, registry,
      renderTask: task => createElement(TaskTree, { task, all, openOnly: true }) };
    const overview = renderToStaticMarkup(createElement(TaskWorkspaceGroups, props));
    expect((overview.match(/aria-expanded="false"/g) ?? [])).toHaveLength(4);
    const html = renderToStaticMarkup(createElement(TaskWorkspaceGroups, { ...props, reveal: true }));
    expect((html.match(/data-workspace=/g) ?? [])).toHaveLength(4);
    expect((html.match(/aria-expanded="true"/g) ?? [])).toHaveLength(4);
    expect(html).toContain('data-owner="FACES"');
    expect(html).toContain('data-task-step="real-step"');
    expect(html).not.toContain('data-task-step="done-step"');
    expect(html).toContain("1 of 2 steps done");
  });
  it.runIf(process.env.AB_TASK_WORKSPACE_NATIVE_PROBE === "1")("projects the current native t0405..0413 records read-only", () => {
    const state = JSON.parse(readFileSync(path.join(homedir(), ".local/state/agent-base/registry.json"), "utf8"));
    const r = { workspaces: state.workspaces, taskIdentities: state.agents, taskAliases: state.aliases };
    const root = path.join(homedir(), "SISO_Workspace/SISO_Agents/agent-zero/siso-agent-zero/tasks");
    const expected = [
      [405, "agent-base", "FACES"], [406, "agent-base", "FACES"], [407, "agent-base", "ab-nav-workspaces"], [408, "agent-base", "ab-nav-workspaces"],
      [409, "agent-base", "ab-stalls-dots"], [410, "agent-base", "TASK-LANES"], [411, "halo", "STREAM-QUALITY"], [412, "siso-agency", "KIKAS"], [413, "agent-base", "ab-stalls-dots"],
    ];
    for (const [n, workspace, owner] of expected) {
      const task = JSON.parse(readFileSync(path.join(root, `t-${String(n).padStart(4, "0")}.json`), "utf8"));
      expect(taskWorkspace(task, r)).toBe(workspace);
      expect(taskOwner(task, r).toUpperCase()).toBe(owner.toUpperCase());
    }
  });
});

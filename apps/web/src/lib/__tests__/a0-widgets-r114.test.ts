// @ts-nocheck
// R1.14 on Agent Zero's page: "N of M checked" counts what the progress card lists, and disk free shows once per machine.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ProgressWidget, type ProgressWidgetFile } from "../../components/widgets/ProgressWidget";
import { SystemsWidget, type SystemsWidgetFile } from "../../components/widgets/SystemsWidget";

const env = <D>(shape: string, data: D) => ({ id: shape, agent: "a0", title: shape, shape, updated: "2026-10-03T02:00:00Z", data });
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("R1.14 progress", () => {
  it("an empty plan beside three running tasks reads 0 of 3, not 0 of 0", () => {
    const items = ["CRM images", "Side nav", "CRM table"].map((title) => ({ title, status: "building", owner: "t-1" }));
    const w = env("progress", { checked: 0, total: 0, counts: {}, items }) as unknown as ProgressWidgetFile;
    const t = text(renderToStaticMarkup(createElement(ProgressWidget, { widget: w, size: "L" })));
    expect(t).toContain("0 of 3");
    expect(t).not.toContain("0 of 0");
  });
  it("a real plan keeps its own numbers", () => {
    const w = env("progress", { checked: 4, total: 10, counts: { checked: 4, building: 6 }, items: [{ title: "x", status: "building", owner: "t-2" }] }) as unknown as ProgressWidgetFile;
    expect(text(renderToStaticMarkup(createElement(ProgressWidget, { widget: w, size: "L" })))).toContain("4 of 10");
  });
});

describe("R1.14 systems", () => {
  it("a low disk shows its free space once (the meter), not again in the reasons", () => {
    const servers = [{ name: "laptop", role: "this Mac", level: "warn", cpus: 8, load: [7], memTotalGb: 16, memAvailGb: 4, diskFreeGb: 12, why: ["load 7 on 8 cores", "12 GB disk free"] }];
    const w = env("systems", { servers, heavy: "2 of 5" }) as unknown as SystemsWidgetFile;
    const t = text(renderToStaticMarkup(createElement(SystemsWidget, { widget: w, size: "L" })));
    expect(t.match(/12 GB/g)?.length).toBe(1);
    expect(t).toContain("load 7 on 8 cores");
  });
});

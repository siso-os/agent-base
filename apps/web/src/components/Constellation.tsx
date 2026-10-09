import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { AgentFace } from "../../../../packages/halo-face";
import type { Agent } from "../lib/agents";
import { canon } from "../lib/hub";
import type { HubAgent, HubOrg } from "../lib/hub-types";
import "./Constellation.css";

type Pos = { x: number; y: number };

const faceStatus = (a: HubAgent) => (!a.spunUp || a.state === "off" ? "offline" : a.state === "working" ? "working" : a.state === "done" ? "done" : "waiting");

export function Constellation({ org, agents, onOpen }: { org: HubOrg; agents: Agent[]; onOpen: (name: string) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Who is on the chart: Agent Zero, each owner once, and each owner's workers (from the live agents' leads).
  const owners = useMemo(() => {
    const m = new Map<string, HubAgent>();
    for (const g of org.groups) for (const p of g.projects) for (const d of p.domains) if (d.owner) m.set(canon(d.owner.name), d.owner);
    return [...m.entries()];
  }, [org]);
  const crews = useMemo(() => {
    const m = new Map<string, Agent[]>();
    for (const a of agents) {
      const lead = a.owner ?? a.lead;
      if (lead && !a.zero) m.set(canon(lead), [...(m.get(canon(lead)) ?? []), a]);
    }
    return m;
  }, [agents]);
  const pos = useMemo(() => {
    const { w, h } = size, m = new Map<string, Pos>();
    if (!w || !h) return m;
    // Preserve the original desktop and phone face positions after removing the message meter.
    const phone = w < 640, left = phone ? 0 : 280, cx = (left + w) / 2, cy = h * (phone ? 0.62 : 0.5), rx = (w - left) * (phone ? 0.38 : 0.38), ry = h * (phone ? 0.25 : 0.36);
    m.set("A0", { x: cx, y: cy });
    owners.forEach(([name], i) => {
      const a = (i / owners.length) * Math.PI * 2 - Math.PI / 2 + 0.2;
      m.set(name, { x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry });
    });
    return m;
  }, [size, owners]);
  const node = (key: string, name: string, project: string, status: string, px: number, label: string, cls = "") => {
    const p = pos.get(key);
    if (!p) return null;
    return (
      <button key={key} type="button" className={`ab-const__node${cls}`} style={{ left: p.x, top: p.y }} data-testid="const-node" data-name={key} aria-label={label} onClick={() => onOpen(name)}>
        <AgentFace name={name} project={project} status={status as "working"} size={px} />
        <span className="ab-const__lbl">{label}</span>
      </button>
    );
  };
  return (
    <div ref={box} className="ab-const" data-testid="constellation">
      {node("A0", org.zero.name, org.zero.project, faceStatus(org.zero), 52, "AGENT ZERO", " is-zero")}
      {owners.map(([key, o]) => {
        const p = pos.get(key);
        const crew = crews.get(key) ?? [], shownCrew = crew.slice(0, 3), more = Math.max(crew.length, o.workers?.total ?? 0) - shownCrew.length;
        return (
          <span key={key}>
            {node(key, o.name, o.project, faceStatus(o), 30, key)}
            {p && shownCrew.length > 0 && (
              <span className={`ab-const__orbit${o.state === "working" ? " is-spin" : ""}`} style={{ left: p.x, top: p.y }}>
                {shownCrew.map((w, j) => {
                  const ang = (j / shownCrew.length) * Math.PI * 2;
                  return (
                    <span key={w.id} className="ab-const__worker" style={{ "--x": `${Math.cos(ang) * 32}px`, "--y": `${Math.sin(ang) * 32}px` } as CSSProperties} title={w.name} data-testid="const-worker">
                      <span>
                        <AgentFace name={w.name} project={w.project ?? o.project} status={w.status === "working" ? "working" : w.status === "done" ? "done" : "waiting"} size={16} />
                      </span>
                    </span>
                  );
                })}
              </span>
            )}
            {p && more > 0 && (
              <span className="ab-const__more" style={{ left: p.x + 22, top: p.y - 30 }}>
                +{more}
              </span>
            )}
          </span>
        );
      })}
    </div>
  );
}

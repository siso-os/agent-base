import { ChevronRight, Network } from "lucide-react";
import type { CSSProperties } from "react";
import type { HubOrg } from "../lib/hub-types";
import { AgentFace } from "../../../../packages/halo-face";

type CommandBarProps = {
  org: HubOrg;
  current: string;
  onSelect: (name: string) => void;
  onOpen: () => void;
};

export function CommandBar({ org, current, onSelect, onOpen }: CommandBarProps) {
  const zeroStatus = org.zero.spunUp ? org.zero.state === "working" ? "working" : org.zero.state === "done" ? "done" : "waiting" : "offline";
  return (
    <header className="hub-commandbar" aria-label="Agent command bar">
      <div className="hub-commandbar__identity">
        <span className="hub-commandbar__zero"><AgentFace name="Agent Zero" project={org.zero.project} status={zeroStatus} size={34} /></span>
        <span className="hub-commandbar__crumb">
          <span className="hub-commandbar__eyebrow">Chain of command</span>
          <span className="hub-commandbar__path"><b>Agent Zero</b><ChevronRight size={13} aria-hidden="true" /><b>{current.toUpperCase() === "STACK-OPT" ? "EFFICIENCY" : current}</b></span>
        </span>
      </div>
      <nav className="hub-commandbar__owners" aria-label="Top-level owners">
        {org.top.map((name) => {
          const owner = org.groups.flatMap((group) => group.projects.flatMap((project) => project.domains))
            .map((domain) => domain.owner).find((candidate) => candidate?.name === name);
          const selected = name === current;
          const state = owner?.state ?? "off";
          const faceStatus = !owner?.spunUp || state === "off" ? "offline" : state === "working" ? "working" : state === "done" ? "done" : "waiting";
          const label = name.toUpperCase() === "STACK-OPT" ? "EFFICIENCY" : name;
          return (
            <button
              className={`hub-commandbar__owner${selected ? " is-current" : ""}`}
              data-state={state}
              style={{ "--agent-accent": owner?.accent ?? "var(--color-brand)" } as CSSProperties}
              key={name}
              type="button"
              aria-current={selected ? "page" : undefined}
              onClick={() => onSelect(name)}
            >
              <span className="hub-commandbar__face"><AgentFace name={label} project={owner?.project} status={faceStatus} size={20} /></span>
              {label}
            </button>
          );
        })}
      </nav>
      <button className="hub-commandbar__org" type="button" onClick={onOpen}>
        <Network size={15} aria-hidden="true" /> Org chart
      </button>
    </header>
  );
}

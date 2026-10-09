import { ChevronDownIcon, ChevronRightIcon, GitCommitHorizontalIcon, MonitorIcon, SquareTerminalIcon, TargetIcon } from "lucide-react";
import { load, save } from "@siso/shell";
import { formatAge } from "@siso/side-nav";
import { useState } from "react";
import { useSharedState } from "../lib/poll";
import { HubPage, Widget, WidgetGrid } from "./page/HubPage";
import "./MiniLanes.css";

/**
 * mini-lanes (Shaan via A0, 3 Oct 14:20): the Codex lanes running on the Mac mini, as a "Mac mini" group under SISO Labs
 * in the side nav (name, Sol/Luna, the one-line goal, last commit age, running or stopped) and a page per lane (the goal,
 * its recent commits, the last ~40 lines of its tmux pane). Read from GET /api/mini/lanes (services/node/src/mini-lanes.ts),
 * which the node keeps 30 s; with the node's opt-in off it answers "not enabled" and the group is not drawn.
 * The pane is the mini's text: it is only ever rendered as text, never as HTML.
 */
export type MiniLane = {
  name: string;
  model: string | null;
  goal: string;
  lastCommitAt: number | null;
  running: boolean;
  session: string;
  source: "lanes" | "qa";
};
export type MiniCommit = { sha: string; subject: string; at: number | null };
type MiniList = { enabled: boolean; reachable: boolean; note: string | null; at: number; lanes: MiniLane[] };
type MiniOne = { enabled: boolean; reachable: boolean; note: string | null; at: number; lane: MiniLane | null; commits: MiniCommit[]; pane: string | null };

const POLL_MS = 30_000;
const LIST = "/api/mini/lanes";

/** The "Mac mini" group in SISO Labs. Nothing at all when the node's opt-in is off. */
export function MiniLanesGroup({ active, onLane }: { active?: string | null; onLane: (name: string) => void }) {
  const { data } = useSharedState<MiniList>(LIST, POLL_MS);
  const key = "ab.nav.folder.mini";
  const [open, setOpen] = useState(() => load(key, true));
  if (!data?.enabled) return null;
  const running = data.lanes.filter((l) => l.running).length;
  return (
    <div className="siso-folder ab-mini" data-folder="mini" data-testid="mini-lanes">
      <button
        type="button"
        className="siso-folder__row"
        aria-expanded={open}
        title={`The Codex lanes on the Mac mini: ${running} of ${data.lanes.length} running`}
        onClick={() => {
          setOpen(!open);
          save(key, !open);
        }}
      >
        {open ? <ChevronDownIcon className="siso-folder__caret" aria-hidden="true" /> : <ChevronRightIcon className="siso-folder__caret" aria-hidden="true" />}
        <MonitorIcon className="siso-folder__mark" aria-hidden="true" />
        <span className="siso-folder__name">Mac mini</span>
        <span className="siso-fold-sum" data-testid="mini-count">
          {data.reachable ? `${running}/${data.lanes.length}` : "?"}
        </span>
      </button>
      {open && (
        <div className="siso-kids">
          {!data.reachable && (
            <p className="ab-mini__note" role="status" data-testid="mini-note">
              {data.note ?? "mini unreachable"}
              {data.lanes.length ? "; showing the last lanes read" : ""}
            </p>
          )}
          {data.reachable && data.lanes.length === 0 && <p className="ab-mini__note">No lanes listed</p>}
          {data.lanes.map((l) => (
            <button
              key={l.name}
              type="button"
              className={`ab-mini__row${active === l.name ? " is-active" : ""}${l.running ? " is-running" : ""}`}
              data-testid="mini-lane"
              data-name={l.name}
              data-state={l.running ? "running" : "stopped"}
              title={`${l.name}${l.model ? ` · ${l.model}` : ""}${l.goal ? `\n${l.goal}` : ""}`}
              onClick={() => onLane(l.name)}
            >
              <span className="ab-mini__dot" aria-hidden="true" />
              <span className="ab-mini__name">{l.name}</span>
              {l.model && <span className="ab-mini__model" data-model={l.model}>{l.model}</span>}
              <span className="ab-mini__age" data-testid="mini-age" title={l.lastCommitAt ? `Last commit ${new Date(l.lastCommitAt).toLocaleString()}` : "No commit recorded"}>
                {l.lastCommitAt ? formatAge(l.lastCommitAt) : "—"}
              </span>
              <span className="ab-mini__state">{l.running ? "running" : "stopped"}</span>
              {l.goal && <span className="ab-mini__goal" data-testid="mini-goal">{l.goal}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** One lane's page: its goal, its recent commits and the last lines of its tmux pane (as text). */
export function MiniLanePage({ name, onBack }: { name: string; onBack: () => void }) {
  const { data, error } = useSharedState<MiniOne>(`${LIST}/${encodeURIComponent(name)}`, POLL_MS);
  const lane = data?.lane ?? null;
  const loading = !data && !error;
  const failed = error ?? (data && !data.enabled ? "Not enabled in this node" : null);
  return (
    <HubPage
      id="mini-lane"
      icon={MonitorIcon}
      kicker="Mac mini · Codex lane"
      title={name}
      blurb={lane?.goal || undefined}
      chips={[
        { label: "model", value: lane?.model ?? null },
        { label: data && !data.reachable ? "mini unreachable" : "state", value: lane ? (lane.running ? "running" : "stopped") : null, tone: lane?.running ? "ok" : "none" },
      ]}
      back={{ label: "Back", onClick: onBack }}
    >
      <WidgetGrid label="The lane">
        <Widget id="goal" size="L" icon={TargetIcon} title="Goal" sub={lane ? `from ${lane.source === "qa" ? "qa-lanes.tsv" : "lanes.tsv"}` : undefined} loading={loading} failed={failed} empty="No goal recorded">
          {lane?.goal ? <p className="ab-mini__text" data-testid="mini-page-goal">{lane.goal}</p> : null}
        </Widget>
        <Widget
          id="commits"
          size="S-wide"
          icon={GitCommitHorizontalIcon}
          title="Recent commits"
          stat={{ value: lane?.lastCommitAt ? formatAge(lane.lastCommitAt) : null, label: "last" }}
          loading={loading}
          failed={failed}
          empty="No commits recorded"
        >
          {data && data.commits.length > 0 ? (
            <ul className="ab-mini__commits" data-testid="mini-commits">
              {data.commits.map((c) => (
                <li key={c.sha}>
                  <code>{c.sha}</code> <span>{c.subject}</span>
                  {c.at && <small>{formatAge(c.at)}</small>}
                </li>
              ))}
            </ul>
          ) : null}
        </Widget>
        <Widget
          id="pane"
          size="XL"
          icon={SquareTerminalIcon}
          title="Pane"
          sub={lane ? `tmux ${lane.session}: the last 40 lines${data ? `, read ${formatAge(data.at) === "now" ? "just now" : `${formatAge(data.at)} ago`}` : ""}` : undefined}
          loading={loading}
          failed={failed ?? (data && !data.reachable ? "mini unreachable" : null)}
          empty={lane && !lane.running ? "The lane is stopped: no pane to read" : "Nothing in the pane"}
        >
          {/* Text only: React escapes it, so markup in the pane shows as the characters it is. */}
          {data?.pane ? <pre className="ab-mini__pane" data-testid="mini-pane">{data.pane}</pre> : null}
        </Widget>
      </WidgetGrid>
    </HubPage>
  );
}

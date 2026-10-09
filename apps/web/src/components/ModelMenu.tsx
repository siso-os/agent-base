import { ClaudeAccounts, accountName, useClaudeAccounts } from "./ClaudeAccounts";
import type { ClaudeAccounts as AccountSnapshot } from "../../../../services/node/src/claude-accounts";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AgentFace } from "../lib/face";
import { Check, UserRound } from "lucide-react";
import type { MoveStatus, MoveTarget } from "../../../../services/node/src/move";
import type { SwitchStatus } from "../../../../services/node/src/account-switch";
import { MOVE_OPTIONS } from "./MoveMenu";
import { ModelPicker, type ModelSelection } from "../../../../packages/siso-composer/src/ModelPicker";
import "./MoveMenu.css";
import "./ModelMenu.css";

const CLAUDE: MoveTarget[] = ["opus", "fable", "sonnet"];
const GROUPS = [
  { title: "Claude", ids: CLAUDE },
  { title: "Other harness", ids: MOVE_OPTIONS.map((o) => o.id).filter((id) => !CLAUDE.includes(id)) },
];

/** The models the switcher offers (SPEC-CHAT-HUD §1), with one line on what each is for. */
/** Speed, depth and cost on one 1-5 scale for every model, so moving between faces shows the trade (ui-hub VISION §6). */
const MODELS = [
  { id: "claude-opus-5-5[1m]", label: "Opus 5.5 · 1M", short: "Opus", why: "deep work, long sessions", speed: 2, depth: 5, cost: 5 },
  { id: "claude-sonnet-5-5", label: "Sonnet 5.5", short: "Sonnet", why: "fast, a fifth of the cost", speed: 4, depth: 4, cost: 2 },
  { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5", short: "Haiku", why: "quick reads and sweeps", speed: 5, depth: 2, cost: 1 },

];
export const modelLabel = (m: string) => m.startsWith("gpt-") ? m.replace(/^gpt-/, "GPT ") : m.replace(/^claude-(opus|sonnet|haiku)-(\d+)-(\d+)(?:-\d{8})?(\[1m\])?$/i, (_, family: string, major: string, minor: string, context: string) => `Claude ${family[0].toUpperCase()}${family.slice(1)} ${major}.${minor}${context ? " · 1M" : ""}`);
const normalizeModel = (name: string) => modelLabel(name).replace(/^Claude /, "").replace(/ · /g, " ").toLowerCase();
const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;

/**
 * Switch this agent's model at its next turn (R1.19's halo rim): the line typed into its chat (`/model <id>`,
 * `/effort <level>`), or host-acknowledged controls for hosted chats.
 */
export type ModelSwitch = { model: string | null; why: string | null; onSay: (text: string) => void; onModel?: (model: string) => void; harness?: string; effort?: string | null; models?: { id: string; label: string; description: string; efforts: string[] }[]; onEffort?: (effort: string) => void };

/** This chat's Claude login switch (t-0577), handed in by Hud: the node runs the by-hand switch script and confirms it. */
export type AccountSwitch = { status: SwitchStatus | null; blocked: string | null; onSwitch: (to: string) => void; refresh: () => void };
type UsageWindow = { pct: number; resetsAt: number | null } | null | undefined;
const pctOf = (w: UsageWindow) => w && typeof w.pct === "number" && Number.isFinite(w.pct) ? Math.round(w.pct) : null;
const hhmm = (at: number) => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
/** "5h 100% · resets 11:00 · week 62%", "usage unknown" when stale or not read; limited when either window is full. */
export function accountUsage(account: { fiveHour?: UsageWindow; week?: UsageWindow; usageStale?: boolean }) {
  const five = pctOf(account.fiveHour), week = pctOf(account.week);
  if (account.usageStale || (five === null && week === null)) return { text: "usage unknown", limited: false };
  const parts = [five !== null && `5h ${five}%${account.fiveHour?.resetsAt ? ` · resets ${hhmm(account.fiveHour.resetsAt)}` : ""}`, week !== null && `week ${week}%`].filter(Boolean);
  return { text: parts.join(" · "), limited: (five ?? 0) >= 100 || (week ?? 0) >= 100 };
}
const SWITCHING = ["queued", "waiting-idle", "moving", "confirming"];
const switchLine = (s: SwitchStatus) => { const stages = s.stages ?? []; return [...stages, ...(stages.at(-1) === s.message ? [] : [s.message])].join(" · "); };

/** The rows' group. The switch's reading (why not, last status) is fetched when the rows are shown, not on every open. */
function AccountRows({ refresh, children }: { refresh: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const details = ref.current?.closest("details");
    if (!details) { refresh(); return; }
    const shown = () => { if (details.open) refresh(); };
    shown();
    details.addEventListener("toggle", shown);
    return () => details.removeEventListener("toggle", shown);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return <div ref={ref} className="ab-hud__move ab-account-switch" role="group" aria-label="Claude account" data-testid="account-switch">{children}</div>;
}

/** Provider catalogs, command dispatch and harness moves belong to Agent Base; the package renders the picker. */
export function ModelMenu({ label, face, className = "ab-model", switcher, current, status, onMove, disabled, agentZero = false, accountId, accounts, account }: { label: string; face?: ReactNode; className?: string; switcher?: ModelSwitch; current?: MoveTarget; status?: MoveStatus | null; onMove?: (to: MoveTarget, effort?: string) => void; disabled?: string; agentZero?: boolean; accountId?: string | null; accounts?: AccountSnapshot; account?: AccountSwitch }) {
  const [open, setOpen] = useState(false);
  const { snapshot, failed } = useClaudeAccounts(open, accounts);
  const [pending, setPending] = useState<{ model?: string; effort?: string } | null>(null);
  const [expired, setExpired] = useState(false);
  useEffect(() => { if (pending && ((!pending.model || normalizeModel(pending.model) === normalizeModel(switcher?.model ?? "")) && (!pending.effort || pending.effort === switcher?.effort))) setPending(null); }, [switcher?.model, switcher?.effort, pending]);
  useEffect(() => { setExpired(false); if (!pending) return; const timer = window.setTimeout(() => setExpired(true), 15_000); return () => window.clearTimeout(timer); }, [pending]);
  const selectedMove = switcher?.harness === "codex" ? /sol/i.test(switcher.model ?? "") ? "sol" : /luna/i.test(switcher.model ?? "") ? "luna" : undefined : current;
  const busy = status?.state === "moving" || status?.state === "queued" || status?.state === "waiting-idle";
  const shut = !!disabled && (!switcher || !!switcher.why);
  const switching = !!account?.status && SWITCHING.includes(account.status.state);
  const claude = switcher?.harness === "claude";
  // t-0577 (Shaan, 9 Oct: "a button on the drop down so I can swap the accounts over the clawed accounts"): one row per
  // switchable login. It never calls the harness move; nothing here switches to Codex.
  const accountGroup = claude && account ? <AccountRows key="account" refresh={account.refresh}>
    <div className="move-menu__heading">Claude account</div>
    {!snapshot && <p className="ab-account-switch__why" role="status">{failed ? "Account readings unavailable." : "Reading accounts…"}</p>}
    {snapshot?.accounts.filter(a => !a.readOnly).map(a => {
      const on = a.id === accountId, usage = accountUsage(a);
      const why = on ? "This chat's account" : account.blocked ?? (switching ? "A switch is running" : undefined);
      return <button key={a.id} className="move-menu__option" role="menuitem" type="button" data-account={a.id} data-current={on || undefined} aria-label={`${a.name}${on ? " (this chat)" : ""}`} disabled={on || switching || !!account.blocked || busy} title={why}
        onClick={() => { if (agentZero && !window.confirm(`Move Agent Zero to the ${a.name} Claude login? Same conversation; it restarts in its pane`)) return; account.onSwitch(a.id); }}>
        <UserRound size={15} aria-hidden/><span className="move-menu__labels"><b>{a.name}{usage.limited && <em className="ab-account-switch__tag">limited</em>}</b><small>{usage.text}</small></span>{on && <Check size={14} aria-label="Current account"/>}
      </button>;
    })}
    {account.blocked && <p className="ab-account-switch__why">{account.blocked}</p>}
  </AccountRows> : null;
  let selection: ModelSelection | undefined;
  if (switcher) {
    const codex = switcher.harness === "codex";
    // t-0570 (Shaan, 9 Oct: "the model selector is broken"): a hosted Claude chat whose host reported an empty catalog showed
    // no models at all, only "Waiting for the host's model catalog". Claude's own list stands in until the host sends one;
    // the host still acknowledges the switch.
    const catalog = switcher.models?.length ? switcher.models : null;
    const list = catalog ? catalog.map(model => ({ ...model, label: modelLabel(model.id), short: modelLabel(model.id), why: model.description, speed: 0, depth: 0, cost: 0 })) : switcher.harness === "claude" ? MODELS : [];
    const selected = list.find(model => model.id === switcher.model || (!!switcher.model && normalizeModel(model.id) === normalizeModel(switcher.model)));
    const efforts = catalog ? catalog.find(model => model.id === selected?.id)?.efforts ?? [] : switcher.harness === "claude" ? EFFORTS : [];
    selection = {
      model: switcher.model, selectedId: selected?.id, effort: switcher.effort, disabledReason: switcher.why, wrap: !!catalog || codex,
      options: list.map(model => ({ id: model.id, label: model.label, description: model.why, identity: <AgentFace name={model.id} project={model.id} family={codex ? "codex" : "claude"} status="waiting" size={34}/>, ...(!codex && !catalog ? { ratings: [{label:"speed",value:model.speed},{label:"depth",value:model.depth},{label:"cost",value:model.cost}] } : {}) })),
      efforts: efforts.map(id => ({ id, label: id === "medium" ? "med" : id === "xhigh" ? "x-high" : id })),
      onSelect: id => {
        const model = list.find(candidate => candidate.id === id);
        if (!model || switcher.why || busy) return false;
        if (agentZero && onMove && !switcher.onModel) {
          const to = model.short.toLowerCase() as MoveTarget;
          const option = MOVE_OPTIONS.find(option => option.id === to);
          if (option) {
            if (!window.confirm(`Move Agent Zero to ${option.label}? It reads its handover first; this chat stays on disk`)) return false;
            onMove(to, switcher.effort ?? "high"); return;
          }
        }
        setPending({ model: id });
        if (switcher.onModel) switcher.onModel(id); else switcher.onSay(`/model ${id}`);
      },
      onEffort: effort => { if (switcher.why || busy) return; setPending({ effort }); if (switcher.onEffort) switcher.onEffort(effort); else switcher.onSay(`/effort ${effort}`); },
    };
  }
  return <ModelPicker label={label} compactLabel={label.replace(/^Claude /, "").replace(/ ·? ?1M/, "")} identity={face} className={className} selection={selection} busy={busy || (!!pending && !expired)} disabled={false}
    accountLabel={switcher?.harness === "claude" ? accountName(accountId) : undefined} accountDetails={switcher?.harness === "claude" || !switcher ? <><ClaudeAccounts compact snapshot={snapshot} currentId={accountId} failed={failed}/>{accountGroup}</> : undefined} onOpenChange={setOpen}
    title={switcher?.why ? `${label} · ${switcher.why}` : shut ? disabled : `${label} · switch model or harness`}
    status={status?.message ?? (switching ? account!.status!.message : undefined) ?? (pending ? expired ? "not confirmed" : "pending" : undefined)} confirmationLabel="Model updated by host" menuClassName={switcher ? "ab-hud__menu" : "move-menu__panel is-portal"}
    emptyLabel="Waiting for the host’s model catalog. Reconnect after its next restart."
    note={pending ? expired ? "The host has not confirmed this change. The observed model and effort are unchanged; you can retry." : "Waiting for the host to confirm the requested change…" : switcher?.why ? `${switcher.why}; it can't be switched from here.` : switcher?.onModel ? "Current model changes only after the host acknowledges it." : "Switches at this agent's next turn."}
    renderActions={current && onMove ? close => GROUPS.map(group => <div key={group.title} className={switcher ? "ab-hud__move" : undefined} role="group" aria-label={group.title}>
      <div className="move-menu__heading">{switcher && group.title === "Claude" ? "Move to… Claude" : group.title}</div>
      {group.ids.map(id => { const option = MOVE_OPTIONS.find(option => option.id === id)!; return <button key={id} className="move-menu__option" role="menuitem" type="button" disabled={id === selectedMove || busy || switching || !!disabled} title={disabled} onClick={() => { if (agentZero && !window.confirm(`Move Agent Zero to ${option.label}? It reads its handover first; this chat stays on disk`)) return; close(); onMove(id, switcher?.effort ?? (agentZero ? "high" : "medium")); }}><option.icon size={15} aria-hidden/><span className="move-menu__labels"><b>{option.label}</b><small>{option.detail}</small></span>{id === selectedMove && <Check size={14} aria-label="Current model"/>}</button>; })}
    </div>) : undefined}
    footer={(status || account?.status) && <>
      {status && <p className="ab-hud__note" role="status">{status.stages?.length ? status.stages.join(" · ") + (status.state === "failed" ? ` · ${status.message}` : "") : status.message}</p>}
      {account?.status && <p className={`ab-hud__note ab-account-switch__status is-${account.status.state}`} role="status" data-testid="account-switch-status" data-state={account.status.state}>{switchLine(account.status)}</p>}
    </>}
  />;
}

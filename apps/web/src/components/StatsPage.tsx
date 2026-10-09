import { type Stats, compact } from "../lib/agents";
import { Bars } from "./StatsBars";
export { Bars } from "./StatsBars";

const ago = (iso: string | null) => {
  if (!iso) return "";
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  return m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
};

/** Output tokens per hour, the last 48 hours the chat was active: when it did its work. */
function Hours({ hours }: { hours: Stats["hours"] }) {
  if (hours.length === 0) return <p className="text-[12px] text-muted-foreground">No output yet.</p>;
  const peak = Math.max(...hours.map((h) => h.output), 1);
  const w = 100 / hours.length;
  const label = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  return (
    <div>
      <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="h-24 w-full" role="img" aria-label="Output tokens per hour">
        {hours.map((h, i) => {
          const bh = (38 * h.output) / peak;
          return (
            <rect key={h.hour} x={i * w + w * 0.15} y={40 - bh} width={w * 0.7} height={bh} rx={0.6} fill="rgb(56 189 248 / 0.75)">
              <title>{`${label(h.hour)} · ${compact(h.output)} output tokens`}</title>
            </rect>
          );
        })}
      </svg>
      <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
        <span>{label(hours[0].hour)}</span>
        <span>output tokens per hour · peak {compact(peak)}</span>
        <span>{label(hours.at(-1)!.hour)}</span>
      </div>
    </div>
  );
}

function Kpi({ k, v, note }: { k: string; v: string; note?: string }) {
  return (
    <div className="rounded-[10px] border border-white/[0.07] bg-white/[0.025] px-3 py-2.5">
      <div className="text-[11px] text-muted-foreground">{k}</div>
      <div className="mt-0.5 text-[19px] font-semibold tabular-nums text-foreground">{v}</div>
      {note && <div className="text-[11px] text-muted-foreground">{note}</div>}
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-5">
      <h3 className="mb-2 text-[12.5px] font-medium text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

/**
 * The chat's Stats page (opens beside the chat from the summary card): what it has used and done, read from its own
 * Claude session file. Main chat only: sub-agents it started write their own files and are listed, not summed.
 */
export function StatsPage({ stats }: { stats: Stats | null }) {
  if (!stats) return <div className="p-5 text-sm text-muted-foreground">Reading the session file…</div>;
  if (stats.error) return <div className="p-5 text-sm text-muted-foreground">{stats.error}.</div>;
  const t = stats.tokens;
  const skills = Object.entries(stats.skills);
  return (
    <div className="h-full overflow-y-auto px-5 pb-8 pt-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Kpi k="Tokens" v={compact(t.total)} note={`${compact(t.input + t.cacheWrite)} fresh in`} />
        <Kpi k="Cache read" v={compact(t.cacheRead)} note={t.cachePct !== null ? `${t.cachePct}% of input` : undefined} />
        <Kpi k="Output" v={compact(t.output)} />
        <Kpi k="Cost" v={stats.costUsd !== null ? `$${stats.costUsd.toFixed(2)}` : "—"} note="Claude's own figure" />
        <Kpi k="Tool calls" v={String(stats.toolCalls)} note={`${stats.apiCalls} model turns`} />
        <Kpi k="Prompts" v={String(stats.prompts)} note={stats.first ? `since ${ago(stats.first)}` : undefined} />
      </div>
      <Block title="When it worked">
        <Hours hours={stats.hours} />
      </Block>
      <Block title="Tools">
        <Bars rows={Object.entries(stats.tools)} />
      </Block>
      <Block title={`Skills · ${skills.reduce((n, [, v]) => n + v, 0)}`}>{skills.length ? <Bars rows={skills} /> : <p className="text-[12px] text-muted-foreground">None used in this chat.</p>}</Block>
      <Block title={`Sub-agents started by this chat · ${stats.subagents.count}`}>
        {stats.subagents.recent.length ? (
          <ul className="flex flex-col gap-1 text-[12px]">
            {stats.subagents.recent.map((s, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-muted-foreground">{ago(s.at)}</span>
                <span className="truncate text-foreground">{s.what || s.type}</span>
                <span className="ml-auto flex-none text-muted-foreground">{s.type}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[12px] text-muted-foreground">None.</p>
        )}
      </Block>
      <Block title="Models">
        <Bars rows={Object.entries(stats.models)} />
      </Block>
      <p className="mt-6 text-[11px] text-muted-foreground">From the chat's own session file, refreshed every 10 s. Main chat only; sub-agents keep their own files.</p>
    </div>
  );
}

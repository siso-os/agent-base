/**
 * Voice stats, lifted from SISO Internal's VoiceStatsPage: the share-card ticket (total words, time saved, level bar,
 * wpm, top app, streak), then words per day, hour rhythm, the app bars and the activity wall. Every number comes from
 * the live store through /api/voice/stats and /api/voice/activity (ShareCardStats parity math in the node).
 */
import { cn } from "@siso/shell";
import { ActivityWall, AppBreakdownChart, HourRhythmChart, WordsTrendChart } from "./charts";
import { useVoiceActivity, useVoiceStats, type VoiceSource } from "./api";
import { dayKey, formatGrouped, formatSavedMinutes } from "./format";

/** A small stat: a label over a number. */
export function StatPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
      <div className="mt-1.5 truncate text-[16px] font-semibold tracking-[-0.01em] text-foreground tabular-nums">{value}</div>
    </div>
  );
}

export function VoiceStats({ source, className }: { source?: VoiceSource; className?: string }) {
  const { data: stats, error } = useVoiceStats(source);
  const activity = useVoiceActivity(366, source);
  const levelPct = stats ? Math.min(100, Math.round((stats.level.xpInLevel / stats.level.xpForNext) * 100)) : 0;
  const dash = "—";

  return (
    <div className={cn("flex flex-col gap-4", className)} data-voice="stats">
      {error && <p className="text-[13px] text-muted-foreground">Voice is not answering: {error}</p>}

      <article className="relative w-full overflow-hidden rounded-[var(--crm-radius-card)] border border-dashed border-working/40 bg-raised p-6">
        <header className="flex flex-wrap items-center gap-3">
          <span className="rounded-md border border-border px-2 py-0.5 font-mono text-3xs tabular-nums text-muted-foreground">{dayKey(new Date())}</span>
          <span className="rounded-[var(--crm-radius-pill)] border border-working/35 bg-working/[0.1] px-2.5 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.16em] text-working">Voice</span>
        </header>

        <div className="mt-3 grid grid-cols-1 gap-6 md:grid-cols-[1fr_auto]">
          <div>
            <div className="font-mono text-3xs uppercase tracking-[0.18em] text-muted-foreground">Total words</div>
            <div className="mt-1 text-[clamp(2.75rem,6vw,4.25rem)] font-semibold leading-none tracking-[-0.04em] text-foreground tabular-nums">
              {stats ? formatGrouped(stats.totalWords) : dash}
            </div>
            <p className="mt-2 text-[13px] text-secondary-label">
              {stats ? (
                <>
                  Voice has saved you <strong className="text-foreground">{formatSavedMinutes(stats.timeSavedMinutes)}</strong> over typing at 40&nbsp;wpm.
                </>
              ) : (
                "Reading the record…"
              )}
            </p>
          </div>
          <div className="hidden min-w-[170px] flex-col justify-center gap-3 border-l border-border pl-6 md:flex">
            <StatPill label="Dictations" value={stats ? formatGrouped(stats.entries) : dash} />
            <StatPill label="Avg words / entry" value={stats && stats.entries > 0 ? String(Math.round(stats.totalWords / stats.entries)) : dash} />
          </div>
        </div>

        <div className="mt-5">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[13px] font-medium text-foreground">{stats ? `Level ${stats.level.level}: ${stats.level.title}` : `Level ${dash}`}</span>
            <span className="font-mono text-[10.5px] tabular-nums text-muted-foreground">
              {stats ? `${formatGrouped(stats.level.wordsToNext)} words to Lv.${stats.level.level + 1}${stats.wordsToday > 0 ? ` (+${formatGrouped(stats.wordsToday)} today)` : ""}` : ""}
            </span>
          </div>
          <div className="mt-2 h-[10px] overflow-hidden rounded-full bg-foreground/[0.06]" role="progressbar" aria-valuenow={levelPct} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full rounded-full bg-working transition-[width] duration-300" style={{ width: `${levelPct}%` }} />
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-4 border-t border-border pt-4 sm:grid-cols-4">
          <StatPill label="WPM" value={stats?.wpm != null ? String(stats.wpm) : dash} />
          <StatPill label="Top app" value={stats?.topApp ?? dash} />
          <StatPill label="Streak" value={stats ? (stats.streakDays === 1 ? "1 day" : `${stats.streakDays} days`) : dash} />
          <StatPill label="Today" value={stats ? `${formatGrouped(stats.wordsToday)} words` : dash} />
        </div>
      </article>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <WordsTrendChart words={activity.data?.words ?? {}} days={30} />
        <HourRhythmChart hours={activity.data?.hours ?? new Array<number>(24).fill(0)} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <AppBreakdownChart apps={activity.data?.apps ?? []} />
        <ActivityWall days={activity.data?.days ?? {}} target={150} />
      </div>
    </div>
  );
}

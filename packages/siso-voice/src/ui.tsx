/** Small pieces the Voice pages share, in the SISO tokens: a card, a switch, a select, input and button looks. */
import { cn } from "@siso/shell";
import type { ReactNode } from "react";

export function Card({ title, sub, right, children, className }: { title: string; sub?: string; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-[var(--crm-radius-card)] border border-border bg-raised p-4", className)}>
      <header className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="m-0 text-[13px] font-semibold text-foreground">{title}</h2>
          {sub && <p className="m-0 mt-0.5 text-[12px] text-muted-foreground">{sub}</p>}
        </div>
        {right}
      </header>
      {children}
    </section>
  );
}

export function Count({ n }: { n: number | null | undefined }) {
  return <span className="rounded-[var(--crm-radius-pill)] border border-border px-2 py-0.5 font-mono text-3xs tabular-nums text-muted-foreground">{n ?? "—"}</span>;
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (next: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-[20px] w-[34px] flex-none items-center rounded-full border transition-colors disabled:opacity-40",
        checked ? "border-working/50 bg-working/70" : "border-border bg-foreground/[0.08]",
      )}
    >
      <span className={cn("absolute h-[14px] w-[14px] rounded-full bg-foreground shadow transition-transform", checked ? "translate-x-[16px]" : "translate-x-[2px]")} />
    </button>
  );
}

export function Select({ value, options, onChange, label, disabled }: { value: string; options: Array<{ value: string; label: string }>; onChange: (v: string) => void; label: string; disabled?: boolean }) {
  return (
    <select
      value={value}
      aria-label={label}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className="h-8 rounded-[var(--crm-radius-control)] border border-border bg-page px-2.5 text-[12.5px] text-foreground focus:border-working/40 focus:outline-none disabled:opacity-40"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** A settings line: label and hint on the left, the control on the right. */
export function SettingRow({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="text-[13px] text-foreground">{label}</div>
        {hint && <div className="mt-0.5 text-[11.5px] text-muted-foreground">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

export const inputClass =
  "min-w-0 flex-1 rounded-[var(--crm-radius-control)] border border-border bg-page px-3 py-2 text-[13px] text-foreground select-text placeholder:text-muted-foreground focus:border-working/40 focus:outline-none";

export const primaryButton =
  "inline-flex flex-none items-center gap-1.5 rounded-[var(--crm-radius-pill)] border border-working/40 bg-working/[0.12] px-3.5 py-2 text-[12px] font-medium text-working transition-colors hover:bg-working/[0.2] disabled:cursor-not-allowed disabled:opacity-40";

export const quietButton =
  "inline-flex flex-none items-center gap-1.5 rounded-[var(--crm-radius-pill)] border border-border px-3.5 py-2 text-[12px] text-secondary-label transition-colors hover:bg-sidebar-row-hover hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40";

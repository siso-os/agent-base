import type { LucideIcon } from "lucide-react";

export type LayoutOption<T extends string> = { id: T; label: string; Icon: LucideIcon };

/** A few small icons that step a layout (Codex's ⌘⇧B cycle: ▭ ◫ ⤢). `next` gives the key handler the same order. */
export function LayoutSwitch<T extends string>({ options, value, onChange, hint }: { options: LayoutOption<T>[]; value: T; onChange: (v: T) => void; hint?: string }) {
  return (
    <div className="siso-segment" role="group" aria-label="Layout">
      {options.map((o) => (
        <button key={o.id} type="button" aria-label={o.label} title={hint ? `${o.label} · ${hint}` : o.label} aria-pressed={value === o.id} onClick={() => onChange(o.id)}>
          <o.Icon />
        </button>
      ))}
    </div>
  );
}
export const nextLayout = <T extends string>(options: LayoutOption<T>[], v: T): T => options[(options.findIndex((o) => o.id === v) + 1) % options.length].id;

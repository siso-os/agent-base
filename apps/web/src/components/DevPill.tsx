export function DevPill() {
  return import.meta.env.DEV ? (
    <span className="rounded border border-needs/30 px-1.5 py-0.5 text-[9px] font-semibold tracking-wide text-needs">DEV</span>
  ) : null;
}

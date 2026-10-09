import { cn } from "@siso/shell";
import { LivingIcon, WorkspaceMark, LIVING_ICONS, type LivingIconName, type WorkspaceBrand } from "../../../../packages/halo-face/living-assets";

/** Use the approved identity where one exists, with a stable initial for other projects. */
export function ProjectMark({ project, className }: { project: string; className?: string }) {
  const key = project.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const brand: WorkspaceBrand | undefined = key === "agent-base" || key === "agentbase" ? "agent-base" : key === "siso-agency" ? "siso-agency" : key === "halo" || key.startsWith("halo-") ? "halo" : undefined;
  const aliases: Record<string, LivingIconName> = { "great-library-of-siso": "library", "siso-estate": "estate", "browser": "web", "life": "lifelog", "maths": "maths-innovations", "creator-management": "ofm", "car-rentals": "car-rental", "restaurant": "restaurants", "tour-guide": "tour-guides" };
  const icon = aliases[key] ?? (Object.hasOwn(LIVING_ICONS, key) ? key as LivingIconName : undefined);
  if (brand || icon) return <span aria-hidden className={cn("ab-project-mark inline-flex size-4 shrink-0 items-center justify-center", className)}>{brand ? <WorkspaceMark brand={brand} size={20}/> : <LivingIcon name={icon!} size={20} variant="glyph"/>}</span>;
  let h = 0;
  for (const c of project) h = (h * 31 + c.charCodeAt(0)) % 360;
  return (
    <span
      aria-hidden
      className={cn("inline-flex size-4 shrink-0 items-center justify-center rounded-[4px] text-3xs font-semibold text-black/80", className)}
      style={{ background: `hsl(${h} 55% 62%)` }}
    >
      {(project.replace(/^[^A-Za-z0-9]+/, "")[0] ?? "·").toUpperCase()}
    </span>
  );
}

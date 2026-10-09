import { BoxIcon, LaptopMinimalCheckIcon, ServerIcon } from "lucide-react";
import "./MachineGlyph.css";

/**
 * R1.4 (Shaan: "a small Mac mini icon next to any agent running on the mini"): which machine an agent runs on, by its
 * estate key (SISO_Agents/siso-estate/plan/machines.json). The Mac mini is a box, the laptop a laptop, a VPS a server;
 * 12 px, muted, the machine's name on hover. An unknown machine shows nothing.
 */
export const machineKind = (key: string | null | undefined) =>
  !key ? null : /mini/i.test(key) ? "mini" : /laptop|macbook/i.test(key) ? "laptop" : /vps|contabo|hetzner|server/i.test(key) ? "vps" : null;

const ICON = { mini: BoxIcon, laptop: LaptopMinimalCheckIcon, vps: ServerIcon } as const;
const WORD = { mini: "the Mac mini", laptop: "the laptop", vps: "a VPS" } as const;

export function MachineGlyph({ machineKey, name, size = 12 }: { machineKey: string | null | undefined; name?: string; size?: number }) {
  const kind = machineKind(machineKey);
  if (!kind) return null;
  const Icon = ICON[kind];
  const label = `Runs on ${kind === "vps" && name ? name : WORD[kind]}`;
  return (
    <span className="ab-machine" data-testid="machine-glyph" data-machine={kind} title={label} aria-label={label} role="img">
      <Icon size={size} aria-hidden="true" />
    </span>
  );
}

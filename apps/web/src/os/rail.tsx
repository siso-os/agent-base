import { ReactNode } from "react";
import type { SpaceId } from "@siso/os";
import { LivingIcon, WorkspaceMark } from "../../../../packages/halo-face/living-assets";
import { CodeXmlIcon, FactoryIcon, type LucideIcon } from "lucide-react";
import type { AppSpace } from "../App";
import { registry } from "./registry";

/** Space marks on the rail head: Agent Base and Agency use WorkspaceMark, App Factory uses an icon. */
export const SPACE_MARK: Record<SpaceId, (size: number) => ReactNode> = {
  "agent-base": (size) => <WorkspaceMark brand="agent-base" size={size} />,
  "app-factory": (size) => <LivingIcon name="app-factory" size={size} variant="rail" />,
  "agency": (size) => <WorkspaceMark brand="siso-agency" size={size} className="ab-rail-mark" />,
};

/** Rail icons by a manifest's `icon` name, for modules the shell draws generically (URL modules). */
export const MODULE_ICON: Record<string, LucideIcon> = { "app-factory": FactoryIcon, "siso-code": CodeXmlIcon };

/**
 * Map an app space to its SISO OS space, or null if it doesn't move the rail
 * (library, questions, life stay at the foot and don't change railSpace).
 */
export function osSpaceOf(space: AppSpace): SpaceId | null {
  switch (space) {
    case "agents":
    case "pinboard":
    case "voice":
    case "web":
    case "estate":
    case "servers":
    case "tokens":
    case "agents-hub":
      return "agent-base";
    case "rolodex":
    case "whatsapp":
      return "agency";
    case "library":
    case "questions":
    case "life":
      return null;
    default:
      // A module the shell doesn't name (a URL module like App Factory) moves the rail to its manifest's space.
      { const home = registry.byId(space)?.space; return home && home !== "os" ? home : null; }
  }
}

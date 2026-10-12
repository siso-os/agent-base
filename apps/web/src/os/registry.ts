import { createBus, defineRegistry, manifestsFrom, type Space } from "@siso/os";

/** The three spaces on the rail (siso-os.md §1, §5): Agent Base teal, App Factory blue, Agency SISO orange. */
export const SPACES: Space[] = [
  { id: "agent-base", name: "Agent Base", icon: "agent-base", colour: "#22d3ee", order: 0 },
  { id: "app-factory", name: "App Factory", icon: "app-factory", colour: "#3b82f6", order: 1 },
  { id: "agency", name: "Agency", icon: "agency", colour: "#FFA726", order: 2 },
];

/** Every module is one manifest file in modules/<id>/; adding a module is adding that file, nothing else. */
export const registry = defineRegistry(SPACES, manifestsFrom(import.meta.glob("../modules/*/manifest.ts", { eager: true })));
export const bus = createBus();

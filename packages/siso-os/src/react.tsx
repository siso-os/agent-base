import { createContext, useContext, useEffect, type ReactNode } from "react";
import type { Registry } from "./registry";
import type { Bus, OsEvent } from "./bus";
import type { Module, Space, SpaceId } from "./types";

const Ctx = createContext<{ registry: Registry; bus: Bus } | null>(null);

export function OsProvider({ registry, bus, children }: { registry: Registry; bus: Bus; children: ReactNode }) {
  return <Ctx.Provider value={{ registry, bus }}>{children}</Ctx.Provider>;
}

function useOs() {
  const v = useContext(Ctx);
  if (!v) throw new Error("SISO OS hooks need an <OsProvider> above them");
  return v;
}

export const useRegistry = (): Registry => useOs().registry;
export const useSpaces = (): Space[] => useOs().registry.spaces;
export const useModules = (space?: SpaceId): Module[] => { const r = useOs().registry; return space ? r.modulesOf(space) : r.modules; };
export const useBus = (): Bus => useOs().bus;

/** Listen to the bus while mounted. */
export function useOsEvent(fn: (e: OsEvent) => void) {
  const bus = useOs().bus;
  useEffect(() => bus.on(fn), [bus, fn]);
}

import type { Module, Space, SpaceId } from "./types";

export type Registry = {
  spaces: Space[];
  modules: Module[];
  /** A space's modules on the rail, in order (hidden ones left out). */
  modulesOf: (space: SpaceId) => Module[];
  /** What every space uses: the foot of the rail (the Library, Questions). */
  bottom: Module[];
  /** Opened from the avatar (Life). */
  avatar: Module[];
  byId: (id: string) => Module | undefined;
  spaceOf: (moduleId: string) => Space | undefined;
};

const byOrder = <T extends { order: number; id: string }>(a: T, b: T) => a.order - b.order || a.id.localeCompare(b.id);

/** Check and index the manifests. Throws on a duplicate id or a module whose space doesn't exist, so a bad manifest fails the build's tests, not the window. */
export function defineRegistry(spaces: Space[], modules: Module[]): Registry {
  const seen = new Set<string>();
  for (const s of spaces) { if (seen.has(`space:${s.id}`)) throw new Error(`Two spaces are called ${s.id}`); seen.add(`space:${s.id}`); }
  for (const m of modules) {
    if (seen.has(m.id)) throw new Error(`Two modules are called ${m.id}`);
    seen.add(m.id);
    if (m.space !== "os" && !spaces.some((s) => s.id === m.space)) throw new Error(`${m.id} names a space that doesn't exist: ${m.space}`);
    if (m.entry.kind === "url" && !/^https?:\/\//.test(m.entry.url)) throw new Error(`${m.id}'s URL isn't http(s): ${m.entry.url}`);
  }
  const sortedSpaces = [...spaces].sort(byOrder);
  const sorted = [...modules].sort(byOrder);
  const shown = sorted.filter((m) => !m.hidden);
  const index = new Map(sorted.map((m) => [m.id, m]));
  return {
    spaces: sortedSpaces,
    modules: sorted,
    modulesOf: (space) => shown.filter((m) => m.space === space && !m.dock),
    bottom: shown.filter((m) => m.space === "os" && !m.dock),
    avatar: shown.filter((m) => m.dock === "avatar"),
    byId: (id) => index.get(id),
    spaceOf: (id) => { const m = index.get(id); return m && m.space !== "os" ? sortedSpaces.find((s) => s.id === m.space) : undefined; },
  };
}

/** Manifests found by the bundler (e.g. Vite's import.meta.glob of modules/*\/manifest.ts, eager): each file's default export. */
export function manifestsFrom(files: Record<string, unknown>): Module[] {
  return Object.entries(files).map(([file, mod]) => {
    const m = (mod as { default?: Module }).default;
    if (!m || typeof m.id !== "string") throw new Error(`${file} has no default-exported module manifest`);
    return m;
  });
}

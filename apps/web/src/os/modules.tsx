import { Suspense, lazy, useEffect, useSyncExternalStore } from "react";
import { every } from "../lib/poll";
import { registry as os } from "./registry";
import { Boundary } from "../components/Boundary";

/**
 * OS module loader and swap system: load modules dynamically, swap them in place without reloading.
 * (spec §2a steps 1-2; proof test module-swap-ui).
 */

// Dynamic loaders for all modules
const moduleLoaders = import.meta.glob("../modules/*/index.tsx") as Record<
  string,
  () => Promise<{ default: React.ComponentType<any> }>
>;

interface ModuleInfo {
  Component?: React.ComponentType<any>;
  rev: number;
  name?: string;
}

interface OSModulesManifest {
  shell: string;
  files?: string[];
  modules: Record<string, { file: string; imports: string[]; hash: string }>;
}

// Store: modules by id with their current revision
const registry = new Map<string, ModuleInfo>();
let subscribers = new Set<() => void>();
let manifestData: OSModulesManifest | null = null;

/**
 * Boot modules: fetch os-modules.json and initialize the registry with component loaders.
 * Called once in main.tsx.
 */
for (const path of Object.keys(moduleLoaders)) {
  const id = path.match(/\/modules\/([^/]+)\/index\.tsx$/)?.[1];
  if (id) registry.set(id, { Component: lazy(moduleLoaders[path]), rev: 0, name: id });
}

/** A module with its own folder (modules/<id>/index.tsx) that ModuleView can draw. */
export const hasModuleView = (id: string) => registry.has(id);

export async function bootModules() {
  try {
    const res = await fetch("/os-modules.json", { cache: "no-store" });
    if (!res.ok) return; // Dev mode: no manifest
    manifestData = await res.json();
  } catch {
    // Ignore failures in dev
  }

  notifySubscribers();
}

/**
 * Try to swap modules in place. Returns the list of swapped module ids, or null if swap failed.
 * Checks: shell hash unchanged, all module imports valid, then re-imports changed modules.
 */
let inflight: Promise<string[] | null> | null = null;
/** null: can't swap (the shell changed): reload. []: already current. ids: swapped in place. One swap at a time. */
export function trySwap(): Promise<string[] | null> {
  inflight ??= swap().finally(() => { inflight = null; });
  return inflight;
}

async function swap(): Promise<string[] | null> {
  try {
    const res = await fetch("/os-modules.json", { cache: "no-store" });
    if (!res.ok) return null;
    const newManifest: OSModulesManifest = await res.json();

    // Check shell integrity
    if (!manifestData || newManifest.shell !== manifestData.shell) {
      return null; // Shell changed, fall back to reload
    }

    // Find changed modules
    const changed: string[] = [];
    const oldModules = manifestData.modules || {};
    const newModules = newManifest.modules || {};

    for (const [id, newModule] of Object.entries(newModules)) {
      const oldModule = oldModules[id];
      if (!oldModule || oldModule.hash !== newModule.hash) {
        changed.push(id);
      }
    }

    // Validate imports: every changed module's imports must be in old manifest or be a changed module
    if (!changed.length) return [];
    const oldFiles = new Set(manifestData.files ?? []);
    const changedFiles = new Set(changed.map(id => newModules[id].file));
    for (const id of changed) {
      const newModule = newModules[id];
      for (const imp of newModule.imports || []) {
        if (!oldFiles.has(imp) && !changedFiles.has(imp)) {
          return null; // Invalid import
        }
      }
    }

    // Reload changed modules
    for (const id of changed) {
      const newModule = newModules[id];
      try {
        const module = await import(/* @vite-ignore */ "/" + newModule.file);
        const Component = lazy(() => Promise.resolve({ default: module.default }));
        const info = registry.get(id) || { rev: 0, name: id };
        registry.set(id, { ...info, Component, rev: info.rev + 1 });
      } catch {
        return null; // Failed to load new module
      }
    }

    manifestData = newManifest;
    notifySubscribers();
    return changed;
  } catch {
    return null;
  }
}

// useSyncExternalStore needs the same snapshot until something changes, or React re-renders forever.
let snapshot = { registry: new Map(registry) };
function notifySubscribers() {
  snapshot = { registry: new Map(registry) };
  subscribers.forEach(cb => cb());
}

// Store subscription for useSyncExternalStore
export const modulesStore = {
  subscribe(cb: () => void) {
    subscribers.add(cb);
    return () => subscribers.delete(cb);
  },
  getSnapshot() {
    return snapshot;
  },
};

/**
 * ModuleView: render a module with crash boundary and Suspense.
 * Keyed by id:rev so swaps remount and Suspense resets.
 */
export function ModuleView({
  id,
  ...props
}: { id: string; [key: string]: any }) {
  const { registry: reg } = useSyncExternalStore(modulesStore.subscribe, modulesStore.getSnapshot);
  const info = reg.get(id);

  if (!info || !info.Component) {
    return (
      <Boundary name={id} kind="space" resetKey={`${id}:unknown`}>
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          Module {id} not found
        </div>
      </Boundary>
    );
  }

  const C = info.Component;
  const key = `${id}:${info.rev}`;

  return (
    <Boundary name={os.byId(id)?.name ?? id} resetKey={key}>
      <Suspense fallback={null}>
        {C ? <C key={key} {...props} /> : null}
      </Suspense>
    </Boundary>
  );
}

/** Watches for a new build on every screen (the version pill isn't always drawn) and swaps changed modules in. */
export function useModuleSwaps() {
  useEffect(() => {
    let seen = "";
    const check = async () => {
      try {
        const v = await (await fetch("/api/version", { cache: "no-store" })).json() as { web?: string; sha?: string };
        const now = `${v.web}:${v.sha}`;
        if (seen && now !== seen) await trySwap();
        seen = now;
      } catch { /* the node is restarting; next time */ }
    };
    const stop = every(() => void check(), 30_000);
    window.addEventListener("focus", check);
    return () => { stop(); window.removeEventListener("focus", check); };
  }, []);
}

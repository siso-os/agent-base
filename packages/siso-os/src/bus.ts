/**
 * How modules talk (siso-os.md §2): never by importing each other, only through the OS. A module asks the shell to open a
 * tab, run a command or raise "needs you"; the shell (or another module) listens.
 */
export type OsEvent =
  | { kind: "open-tab"; module: string; page?: string; target?: string }
  | { kind: "command"; id: string; args?: unknown }
  | { kind: "attention"; module: string; id: string; title: string; on: boolean };

type Listener = (e: OsEvent) => void;

export function createBus() {
  const listeners = new Set<Listener>();
  const emit = (e: OsEvent) => { for (const l of [...listeners]) l(e); };
  return {
    emit,
    on(fn: Listener) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    openTab: (module: string, page?: string, target?: string) => emit({ kind: "open-tab", module, page, target }),
    runCommand: (id: string, args?: unknown) => emit({ kind: "command", id, args }),
    attention: (module: string, id: string, title: string, on = true) => emit({ kind: "attention", module, id, title, on }),
  };
}
export type Bus = ReturnType<typeof createBus>;

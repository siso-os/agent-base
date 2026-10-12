// A module in a window of its own (Shaan, 10 Oct: "right click ... open it in a new window ... a condensed version of like
// literally the same browser just with no icons"). The window is this app at ?window=module&m=<id>: App draws that module
// with no rail. Browser has its own window already (the SISO Browser window, ?window=browser).

type Bridge = { invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T> };
const bridge = () => (window as unknown as { __TAURI_INTERNALS__?: Bridge }).__TAURI_INTERNALS__;

/** The module this window shows on its own, or null in the main window. */
export function soloModule(): string | null {
  const q = new URLSearchParams(location.search);
  const m = q.get("window") === "module" ? q.get("m") : null;
  return m && /^[a-z0-9-]{1,40}$/.test(m) ? m : null;
}

/** Opens (or focuses) the module's window. Resolves to null when it opened, or to what went wrong, in his words. */
export async function openModuleWindow(id: string, title: string): Promise<string | null> {
  const ipc = bridge();
  if (!ipc) {
    // A plain browser tab (dev, the phone): a popup window of the same page.
    const w = window.open(`/?window=module&m=${encodeURIComponent(id)}`, `mod-${id}`, "popup,width=1280,height=860");
    return w ? null : "The browser blocked the new window.";
  }
  try {
    if (id === "browser") await ipc.invoke("browser_window", { open: true });
    else await ipc.invoke("module_window", { module: id, title: `${title} · SISO OS` });
    return null;
  } catch (e) {
    const text = String((e as Error)?.message ?? e);
    // The installed desktop app is older than this page: the command arrives with the next desktop build.
    if (/module_window|not found|unknown command|not allowed/i.test(text)) return "New windows need the desktop update: quit SISO OS and open the new build.";
    return "That window didn't open.";
  }
}

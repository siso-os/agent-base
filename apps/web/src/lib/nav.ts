export type PageHistoryOptions<T> = {
  current: () => T;
  change: (page: T) => void;
  encode?: (page: T) => string;
  decode?: (value: string) => T | null;
  target?: Window;
};

/** Small adapter around the app's page state and the browser's session history. */
export function createPageHistory<T>(options: PageHistoryOptions<T>) {
  const target = options.target ?? window;
  const encode = options.encode ?? String;
  const decode = options.decode ?? ((value: string) => value as T);
  let index = 0;
  let maxIndex = 0;

  const write = (page: T, method: "pushState" | "replaceState", nextIndex: number) => {
    const hash = `#${encode(page)}`;
    target.history[method]({ ...target.history.state, agentBasePage: encode(page), agentBaseIndex: nextIndex }, "", `${target.location.pathname}${target.location.search}${hash}`);
    options.change(page);
  };

  const push = (page: T) => {
    if (Object.is(page, options.current())) return false;
    index += 1;
    maxIndex = index;
    write(page, "pushState", index);
    return true;
  };

  const back = () => { if (index > 0) target.history.back(); };
  const forward = () => { if (index < maxIndex) target.history.forward(); };

  const onPopState = (event: PopStateEvent) => {
    const value = target.location.hash.slice(1) || event.state?.agentBasePage;
    if (typeof value !== "string") return;
    const page = decode(value);
    if (page !== null) {
      if (Number.isInteger(event.state?.agentBaseIndex)) index = event.state.agentBaseIndex;
      else {
        // Native hash links (Library lists and documents) already created an entry. Adopt it without another push.
        index += 1;
        maxIndex = index;
        target.history.replaceState({ ...event.state, agentBasePage: encode(page), agentBaseIndex: index }, "");
      }
      if (!Object.is(page, options.current())) options.change(page);
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
    // ⌘⇧← / ⌘⇧→ in a text box select to the line's start or end (t-0265: they went back to the last agent mid-sentence).
    const t = event.target as HTMLElement | null;
    if (event.key.startsWith("Arrow") && t && (t.isContentEditable || t.tagName === "TEXTAREA" || t.tagName === "INPUT")) return;
    if (event.key === "[" || (event.shiftKey && event.key === "ArrowLeft")) {
      event.preventDefault();
      back();
    } else if (event.key === "]" || (event.shiftKey && event.key === "ArrowRight")) {
      event.preventDefault();
      forward();
    }
  };

  const start = () => {
    index = Number.isInteger(target.history.state?.agentBaseIndex) ? target.history.state.agentBaseIndex : 0;
    maxIndex = index;
    const fromHash = target.location.hash.slice(1);
    const stored = target.history.state?.agentBasePage;
    const restored = fromHash ? decode(fromHash) : typeof stored === "string" ? decode(stored) : null;
    write(restored ?? options.current(), "replaceState", index);
    target.addEventListener("popstate", onPopState);
    target.addEventListener("keydown", onKeyDown);
  };
  const stop = () => {
    target.removeEventListener("popstate", onPopState);
    target.removeEventListener("keydown", onKeyDown);
  };

  return { push, back, forward, start, stop, get canBack() { return index > 0; }, get canForward() { return index < maxIndex; } };
}

/** Drop corrupt JSON conveniences before components read them. Raw string preferences stay intact. */
export function recoverPersistedJson() {
  let store: Storage;
  let keys: string[];
  try {
    store = window.localStorage;
    keys = Array.from({ length: store.length }, (_, i) => store.key(i)).filter((key): key is string => key !== null);
  } catch {
    return; // Storage may be denied; the existing readers use their defaults.
  }
  for (const key of keys) {
    // Draft readers validate their own records and keep corrupt originals for recovery.
    if (key.startsWith("agent-base:draft:") || !isJsonKey(key)) continue;
    let raw: string | null;
    try {
      raw = store.getItem(key);
    } catch {
      continue;
    }
    if (raw === null) continue;
    try {
      JSON.parse(raw);
    } catch {
      // Report only the key: a draft or cached data can contain private text.
      console.warn(`Agent Base: dropped malformed saved JSON for ${key}`);
      try {
        store.removeItem(key);
      } catch {
        // A read-only store still reaches the readers' safe defaults.
      }
    }
  }
}

function isJsonKey(key: string) {
  if (key.startsWith("agent-base:")) {
    return key !== "agent-base:whats-new.seen" && key !== "agent-base:browser-sidebar-hidden" &&
      !key.startsWith("agent-base:browser-profile:") && !key.startsWith("agent-base:browser-account:");
  }
  return key.startsWith("ab.fold.") || key === "ab.tokens.v1" || key === "life-queue-v1" || key === "life-config-v1";
}

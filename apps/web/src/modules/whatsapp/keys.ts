import { useEffect, useState } from "react";

// Chats and people meet on the node's hashed key (services/node/src/rolodex-book.ts keyOf: "wa:" + sha1(jid), 12 hex): the
// book never sends a chat id to the page, so the page hashes the ids it already has and matches. In memory only.
const cache = new Map<string, string>();
export async function waKey(jid: string): Promise<string> {
  const hit = cache.get(jid);
  if (hit) return hit;
  const sum = new Uint8Array(await crypto.subtle.digest("SHA-1", new TextEncoder().encode(jid)));
  const key = "wa:" + [...sum].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 12);
  cache.set(jid, key);
  return key;
}

/** jid -> key for every one-to-one chat in the list (groups are never people). */
export function useChatKeys(chats: { jid: string; isGroup: boolean }[]): Map<string, string> {
  const [keys, setKeys] = useState<Map<string, string>>(() => new Map());
  useEffect(() => {
    let live = true;
    const dms = chats.filter((c) => !c.isGroup);
    if (!globalThis.crypto?.subtle) return;
    Promise.all(dms.map(async (c) => [c.jid, await waKey(c.jid)] as const)).then((pairs) => {
      if (!live) return;
      setKeys((prev) => (pairs.length === prev.size && pairs.every(([j, k]) => prev.get(j) === k) ? prev : new Map(pairs)));
    }).catch(() => {});
    return () => { live = false; };
  }, [chats]);
  return keys;
}

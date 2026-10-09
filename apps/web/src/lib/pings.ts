import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * An agent's pings (R1.21, the header spec's option A; was the bell, ab-150): its notifications from the node, read and
 * reacted to there. Agent Zero's come from his repo's notifications file. A reply
 * or a reaction goes back to the agent through its own chat socket, the same queue as anything he types in its chat, as
 * "re: notification N: …" (a0-016); Agent Zero's also land in his console inbox (the node posts them).
 */
export type Ping = {
  id: string | number; at: string; title: string; body: string; needs?: string; url?: string; project?: string;
  read: boolean; react: string | null;
};
/** A ping needs him when it says what it needs and that is not "nothing" (the real rows say "nothing now; …"). */
export const needsHim = (p: Pick<Ping, "needs">) => !!p.needs?.trim() && !/^nothing/i.test(p.needs.trim());
/** Needing ones first, then newest first. */
export const byPing = (a: Ping, b: Ping) => Number(needsHim(b)) - Number(needsHim(a)) || Date.parse(b.at) - Date.parse(a.at);

function sendViaChat(id: string, text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const sock = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/chat/${encodeURIComponent(id)}/ws`);
    let sent = false;
    const fail = window.setTimeout(() => (sock.close(), reject(new Error("The agent's chat did not answer"))), 6000);
    sock.onmessage = (ev) => {
      const m = JSON.parse(String(ev.data)) as { t: string; text?: string };
      if (m.t === "hello" && !sent) {
        sent = true;
        sock.send(JSON.stringify({ t: "prompt", text }));
        // A refusal comes back as a note at once ("This agent has ended …"); silence means it was queued.
        window.setTimeout(() => (window.clearTimeout(fail), sock.close(), resolve()), 1200);
      } else if (sent && m.t === "note" && /ended|Could not type/.test(m.text ?? "")) {
        window.clearTimeout(fail);
        sock.close();
        reject(new Error(m.text));
      }
    };
    sock.onerror = () => (window.clearTimeout(fail), reject(new Error("Could not reach the agent's chat")));
  });
}

export type Pings = ReturnType<typeof usePings>;
/** `id` addresses the node (null: no agent open, nothing loads). Polls every 30 s, and again on focus and after every action. */
export function usePings(id: string | null) {
  const [items, setItems] = useState<Ping[]>([]);
  const base = `/api/agents/${encodeURIComponent(id ?? "")}/notifications`;
  const load = useCallback(
    async () =>
      id &&
      fetch(base)
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { notifications?: Ping[] } | null) => d && setItems(d.notifications ?? []))
        .catch(() => {}),
    [base],
  );
  useEffect(() => {
    setItems([]);
    void load();
    const t = window.setInterval(load, 30_000);
    const focus = () => void load();
    window.addEventListener("focus", focus);
    return () => (window.clearInterval(t), window.removeEventListener("focus", focus));
  }, [load]);
  const post = useCallback(
    async (path: string, body: unknown) => {
      const r = await fetch(`${base}/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error ?? "The node refused it");
      return d as { deliver?: string };
    },
    [base],
  );
  const mark = useCallback(
    async (nid: Ping["id"], patch: { read?: boolean; react?: string | null }) => {
      // The strip moves on at once; the node's answer confirms it.
      setItems((xs) => xs.map((x) => (x.id === nid ? { ...x, ...patch } : x)));
      try {
        const d = await post(encodeURIComponent(String(nid)), patch);
        // a0-016: a reaction goes back to the agent at once, through its chat, as "re: notification N: 👍 yes".
        if (d.deliver && id) await sendViaChat(id, d.deliver);
      } finally {
        await load();
      }
    },
    [post, load, id],
  );
  const markAll = useCallback(async () => {
    const ids = items.filter((x) => !x.read).map((x) => x.id);
    setItems((xs) => xs.map((x) => ({ ...x, read: true })));
    try {
      for (const nid of ids) await post(encodeURIComponent(String(nid)), { read: true });
    } finally {
      await load();
    }
  }, [items, post, load]);
  const reply = useCallback(
    async (nid: Ping["id"], text: string) => {
      const d = await post(`${encodeURIComponent(String(nid))}/reply`, { text });
      if (d.deliver && id) await sendViaChat(id, d.deliver);
      await load();
    },
    [post, id, load],
  );
  const unread = useMemo(() => items.filter((x) => !x.read).sort(byPing), [items]);
  return { items, unread, mark, markAll, reply, reload: load };
}

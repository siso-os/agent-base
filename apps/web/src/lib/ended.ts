/**
 * Agents that left herdr (R1.25, Shaan: "when the agent gets spun down it's tracked somewhere"): the node's record,
 * newest first (services/node/src/server.ts, GET /api/ended). A row opens its chat read back, read-only.
 */
import { useEffect, useState } from "react";

export type Ended = {
  id: string;
  name: string;
  pane: string;
  terminal: string;
  session: string | null;
  cwd: string;
  project: string | null;
  tool: string;
  started: number;
  ended: number;
  status: string;
  task: string;
  machine: string;
};

/** The record, read at start and every 15 s (an agent ending is rare; nothing here is urgent). */
export function useEnded(): Ended[] {
  const [ended, setEnded] = useState<Ended[]>([]);
  useEffect(() => {
    let alive = true;
    const read = () =>
      fetch("/api/ended")
        .then((r) => r.json())
        .then((d) => alive && Array.isArray(d.ended) && setEnded(d.ended))
        .catch(() => {});
    read();
    const t = window.setInterval(read, 15_000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, []);
  return ended;
}

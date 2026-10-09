import { useEffect, useState } from "react";
import { every } from "../lib/poll";

/** The agent's last screen of text, refreshed every 5 s while shown (lib/poll.ts). */
export function RecentOutput({ id }: { id: string }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    const read = async () => {
      try {
        const r = await fetch(`/api/agents/${encodeURIComponent(id)}/read?lines=40`, { cache: "no-store" });
        const d = await r.json();
        if (live) setText(String(d.text ?? d.error ?? ""));
      } catch (e) {
        if (live) setText(`(could not read: ${(e as Error).message})`);
      }
    };
    const stop = every(() => void read(), 5000);
    return () => {
      live = false;
      stop();
    };
  }, [id]);
  return (
    <pre data-testid="recent-output" className="m-0 min-h-full whitespace-pre-wrap break-words p-4 font-mono text-[11.5px] leading-relaxed text-secondary-label select-text">
      {text === null ? "Reading…" : text.trim() || "(no output yet)"}
    </pre>
  );
}

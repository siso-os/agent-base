import { useEffect, useRef } from "react";
import type { Agent } from "../lib/agents";
import { faceFor } from "../lib/face";
import { recentCue, type ZeroCue } from "../lib/zeroFace";
import "../../../../packages/halo-face";

type Face = { el: HTMLElement; set(state: string, o?: object): Face; look(x: number, y: number): void; gesture(name: string): Face; voice(level: number): Face };
type Ctl = { face: Face; status(s: string): Ctl; destroy(): void };
type HaloFaceGlobal = { agent(host: HTMLElement, o: object): Ctl };

/**
 * Agent Zero's own face, bottom-right (the 40 px tracked one; every other face stays still). The same engine as
 * AgentFace, kept here so the app can cue it (lib/zeroFace.ts): glance at the new-build pill, burst on a ship. Its live
 * status still follows herdr; PERF's 20 s idle doze is the engine's and is left alone.
 */
export function ZeroFace({ agent, size = 40 }: { agent: Agent; size?: number }) {
  const host = useRef<HTMLSpanElement>(null);
  const ctl = useRef<Ctl | null>(null);
  const { name, project, status } = faceFor(agent);
  useEffect(() => {
    const HF = (window as unknown as { HaloFace: HaloFaceGlobal }).HaloFace;
    if (!host.current) return;
    const c = HF.agent(host.current, { name, project, status, size, track: true, interactive: true });
    ctl.current = c;
    const el = host.current;
    return () => {
      c.destroy();
      ctl.current = null;
      el.innerHTML = "";
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size]);
  useEffect(() => void ctl.current?.status(status), [status]);
  useEffect(() => {
    // The state his status gave the face, so a voice cue (listen, think, problem) can hand it back afterwards.
    let held: string | null = null;
    const hold = (f: Face) => (held ??= f.el.dataset.state ?? "standby");
    const back = (f: Face) => (held && f.set(held), (held = null));
    const on = (e: Event) => {
      const cue = (e as CustomEvent<ZeroCue>).detail, f = ctl.current?.face;
      if (!f || !cue) return;
      if (cue.do === "listen" || cue.do === "think" || cue.do === "problem") hold(f);
      if (cue.do === "glance") (f.look(-2.6, -2.2), f.gesture("tilt"));
      else if (cue.do === "celebrate") f.set("celebrating", { variant: "burst" });
      else if (cue.do === "listen") (f.el.dataset.state !== "listening" && f.set("listening"), f.voice(cue.level ?? 0));
      else if (cue.do === "think") f.set("thinking");
      else if (cue.do === "done") (back(f), f.gesture("nod"));
      else if (cue.do === "problem") (f.set("problem"), window.setTimeout(() => back(f), 1500));
      else if (cue.do === "rest") back(f);
    };
    window.addEventListener("siso-zero-face", on);
    // A cue from just before this face mounted (after a reload the Shipped card is up before the agent list).
    const missed = recentCue();
    if (missed) on(new CustomEvent("siso-zero-face", { detail: missed }));
    return () => window.removeEventListener("siso-zero-face", on);
  }, [status]);
  return <span ref={host} data-testid="zero-face-art" style={{ display: "inline-flex", width: size, height: size, flex: "none" }} />;
}

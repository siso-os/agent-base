/**
 * Agent Zero's face bottom-right takes cues from anywhere in the app (SPEC-DELIGHT): `glance` at something it just
 * offered (the new-build pill), `celebrate` a ship, `listen` / `think` / `done` / `problem` around his voice. ZeroFace
 * listens; with no face on screen a cue does nothing.
 */
export type ZeroCue = { do: "glance" | "celebrate" | "listen" | "think" | "done" | "problem" | "rest"; level?: number };
let last: { cue: ZeroCue; at: number } | null = null;
export const zeroCue = (cue: ZeroCue) => ((last = { cue, at: Date.now() }), window.dispatchEvent(new CustomEvent<ZeroCue>("siso-zero-face", { detail: cue })));
/** A cue given in the last few seconds, for a face that mounts just after it (the Shipped burst right after a reload). */
export const recentCue = (ms = 6000) => (last && Date.now() - last.at < ms ? last.cue : null);

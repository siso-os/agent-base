import { CornerDownLeftIcon, PauseIcon, PlayIcon, VolumeXIcon } from "lucide-react";
import type { CSSProperties } from "react";
import type { NowPlaying } from "../../lib/browser-player";
import { spaceColour } from "../../lib/browser-setup";

/** The mini player (arc-edges §5.6): above the space bar while a page plays sound and is not on screen, across spaces.
 * The page is never put to sleep while it plays (browser_audio). ⏯ pauses or resumes it, the speaker mutes it, and ↩
 * brings its tab back (its space and account, here). A page in another app tab says so instead. */
export function MiniPlayer(props: { now: NowPlaying; onToggle: () => void; onMute: () => void; onGo: () => void }) {
  const n = props.now;
  return (
    <div className="ab-browser__player" role="region" aria-label={`Playing: ${n.title}`} data-paused={n.paused || undefined} style={{ "--ab-tile-rgb": spaceColour(n.host || n.title) } as CSSProperties}>
      <span className="ab-browser__player-art" aria-hidden="true">{n.paused ? (n.title || n.host).trim().charAt(0).toUpperCase() : <><i /><i /><i /></>}</span>
      <span className="ab-browser__player-text">
        <b title={n.title}>{n.title}</b>
        <small>{[n.space?.name, n.here ? "" : "another tab", n.host].filter(Boolean).join(" · ")}</small>
      </span>
      <button type="button" aria-label={n.paused ? `Play ${n.title}` : `Pause ${n.title}`} title={n.paused ? "Play" : "Pause"} onClick={props.onToggle}>{n.paused ? <PlayIcon size={14} /> : <PauseIcon size={14} />}</button>
      {!n.paused && <button type="button" aria-label={`Mute ${n.title}`} title="Mute" onClick={props.onMute}><VolumeXIcon size={14} /></button>}
      {n.here && <button type="button" aria-label={`Go to ${n.title}`} title="Go to tab" onClick={props.onGo}><CornerDownLeftIcon size={14} /></button>}
    </div>
  );
}

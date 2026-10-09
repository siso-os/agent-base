import { useLayoutEffect, useRef, useState } from 'react';
import type { Ev } from '../lib/chat';
import { recordedReplay } from '../lib/recorded-replay';
import { SessionReplay, type SessionReplayAgent } from './SessionReplay';

export type RecordedSessionReplayProps = {
  /** Must identify the same session as events; a successor resets the local cursor. */
  sessionId: string | null;
  events: readonly Ev[];
  owner: SessionReplayAgent;
  loading?: boolean;
  error?: string | null;
};

export function RecordedSessionDisclosure({ onOpen, ...props }: RecordedSessionReplayProps & { onOpen?: () => void }) {
  const [open, setOpen] = useState(false);
  const disclosure = useRef<HTMLDetailsElement>(null);
  useLayoutEffect(() => {
    if (open) disclosure.current?.scrollIntoView({ block: 'start' });
  }, [open]);
  return <details ref={disclosure} style={{ marginBlock: 10, fontSize: 12 }} onToggle={event => {
    if (event.currentTarget.open) onOpen?.();
    setOpen(event.currentTarget.open);
  }}>
    <summary style={{ cursor: 'pointer', color: 'var(--muted-foreground)' }}>Recorded session</summary>
    {open && <RecordedSessionReplay {...props} />}
  </details>;
}

export function RecordedSessionReplay(props: RecordedSessionReplayProps) {
  if (!props.sessionId) return <p role="status">Session recording unavailable: no session selected.</p>;
  return <Recording key={props.sessionId} {...props} sessionId={props.sessionId} />;
}

function Recording({ sessionId, events, owner, loading, error }: RecordedSessionReplayProps & { sessionId: string }) {
  const { frames, omitted, total } = recordedReplay(events, sessionId, owner);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = frames.findIndex(frame => frame.id === selectedId);
  const cursor = selected < 0 ? 0 : selected;
  if (loading) return <p role="status">Loading recorded session…</p>;
  if (error) return <p role="status">Session recording unavailable: {error}</p>;
  return <div className="recorded-session-replay">
    <p role="status">{frames.length} of {total} loaded events represented. {omitted > 0 ? `${omitted} events remain in the original chat, including unsupported events or records without a timestamp or identified owner. ` : ''}Earlier history may not be loaded. Seeking changes only this view.</p>
    <SessionReplay events={frames} cursor={cursor} onSeek={index => { const frame = frames[index]; if (frame) setSelectedId(frame.id); }} title={`${owner.name} · recorded session`} />
  </div>;
}

import { useState } from 'react';
import type { DeliveryCapabilities, QueueSnapshot, QueuedPrompt } from '../../../../services/host/src/delivery';
export function QueuedPrompts({ snapshot: s, capabilities: c, connected, busy, onCommand }: { snapshot: QueueSnapshot; capabilities: DeliveryCapabilities; connected: boolean; busy: boolean; onCommand: (m: object) => void }) {
  // Separate editor leaves his normal composer and its images intact, including on remote advance.
  const [edit,setEdit] = useState<{ id: string; text: string; images: string[]; revision: number } | null>(null);
  const rows = s.entries.filter(e => ['saved','dispatching','unknown'].includes(e.phase));
  const command = (m: object) => onCommand({ ...m, expectedRevision: s.revision });
  const move = (e: QueuedPrompt, direction: number) => {
    const i = rows.indexOf(e); if (i + direction < 0 || i + direction >= rows.length) return;
    command({ t: 'queue.move', id: e.id, beforeId: direction < 0 ? rows[i - 1].id : rows[i + 2]?.id ?? null });
  };
  const editable = edit && s.entries.some(e => e.id === edit.id && e.phase === 'saved');
  return <div className="siso-chat__queued siso-chat__saved" aria-label="Saved queue">
    {s.held && <div><span>Held</span><em>Next tasks are paused</em><button type="button" disabled={!connected || busy || rows.some(e => e.phase === 'unknown')} onClick={() => command({ t: 'queue.resume' })}>Resume</button></div>}
    {rows.map(e => <div key={e.id} data-testid="queued-row"><span>{e.phase === 'unknown' ? 'Outcome unknown' : e.phase === 'dispatching' ? 'Sending' : 'Queued'}</span><em title={e.failure}>{e.text}{e.images.length ? ` · ${e.images.length} images` : ''}</em>
      {e.phase === 'saved' && <>
        <button type="button" aria-label="Edit queued message" disabled={busy || !connected} onClick={() => setEdit({ id: e.id, text: e.text, images: e.images, revision: s.revision })}>Edit</button>
        <button type="button" aria-label="Move queued message up" disabled={busy || !connected} onClick={() => move(e,-1)}>↑</button>
        <button type="button" aria-label="Move queued message down" disabled={busy || !connected} onClick={() => move(e,1)}>↓</button>
        <button type="button" disabled={busy || !connected || !c.steer || (!c.auto && !c.activeTurnId)} onClick={() => command(c.auto ? { t: 'queue.send', id: e.id } : { t: 'queue.steer', id: e.id, expectedTurnId: c.activeTurnId })}>Send now</button>
        <button type="button" aria-label="Remove queued message" disabled={busy || !connected} onClick={() => command({ t: 'queue.remove', id: e.id })}>×</button>
      </>}
    </div>)}
    {edit && <section className="siso-chat__ask siso-chat__queue-edit">
      <textarea aria-label="Edit queued text" value={edit.text} onChange={e => setEdit({ ...edit,text:e.target.value })} />
      {edit.images.map(p => <button type="button" key={p} onClick={() => setEdit({ ...edit, images:edit.images.filter(x => x !== p) })}>Remove {p.split('/').pop()}</button>)}
      {!editable && <p>Message advanced remotely · your edit is kept here.</p>}
      <button type="button" disabled={!editable || busy || !connected} onClick={() => onCommand({ t:'queue.edit', id:edit.id, text:edit.text, images:edit.images, expectedRevision:edit.revision })}>Save edit</button>
      {edit.revision !== s.revision && <button type="button" onClick={() => setEdit({ ...edit,revision:s.revision })}>Use current revision</button>}
      <button type="button" onClick={() => setEdit(null)}>Close edit</button>
    </section>}
  </div>;
}

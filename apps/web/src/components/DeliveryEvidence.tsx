import { useState } from 'react';
import { useSharedState } from '../lib/poll';
import { deliveryPairs, pipelineMedian, verifiedDeliveries, type DeliveredWork, type Deliveries } from '../lib/delight';
import { EvidenceLightbox } from './panel/LandedRows';
import './DeliveryEvidence.css';
const duration = (ms: number) => ms < 60_000 ? `${Math.round(ms / 1000)}s` : ms < 3600_000 ? `${Math.round(ms / 60_000)}m` : `${(ms / 3600_000).toFixed(1)}h`;
const endpoint = (key: string) => `/api/delight?agent=${encodeURIComponent(key)}`;
export function DeliveryCard({ delivery }: { delivery: DeliveredWork }) {
  const [image, setImage] = useState<{ title: string; shots: { before: string; after: string }; side: number } | null>(null);
  const [failed, setFailed] = useState<Record<string, boolean>>({});
  const pairs = deliveryPairs(delivery);
  return <article className="ab-delivery" data-testid="delivery-card">
    <header><strong>{delivery.title}</strong><span>Verified live</span></header>
    <p>{delivery.taskId} · <time dateTime={delivery.live.at}>{new Date(delivery.live.at).toLocaleString()}</time> · <code>{delivery.live.revision.slice(0,7)}</code></p>
    {!pairs.length && <p role="status">{delivery.evidence?.reason || 'Before/after evidence unavailable for this delivery.'}</p>}
    {pairs.map(pair => <section key={pair.id} aria-label={pair.title}><strong>{pair.title}</strong><div className="ab-delivery__pair">{(['before','after'] as const).map((side,i) => <button key={side} type="button" aria-label={`${i ? 'After' : 'Before'}: ${pair.title}`} onClick={() => setImage({title: pair.title, shots: pair, side:i})}>
      {failed[`${pair.id}:${side}`] ? <span>Image unavailable</span> : <img loading="lazy" src={pair[side]} alt={`${i ? 'After' : 'Before'}: ${pair.title}`} onError={() => setFailed(v => ({...v,[`${pair.id}:${side}`]:true}))} />}
      <span>{i ? 'After' : 'Before'} · {(i ? pair.afterSha : pair.beforeSha).slice(0,7)}</span>
    </button>)}</div></section>)}
    <details><summary>Delivery evidence</summary><p>Live receipt: {delivery.live.id} · {delivery.live.source}</p><p>Original words: {delivery.prompt?.at || 'Timestamp unavailable'} · {delivery.prompt?.source || 'Source unavailable'}</p></details>
    {image && <EvidenceLightbox task={image} side={image.side} onClose={() => setImage(null)} />}
  </article>;
}
export function DeliveryEvidence({ agentKey, session, active }: { agentKey: string; session: string | null; active: boolean }) {
  const {data,error} = useSharedState<Deliveries>(active && session ? endpoint(agentKey) : null, 10_000);
  if (!session) return null;
  const rows = verifiedDeliveries(Array.isArray(data?.deliveries) ? data.deliveries : [], agentKey, session);
  return <section aria-label="Delivered work" data-testid="delivery-evidence">{(error || data?.error) && <p className="ab-delivery__quiet" role="status">Delivery evidence unavailable · {error || data?.error}</p>}{rows.map(r => <DeliveryCard key={r.id} delivery={r} />)}</section>;
}
export function ZeroPipelineMetric({ agentKey }: { agentKey: string }) {
  const {data,error} = useSharedState<Deliveries>(endpoint(agentKey), 10_000);
  const {median,samples} = pipelineMedian(Array.isArray(data?.deliveries) ? data.deliveries : [], agentKey);
  return <details className="ab-pipeline" data-testid="zero-pipeline"><summary>Words to live <strong>{error || data?.error || median === null ? 'Unavailable' : `${duration(median)} median`}</strong></summary>
    <p>{error || data?.error || (samples.length ? `${samples.length} measured ${samples.length === 1 ? 'delivery' : 'deliveries'} · original prompt to verified live acceptance.` : 'No joined original-prompt and verified-live timestamps are recorded.')}</p>
    {!error && !data?.error && samples.map(({receipt:r,ms}) => <p key={r.id}>{r.title} · {duration(ms)}<br /><small>{r.prompt.at} → {r.live.at}<br />{r.prompt.source} → {r.live.source}</small></p>)}
  </details>;
}

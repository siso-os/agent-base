import type { QuestionRecoverySnapshot } from '../../../../services/host/src/questions';

export function QuestionRecoveryHistory({ snapshot, connected }: { snapshot: QuestionRecoverySnapshot | null | undefined; connected: boolean }) {
  if (!snapshot || (!snapshot.records.length && snapshot.status !== 'unavailable')) return null;
  const records = snapshot.records.slice(-10).reverse();
  return <section className="siso-chat__ask siso-chat__question" aria-label="Saved question history">
    <header><b>Saved questions</b><span>Read-only history</span></header>
    {snapshot.status === 'unavailable' && <p role="status">Question history is unavailable. Answer delivery is disabled until the host has a valid reading.</p>}
    {!connected && <p role="status">Disconnected · showing the last history received.</p>}
    {records.length > 0 && <details><summary>{snapshot.records.length} saved {snapshot.records.length === 1 ? 'question' : 'questions'}{snapshot.records.length > 10 ? ' · latest 10' : ''}</summary>
      {records.map(record => <article key={`${record.request.hostInstance}:${record.request.id}`}>
        <p>{record.request.questions.map(q => q.question).join(' · ')}</p>
        <small>{['pending','dispatching','unconfirmed'].includes(record.phase) ? 'Answer delivery unconfirmed · waiting for the provider to reissue this question' : `Recorded outcome: ${record.phase}`} · {new Date(record.updatedAt).toLocaleString()}</small>
        {record.reboundTo && <p>A newly issued question is handled separately above. The previous answer will not be resent automatically.</p>}
      </article>)}
    </details>}
  </section>;
}

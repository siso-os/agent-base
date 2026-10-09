import type { QuestionRequest } from '../../../../services/host/src/questions';
import { buildAnswers, resolveAnswer, type QuestionDraft } from '../lib/questions';
export function QuestionCard({ request: r, draft: d, connected, onChange, onSubmit }: { request: QuestionRequest; draft: QuestionDraft; connected: boolean; onChange: (d: QuestionDraft) => void; onSubmit: (dismiss: boolean) => void }) {
  const q = r.questions[Math.min(d.index, r.questions.length - 1)], answer = d.answers[q.id] ?? { selected: [], custom: '' };
  const disabled = d.status === 'sending';
  const pick = (v: string) => {
    if (disabled) return;
    const selected = q.multiple ? answer.selected.includes(v) ? answer.selected.filter(x => x !== v) : [...answer.selected,v] : [v];
    onChange({ ...d, answers: { ...d.answers, [q.id]: { selected, custom: '' } }, status: 'editing' });
  };
  return <section className="siso-chat__ask siso-chat__question" aria-label="Agent question" data-testid="question-card" onKeyDown={e => {
    if ((e.target as HTMLElement).closest('input,textarea,[contenteditable]') || e.metaKey || e.altKey || e.ctrlKey || e.repeat) return;
    const i = Number(e.key)-1; if (i >= 0 && i < q.options.length) { e.preventDefault(); pick(q.options[i].value); }
  }}>
    <header><b>{q.header}</b><span>{d.index + 1} of {r.questions.length}</span></header>
    <p>{q.question}</p>
    <div role={q.multiple ? 'group' : 'radiogroup'} aria-label={q.question}>
      {q.options.map(o => <label key={o.value}><input type={q.multiple ? 'checkbox' : 'radio'} name={r.id + q.id} checked={answer.selected.includes(o.value) && !answer.custom} disabled={disabled} onChange={() => pick(o.value)} /><span><b>{o.label}</b>{o.description && <small>{o.description}</small>}</span></label>)}
    </div>
    {q.allowCustom && <input aria-label="Custom answer" placeholder="Your own answer" value={answer.custom} disabled={disabled} onChange={e => onChange({ ...d, answers: { ...d.answers, [q.id]: { selected: [], custom: e.target.value } }, status: 'editing' })} />}
    {d.error && <p role="alert">{d.error}</p>}
    {!connected && <p role="status">Disconnected · answers kept. Reconnect to send.</p>}
    <footer>
      <button type="button" disabled={disabled || d.index === 0} onClick={() => onChange({ ...d, index: d.index - 1 })}>Back</button>
      {d.index < r.questions.length - 1 ? <button type="button" disabled={disabled || !resolveAnswer(q,answer)} onClick={() => onChange({ ...d, index: d.index + 1 })}>Next</button> : <button type="button" disabled={!connected || disabled || !buildAnswers(r,d)} onClick={() => onSubmit(false)}>{disabled ? 'Sending…' : d.status === 'failed' ? 'Retry answer' : 'Submit answer'}</button>}
      <button type="button" disabled={!connected || disabled} onClick={() => onSubmit(true)}>Dismiss</button>
    </footer>
  </section>;
}

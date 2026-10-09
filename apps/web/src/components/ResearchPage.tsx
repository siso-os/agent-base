import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Research, ResearchOutput, ResearchSelection } from '../../../../services/node/src/research';
import { useSharedState } from '../lib/poll';
import { fleetRunning, ModelChip } from './A0Nav';
import { AgentFace } from '../lib/face';
import { researchFaceName, researchFaceStatus, researchFleetUsage, researchJobName, researchTokenLabel } from '../lib/research-display';
import './ResearchPage.css';

const date = (value: string | number | null) => value && Number.isFinite(new Date(value).getTime()) ? new Date(value).toLocaleString() : 'Not reported';
export function ResearchPage({ initialSelection }: { initialSelection?: ResearchSelection | null } = {}) {
  const root = useRef<HTMLElement>(null), scrolledSelection = useRef('');
  const { data, error } = useSharedState<Research>('/api/research', 10_000);
  const [selected, setSelected] = useState<{ fleet: string; job: string } | null>(null);
  const [topic, setTopic] = useState<string | null>(null);
  useEffect(() => { if (initialSelection?.job) { setSelected({ fleet: initialSelection.fleet, job: initialSelection.job }); setTopic(null); } }, [initialSelection?.fleet, initialSelection?.job]);
  const fleets = [...(data?.fleets.data ?? [])].sort((a, b) => Number(fleetRunning(b)) - Number(fleetRunning(a)) || b.created.localeCompare(a.created));
  const chosenFleet = fleets.find((f) => f.name === selected?.fleet);
  const chosenOutput: ResearchOutput | null | undefined = selected?.job === 'then' ? chosenFleet?.then : chosenFleet?.jobs.find((j) => j.id === selected?.job);
  const chosenJob = chosenFleet?.jobs.find(j => j.id === selected?.job);
  useEffect(() => {
    if (!initialSelection?.fleet || !data?.fleets.data) return;
    const key = `${initialSelection.fleet}/${initialSelection.job ?? ''}`;
    if (scrolledSelection.current === key) return;
    const fleet = [...(root.current?.querySelectorAll<HTMLElement>('[data-fleet]') ?? [])].find(el => el.dataset.fleet === initialSelection.fleet);
    const target = initialSelection.job && selected?.job === initialSelection.job ? root.current?.querySelector<HTMLElement>('[data-testid="research-return"]') : !initialSelection.job ? fleet : null;
    if (target) { scrolledSelection.current = key; target.scrollIntoView({ block: 'start', behavior: 'auto' }); }
  }, [initialSelection?.fleet, initialSelection?.job, data?.fleets.at, selected?.job]);
  const chosenTopic = data?.topics.data?.find((t) => t.id === topic);
  return <main ref={root} className="ab-research" data-testid="research-page">
    <header><h1>Research</h1><p>Agent Zero’s research fleet and persistent findings</p></header>
    {error && <p role="status">Research unavailable; retrying.</p>}
    {!data && !error && <p role="status">Reading research…</p>}
    <section aria-label="Research fleets"><h2>Fleets <small>{fleets.filter(fleetRunning).length} running</small></h2>
      {data?.fleets.error && <p role="status">Fleets unavailable; retrying.</p>}
      {data?.fleets.data?.length === 0 && <p>No research fleets reported.</p>}
      {fleets.map((fleet) => <article className="ab-research__card" key={fleet.name} data-testid="research-fleet" data-fleet={fleet.name}>
        <div className="ab-research__heading"><h3>{fleet.name}</h3><ModelChip model={fleet.model} /><span>{fleetRunning(fleet) ? 'Running' : fleet.jobs.some((j) => j.status === 'failed') || fleet.then?.status === 'failed' ? 'Failed' : fleet.finished ? 'Finished' : 'Idle'}</span></div>
        <p className="ab-research__usage">{researchFleetUsage(fleet)} <small>· job usage only</small></p>
        <div className="ab-research__jobs" aria-label={`${fleet.name} jobs`}>{fleet.jobs.map((job) => <button type="button" className="ab-research__job" key={job.id} aria-label={`${fleet.name} · ${researchJobName(job)} · ${job.status}`} aria-pressed={selected?.fleet === fleet.name && selected?.job === job.id} title={`${job.id}: ${job.status}`} onClick={() => { setSelected({ fleet: fleet.name, job: job.id }); setTopic(null); }}>
          <AgentFace name={researchFaceName(fleet, job)} project={fleet.name} status={researchFaceStatus(job.status)} family="codex" size={32} />
          <span className="ab-research__jobbody"><b>{researchJobName(job)}</b><small>{job.id}</small><span>{researchTokenLabel(job)}</span></span><em className={`is-${job.status}`}>{job.status}</em>
        </button>)}</div>
        {fleet.then ? <button type="button" className="ab-research__synthesis" onClick={() => { setSelected({ fleet: fleet.name, job: 'then' }); setTopic(null); }} aria-pressed={selected?.fleet === fleet.name && selected?.job === 'then'}>Synthesis <ModelChip model={fleet.then.model} /> <i className={`ab-research__dot is-${fleet.then.status}`} /> {fleet.then.status}</button> : <p>Synthesis not configured</p>}
        <p className="ab-research__dates">Started {date(fleet.created)} · Finished {date(fleet.finished)}</p>
      </article>)}
    </section>
    {selected && <section className="ab-research__card" aria-label="Job RETURN" data-testid="research-return"><div className="ab-research__heading"><h2>{selected.fleet} · {chosenJob ? researchJobName(chosenJob) : selected.job === 'then' ? 'Synthesis' : selected.job}</h2><button type="button" onClick={() => setSelected(null)}>Close output</button></div>{chosenJob && <p className="ab-research__usage">{researchTokenLabel(chosenJob)}{chosenJob.tokensIn != null && chosenJob.tokensOut != null && <small> · {chosenJob.tokensIn.toLocaleString()} input · {chosenJob.tokensOut.toLocaleString()} output</small>}</p>}{chosenOutput?.error || !chosenOutput ? <p role="status">{chosenOutput?.error ?? 'Job no longer reported'}</p> : <pre>{chosenOutput.output || 'No output yet.'}</pre>}</section>}
    <section aria-label="Research topics"><h2>Topics <small>{data?.topics.data?.length ?? 0} persistent</small></h2>
      {data?.topics.error && <p role="status">Topics unavailable; retrying.</p>}
      {data?.topics.data?.length === 0 && <p>No research findings yet.</p>}
      {data?.topics.data?.map((t) => <article className="ab-research__card" key={t.id} data-testid="research-topic"><button type="button" className="ab-research__topic" onClick={() => { setTopic(t.id); setSelected(null); }} aria-expanded={topic === t.id}><h3>{t.title}</h3><small>Updated {date(t.updated)}</small></button><pre className="ab-research__preview">{t.preview}</pre>{t.error && <p role="status">{t.error}</p>}<p>Fleets: {data.fleets.error ? 'Unavailable' : t.fleets.join(' · ') || 'None linked'}</p></article>)}
    </section>
    {chosenTopic && <section className="ab-research__card" aria-label="Topic findings" data-testid="research-findings"><div className="ab-research__heading"><h2>{chosenTopic.title}</h2><button type="button" onClick={() => setTopic(null)}>Close findings</button></div>{chosenTopic.error ? <p role="status">{chosenTopic.error}</p> : <article className="siso-md siso-md--doc"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ img: ({ alt }) => <span>{alt}</span>, a: ({ children }) => <span>{children}</span> }}>{chosenTopic.markdown ?? ''}</ReactMarkdown></article>}</section>}
  </main>;
}

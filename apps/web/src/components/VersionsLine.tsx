import { useSharedResult } from '../lib/poll';
import { versionSha, versionLineState, type VersionLineData } from '../lib/version-line';
import './UsagePage.css';
// uihub: arc:timeline; standalone content for AB-ASTRA-RAIL's shared peek.
export function VersionsLine({ line, applying = false, stale = false }: {line?:VersionLineData|null; applying?:boolean; stale?:boolean}) {
 return <section className="usage-versions" aria-label="Version provenance" data-applying={applying}>
  <div className="usage-version-status" role="status">{stale ? 'Last observed versions · refresh unavailable' : applying ? 'Update applying · awaiting confirmation' : versionLineState(line)}</div>
  <ol className="usage-version-steps">{(['source','preview','live'] as const).map((stage,i)=><li key={stage} style={{animationDelay:`${i*350}ms`}}><span>{stage}</span><code title={versionSha(line?.[stage]?.sha) ?? 'No revision recorded'}>{versionSha(line?.[stage]?.sha)?.slice(0,8) ?? 'Unknown'}</code><small>{line?.[stage]?.ref ?? 'No ref reported'}</small></li>)}</ol>
  <dl className="usage-version-layers"><div><dt>Served web</dt><dd><code>{versionSha(line?.layers?.web)?.slice(0,8) ?? 'Unknown'}</code></dd></div><div><dt>Running node</dt><dd><code>{versionSha(line?.layers?.node)?.slice(0,8) ?? 'Unknown'}</code></dd></div></dl>
  <p>Refs identify commits. A missing preview or node receipt stays unknown.</p>
 </section>;
}
export function ConnectedVersionsLine({applying=false}:{applying?:boolean}) {
 const result=useSharedResult<{line?:VersionLineData}>('/api/version', 5000);
 return <VersionsLine line={result.data?.line} applying={applying} stale={!!result.error}/>;
}

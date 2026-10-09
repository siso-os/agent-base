import { useEffect, useId, useRef } from 'react';
import { FleetStatsPage } from './FleetStats';
import { UsageTokenSections, useTokens } from './TokensSpace';
import { UsageAnswer } from './UsageAnswer';
import { ConnectedVersionsLine } from './VersionsLine';
import { useSpend } from '../lib/spend';
import './UsagePage.css';
// uihub: statistics-card-7, arc:timeline; original HaloRim, Stats cards, TokenTracker graphs and rings.
export function UsagePage({ onPopOut, onPop, density = 'page', host = 'page' }: {onPopOut?:()=>void; onPop?:()=>void; density?:'page'|'panel';host?:'page'|'pop'}) {
 const spend=useSpend();
 return <UsagePageView spend={spend} onPop={onPopOut ?? onPop} compact={density==='panel'||host==='pop'}/>;
}
// Usage lane (9 Oct): the answer first (which login, how full, when it resets), then the graphs, then the fleet's day.
// One /api/tokens poll for the whole page, shared by the answer and the sections below it.
export function UsagePageView({spend,onPop,compact=false}:{spend:ReturnType<typeof useSpend>;onPop?:()=>void;compact?:boolean}) {
 const titleId=useId();
 const tokens=useTokens();
 const dialog=useRef<HTMLDialogElement>(null), trigger=useRef<HTMLButtonElement>(null);
 const showVersions=()=>dialog.current?.showModal();
 useEffect(()=>{ const el=dialog.current; const close=()=>trigger.current?.focus();el?.addEventListener('close',close);return ()=>el?.removeEventListener('close',close);},[]);
 return <main className="usage-page" data-testid="usage-page" data-compact={compact}>
  <header className="usage-heading"><div><span>WORKSPACE</span><h1>Usage</h1></div><div className="usage-actions"><button ref={trigger} type="button" onClick={showVersions}>Versions</button>{onPop&&<button type="button" onClick={onPop}>Open in side panel</button>}</div></header>
  <UsageAnswer tokens={tokens.data} error={tokens.error} fresh={tokens.fresh} spend={spend}/>
  <UsageTokenSections tokens={tokens}/>
  <FleetStatsPage overview/>
  <dialog ref={dialog} role="dialog" aria-modal="true" className="usage-version-dialog" aria-labelledby={titleId} onKeyDown={e=>{if(e.key==='Tab'){e.preventDefault();e.currentTarget.querySelector('button')?.focus();}}} onClick={e=>{if(e.target===e.currentTarget)dialog.current?.close();}}>
   <header><h2 id={titleId}>Versions</h2><button type="button" autoFocus onClick={()=>dialog.current?.close()} aria-label="Close versions">×</button></header>
   <ConnectedVersionsLine/>
  </dialog>
 </main>;
}

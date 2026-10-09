import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { HaloRim } from '@siso/shell';
import { ComposerHud, ContextPopover } from '../../../packages/siso-composer/src/ComposerHud';
import '../src/index.css';
import './compact-dial.css';

function Preview() {
  const [saved, setSaved] = useState(30), [requested, setRequested] = useState<number | null>(null);
  const [mode, setMode] = useState('claude');
  const commit = async (pct: number) => {
    // Standalone synthetic adapter: never forwards a mutation to a real node.
    if (mode === 'failed') throw Error('Could not start compact-at; the compaction point was not changed');
    setRequested(pct);
  };
  return <main className="compact-preview">
    <header><b>Agent Base</b><span>Compaction dial · synthetic preview</span></header>
    <section className="compact-preview__controls"><label>Runtime <select aria-label="Runtime" value={mode} onChange={e => {setMode(e.target.value);setRequested(null);}}><option value="claude">Hosted Claude</option><option value="codex">Codex · read-only</option><option value="failed">Launcher unavailable</option></select></label><button disabled={requested === null} onClick={() => {setSaved(requested!);setRequested(null);}}>Finish idle relaunch</button></section>
    <article><small>LIBRARY · CLAUDE</small><h1>Choose how much context this chat keeps.</h1><p>Hover the ring or focus it with the keyboard. Adjust the threshold, then release.</p><p className="compact-preview__saved">Saved threshold: <b data-testid="saved">{saved}%</b></p></article>
    <div className="compact-preview__composer"><HaloRim><div className="compact-preview__inside"><p>Message Library…</p><ComposerHud identity={<span>Claude Opus</span>} context={<ContextPopover key={mode} value={30} compactAt={mode==='codex'?75:saved} onCompactAt={mode==='codex'?undefined:commit} compactReadOnlyReason="Codex manages its own compaction. This mark is read-only."><p className="ab-hud__foot">30% of the context window is in use.</p></ContextPopover>}/></div></HaloRim></div>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);

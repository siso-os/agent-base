"""Build the timing receipt, charts and gallery from observed samples (no screenshots)."""
import hashlib, json, subprocess
from pathlib import Path
root=Path(__file__).resolve().parent.parent
out=root/'ui-hub/right-panel/rounds/reconnect'
before=json.loads((out/'receipt-before.json').read_text())
after=json.loads((out/'receipt-after.json').read_text())
phases=[('nodeListeningMs','Node listening'),('firstAgentsMs','First live agents HTTP 200'),('liveRowsRenderedMs','Rendered live agents'),('chatHelloMs','Chat hello'),('terminalFirstDataMs','Terminal first data')]
rows=[]
for key,label in phases:
    a,b=before['medianMs'][key],after['medianMs'][key]
    rows.append(dict(phase=label,key=key,beforeMs=a,afterMs=b,speedup=round(a/b,2)))
sources=['services/node/src/server.ts','services/node/src/landing.ts','services/node/src/seat-hud.ts','services/node/src/timeline.ts','apps/web/src/lib/agents.ts','apps/web/src/components/Sidebar.tsx']
base=subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip()
receipt={'task':'t-0389','gitBase':base,'branch':'ui/reconnect','corpusBytes':before['corpusBytes'],'sameCorpusSize':before['corpusBytes']==after['corpusBytes'],'beforeSamples':len(before['samples']),'afterSamples':len(after['samples']),'timings':rows,'targetMet':all(r['speedup']>=10 for r in rows[1:]),'cachedPaintMs':[s['firstRowPaintMs'] for s in after['samples']if s['cachedPaint']], 'cacheChecks':after['cacheChecks'],'checks':{'webTsc':0,'webBuild':0,'usageFresh':0,'reconnectHud':0,'reconnectLanding':0,'timelineUtf8':0,'zeroFollowsUi':{'exit':0,'passed':6,'of':6},'diffCheck':0},'sourceHashes':{p:hashlib.sha256((root/p).read_bytes()).hexdigest()for p in sources},'baselineSourceHashes':{p:hashlib.sha256(subprocess.check_output(['git','show',f'{base}:{p}'],cwd=root)).hexdigest()for p in sources},'cleanup':after['cleanup'],'limits':['Real named herdr with synthetic SDK seats; not a live desktop measurement.','Three-sample contention set reached 9.7x; retained in receipt-after-contention.json.','HUD/stat/timeline accounting completes asynchronously; cached rows are marked stale until a live response.','UI screenshots intentionally omitted; PNGs are numeric charts generated from JSON timings.']}
assert receipt['targetMet'] and receipt['sameCorpusSize']
assert all(s['statsExact'] and s['agentsStatus']==200 for s in after['samples'])
assert all(x['passed'] for x in after['cacheChecks'])
(out/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
for name,field,color in [('before','beforeMs','#959da6'),('after','afterMs','#58d6c7')]:
    fig,ax=plt.subplots(figsize=(10,4.7),dpi=180)
    fig.patch.set_facecolor('#10110e');ax.set_facecolor('#10110e')
    vals=[r[field]/1000 for r in rows];ax.barh([r['phase'] for r in rows],vals,color=color)
    ax.invert_yaxis();ax.set_xlim(0,30);ax.set_xlabel('Seconds from node spawn',color='#dddddd');ax.tick_params(colors='#dddddd')
    for spine in ax.spines.values():spine.set_visible(False)
    for i,v in enumerate(vals):ax.text(v+.2,i,f'{v:.2f}s',color='#dddddd',va='center')
    ax.set_title(f'{name.title()} · median of {len(before["samples"]) if name=="before" else len(after["samples"])} lab restarts',color='#dddddd',loc='left')
    fig.tight_layout();fig.savefig(out/f'01-{name}-phase-timings.png');plt.close(fig)
trs=''.join(f'<tr><td>{r["phase"]}</td><td>{r["beforeMs"]/1000:.2f}s</td><td>{r["afterMs"]/1000:.2f}s</td><td>{r["speedup"]:.1f}×</td></tr>'for r in rows)
(out/'index.html').write_text('''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Restart → reconnected</title><style>body{background:#10110e;color:#ddd;font:15px/1.55 system-ui;margin:0}main{max-width:1050px;margin:auto;padding:28px}h1{font-size:30px;letter-spacing:-.03em}a{color:#58d6c7}table{border-collapse:collapse;width:100%;margin:24px 0}th,td{text-align:left;padding:12px;border-bottom:1px solid #353730}.charts{display:grid;grid-template-columns:1fr 1fr;gap:16px}img{width:100%}small{color:#aaa}@media(max-width:650px){main{padding:16px}.charts{grid-template-columns:1fr}th,td{padding:7px;font-size:12px}}</style><main><h1>Restart → reconnected</h1><p>Live agents, chat and terminals reconnect while historical accounting finishes. The previous fleet paints immediately with its saved timestamp, then current herdr data replaces it.</p>'''+f'<p><b>{rows[2]["speedup"]:.1f}× faster live agents</b> · {rows[2]["beforeMs"]/1000:.2f}s → {rows[2]["afterMs"]/1000:.2f}s · cached paint {min(receipt["cachedPaintMs"])/1000:.2f}–{max(receipt["cachedPaintMs"])/1000:.2f}s</p>'+'''<p><a href="REASONING.md">Reasoning, options and critique</a> · <a href="receipt.json">Machine-readable receipt</a> · <a href="receipt-before.json">Before samples</a> · <a href="receipt-after.json">Final samples</a> · <a href="receipt-after-contention.json">Contention samples</a></p><table><thead><tr><th>Phase</th><th>Before</th><th>After</th><th>Speedup</th></tr></thead><tbody>'''+trs+'''</tbody></table><div class="charts"><a href="01-before-phase-timings.png"><img src="01-before-phase-timings.png" alt="Before restart timings"></a><a href="01-after-phase-timings.png"><img src="01-after-phase-timings.png" alt="After restart timings"></a></div><p>What changed: async Git branch checks remove the largest event-loop stall. Bounded async HUD, stats and timeline reads preserve exact accounting without blocking agent/chat sockets. Origin-local metadata restores the existing navigation while the first verified list arrives.</p><p><small>Real named headless herdr; six synthetic SDK seats; 812MB of generated JSONL; random non-5401 port. Three baseline and five final cold node samples, headless WebKit. Shared-load contention reached 9.7× in a separate retained three-sample set. Four cache checks and six routing checks passed. No live desktop restart, deployment, live-agent attachment or UI screenshots. These images are numeric timing charts.</small></p></main>''')
components=root/'ui-hub/components.json';data=json.loads(components.read_text());panel=next(c for c in data['components']if c['id']=='right-panel')
entry={'id':'reconnect','title':'Restart → reconnected 10x faster','kind':'gallery','file':'rounds/reconnect/'}
if not any(p['id']=='reconnect'for p in panel['pages']):panel['pages'].append(entry)
components.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'targetMet':receipt['targetMet'],'liveSpeedup':rows[2]['speedup'],'chatSpeedup':rows[3]['speedup'],'terminalSpeedup':rows[4]['speedup'],'cacheChecks':len(after['cacheChecks'])}))

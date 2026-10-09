import assert from 'node:assert/strict';
import { buildOrgPresentation, orgSeatStatus } from './OrgChartModel.ts';
const hub=(name,extra={})=>({ name,kind:'owner',project:'Example',domain:'Build',icon:'layers',accent:'#ffb000',harness:'codex',model:'fixture',machine:'fixture',state:'idle',spunUp:true,...extra });
const zero=hub('A0',{kind:'zero'}), owner=hub('OWNER',{role:'Keep the project ready',holding:{id:'task',title:'Verify the example',status:'building'}}), infra=hub('EFFICIENCY');
const org={zero,top:['OWNER','EFFICIENCY','MISSING'],groups:[{id:'labs',name:'Labs',icon:'layers',projects:[{name:'Example',icon:'layers',accent:'#ffb000',domains:[{name:'Build',owner},{name:'Alias',owner},{name:'Infrastructure',owner:infra}]}]}]};
const roster={groups:[{id:'labs',name:'Labs',projects:[{id:'example',name:'Example',owners:[{name:'OWNER',domain:'Build',state:'live',working:1,plan:null},{name:'PLANNED',domain:'Research',state:'planned',working:0,plan:null}]}]}],bottom:[{name:'EFFICIENCY',state:'live',working:0,plan:null}]};
const row=(id,name,extra={})=>({id,key:id,name,title:'',row:'live',status:'idle',project:'Example',owner:'OWNER',lead:null,role:null,...extra});
const workers=[row('owner','OWNER',{kind:'owner'}),row('a','ACTIVE',{parentId:'owner',status:'working',title:'Run the fixture'}),row('b','TURN-DONE',{parentId:'owner',status:'done'}),row('c','SETTLED',{parentId:'owner',row:'settled'}),row('d','NESTED',{parentId:'a'}),row('e','UNKNOWN',{owner:null,parentId:'owner',ownershipResolved:false}),row('f','CYCLE-A',{owner:null,parentId:'g'}),row('g','CYCLE-B',{owner:null,parentId:'f'}),row('service','EFFICIENCY',{kind:'owner',infrastructureRole:'EFFICIENCY'}),row('a','ACTIVE',{parentId:'owner',status:'working',title:'Run the fixture'})];
const p=buildOrgPresentation(org,workers,roster);
assert.equal(p.owners.filter(s=>s.name==='OWNER').length,1);
assert.equal(p.infrastructure.length,1);assert(!p.owners.some(s=>s.name==='EFFICIENCY'));
assert.equal(orgSeatStatus(p.owners.find(s=>s.name==='PLANNED')),'Planned seat');
assert.equal(orgSeatStatus(p.owners.find(s=>s.name==='MISSING')),'State not recorded');
assert.equal(p.workers.length,7);assert.equal(new Set(p.workers.map(w=>w.agent.id)).size,7);
assert.equal(p.history,1);assert.equal(p.current,6,'turn done stays current until settled');
assert.equal(p.workers.find(w=>w.agent.id==='d').parent,'worker:a');
assert.equal(p.workers.find(w=>w.agent.id==='e').parent,'unassigned','unresolved fallback does not invent parent');
assert(p.workers.some(w=>w.reason==='Parent relationship is cyclic'));
assert(p.owners.find(s=>s.name==='OWNER').places.length>=2,'conflicting placements stay visible without repeating rows');
const preferred=buildOrgPresentation(org,[row('a','ACTIVE',{row:'live'}),row('a','ACTIVE',{row:'settled'})],roster);assert.equal(preferred.workers[0].agent.row,'live');
console.log('PASS: unique owners/workers, explicit infrastructure, planned/missing seats, live vs settled, nested and unresolved/cyclic parents, retained conflicting placement');

const aliases = buildOrgPresentation({...org,top:[...org.top,'AGENT-BASE','AGENT BASE']},[
  row('base-old','AGENT-BASE',{kind:'owner',row:'settled'}),
  row('base-main','AGENT BASE',{kind:'owner',main:true,status:'working'}),
  row('base-other','AGENT-BASE',{kind:'owner',status:'idle'}),
  row('base-child','BASE-CHILD',{owner:'AGENT BASE'}),
  row('dash','OTHER-NAME',{kind:'owner'}),row('space','OTHER NAME',{kind:'owner'}),row('prefixed','SOL-OWNER',{kind:'owner'}),row('decorated','Session | OWNER',{kind:'owner'})
],{...roster,groups:[{...roster.groups[0],projects:[{...roster.groups[0].projects[0],owners:[...roster.groups[0].projects[0].owners,{name:'AGENT-BASE',state:'offline'},{name:'AGENT BASE',state:'live'}]}]}]});
const base = aliases.owners.find(s=>s.key==='owner:AGENT-BASE');
assert.equal(aliases.owners.filter(s=>s.key==='owner:AGENT-BASE').length,1,'approved display alias has one seat');
assert.equal(base.runtime.id,'base-main','primary active main session opens first');
assert.deepEqual(new Set(base.runtimes.map(a=>a.id)),new Set(['base-old','base-main','base-other']),'every historical and live session retained');
assert.deepEqual(new Set(base.recordedNames),new Set(['AGENT-BASE','AGENT BASE']));
assert.equal(base.rosterRecords.length,2,'source states preserved');
assert.equal(aliases.workers.find(w=>w.agent.id==='base-child').parent,base.key);
assert(aliases.owners.some(s=>s.name==='OTHER-NAME') && aliases.owners.some(s=>s.name==='OTHER NAME'),'unknown punctuation aliases are never inferred');
assert(aliases.owners.some(s=>s.name==='SOL-OWNER') && aliases.owners.some(s=>s.name==='Session | OWNER'),'unapproved prefixes and decorated names remain separate identities');
console.log('PASS: approved Agent Base alias retains source names, states and all sessions; unknown aliases stay separate');

const projectAliases = buildOrgPresentation({...org,groups:[{...org.groups[0],projects:[
  {name:'SISO Internal Labs',domains:[{name:'Build',owner}]},
  {name:'Agent Base',domains:[{name:'Build',owner}]},
  {name:'SISO Labs',domains:[{name:'Setup',owner:hub('ALEX-SETUP')}]}
]}]},[],{...roster,groups:[{...roster.groups[0],projects:[{id:'agent-base',name:'Agent Base',owners:[{name:'OWNER',domain:'Build',state:'offline'}]}]}]});
const projectedOwner=projectAliases.owners.find(s=>s.name==='OWNER');
assert.deepEqual(projectedOwner.places.map(p=>p.project),['Agent Base']);
assert.deepEqual(new Set(projectedOwner.recordedPlaces.map(p=>p.project)),new Set(['Agent Base','SISO Internal Labs']),'raw placement provenance remains available');
assert.equal(projectAliases.owners.find(s=>s.name==='ALEX-SETUP').places[0].project,'SISO Labs','ambiguous legacy seat is never silently moved');
console.log('PASS: approved legacy project display folds once with provenance; unresolved ALEX placement retained');

// Synthetic contracts only. No filesystem, private catalogue, account or service reads.
// Shapes reused from base-card-fixture, Library serve fixture, WhatsApp preview and page API types.
import { baseCardFixture } from './base-card-fixture.mjs';
export const FIXTURE_NOW=1791244800000;
// Typed Estate input is generated here; neither its real snapshot nor proposed records are read.
const estateRegions=[
 {id:'mainland',name:'Synthetic QA island',sub:'Synthetic fixture only',tone:'#7fb069',x:0,z:0},
 {id:'library',name:'Synthetic library island',sub:'Synthetic fixture only',tone:'#a0b878',x:-28,z:-32},
 {id:'personal',name:'Synthetic sealed island',sub:'No private data',tone:'#a0a9b8',x:-36,z:12},
];
export const estateFixture = {
 generated_at:new Date(FIXTURE_NOW).toISOString(),era:'xiaogang',score:1,
 regions:estateRegions,
 districts:estateRegions.map(r=>({region:r.id,name:'qa',x:r.x,z:r.z,n:r.id==='mainland'?2:0,partner:false})),
 tiles:estateRegions.flatMap(r=>[[0,0],[5.54256,0],[-5.54256,0],[2.77128,4.8],[-2.77128,4.8],[2.77128,-4.8],[-2.77128,-4.8]].map(([x,z])=>({x:r.x+x,z:r.z+z,region:r.id,d:'qa'}))),
 buildings:['a','b'].map((id,i)=>({id:'qa-building-'+id,path:'synthetic/estate-'+id,name:'Synthetic building '+id.toUpperCase(),kind:'app',life:'active',size:1024,c14:1,d30:1,score:1,ok:true,prov:'Synthetic QA only',upstream:null,keeper:'Fixture owner',public:false,vps:false,laptop:true,lit:true,unpushed:false,desc:'Deterministic synthetic Estate fixture. No real records.',x:i*5.54256,z:0,region:'mainland',district:'qa'})),
 roads:[],agents:[],vault:[],vault_total:0,landmarks:[],horizon:[],weather:{up_to_code:2,repos_scored:2,wrong_births:0,loose_keys:0},counts:{buildings:2},machines:{},
};
export const estateProposedFixture={merges:[],archive:[]};
const now=FIXTURE_NOW,iso=new Date(now).toISOString(),day=iso.slice(0,10),sec=now/1000;
const sum={input:1200,output:300,cacheRead:200,cacheWrite:0,total:1700,cost:0.02,unpricedTokens:0,messages:2};
const zero={id:'fixture-zero',key:'fixture/zero',pane:'',name:'Agent Zero',title:'Agent Zero',status:'idle',zero:true,a0:true,chat:true,host:true,project:'Agent Base',folder:'fixture',cwd:'/synthetic/agent-base',tool:'siso',session:'synthetic-qa',since:now,lastEvent:now,hud:null,pages:[],row:'live'};
const f=baseCardFixture(zero,now);
// The shared nav fixture refers to screenshots supplied by its own preview server.
// Use visibly labelled synthetic image data here; never borrow real UI evidence.
for(const task of f.tasks)if(task.shots)task.shots=Object.fromEntries(['before','after'].map(state=>[state,'data:image/svg+xml,'+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="480" height="240"><rect width="480" height="240" fill="#202820"/><text x="24" y="120" fill="#fff" font-size="24">Synthetic ${state} fixture</text></svg>`)]));
const hubAgent={name:'AGENT BASE',kind:'owner',project:'Agent Base',icon:'bot',accent:'#66bb6a',harness:'codex',model:'gpt-6-astra',machine:'fixture',state:'idle',spunUp:true,workers:{total:0,working:0},plan:{checked:1,total:2,counts:{building:1,live:1}}};
const waChat={jid:'fixture-one@s.whatsapp.net',name:'Avery Fixture',isGroup:false,lastTs:sec,unread:1,preview:'Synthetic launch notes are ready.'};
const waCounts={chats:1,groups:0,messages:1,unreadChats:1};
const waMessage={chat:waChat.jid,id:'fixture-message',senderName:waChat.name,fromMe:false,ts:sec-60,kind:'text',text:'Synthetic message for the communications review. No real account is connected.'};
const doc={id:'fixture:internal',title:'Synthetic QA handbook',project:'agent-base',domain:'library',owner:'QA fixture',source:'Synthetic fixture',reference:'fixture/README.md',revision:'synthetic',privacy:'internal',availability:'local',checkedAt:now,url:null,text:'# Synthetic QA handbook\n\nThis document exercises the local Library reader.',note:'Synthetic document; no private catalogue is read.'};
const library={at:now,counts:{built:1,live:1,works:1,templates:0,lifecycle:{active:1},islands:{engine:1},vps:0},built:{rows:[{postcode:'engine/fixture-app',path:'fixture/app',island:'engine',lifecycle:'active',machines:['laptop'],commits:1,sizeKb:1,seat:null,provenance:'synthetic',description:'Fixture application',live:null}],source:'fixture',error:null},live:{rows:[{id:'fixture-preview',name:'Fixture preview',group:'labs',project:'agent-base',url:'https://example.test/fixture',host:'local',machine:'fixture',status:'up',code:200,checkedAt:now,note:'Synthetic surface'}],source:'fixture'},works:{rows:[{id:'fixture-work',slug:'fixture-work',name:'Fixture research work',summary:'A synthetic work for route acceptance.',kind:'research',maturity:'documented',section:'Research',owner:'QA fixture',reference:'fixture/work.json',revision:'synthetic',url:null,sourceLinks:[]}],templates:[],site:'https://example.test',shell:'https://example.test',generated:iso,fetchedAt:now,stale:false,error:null,templatesError:null},documents:{rows:[doc],source:'fixture',fetchedAt:now,stale:false,error:null,scope:'Synthetic fixture; no private inventory.'}};
const usage={source:'stack-opt',data:{at:now,window_min:60,claude:[],grants:[],codex:{credits_per_hour:[1,2],pct_of_budget_per_hour:[0.1,0.2],today_credits:[1,2],left:[90,100],hours_left_at_rate:50,by_model_per_hour:{}}}};
const ship={at:iso,today:{live:1,deploys:1,leadMin:{median:5,min:5,max:5},waiting:0,conflict:0,failed:0,dropped:0,gaps:[]},lanes:[{id:'fixture-ship',branch:'codex/fixture',by:'QA fixture',state:'live',built_at:iso,live_at:iso,why:'Synthetic release'}]};
const health={source:'probe',at:now,level:'ok',why:[],state:'ok',detail:'Synthetic health',cpus:8,load:[1,1,1],memTotalGb:16,memAvailGb:8,diskTotalGb:256,diskFreeGb:64,diskUsedGb:192,upDays:1};
const server={key:'fixture',name:'Fixture machine',role:'Synthetic QA',status:'active',here:true,client:false,onBoard:true,agentsVisible:true,agentMachine:'fixture',watched:true,health,agents:{count:1,byStatus:{idle:1},byKind:{owner:1},source:'fixture',note:null},agentFaces:[],services:{count:0,failed:0},tokensToday:null,tokensWhyNull:'Synthetic fixture'};
const config={version:1,levelSize:100,streakMin:1,dailyTarget:20,morning:[{key:'plan',label:'Review synthetic plan',check:true}],counters:[{key:'water',label:'Water',unit:'glass',inc:1,goal:8,good:'up'}],checkout:[{key:'review',label:'Synthetic reflection',input:{key:'review',type:'text'}}]};
const person={id:'fixture-avery',name:'Avery Fixture',note:'Synthetic QA collaborator',kinds:['client'],projects:[{id:'fixture-project',name:'Fixture project',folder:'fixture/project',kind:'client',available:true}],relation:'client',aliases:[],labels:[],words:[],status:'active'};
const counts={thought:0,specced:0,allocated:0,building:1,tested:0,preview:0,feedback:0,live:1,parked:0,dropped:0};
export const fixtureChatHello={t:'hello',session:'synthetic-qa',state:'idle',log:[{t:'text',id:'qa-reply',text:'Synthetic QA conversation. No agent session is connected.',at:now}],partial:{},tasks:[],bg:[]};
export function fixtureResponse(pathname,revision){
 const fixture={
 '/api/browser/state':{spaces:[],folders:[],accounts:[],today:{},setup:{step:4,doneAt:1},choice:{},last:'',migratedAt:1},
 '/api/attention':{items:[],healthy:true,settings:{desktop:false,phone:false,phoneConfigured:false,appUrl:'',snoozeUntil:0}},
 '/api/workspace-registry':{workspaces:[],taskIdentities:{},taskAliases:{}},
 '/api/reviews':{reviews:[],availability:'available',coverage:'Synthetic fixture'},'/api/scratchpad':{date:day,updated:now,items:[]},
 '/api/a0/now':{at:now,lanes:{at:now,data:{at:sec,tabs:[],pairs:[],runs:[]},error:null},stack:{at:now,data:[],error:null},renewals:{at:now,data:[],error:null},needs:{at:now,data:{total:0,items:[]},error:null},ship:{at:now,data:{liveSha:revision,queued:[],rows:[]},error:null},budget:{at:now,data:{claude:[],codex:{balance:100}},error:null},today:{at:now,data:[],error:null}},
 '/api/health':{ok:true},'/api/version':{sha:revision},
 '/api/delight':{deliveries:[],error:'Synthetic QA has no joined live delivery evidence.'},
 '/api/remote/agents':{enabled:false,configured:false,readOnly:true,at:now,sources:[]},
 '/api/agents':{agents:f.agents,pinned:['fixture-zero'],domains:[],workspaces:[],recentPages:[],pinnedPages:[],projects:f.projects},
 '/api/org':f.org,'/api/a0/tasks':{tasks:f.tasks,counts,updated:iso},'/api/tasks':{tasks:f.tasks},'/api/owners':{owners:[]},'/api/ended':{ended:[{id:'fixture-ended',name:'Finished fixture',pane:'',terminal:'',session:null,cwd:'/synthetic',project:'Agent Base',tool:'codex',started:now-60000,ended:now,status:'done',task:'Synthetic finished task',machine:'fixture'}]},'/api/tabs':{tabs:[]},
 '/api/machines':{machines:[]},'/api/mini/lanes':{enabled:true,reachable:true,note:'Synthetic Mini fixture',lanes:[]},
 '/api/whatsapp/config':{configured:true},'/api/whatsapp/health':{link:{state:'connected',loggedIn:true,connected:true,since:sec},counts:waCounts,sendEnabled:false,appSendEnabled:false,readReceipts:false},'/api/whatsapp/chats':{chats:[waChat],counts:waCounts},'/api/whatsapp/organisation':{account:'fixture',revision:1,pins:{},folders:[{id:'fixture-folder',name:'Fixture clients',chats:[waChat.jid]}],saved:[]},'/api/whatsapp/rolodex':{people:[{jid:waChat.jid,name:waChat.name,isGroup:false,lastTs:sec,messages:1}]},
 '/api/life/status':{configured:true},'/api/life/config':config,'/api/life/xp':{total:20,level:1,intoLevel:20,levelSize:100,streak:1,streakMin:1,today:20,target:20,best:20,daysLogged:1,days:[{day,xp:20}]},
 '/api/rolodex':[person],'/api/rolodex/book':{people:[{id:'fixture-person',name:'Avery Fixture',level:'client',fullName:'Avery Fixture',from:'Fixture Town',added:iso,updated:iso,keys:[],gaps:['company','role'],talk:{messages:12,sent:5,last:sec}}],inbox:[{key:'wa:000000000001',name:'Casey Fixture',named:true,talk:{messages:40,sent:18,last:sec},proposal:{level:'friend',confidence:'low',reason:'40 messages both ways this year'}}],offCount:0,whatsapp:{state:'live',chats:2,named:2}},'/api/rolodex/sources':[{id:'registry',label:'Synthetic registry',state:'ok',at:iso,count:1}],'/api/rolodex/everyone':{total:1,hiddenNumbers:0,rows:[{id:person.id,name:person.name,labels:[]}]},
 '/api/library':library,
 '/api/product-map':{at:iso,taskAvailability:'available',taskError:null,ratingGate:'Synthetic read-only fixture; ratings are not written',rows:[{id:'fixture-surface',name:'Synthetic QA surface',kind:'page',summary:'Synthetic product catalog entry; no real evidence or rating is asserted.',status:'Fixture',rating:null,lane:'now',lastWorked:null,landedAt:null,screenshot:null,feedback:null,openFeedback:null,rounds:[],pages:[],tasks:[],active:[],issues:['No live acceptance is asserted by this fixture.']}]},
 '/api/dictation/status':{owner:'agent-base',switching:false,phase:'idle',error:'',hotkey:'Fixture',native:{registered:true,permission:true,updatedAt:now,error:''}},'/api/dictation/history':{entries:[{id:'fixture-dictation',timestamp:iso,app:'Synthetic fixture',bundleId:'',text:'Synthetic dictation for route acceptance.',cleanup:'done'}],total:1},
 '/api/voice/status':{watching:true,services:[{label:'com.siso.voice.runtime',loaded:true,running:true,ok:true,kind:'keepalive',lastKick:null,lastKickOk:null,kicks:0,checkedAt:iso}],lastDictationAt:iso},
 '/api/voice/activity':{days:{[day]:1},words:{[day]:8},hours:Array(24).fill(0),apps:[{app:'Fixture',entries:1,words:8}]},
 '/api/voice/history':{total:1,entries:[{id:1,timestamp:iso,app:'Fixture',bundleId:null,intent:'dictation',durationSeconds:2,hasAudio:false,text:'A synthetic dictation used only for QA.',raw:'A synthetic dictation used only for QA.',words:8,status:'done'}],apps:[{app:'Fixture',n:1}]},
 '/api/voice/stats':{totalWords:8,wordsToday:8,entries:1,wpm:120,topApp:'Fixture',streakDays:1,timeSavedMinutes:1,level:{level:1,title:'Fixture',xpInLevel:8,xpForNext:100,wordsToNext:92}},
 '/api/donor/work':{schema:1,state:'unconfigured',error:null,source:null,projects:[]},
 '/api/servers':{servers:[server],fleetAt:now,offBoard:[]},'/api/usage':usage,'/api/ship':ship,
 '/api/tokens':{at:now,scanning:false,scanMs:1,files:1,ranges:{today:day,weekFrom:day,monthFrom:day,timeZone:'UTC'},overall:{today:sum,week:sum,month:sum,allTime:sum},accounts:[{id:'codex',name:'Synthetic Codex',kind:'codex',person:{email:null,label:'QA fixture',mine:true},today:sum,week:sum,month:sum,allTime:sum,firstAt:now,lastAt:now,models:[{model:'gpt-6-astra',total:1700,cost:0.02}],limits:null}],daily:[{day,total:1700,output:300,cost:.02,byAccount:{codex:1700}}],heatmap:[{day,value:1700,level:1}],hourOfDay:Array.from({length:24},(_,hour)=>({hour,total:hour===10?1700:0,output:hour===10?300:0})),attribution:{},achievements:[],notes:['Synthetic token data']},
 '/api/tokens/money':{at:now,pending:false,grants:[],codex:{balance:100,balanceAt:now,budget:100,plan:'Synthetic',todaySpent:1,yesterdaySpent:2,byDay:{[day]:1},reset:now+86400000,resetNote:'Synthetic'},other:[],notes:['Synthetic balances']},
 '/api/tokens/split':{day,pending:false,luna:0,sol:1,lunaPct:0,solPct:100,target:{luna:80,sol:20},seen:1,total:1,seenPct:100},'/api/tokens/fleet':{host:'fixture',at:now,pending:false,error:null,devices:[{device:'fixture',today:1700,total:1700,lastSeen:now,stale:false}]},
 '/api/spend':{source:'stack-opt',data:{day,claude_usd_equiv:0,codex_credits:[1,2],attributed_to_plan_items:1,projects:[],plan_items:[],note:'Synthetic spend'}},
 '/api/releases':{releases:[{version:1,at:iso,sha:revision,kinds:['feat'],commits:[{sha:revision,subject:'Synthetic checked release',line:'Synthetic checked release',author:'QA fixture',tag:null,at:iso}],evidence:{state:'unavailable',pairs:[],reason:'Synthetic release fixture'}}],pending:{ref:null,commits:[]}},
 '/api/not-landed':{branches:[],live:{sha:revision,main:revision,behind:0},fetchedAt:iso},
 '/api/hub/agents':{agents:[hubAgent]},'/api/hub/org':{zero:{...hubAgent,name:'Agent Zero',kind:'zero'},top:[],groups:[{id:'labs',name:'SISO Labs',icon:'flask',projects:[{name:'Agent Base',icon:'bot',accent:'#66bb6a',domains:[{name:'QA fixture',owner:hubAgent}]}]}]},
 '/api/hub/a0':{current:{session:'synthetic-qa',model:'gpt-6-astra',effort:'high',state:'idle'},sessions:[],goals:[],timeline:[],needsYou:[],tasks:{counts,running:[]},memory:[],gaps:[]},
 '/api/codex-lanes':{at:sec,tabs:[{pane:'fixture',tab:'QA fixture',status:'done',model:'gpt-6-astra',cwd:'/synthetic',branch:'codex/fixture',worked:'1 minute',said:['Synthetic finished job'],last_commit:null}],pairs:[],runs:[]},
 '/api/research':{fleets:{at:now,error:null,data:[{name:'QA research fixture',model:'gpt-6-astra',created:iso,finished:iso,jobs:[],then:null}]},topics:{at:now,error:null,data:[{id:'fixture-topic',title:'Synthetic findings',updated:iso,preview:'Synthetic findings for QA.',markdown:'# Synthetic findings',fleets:[],error:null}]}},
 '/api/timeline':{day,moments:[],unavailable:[],hasEarlier:false},'/api/pipeline':{pending:[]},'/api/asks':{asks:[]},'/api/feedback':{items:[]},
 };
 if(pathname in fixture)return fixture[pathname];
 if(/^\/api\/life\/day\//.test(pathname))return {day:pathname.split('/').pop(),state:{checks:{plan:true},sets:{review:'Synthetic reflection'},counters:{water:2}},xp:{total:20,items:[{id:'plan',label:'Review plan',xp:20}],target:20}};
 if(/^\/api\/whatsapp\/chats\/[^/]+\/messages$/.test(pathname))return {chat:waChat,messages:[waMessage]};
 if(/^\/api\/spaces\/[^/]+$/.test(pathname))return {project:'agent-base',agents:f.agents,layout:{positions:{'pin:fixture-pin':{x:500,y:0}},collapsed:{}},pins:[{id:'fixture-pin',title:'Synthetic QA pin',kind:'note',by:'QA fixture',at:iso,markdown:'Read the fixture plan.'}]};
 if(/^\/api\/hub\/project\//.test(pathname))return {id:'agent-base',name:'Agent Base',group:'labs',line:'Synthetic project',accent:'#66bb6a',icon:'bot',owners:[hubAgent],counts,open:[],needsYou:[],timeline:[],health:[],spendToday:null};
 if(/^\/api\/agents\/[^/]+\/notifications$/.test(pathname))return {notifications:[]};
 if(/^\/api\/agents\/[^/]+\/stats$/.test(pathname))return {first:iso,last:iso,prompts:1,apiCalls:1,tokens:{input:1200,output:300,cacheRead:200,cacheWrite:0,total:1700,cachePct:15},toolCalls:0,tools:{},skills:{},subagents:{count:0,recent:[]},models:{'gpt-6-astra':1},hours:[],costUsd:0.02};
 if(/^\/api\/agents\/[^/]+\/subagents$/.test(pathname))return {rows:[]};
 if(/^\/api\/agents\/[^/]+\/context$/.test(pathname))return {kinds:{files:0,shell:0,subagents:0,talk:0,tools:0},top:[]};
 return undefined;
}
export function fixtureEvent(pathname){
 if(pathname==='/api/a0/tasks/events')return `event: index\ndata: ${JSON.stringify(fixtureResponse('/api/a0/tasks','fixture'))}\n\n`;
 if(pathname==='/api/owners/events')return 'data: {"owners":[],"warnings":[],"error":null}\n\n';
 if(pathname==='/api/whatsapp/events')return ': synthetic fixture\n\n';
 return null;
}

export function fixtureStreams(revision){return {'/api/owners/events':{type:'message',data:{owners:[],warnings:[],error:null}},'/api/a0/tasks/events':{type:'index',data:fixtureResponse('/api/a0/tasks',revision)},'/api/whatsapp/events':null};}

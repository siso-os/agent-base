import { fixtureResponse } from '../../../tools/ab-qa-fixtures.mjs';
export function usageFixture(pathname) {
 const now=Date.now(), day=new Date(now).toLocaleDateString('en-CA');
 const base=fixtureResponse(pathname,'052c660a');
 if(pathname==='/api/version')return {web:'fixture-web',node:'fixture-node',desktop:'fixture-desktop',sha:'cccccccc',line:{source:{ref:'HEAD',sha:'aaaaaaaa'},preview:{ref:'refs/preview',sha:'bbbbbbbb'},live:{ref:'refs/live',sha:'cccccccc'},layers:{web:'bbbbbbbb',node:'cccccccc'}}};
 if(pathname==='/api/ship'){base.at=new Date(now).toISOString();base.lanes[0].built_at=new Date(now-600000).toISOString();base.lanes[0].live_at=new Date(now-300000).toISOString();return base;}
 if(pathname==='/api/servers'){base.servers[0].agents.byStatus={working:1};return base;}
 if(pathname==='/api/tokens') {
  base.ranges.today=day; base.at=now;
  const sum={...base.overall.today,total:1200000,cost:21.25};
  const total={...sum,total:2400000,cost:42.5};base.overall={today:total,week:total,month:total,allTime:total};
  base.daily=Array.from({length:30},(_,i)=>{const count=600000+(i*173113)%1800000;return {day:new Date(now-(29-i)*86400000).toLocaleDateString('en-CA'),total:count,output:count/4,cost:count/100000,byAccount:{'claude:fixture-0':count*.6,'claude:fixture-1':count*.4}};});
  base.hourOfDay=Array.from({length:24},(_,hour)=>({hour,total:hour<6?30000+hour*14000:100000+(hour*31311)%140000,output:10000}));
  base.accounts=[25,100].map((used,i)=>({id:'claude:fixture-'+i,name:'Claude '+(i+1),kind:'claude',person:{email:null,label:'Claude '+(i+1),mine:true},today:sum,week:sum,month:sum,allTime:sum,firstAt:now,lastAt:now,models:[],limits:{source:'live Claude OAuth usage',at:now,stale:false,fiveHour:{usedPct:used,resetsAt:now+3600000,expired:false},weekly:{usedPct:used,resetsAt:now+86400000*(i+1),expired:false}}}));
  return base;
 }
 if(pathname==='/api/spend')return {source:'stack-opt',today:{from:'tokens',usd:42.5,day,observedAt:now},attribution:{source:'stack-opt',scope:'report-day',state:'fresh',observedAt:now,attemptedAt:now,day,reason:null},data:{day,claude_usd_equiv:30,codex_credits:[10,20],attributed_to_plan_items:30,plan_items:[],projects:[{project:'Fixture project',claude_usd_equiv:12,codex_credits:[2,4],owners:[]}]}};
 return base ?? {};
}

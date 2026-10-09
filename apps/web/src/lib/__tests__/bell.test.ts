// @ts-nocheck
import { bellItems, bellCounts, visibleBellItems, parseSnoozes, attentionArrivals } from '../bell';
import { attentionCommandState, updateAttentionCommand, reconcileAttentionCommands } from '../attention-command-state';
const now=1791446400000;
const item=(id='one',name='Astra')=>({id,ref:{hostInstanceId:id,sessionId:'session',runId:'run'},requestId:'shared',requestKind:'approval',phase:'needs',revision:1,read:false,at:new Date(now-1000).toISOString(),agentId:id,agentName:name,headline:'Same request'});
describe('bell triage contract',()=>{
  it('rings only for a new eligible activity arrival',()=>{
    const fresh={...item(),at:new Date(now-1000).toISOString(),buzz:true};
    expect(attentionArrivals([fresh],new Set(),now)).toHaveLength(1);
    expect(attentionArrivals([{...fresh,revision:2}],new Set([fresh.id]),now)).toHaveLength(0);
    expect(attentionArrivals([{...fresh,phase:'resolved'}],new Set(),now)).toHaveLength(0);
    expect(attentionArrivals([],new Set([fresh.id]),now)).toHaveLength(0);
  });
  it('does not ring for historical, replayed or non-buzz feed items',()=>{
    const fresh={...item(),at:new Date(now-1000).toISOString(),buzz:true};
    expect(attentionArrivals([{...fresh,buzz:false},{...fresh,at:new Date(now-120000).toISOString()}],new Set(),now)).toHaveLength(0);
  });
  it('retains in-flight and uncertain command guards outside row instances',()=>{
    updateAttentionCommand('fixture-one',{busy:true});
    expect(attentionCommandState('fixture-one').busy).toBe(true);
    updateAttentionCommand('fixture-one',{busy:false,blocked:true,error:'Delivery uncertain'});
    expect(attentionCommandState('fixture-one')).toMatchObject({busy:false,blocked:true,error:'Delivery uncertain'});
    expect(attentionCommandState('fixture-other').blocked).toBe(false);
    reconcileAttentionCommands(['fixture-one']);
    expect(attentionCommandState('fixture-one').blocked).toBe(true);
    reconcileAttentionCommands(['fixture-one-revision-2']);
    expect(attentionCommandState('fixture-one')).toMatchObject({busy:false,blocked:false,error:''});
  });
  it('clears successful reply state without turning a request into a decision',()=>{
    updateAttentionCommand('fixture-reply',{busy:true});
    updateAttentionCommand('fixture-reply',{busy:false,blocked:false,error:''});
    expect(attentionCommandState('fixture-reply')).toMatchObject({busy:false,blocked:false,error:''});
  });
  it('counts only unseen arrivals within 24 hours without losing pending requests or history',()=>{
    const rows=bellItems([
      {...item('old'),phase:'completed',at:new Date(now-86400001).toISOString()},
      {...item('boundary'),phase:'completed',at:new Date(now-86400000).toISOString()},
      {...item('seen'),phase:'completed',at:new Date(now-2000).toISOString()},
      {...item('new'),phase:'completed'},
      {...item('future'),phase:'completed',at:new Date(now+1).toISOString()},
      {...item('bad'),phase:'completed',at:'invalid'},
      {...item('pending'),read:true,at:new Date(now-86400001).toISOString()},
    ]);
    expect(bellCounts(rows,{},now,now-2000)).toMatchObject({needs:1,newCount:1,badge:2,unread:6});
    expect(bellCounts(rows,{},now,now)).toMatchObject({needs:1,newCount:0,badge:1});
    expect(visibleBellItems(rows,{},now,'all',false)).toHaveLength(7);
  });
  it('counts read requests and unread outcomes exactly once',()=>{
    const rows=bellItems([{...item(),read:true},{...item('two'),phase:'completed'},{...item('three'),phase:'failed',read:true}]);
    expect(bellCounts(rows,{},now)).toMatchObject({needs:1,outcomes:2,badge:2,unread:1});
    expect(visibleBellItems(rows,{},now,'needs',false)).toHaveLength(1);
    expect(visibleBellItems(rows,{},now,'needs',true)).toHaveLength(0);
  });
  it('keeps identical requests from two hosts distinct and pins Agent Zero',()=>{
    const rows=bellItems([item(),item('two','Agent Zero')]);
    expect(rows[0].owner.name).toBe('Agent Zero');
    expect(rows[0].identity).not.toBe(rows[1].identity);
    expect(bellCounts(rows,{},now).needs).toBe(2);
  });
  it('snoozes into Later without changing read or phase, then expires',()=>{
    const rows=bellItems([item()]);const snoozes={[rows[0].identity]:now+900000};
    expect(bellCounts(rows,snoozes,now)).toMatchObject({needs:0,later:1,badge:0});
    expect(visibleBellItems(rows,snoozes,now,'later',false)).toEqual(rows);
    expect(rows[0]).toMatchObject({phase:'needs',read:false});
    expect(bellCounts(rows,snoozes,now+900000)).toMatchObject({needs:1,later:0,badge:1});
  });
  it('a revised or withdrawn request escapes an old snooze; no approval inferred',()=>{
    const old=bellItems([item()])[0];const snoozes={[old.identity]:now+900000};
    expect(bellCounts(bellItems([{...item(),revision:2}]),snoozes,now).needs).toBe(1);
    const resolved=bellItems([{...item(),revision:2,phase:'resolved'}]);
    expect(bellCounts(resolved,snoozes,now)).toMatchObject({needs:0,outcomes:1,later:0});
    expect(resolved[0].body).toBe('Request ended · no decision is pending.');
  });
  it('isolates run and session identity even when row id is reused',()=>{
    const base=item();const old=bellItems([base])[0];
    for(const ref of [{...base.ref,runId:'new-run'},{...base.ref,sessionId:'new-session'},{...base.ref,hostInstanceId:'new-host'}])
      expect(bellItems([{...base,ref}])[0].identity).not.toBe(old.identity);
  });
  it('historical owner notes cannot claim a current pending request',()=>{
    const rows=bellItems([],[{key:'one',name:'Astra',status:'waiting-on-shaan',subtitle:'Historical note',at:now,read:false,workspace:'Lab'}]);
    expect(rows[0].phase).toBe('outcome');expect(rows[0].id).toBe('owner:one');
  });
  it('discards malformed, expired and unbounded stored snoozes',()=>{
    expect(parseSnoozes('bad',now)).toEqual({});expect(parseSnoozes('null',now)).toEqual({});
    expect(parseSnoozes(JSON.stringify({ok:now+1000,expired:now,wrong:'tomorrow',far:now+86400000}),now)).toEqual({ok:now+1000});
  });
  it('retains all 35 rows across shelves',()=>{
    const rows=bellItems(Array.from({length:35},(_,i)=>item(String(i))));
    expect(visibleBellItems(rows,{},now,'all',false)).toHaveLength(35);
  });
});

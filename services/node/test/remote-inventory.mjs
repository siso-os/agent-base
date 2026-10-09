import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import { createRemoteInventory, parseRemoteAgents, remoteTargets, remoteInventoryRoute, readRemoteHerdr } from '../src/remote-inventory.ts';
let tests = 0;
const ok = (name, fn) => { fn(); tests++; console.log(`PASS ${name}`); };
const target = { machineKey: 'mini', alias: 'mac-mini-herdr', session: 'existing' };
const row = (extra = {}) => ({ terminal_id: 'terminal-1', name: 'WORKER', agent: 'codex', agent_status: 'working', ...extra });
const payload = (...agents) => ({ result: { agents } });
ok('strict empty result is healthy', () => assert.deepEqual(parseRemoteAgents(payload(), target, 10), []));
for (const value of [{}, { result: {} }, { result: { agents: {} } }, payload(row(), row()), payload(row({ terminal_id: '' })), payload(row({ name: 'bad\nname' }))]) {
  ok('invalid or ambiguous payload rejected', () => assert.throws(() => parseRemoteAgents(value, target, 10)));
}
ok('cross-machine identities never collide', () => assert.notEqual(parseRemoteAgents(payload(row()), target, 10)[0].id, parseRemoteAgents(payload(row()), { ...target, machineKey: 'vps-siso' }, 10)[0].id));
ok('cross-session identities never collide', () => assert.notEqual(parseRemoteAgents(payload(row()), target, 10)[0].id, parseRemoteAgents(payload(row()), { ...target, session: 'other' }, 10)[0].id));
ok('parent is limited to observed same-machine/session identity', () => {
 const rows = parseRemoteAgents(payload(row(), row({ terminal_id: 'child', parent_terminal_id: 'terminal-1' })), target, 10);
 assert.equal(rows[1].parentId, rows[0].id);
 assert.equal(parseRemoteAgents(payload(row({ parent_terminal_id: 'foreign' })), target, 10)[0].parentId, null);
});
ok('private payload and terminal routing fields are not projected', () => {
 const got = parseRemoteAgents(payload(row({ cwd: '/private', prompt: 'private', session: 'private', token: 'secret' })), target, 10)[0];
 for (const field of ['cwd', 'prompt', 'session', 'token', 'terminal_id']) assert.equal(field in got, false);
 assert.equal(got.readOnly, true);
});
ok('estate mapping excludes local client retired unconfigured and unsafe targets', () => {
 const machine = (probe, extra = {}) => ({ status: 'on the map', fleet: { probe, ...extra } });
 const map = { laptop: machine('local'), mini: machine('mac-mini-herdr'), client: machine('client', {client:true}), retired: {...machine('old'),status:'retired'}, missing: machine('missing'), unsafe: machine('-option') };
 assert.deepEqual(remoteTargets(map, { herdr: { mini: ['existing'], client: ['existing'], retired: ['existing'], unsafe: ['existing'] } }), [target]);
});
let enabled = true, targets = [target], now = 10000, reads = 0, fail = false;
const inventory = createRemoteInventory({ enabled: () => enabled, targets: () => targets, now: () => now, ttlMs: 1000,
 read: async () => { reads++; if (fail) throw new Error('SECRET hostname/private path'); return payload(row()); } });
let result = await inventory.read();
ok('successful source records observation and fresh rows', () => { assert.equal(result.sources[0].state, 'fresh'); assert.equal(result.agents[0].state, 'working'); assert.equal(reads, 1); });
await inventory.read(); ok('TTL avoids duplicate reads', () => assert.equal(reads, 1));
now += 1001; fail = true; result = await inventory.read();
ok('outage retains rows marked unknown and last observation time', () => { assert.equal(result.sources[0].state, 'stale'); assert.equal(result.agents[0].state, 'unknown'); assert.equal(result.agents[0].stale, true); assert.equal(result.sources[0].observedAt, 10000); assert.ok(!JSON.stringify(result).includes('SECRET')); });
now += 1001; fail = false; result = await inventory.read();
ok('reconnect refreshes rows', () => { assert.equal(result.sources[0].state, 'fresh'); assert.equal(result.agents[0].stale, false); assert.equal(result.sources[0].observedAt, now); });
enabled = false; result = await inventory.read();
ok('disabled revokes cached rows immediately', () => { assert.deepEqual(result.agents, []); assert.deepEqual(result.sources, []); assert.equal(reads, 3); });
enabled = true; fail = true; result = await inventory.read();
ok('cold outage is unavailable not healthy empty', () => { assert.equal(result.sources[0].state, 'unavailable'); assert.deepEqual(result.agents, []); });
targets = []; result = await inventory.read(); ok('removed config revokes source', () => assert.deepEqual(result.sources, []));
targets = [target, { ...target, alias: 'other' }]; result = await inventory.read(); ok('ambiguous config fails closed', () => { assert.equal(result.configured, false); assert.deepEqual(result.agents, []); });
let finish; let active = [target]; let concurrent = 0;
const pending = createRemoteInventory({ enabled: () => true, targets: () => active, read: () => { concurrent++; return new Promise(r => { finish = r; }); } });
const first = pending.read(); const second = pending.read();
ok('concurrent readers share one request', () => assert.equal(concurrent, 1));
active = []; await pending.read(); finish(payload(row()));
const returned = await Promise.all([first, second]);
ok('in-flight completion cannot resurrect revoked target', () => returned.forEach(r => assert.deepEqual(r.agents, [])));
let routeReads = 0;
const route = remoteInventoryRoute({ read: async () => { routeReads++; return { agents: [] }; } });
for (const [method, suffix, status] of [['POST','','405'],['GET','?machine=other','400'],['GET','','200']]) {
 const response = { writeHead(code) { this.code = code; }, end(body) { this.body = body; } };
 await route({method, socket:{remoteAddress:'127.0.0.1'},headers:{}}, response, new URL(`http://localhost/api/remote/agents${suffix}`));
 ok(`route ${method} ${suffix || 'plain'}`, () => assert.equal(response.code, Number(status)));
}
for (const request of [{method:'GET',socket:{remoteAddress:'10.0.0.2'},headers:{}}, {method:'GET',socket:{remoteAddress:'127.0.0.1'},headers:{origin:'https://foreign.example'}}, {method:'GET',socket:{remoteAddress:'127.0.0.1'},headers:{origin:'null'}}]) {
 const response = { writeHead(code) {this.code=code;},end(){} };
 await route(request,response,new URL('http://localhost/api/remote/agents'));
 ok('remote peer or foreign origin rejected',()=>assert.equal(response.code,403));
}
ok('rejected methods and arbitrary selectors cause no inventory reads', () => assert.equal(routeReads, 1));
const brokenConfig = createRemoteInventory({enabled:()=>true, targets:()=>{throw new Error('private config path');}, read:async()=>{throw new Error('must not read');}});
const brokenResult = await brokenConfig.read();
ok('unreadable config fails closed with no private error',()=>{assert.equal(brokenResult.configured,false);assert.deepEqual(brokenResult.agents,[]);});
let transport;
const protocol = await readRemoteHerdr(target, async (...args) => { transport = args; return '{"result":{"agents":[]}}'; });
ok('transport reuses named authenticated machine with bounded fixed read', () => {
 assert.equal(transport[0], 'mac-mini-herdr'); assert.equal(transport[2], 15_000); assert.equal(transport[3], 1 << 20);
 assert.match(transport[1], /exec perl -e 'alarm 12; exec @ARGV' herdr --session 'existing' agent list/);
 assert.doesNotMatch(transport[1], /attach|launch|server start|update|--remote/);
 assert.deepEqual(protocol.result.agents, []);
});
ok('remote calling-pane and config identity stripped before read', () => assert.match(transport[1], /unset HERDR_ENV HERDR_PANE_ID HERDR_TAB_ID HERDR_WORKSPACE_ID HERDR_CONFIG_PATH/));
ok('known noninteractive binary locations included', () => assert.ok(transport[1].includes('$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:')));
await assert.rejects(readRemoteHerdr(target, async()=>{throw new Error('SECRET');}), {message:'remote inventory unavailable'});
ok('transport errors are redacted', () => {});
await assert.rejects(readRemoteHerdr({...target,alias:'-oProxyCommand=bad'},async()=>{throw new Error('must not run');}), {message:'invalid target'});
ok('unsafe transport alias rejected before command', () => {});
await assert.rejects(readRemoteHerdr({...target,session:"foo'; restart"},async()=>{throw new Error('must not run');}), {message:'invalid target'});
ok('session injection rejected before transport', () => {});
const scoped={machineKey:'vps-siso',alias:'siso-vps',session:'agent-home',user:'siso'};
ok('trusted catalog accepts explicit users and preserves legacy session strings',()=>{
 const map={mini:{status:'active',fleet:{probe:'mac-mini-herdr'}},'vps-siso':{status:'active',fleet:{probe:'siso-vps'}}};
 assert.deepEqual(remoteTargets(map,{herdr:{mini:['existing'],'vps-siso':[{session:'agent-home',user:'siso'}]}}),[target,scoped]);
 for(const entry of [{session:'agent-home'},{session:'agent-home',user:null},{session:'agent-home',user:'siso',command:'whoami'},{session:'agent-home',user:'../root'},{session:'agent-home',user:'-root'},{session:'agent-home',user:'siso;id'}])assert.equal(remoteTargets(map,{herdr:{'vps-siso':[entry]}}).length,0);
});
const scopedRows=parseRemoteAgents(payload(row(),row({terminal_id:'child',parent_terminal_id:'terminal-1'})),scoped,10);
ok('machine user binds opaque remote IDs and parent IDs without local routing',()=>{
 const other=parseRemoteAgents(payload(row()),{...scoped,user:'herdr'},10)[0],legacy=parseRemoteAgents(payload(row()),{...scoped,user:undefined},10)[0];
 assert.notEqual(scopedRows[0].id,other.id);assert.notEqual(scopedRows[0].id,legacy.id);assert.equal(scopedRows[0].machineUser,'siso');assert.equal(scopedRows[1].parentId,scopedRows[0].id);
 assert.ok(scopedRows.every(a=>a.id.startsWith('remote:')&&!('terminal_id' in a)));
});
let userReads=0,userTargets=[scoped,{...scoped,user:'herdr'}];
const users=createRemoteInventory({enabled:()=>true,targets:()=>userTargets,read:async()=>{userReads++;return payload(row());}});
const userResult=await users.read();await users.read();
ok('different users sharing machine/session coexist and cache separately',()=>{assert.equal(userResult.configured,true);assert.equal(userResult.sources.length,2);assert.equal(new Set(userResult.agents.map(a=>a.id)).size,2);assert.equal(userReads,2);});
userTargets=[{...scoped,user:'herdr'}];const userRevoked=await users.read();
ok('revoking one user immediately removes only its cached identities',()=>{assert.equal(userRevoked.sources.length,1);assert.equal(userRevoked.agents[0].machineUser,'herdr');assert.equal(userReads,2);});
let releaseUser,allowedUsers=[scoped];
const pendingUser=createRemoteInventory({enabled:()=>true,targets:()=>allowedUsers,read:()=>new Promise(resolve=>{releaseUser=resolve;})});
const userPending=pendingUser.read();allowedUsers=[];await pendingUser.read();releaseUser(payload(row()));
ok('revoked user cannot return through an in-flight completion',()=>{});assert.deepEqual((await userPending).agents,[]);
for(const user of ['',null,'root:0','../root','-siso','siso;id',"siso'",'siso\nroot','a'.repeat(33)])await assert.rejects(readRemoteHerdr({...scoped,user},async()=>assert.fail('invalid user must not reach transport')),{message:'invalid target'});
ok('invalid explicit users rejected before transport',()=>{});
await readRemoteHerdr(scoped,async(...args)=>{transport=args;return '{"result":{"agents":[]}}';});
ok('Linux switch is exact noninteractive read with account-owned HOME and nested deadline',()=>{
 assert.equal(transport[0],'siso-vps');assert.equal(transport[2],15000);assert.equal(transport[3],1<<20);
 assert.match(transport[1],/python3 - 'siso' 'agent-home'/);assert.match(transport[1],/pwd.getpwnam\(sys.argv\[1\]\)/);
 assert.match(transport[1],/os.execv\('\/usr\/sbin\/runuser'/);assert.match(transport[1],/'\/usr\/bin\/env', '-i', 'HOME=' \+ account.pw_dir/);
 assert.match(transport[1],/alarm 10; exec @ARGV/);assert.match(transport[1],/'\/usr\/local\/bin\/herdr', '--session', sys.argv\[2\], 'agent', 'list'/);
 assert.doesNotMatch(transport[1],/attach|launch|server start|sudo|update|--remote/);
});
execFileSync('sh',['-n'],{input:transport[1]});
execFileSync('python3',['-c','import ast,sys; ast.parse(sys.stdin.read())'],{input:transport[1].split("<<'AB_REMOTE_READ'\n")[1].split('\nAB_REMOTE_READ')[0]});
ok('fixed user-switch shell and Python scripts parse locally without executing',()=>{});
console.log(`${tests}/${tests} remote inventory contracts passed; synthetic only; zero real SSH calls`);

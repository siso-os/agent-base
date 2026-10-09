/** Real node WS routing, authenticated fake native host, synthetic legacy/ended files and a cache race probe. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, readFileSync, existsSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import path from 'node:path';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';
import { readReviewCaptures, createReviewCapture } from '../src/review-capture.ts';

const repo = path.resolve(import.meta.dirname, '../../..');
const scratch = mkdtempSync(path.join(tmpdir(), '.siso-ephemeral-review-wiring.'));
const evidence = process.argv[2] ?? path.join(repo, '.agents/scratchpads/landing-20261006/review-wiring-probe.json');
const sourceFiles = ['services/node/src/server.ts','services/node/src/review-delivery.ts','services/node/src/review-capture.ts','services/node/src/reviews.ts','services/node/src/transcript.ts'];
const hashes = () => Object.fromEntries(sourceFiles.map(file => [file, createHash('sha256').update(readFileSync(path.join(repo, file))).digest('hex')]));
const checkedHashes = hashes(), findings = [], checks = [], viewers = [], logs = [];
const hosts = path.join(scratch, 'hosts'), claude = path.join(scratch, 'claude'), empty = path.join(scratch, 'empty');
for (const dir of [hosts, claude, empty]) mkdirSync(dir, { recursive: true });
const delivered = path.join(scratch, 'reviews-delivered.json');
const at = Date.now() - 5000;
const event = (id, url, extra = {}) => ({ t: 'text', id, text: `Synthetic review ${url}`, at, ...extra });
const nativeLog = Array.from({ length: 70 }, (_, i) => ({ t: 'text', id: `native-${i}`, text: i === 0 ? 'Synthetic older link https://review.fixture/native-old' : i === 69 ? 'Synthetic visible link https://review.fixture/native-visible' : `Synthetic filler ${i}`, at: at + i }));
const transcriptDir = path.join(claude, 'projects', 'fixture'); mkdirSync(transcriptDir, { recursive: true });
const legacyFile = path.join(transcriptDir, 'legacy-a.jsonl');
const legacyRecord = (uuid, text, options = {}) => ({ type: 'assistant', uuid, timestamp: new Date(at).toISOString(), message: { role: 'assistant', content: [{ type: 'text', text }] }, ...options });
writeFileSync(legacyFile, [
  legacyRecord('legacy-initial', 'Synthetic legacy https://review.fixture/legacy-initial'),
  { type: 'user', uuid: 'legacy-user', timestamp: new Date(at).toISOString(), message: { role: 'user', content: 'https://excluded.fixture/legacy-user' } },
  legacyRecord('legacy-sidechain', 'https://excluded.fixture/legacy-child', { isSidechain: true }),
  legacyRecord('legacy-tool', '', { message: { role: 'assistant', content: [{ type: 'tool_use', id: 'tool1', name: 'Read', input: { file_path: 'https://excluded.fixture/tool' } }] } }),
].map(JSON.stringify).join('\n') + '\n');
const ended = path.join(scratch, 'ended.jsonl');
writeFileSync(ended, JSON.stringify({ id: 'audit-ended', name: 'Legacy audit', pane: 'fixture:p1', terminal: 'legacy-review', session: 'legacy-a', cwd: '/fixture', project: null, tool: 'claude', started: at, ended: Date.now(), status: 'idle', task: '', machine: 'fixture' }) + '\n');
const fixtureHost = http.createServer((req, res) => {
  assert.equal(req.url, '/health', 'the fixture host only accepts health reads and websocket upgrades');
  res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ pid: process.pid }));
});
const upstream = new WebSocketServer({ noServer: true });
let authenticated = 0, child;
fixtureHost.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://fixture');
  if (url.pathname !== '/ws' || url.searchParams.get('token') !== 'fixture-only-token') { socket.destroy(); return; }
  authenticated++;
  upstream.handleUpgrade(req, socket, head, ws => upstream.emit('connection', ws, req));
});
upstream.on('connection', ws => ws.send(JSON.stringify({ t: 'hello', name: 'REVIEW-FIXTURE', session: 'native-a', state: 'idle', log: nativeLog, partial: {}, tasks: [], bg: [] })));
const wait = async (predicate, label, timeout = 12000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 20)); }
  throw Error(`Audit timeout: ${label}. Child: ${logs.slice(-4).join(' | ')}`);
};
const rows = () => readReviewCaptures(delivered);
const broadcast = frame => { const text = typeof frame === 'string' ? frame : JSON.stringify(frame); for (const ws of upstream.clients) ws.send(text); };
try {
  await new Promise(resolve => fixtureHost.listen(0, '127.0.0.1', resolve));
  const hostPort = fixtureHost.address().port;
  writeFileSync(path.join(hosts, 'name-REVIEW-FIXTURE.json'), JSON.stringify({ pid: process.pid, port: hostPort, token: 'fixture-only-token', name: 'REVIEW-FIXTURE', session: 'native-a', cwd: scratch, state: 'idle' }));
  const reserve = http.createServer(); await new Promise(resolve => reserve.listen(0, '127.0.0.1', resolve));
  const port = reserve.address().port; await new Promise(resolve => reserve.close(resolve));
  const base = `ws://127.0.0.1:${port}`;
  const fakeHerdr = path.join(repo, 'services/node/test/fake-herdr.mjs');
  const env = {
    PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`, LANG: 'en_US.UTF-8',
    REVIEW_AUDIT_ROOT: scratch, REVIEW_AUDIT_HERDR: fakeHerdr, REVIEW_AUDIT_PORTS: String(hostPort),
    AB_PORT: String(port), AB_HOST: '127.0.0.1', AB_HOME: scratch, AB_HUB_HOME: scratch, AB_ORG_HOME: scratch,
    AB_HERDR: `${process.execPath} ${fakeHerdr}`,
    FAKE_HERDR_AGENTS: JSON.stringify([{ agent: 'siso', agent_status: 'idle', cwd: '/fixture', pane_id: 'fixture:p1', terminal_id: 'legacy-review', terminal_title_stripped: 'LEGACY', agent_session: { value: 'legacy-a' } }]),
    AB_HOSTS_DIR: hosts, AB_STATE: path.join(scratch, 'rows.json'), AB_REGISTRY: path.join(scratch, 'registry.json'), AB_ENDED: ended,
    AB_CLAUDE_DIRS: claude, CLAUDE_CONFIG_DIR: claude, AB_CODEX_DIRS: empty, AB_CODEX_HOME: empty, AB_CODEX_RUNS: empty, AB_A0_TASKS: empty,
    AB_A0_SEAT: path.join(scratch, 'seat.json'), AB_RESURRECT_DIR: empty, AB_CONSOLE_EVENTS: path.join(scratch, 'none-events'), AB_CONSOLE_URL: '',
    AB_REVIEWS_DELIVERED: delivered, AB_REVIEWS_OPENED: path.join(scratch, 'reviews-opened.json'),
    AB_ROUTES_DIR: empty, AB_WEB_DIST: empty, AB_SERVERS_FILE: path.join(scratch, 'servers.json'), AB_VOICE_WATCH: '0', AB_REMOTE_INVENTORY: '0',
    AB_DICTATION_DIR: path.join(scratch, 'dictation'), AB_VOICE_LAUNCH_AGENTS: empty, AB_OWNERS_DIR: empty, AB_AGENTS_MS: '100',
  };
  child = spawn(process.execPath, ['--experimental-strip-types','--no-warnings','--import',path.join(repo,'services/node/test/review-wiring-preload.mjs'),path.join(repo,'services/node/src/server.ts')], { cwd: repo, env, stdio: ['ignore','pipe','pipe'] });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', bytes => logs.push(String(bytes)));
  await wait(() => logs.some(line => line.includes('agent-base node on')), 'synthetic node listening');
  async function connect(route, origin = `http://127.0.0.1:${port}`) {
    const ws = new WebSocket(base + route, { origin });
    const events = []; ws.on('message', data => events.push(JSON.parse(String(data)))); ws.on('error', () => {});
    viewers.push(ws); await once(ws, 'open'); await wait(() => events.some(e => e.t === 'hello'), route + ' hello');
    return { ws, events };
  }
  const native = await connect('/chat/service-REVIEW-FIXTURE/ws');
  await wait(async () => (await rows()).some(r => r.url.endsWith('/native-visible')), 'native hello capture');
  assert.ok(authenticated >= 1);
  assert.equal((await rows()).some(r => r.url.endsWith('/native-old')), false, 'unseen native stash is not captured');
  checks.push('Actual /chat/service-REVIEW-FIXTURE/ws route authenticates to the fixture host and captures only the delivered hello page.');
  const second = await connect('/chat/service-REVIEW-FIXTURE/ws');
  broadcast(event('native-live','https://review.fixture/native-live'));
  broadcast({ t: 'user', id: 'u1', text: 'https://excluded.fixture/user', at });
  broadcast(event('child','https://excluded.fixture/child',{ parent: 'task1' }));
  broadcast({ t: 'tool', id: 'tool2', name: 'Read', input: 'https://excluded.fixture/tool', at });
  broadcast({ t: 'delta', id: 'partial', text: 'https://excluded.fixture/delta', at });
  broadcast(event('sensitive','https://excluded.fixture/signed?token=private-fixture'));
  broadcast(event('code','`https://excluded.fixture/code`'));
  await wait(async () => (await rows()).some(r => r.url.endsWith('/native-live')), 'native live capture');
  await wait(() => second.events.some(e => e.id === 'native-live'), 'second viewer delivery');
  native.ws.send(JSON.stringify({ t: 'older', before: native.events[0].before }));
  await wait(async () => (await rows()).some(r => r.url.endsWith('/native-old')), 'older capture');
  native.ws.send(JSON.stringify({ t: 'older', before: native.events[0].before }));
  await new Promise(resolve => setTimeout(resolve, 100));
  let data = await rows();
  assert.equal(data.length, 3); assert.ok(data.every(r => r.provenance.sessionId === 'native-a'));
  checks.push('Two simultaneous viewers plus repeated older-page replay deduplicate; live assistant links persist; user/child/tool/delta/credential-query/code links are excluded.');
  broadcast({ t: 'hello', name: 'REVIEW-FIXTURE', session: 'native-b', state: 'idle', log: [event('native-69','https://review.fixture/native-b')] });
  await wait(async () => (await rows()).some(r => r.url.endsWith('/native-b')), 'new native session');
  assert.equal((await rows()).find(r => r.url.endsWith('/native-b')).provenance.sessionId, 'native-b');
  checks.push('Canonical replacement hello binds repeated message IDs to the new native session.');
  // Restore a nonempty old-session stash, then send a valid JSON hello whose key order differs.
  broadcast({ t: 'hello', name: 'REVIEW-FIXTURE', session: 'native-a', state: 'idle', log: nativeLog });
  await wait(() => native.events.filter(e => e.t === 'hello' && e.session === 'native-a').length === 2, 'restored native stash');
  broadcast({ session: 'native-c', t: 'hello', name: 'REVIEW-FIXTURE', state: 'idle', log: [event('new-c','https://review.fixture/native-c')] });
  await wait(() => native.events.some(e => e.t === 'hello' && e.session === 'native-c'), 'reordered replacement hello');
  const beforeCount = native.events.length;
  native.ws.send(JSON.stringify({ t: 'older', before: 10 }));
  await wait(() => native.events.slice(beforeCount).some(e => e.t === 'older'), 'older after reordered hello');
  await new Promise(resolve => setTimeout(resolve, 150));
  const wrong = (await rows()).find(r => r.url.endsWith('/native-old') && r.provenance.sessionId === 'native-c');
  if (wrong) findings.push({ id: 'native-stale-stash-session', priority: 1, observed: 'After native-a retained an older page, a valid reordered hello for native-c changed reviewSession without clearing/replacing stash. A subsequent older request delivered native-a text and captured it as native-c.', evidence: { messageId: wrong.provenance.messageId, recordedSession: wrong.provenance.sessionId, actualSourceSession: 'native-a', url: wrong.url }, location: 'services/node/src/server.ts passThrough hello handling and older reply', suggestedFix: 'Parse once; branch on parsed frame.t, paginate/replace stash on every hello regardless of JSON key order, and bind stash to its own immutable session identity. Clear stash and session together on malformed/unbound replacement hello.' });
  else checks.push('Reordered replacement hello did not expose or misattribute an old-session stash.');
  const legacy = await connect('/chat/legacy-review/ws');
  await wait(async () => (await rows()).some(r => r.url.endsWith('/legacy-initial') && r.provenance.agentId === 'legacy-review'), 'legacy hello capture');
  appendFileSync(legacyFile, JSON.stringify(legacyRecord('legacy-live', 'Synthetic legacy live https://review.fixture/legacy-live')) + '\n');
  await wait(async () => (await rows()).some(r => r.url.endsWith('/legacy-live') && r.provenance.agentId === 'legacy-review'), 'legacy subscription capture');
  assert.ok(legacy.events.some(e => e.t === 'text' && e.text.includes('/legacy-live')));
  checks.push('Actual legacy /chat/legacy-review/ws captures hello and subscribed file append with legacy-a identity; synthetic sidechain/user/tool records are excluded.');
  await connect('/ended/audit-ended/ws');
  await wait(async () => (await rows()).some(r => r.provenance.agentId === 'ended-audit-ended'), 'ended replay capture');
  checks.push('Actual ended-session replay captures only its sent synthetic assistant text with the ended receipt session identity.');
  data = await rows();
  assert.ok(data.every(r => !r.url.includes('excluded.fixture')));
  const serialized = readFileSync(delivered, 'utf8');
  for (const secret of ['fixture-only-token', 'private-fixture', 'Synthetic review', 'Synthetic filler', 'excluded.fixture']) assert.equal(serialized.includes(secret), false, `store must omit ${secret}`);
  assert.equal(statSync(delivered).mode & 0o777, 0o600);
  checks.push('Private capture store is mode 0600 and stores no host token, user/tool/child URLs, message bodies, or manufactured approvals/opens.');

  // In-memory fake fetch only. No console/review URL is requested on the network.
  const envKeys = ['AB_CONSOLE_URL','AB_CONSOLE_EVENTS','AB_REVIEWS_DELIVERED','AB_REVIEWS_OPENED'];
  const priorEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  const savedFetch = globalThis.fetch;
  const cacheFile = path.join(scratch, 'cache-race.json'); writeFileSync(cacheFile, JSON.stringify({ version: 1, reviews: [] }));
  let release, started;
  const entered = new Promise(resolve => { started = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  try {
    process.env.AB_CONSOLE_URL = 'https://synthetic-console.fixture'; process.env.AB_CONSOLE_EVENTS = path.join(scratch,'missing-journal'); process.env.AB_REVIEWS_DELIVERED = cacheFile; process.env.AB_REVIEWS_OPENED = path.join(scratch,'cache-opened.json');
    let calls = 0;
    globalThis.fetch = async () => { if (++calls === 1) { started(); await gate; } return new Response('data: {"type":"ready"}\n\n', { headers: { 'content-type': 'text/event-stream' } }); };
    const reviews = await import(pathToFileURL(path.join(repo, 'services/node/src/reviews.ts')).href + '?audit=' + Date.now());
    const pending = reviews.readReviewsCached();
    await entered; await new Promise(resolve => setTimeout(resolve, 50));
    const ref = { adapter: 'native', agentId: 'cache-agent', sessionId: 'cache-session', messageId: 'cache-message' };
    await createReviewCapture({ file: cacheFile, resolve: async () => ({ ...ref, by: 'Cache fixture', deliveredAt: Date.now(), boundary: 'assistant-message-complete', event: event(ref.messageId,'https://review.fixture/cache-new') }) })(ref);
    reviews.invalidateReviewsCache(); release();
    const pendingValue = await pending, next = await reviews.readReviewsCached();
    assert.equal((await readReviewCaptures(cacheFile)).length, 1);
    if (!next.reviews.some(r => r.url.endsWith('/cache-new'))) findings.push({ id: 'review-cache-inflight-invalidation', priority: 2, observed: 'A read that started before capture had already read the empty delivery file. Capture then persisted a row and invalidated cache, but the pending console read later completed and repopulated cache with the old empty capture snapshot. The next cached read omitted the persisted row.', evidence: { persistedRows: 1, pendingReadRows: pendingValue.reviews.length, nextCachedReadRows: next.reviews.length }, location: 'services/node/src/reviews.ts invalidateReviewsCache/readReviewsCached', suggestedFix: 'Use an invalidation generation counter; a read started before the latest invalidation must not repopulate cache or satisfy the next fresh read. Alternatively queue a follow-up read after that in-flight read settles.' });
    else checks.push('In-flight review read respected delivery-store invalidation.');
  } finally {
    release?.(); globalThis.fetch = savedFetch;
    for (const key of envKeys) if (priorEnv[key] === undefined) delete process.env[key]; else process.env[key] = priorEnv[key];
  }
  const afterHashes = hashes();
  const sourceStable = sourceFiles.every(file => checkedHashes[file] === afterHashes[file]);
  writeFileSync(evidence, JSON.stringify({ status: findings.length ? 'defects-observed' : 'verified', checks, findings, authenticatedHostConnections: authenticated, capturedRows: data.length, sourceStable, sourceHashes: checkedHashes, sourceHashesAfter: afterHashes, deniedOperations: existsSync(path.join(scratch,'denied.jsonl')) ? readFileSync(path.join(scratch,'denied.jsonl'),'utf8').trim().split('\n').map(JSON.parse) : [], resources: 'All synthetic sockets, host server, child node and scratch state closed/removed in finally; review target URLs were never fetched.' }, null, 2) + '\n');
  console.log(JSON.stringify({ checks: checks.length, findings: findings.map(f=>({id:f.id,priority:f.priority})), sourceStable, evidence }));
} finally {
  for (const ws of viewers) ws.terminate();
  if (child && child.exitCode === null) { child.kill('SIGTERM'); await once(child, 'exit'); }
  for (const ws of upstream.clients) ws.terminate();
  await new Promise(resolve => upstream.close(resolve));
  if (fixtureHost.listening) await new Promise(resolve => fixtureHost.close(resolve));
  rmSync(scratch, { recursive: true, force: true });
}

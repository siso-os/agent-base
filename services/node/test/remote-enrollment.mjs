import assert from 'node:assert/strict';
import { generateKeyPairSync, randomBytes, randomUUID, sign } from 'node:crypto';
import { createServer, request as httpRequest } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { mkdtempSync, realpathSync, readFileSync, statSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { createRemoteEnrollment, openRemoteEnrollmentStore, createDurableRemoteEnrollment, createDurableRemoteDevicePeer, enrollmentProofMessage, relayProofMessage } from '../src/remote-enrollment.ts';
import { createRemoteIdentity, createRemoteInventoryTransport, deviceRequestMessage, deviceResponseMessage } from '../src/remote-identity.ts';
import { remoteEnrollmentRoute, createPrivateRemoteRelay, route as defaultRoute } from '../src/routes/remote-enrollment.route.ts';
import { dispatchRoute } from '../src/routes/registry.ts';

if (process.argv[2] === '--child') {
  let input = ''; for await (const chunk of process.stdin) input += chunk;
  const data = JSON.parse(input);
  if (data.crash) { const db = new DatabaseSync(path.join(data.directory, 'remote-access.sqlite')); db.exec('PRAGMA synchronous=EXTRA; BEGIN IMMEDIATE'); db.prepare('UPDATE state SET payload=? WHERE id=1').run('uncommitted-crash'); process.exit(3); }
  let service;
  try { service = createRemoteEnrollment({ config: data.config, now: () => data.clock, store: openRemoteEnrollmentStore(data.directory, data.config), readInventory: async () => ({ working: 1, idle: 0, blocked: 0 }) }); await service.execute(data.token, data.body); console.log(JSON.stringify({ ok: true })); }
  catch (error) { console.log(JSON.stringify({ ok: false, code: error.code })); }
  finally { service?.close(); }
  process.exit(0);
}

const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
const device = generateKeyPairSync('ed25519'), other = generateKeyPairSync('ed25519');
const pem = key => key.export({ type: 'spki', format: 'pem' }).toString();
let clock = 1_800_000_000;
const config = { enabled: true, account: 'fixture-account', issuer: 'https://fixture.cloudflareaccess.com', audience: 'fixture-audience', keys: [{ kid: 'fixture-key', publicKey: pem(rsa.publicKey) }], principals: [
  { subject: 'owner-a', tenant: 'tenant-a', role: 'owner' }, { subject: 'owner-b', tenant: 'tenant-b', role: 'owner' },
  { subject: 'helper-a', tenant: 'tenant-a', role: 'support' }, { subject: 'helper-b', tenant: 'tenant-b', role: 'support' },
], devices: [{ id: 'device-a', ownerSubject: 'owner-a', publicKey: pem(device.publicKey) }, { id: 'device-b', ownerSubject: 'owner-b', publicKey: pem(other.publicKey) }] };
function jwt(sub = 'owner-a', overrides = {}, headerOverrides = {}) {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'fixture-key', ...headerOverrides })).toString('base64url');
  const claims = Buffer.from(JSON.stringify({ sub, iss: config.issuer, aud: [config.audience], iat: clock, exp: clock + 600, ...overrides })).toString('base64url');
  return `${header}.${claims}.${sign('RSA-SHA256', Buffer.from(`${header}.${claims}`), rsa.privateKey).toString('base64url')}`;
}
let checks = 0;
const ok = (condition, message) => { assert.ok(condition, message); checks++; };
const equal = (a, b) => { assert.deepEqual(a, b); checks++; };
async function denied(service, token, body, code) { await assert.rejects(service.execute(token, body), error => error.code === code); checks++; }
const audits = []; let transportCalls = 0, pendingRead;
const service = createRemoteEnrollment({ config, now: () => clock, audit: event => audits.push(event), readInventory: async () => { transportCalls++; return pendingRead ? pendingRead : { working: 2, idle: 3, blocked: 1, secret: 'never-return' }; } });
const issue = () => ({ operation: 'enroll.issue', deviceId: 'device-a' });
const proof = text => sign(null, Buffer.from(text), device.privateKey).toString('base64url');
const readBody = (token, extra = {}) => { const nonce = randomBytes(18).toString('base64url'), at = clock; return { operation: 'relay.read', deviceId: 'device-a', nonce, at, proof: proof(relayProofMessage('device-a', token, nonce, at)), ...extra }; };
await denied(createRemoteEnrollment(), jwt(), issue(), 'remote_access_disabled');
await denied(createRemoteEnrollment({ config }), jwt(), issue(), 'remote_access_disabled');
const identity = createRemoteIdentity(config);
for (const overrides of [{ iss: 'https://wrong.cloudflareaccess.com' }, { aud: ['wrong'] }, { exp: clock }, { iat: clock + 1 }, { exp: clock + 7200 }, { nbf: clock + 1 }, { sub: 'stranger' }]) {
  assert.throws(() => identity.authenticate(jwt('owner-a', overrides), clock), /identity_invalid/); checks++;
}
for (const header of [{ alg: 'none' }, { alg: 'HS256' }, { kid: 'unknown' }, { jku: 'https://attacker.invalid/key' }, { crit: ['custom'] }]) {
  assert.throws(() => identity.authenticate(jwt('owner-a', {}, header), clock), /identity_invalid/); checks++;
}
assert.throws(() => identity.authenticate(jwt().slice(0, -4) + 'AAAA', clock), /identity_invalid/); checks++;
equal(identity.authenticate(jwt('owner-a', { tenant: 'tenant-b', role: 'support' }), clock).tenant, 'tenant-a');
await denied(service, jwt('owner-b'), issue(), 'device_unavailable');
await denied(service, jwt('helper-a'), issue(), 'owner_required');
await denied(service, jwt(), { ...issue(), tenant: 'tenant-b' }, 'invalid_request');
await denied(service, jwt(), { operation: 'terminal.send', deviceId: 'device-a', text: 'touch /tmp/x' }, 'unsupported_operation');
const expired = await service.execute(jwt(), issue()); clock += 301;
await denied(service, jwt(), { operation: 'enroll.claim', deviceId: 'device-a', code: expired.code, proof: proof(enrollmentProofMessage('device-a', expired.code)) }, 'enrollment_invalid');
const ticket = await service.execute(jwt(), issue());
await denied(service, jwt(), { operation: 'enroll.claim', deviceId: 'device-a', code: ticket.code, proof: 'bad' }, 'device_proof_invalid');
const claim = { operation: 'enroll.claim', deviceId: 'device-a', code: ticket.code, proof: proof(enrollmentProofMessage('device-a', ticket.code)) };
equal(await service.execute(jwt(), claim), { deviceId: 'device-a', state: 'active' });
await denied(service, jwt(), claim, 'enrollment_invalid');
const token = jwt(), body = readBody(token);
equal(await service.execute(token, body), { deviceId: 'device-a', inventory: { working: 2, idle: 3, blocked: 1 } });
await denied(service, token, body, 'relay_replay');
await denied(service, token, readBody(token, { url: 'http://127.0.0.1:5401/api/agents' }), 'invalid_request');
await denied(service, token, readBody(token, { at: clock - 31 }), 'relay_proof_invalid');
await denied(service, token, readBody(token, { proof: 'forged' }), 'device_proof_invalid');
await denied(service, jwt('helper-a'), readBody(jwt('helper-a')), 'consent_required');
const grantBody = { operation: 'support.grant', deviceId: 'device-a', subject: 'helper-a', expiresAt: clock + 300, scope: 'inventory.read' };
await denied(service, token, { ...grantBody, subject: 'helper-b' }, 'invalid_consent');
await denied(service, token, { ...grantBody, scope: 'terminal.send' }, 'invalid_consent');
await denied(service, token, { ...grantBody, expiresAt: clock + 901 }, 'invalid_consent');
const grant = await service.execute(token, grantBody), helper = jwt('helper-a');
await service.execute(helper, readBody(helper)); checks++;
await denied(service, jwt('owner-b'), { operation: 'support.revoke', deviceId: 'device-a', grantId: grant.grantId }, 'device_unavailable');
await service.execute(token, { operation: 'support.revoke', deviceId: 'device-a', grantId: grant.grantId });
await denied(service, helper, readBody(helper), 'consent_required');
await service.execute(token, { ...grantBody, expiresAt: clock + 2 }); clock += 3;
await denied(service, helper, readBody(helper), 'consent_required');
await service.execute(jwt(), { ...grantBody, expiresAt: clock + 300 });
let release; pendingRead = new Promise(resolve => { release = resolve; });
const inFlight = service.execute(jwt(), readBody(jwt()));
await service.execute(jwt(), { operation: 'device.revoke', deviceId: 'device-a' });
release({ working: 0, idle: 0, blocked: 0 });
await assert.rejects(inFlight, /device_inactive/); checks++;
await denied(service, jwt(), readBody(jwt()), 'device_inactive');
await denied(service, jwt(), issue(), 'device_inactive');
await denied(service, jwt(), claim, 'enrollment_invalid');
ok(transportCalls === 3, 'denied requests never call transport');
ok(!JSON.stringify(audits).includes(ticket.code) && !JSON.stringify(audits).includes(token) && !JSON.stringify(audits).includes('never-return'), 'audit contains no credentials or inventory');
ok(audits.some(a => a.event === 'device.revoke' && a.outcome === 'allowed'), 'revocation audited');
const brokenAudit = createRemoteEnrollment({ config, now: () => clock, audit: () => { throw new Error('disk unavailable'); } });
await denied(brokenAudit, jwt(), issue(), 'audit_unavailable');
const restarted = createRemoteEnrollment({ config, now: () => clock, audit: () => {} });
await denied(restarted, jwt(), readBody(jwt()), 'device_inactive');

// Consent revocation also closes an already dispatched read, even if a new grant replaces it.
let finishSupport;
const supportService = createRemoteEnrollment({ config, now: () => clock, audit: () => {}, readInventory: () => new Promise(resolve => { finishSupport = resolve; }) });
const supportTicket = await supportService.execute(jwt(), issue());
await supportService.execute(jwt(), { ...claim, code: supportTicket.code, proof: proof(enrollmentProofMessage('device-a', supportTicket.code)) });
const consent = await supportService.execute(jwt(), { ...grantBody, expiresAt: clock + 300 });
const supportToken = jwt('helper-a');
const supportRead = supportService.execute(supportToken, readBody(supportToken));
await supportService.execute(jwt(), { operation: 'support.revoke', deviceId: 'device-a', grantId: consent.grantId });
await supportService.execute(jwt(), { ...grantBody, expiresAt: clock + 300 });
finishSupport({ working: 1, idle: 1, blocked: 0 });
await assert.rejects(supportRead, /consent_changed/); checks++;
const asyncAudit = createRemoteEnrollment({ config, now: () => clock, audit: async () => {} });
await denied(asyncAudit, jwt(), issue(), 'audit_unavailable');
for (const malformed of [{ ...config, account: '' }, { ...config, issuer: 'http://fixture.cloudflareaccess.com' }, { ...config, keys: [] }, { ...config, devices: [] }, { ...config, devices: [{ ...config.devices[0], ownerSubject: 'helper-a' }] }, { ...config, devices: [{ ...config.devices[0], publicKey: pem(rsa.publicKey) }] }]) {
  assert.throws(() => createRemoteEnrollment({ config: malformed, audit: () => {} })); checks++;
}
const frozenBinding = createRemoteIdentity(config);
const oldTenant = config.principals[0].tenant; config.principals[0].tenant = 'changed-after-start';
equal(frozenBinding.authenticate(jwt(), clock).tenant, oldTenant); config.principals[0].tenant = oldTenant;
const wrongToken = jwt('helper-a');
await denied(supportService, wrongToken, readBody(jwt()), 'device_proof_invalid');
const denyTransport = createRemoteEnrollment({ config, now: () => clock, audit: () => {}, readInventory: async () => { throw new Error('SECRET-provider-details'); } });
const denyTicket = await denyTransport.execute(jwt(), issue());
await denyTransport.execute(jwt(), { ...claim, code: denyTicket.code, proof: proof(enrollmentProofMessage('device-a', denyTicket.code)) });
await denied(denyTransport, jwt(), readBody(jwt()), 'remote_unavailable');
const noTransport = createRemoteEnrollment({ config, now: () => clock, audit: () => {} });
const noTransportTicket = await noTransport.execute(jwt(), issue());
await noTransport.execute(jwt(), { ...claim, code: noTransportTicket.code, proof: proof(enrollmentProofMessage('device-a', noTransportTicket.code)) });
await denied(noTransport, jwt(), readBody(jwt()), 'transport_unavailable');
let expiredFinish;
const expiredService = createRemoteEnrollment({ config, now: () => clock, audit: () => {}, readInventory: () => new Promise(resolve => { expiredFinish = resolve; }) });
const expTicket = await expiredService.execute(jwt(), issue());
await expiredService.execute(jwt(), { ...claim, code: expTicket.code, proof: proof(enrollmentProofMessage('device-a', expTicket.code)) });
const expToken = jwt('owner-a', { exp: clock + 1 });
const expRead = expiredService.execute(expToken, readBody(expToken)); clock += 2;
expiredFinish({ working: 0, idle: 0, blocked: 0 });
await assert.rejects(expRead, /identity_expired/); checks++;

// Real loopback HTTP adapter, synthetic config only; no application server/agents are started.
const routes = [remoteEnrollmentRoute(restarted, new Set(['http://fixture.local']))];
const server = createServer(async (req, res) => {
  if (!await dispatchRoute(routes, req, res, new URL(req.url, 'http://node').pathname)) { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/api/remote/access`;
try {
  const send = (body, headers = {}, suffix = '') => fetch(url + suffix, { method: 'POST', headers: { authorization: `Bearer ${jwt()}`, 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  equal((await send(issue(), { origin: 'https://evil.invalid' })).status, 403);
  equal((await send(issue(), { authorization: '' })).status, 401);
  equal((await send(issue(), { 'content-type': 'text/plain' })).status, 415);
  equal((await send('{')).status, 400);
  equal((await send(issue(), {}, '?tenant=tenant-b')).status, 400);
  equal((await send('x'.repeat(4097))).status, 413);
  equal((await send(issue(), { origin: 'http://fixture.local' })).status, 200);
  equal((await fetch(url)).status, 404);
  routes[0] = defaultRoute;
  const disabled = await send(issue()); equal(disabled.status, 503); equal(await disabled.json(), { error: 'remote_access_disabled' });
} finally { await new Promise(resolve => server.close(resolve)); }

// Durable adapters: private fixture root is retained for inspection; it contains generated dummy identities only.
const fixtureRoot = mkdtempSync(path.join(realpathSync(tmpdir()), 'agent-base-remote-contract-'));
clock = Math.floor(Date.now() / 1000);
const fixtureDir = name => path.join(fixtureRoot, name);
const persisted = (directory, readInventory = async () => ({ working: 1, idle: 0, blocked: 0 })) => createRemoteEnrollment({ config, now: () => clock, store: openRemoteEnrollmentStore(directory, config), readInventory });
const enroll = async svc => { const ticket = await svc.execute(jwt(), issue()); await svc.execute(jwt(), { ...claim, code: ticket.code, proof: proof(enrollmentProofMessage('device-a', ticket.code)) }); };
const child = data => new Promise((resolve, reject) => { const cp = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', new URL(import.meta.url).pathname, '--child'], { stdio: ['pipe', 'pipe', 'pipe'] }); let out = '', err = ''; cp.stdout.on('data', chunk => { out += chunk; }); cp.stderr.on('data', chunk => { err += chunk; }); cp.on('error', reject); cp.on('close', code => { if (data.crash) resolve({ exitCode: code }); else if (code !== 0) reject(new Error('fixture subprocess failed')); else resolve(JSON.parse(out)); }); cp.stdin.end(JSON.stringify(data)); });
const durableDir = fixtureDir('durable');
let durable = persisted(durableDir);
const durableTicket = await durable.execute(jwt(), issue()); durable.close();
durable = persisted(durableDir);
const durableClaim = { ...claim, code: durableTicket.code, proof: proof(enrollmentProofMessage('device-a', durableTicket.code)) };
const races = await Promise.all([1, 2].map(() => child({ directory: durableDir, config, clock, token: jwt(), body: durableClaim })));
equal(races.filter(r => r.ok).length, 1); equal(races.find(r => !r.ok).code, 'enrollment_invalid');
let durableToken = jwt(), durableRead = readBody(durableToken);
await durable.execute(durableToken, durableRead); durable.close(); durable = persisted(durableDir);
await denied(durable, durableToken, durableRead, 'relay_replay');
const durableConsent = await durable.execute(jwt(), { ...grantBody, expiresAt: clock + 300 }); durable.close(); durable = persisted(durableDir);
await durable.execute(jwt('helper-a'), readBody(jwt('helper-a'))); checks++;
await durable.execute(jwt(), { operation: 'support.revoke', deviceId: 'device-a', grantId: durableConsent.grantId }); durable.close(); durable = persisted(durableDir);
await denied(durable, jwt('helper-a'), readBody(jwt('helper-a')), 'consent_required');
await durable.execute(jwt(), { operation: 'device.revoke', deviceId: 'device-a' }); durable.close(); durable = persisted(durableDir);
await denied(durable, jwt(), readBody(jwt()), 'device_inactive'); await denied(durable, jwt(), issue(), 'device_inactive'); durable.close();
equal(statSync(durableDir).mode & 0o777, 0o700); equal(statSync(path.join(durableDir, 'remote-access.sqlite')).mode & 0o777, 0o600);
assert.throws(() => openRemoteEnrollmentStore(durableDir, { ...config, audience: 'other-audience' }), /state_binding_mismatch/); checks++;
const crashDir = fixtureDir('crash'); let crashSvc = persisted(crashDir); await enroll(crashSvc); crashSvc.close();
equal((await child({ directory: crashDir, crash: true })).exitCode, 3); crashSvc = persisted(crashDir); await crashSvc.execute(jwt(), readBody(jwt())); checks++; crashSvc.close();
const corruptDir = fixtureDir('corrupt'); const corruptSvc = persisted(corruptDir); corruptSvc.close();
let db = new DatabaseSync(path.join(corruptDir, 'remote-access.sqlite')); db.prepare('UPDATE state SET payload=? WHERE id=1').run('{broken'); db.close();
assert.throws(() => persisted(corruptDir), /state_corrupt/); checks++;
const auditDir = fixtureDir('audit-failure'); const auditSvc = persisted(auditDir);
db = new DatabaseSync(path.join(auditDir, 'remote-access.sqlite')); db.exec('DROP TABLE audit'); db.close();
await denied(auditSvc, jwt(), issue(), 'state_unavailable'); auditSvc.close();
db = new DatabaseSync(path.join(auditDir, 'remote-access.sqlite')); equal(JSON.parse(db.prepare('SELECT payload FROM state').get().payload).pending.length, 0); db.close();
const tamperDir = fixtureDir('audit-corrupt'); const tamperSvc = persisted(tamperDir); await tamperSvc.execute(jwt(), issue()); tamperSvc.close();
db = new DatabaseSync(path.join(tamperDir, 'remote-access.sqlite')); db.prepare('UPDATE audit SET payload=? WHERE sequence=1').run('{}'); db.close();
assert.throws(() => persisted(tamperDir), /audit_corrupt/); checks++;
const oldAuditDir = fixtureDir('live-old-audit-corrupt'); const oldAuditSvc = persisted(oldAuditDir); await oldAuditSvc.execute(jwt(), issue()); await oldAuditSvc.execute(jwt(), issue());
db = new DatabaseSync(path.join(oldAuditDir, 'remote-access.sqlite')); db.prepare('UPDATE audit SET payload=? WHERE sequence=1').run('{}'); db.close();
await denied(oldAuditSvc, jwt(), issue(), 'audit_corrupt'); oldAuditSvc.close();
const modeDir = fixtureDir('private-mode'); const modeSvc = persisted(modeDir); chmodSync(path.join(modeDir, 'remote-access.sqlite'), 0o644);
await denied(modeSvc, jwt(), issue(), 'state_unavailable'); modeSvc.close(); chmodSync(path.join(modeDir, 'remote-access.sqlite'), 0o600);
const inFlightDir = fixtureDir('cross-instance'); let releasePersistent;
const firstStore = persisted(inFlightDir, () => new Promise(resolve => { releasePersistent = resolve; })); await enroll(firstStore);
const secondStore = persisted(inFlightDir); const pendingPersistent = firstStore.execute(jwt(), readBody(jwt()));
await secondStore.execute(jwt(), { operation: 'device.revoke', deviceId: 'device-a' }); releasePersistent({ working: 1, idle: 0, blocked: 0 });
await assert.rejects(pendingPersistent, /device_inactive/); checks++; firstStore.close(); secondStore.close();
const rateDir = fixtureDir('persistent-rate'); let rateSvc = persisted(rateDir); await enroll(rateSvc);
for (let i = 0; i < 30; i++) await rateSvc.execute(jwt(), readBody(jwt())); rateSvc.close(); rateSvc = persisted(rateDir);
await denied(rateSvc, jwt(), readBody(jwt()), 'relay_rate_limited'); rateSvc.close();

// Actual signed outbound requests and peer responses. The peer never opens a listener by itself.
const hubKeys = generateKeyPairSync('ed25519'), privatePem = key => key.export({ format: 'pem', type: 'pkcs8' }).toString();
const peerConfig = { id: 'device-a', tenant: 'tenant-a', hubPublicKey: pem(hubKeys.publicKey), privateKey: privatePem(device.privateKey), stateDirectory: fixtureDir('peer'), readInventory: async () => ({ working: 4, idle: 2, blocked: 1 }) };
let peer = createDurableRemoteDevicePeer(peerConfig), handler = peer.handle;
const peerServer = createServer((req, res) => { void handler(req, res); });
await new Promise(resolve => peerServer.listen(0, '127.0.0.1', resolve));
const peerUrl = `http://127.0.0.1:${peerServer.address().port}/agent-base/remote/inventory`;
const transportConfig = { privateKey: privatePem(hubKeys.privateKey), devices: [{ id: 'device-a', tenant: 'tenant-a', url: peerUrl, publicKey: pem(device.publicKey) }], allowLoopbackHttpForTests: true };
const peerRequest = (overrides = {}, signer = hubKeys.privateKey) => { const at = Date.now(); const request = { version: 1, id: randomUUID(), deviceId: 'device-a', tenant: 'tenant-a', operation: 'inventory.read', issuedAt: at, expiresAt: at + 5000, ...overrides }; return { request, signature: sign(null, Buffer.from(deviceRequestMessage(request)), signer).toString('base64url') }; };
const postPeer = body => fetch(peerUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) });
const transportDenied = async (fn, code) => { await assert.rejects(fn(), error => error.code === code); checks++; };
try {
  const transport = createRemoteInventoryTransport(transportConfig);
  equal(await transport({ id: 'device-a', tenant: 'tenant-a' }), { working: 4, idle: 2, blocked: 1 });
  await transportDenied(() => transport({ id: 'device-a', tenant: 'tenant-b' }), 'transport_device_unavailable');
  for (const body of [peerRequest({}, other.privateKey), peerRequest({ tenant: 'tenant-b' }), peerRequest({ operation: 'terminal.send' }), peerRequest({ expiresAt: Date.now() - 1 })]) equal((await postPeer(body)).status, 401);
  equal((await postPeer('{')).status, 400); equal((await postPeer('x'.repeat(4097))).status, 413);
  const replay = peerRequest(); equal((await postPeer(replay)).status, 200);
  peer.close(); peer = createDurableRemoteDevicePeer(peerConfig); handler = peer.handle;
  equal((await postPeer(replay)).status, 409);
  const assemblyConfig = { ...config, devices: [config.devices[0]] };
  const production = createDurableRemoteEnrollment({ config: assemblyConfig, stateDirectory: fixtureDir('production-assembly'), transport: transportConfig, now: () => clock });
  await enroll(production); equal(await production.execute(jwt(), readBody(jwt())), { deviceId: 'device-a', inventory: { working: 4, idle: 2, blocked: 1 } }); production.close();
  const privateRelay = createPrivateRemoteRelay({ config: assemblyConfig, stateDirectory: fixtureDir('private-relay'), transport: transportConfig, allowedOrigins: ['https://fixture.example'] });
  const privateAddress = await privateRelay.listen(); equal(privateAddress.host, '127.0.0.1');
  try {
    const relayUrl = `http://${privateAddress.host}:${privateAddress.port}/api/remote/access`;
    const post = body => fetch(relayUrl, { method: 'POST', headers: { 'content-type': 'application/json', 'cf-access-jwt-assertion': jwt(), origin: 'https://fixture.example' }, body: JSON.stringify(body) });
    equal((await fetch(relayUrl.replace('/api/remote/access', '/api/agents'))).status, 404);
    equal(await new Promise((resolve, reject) => { const req = httpRequest({ host: privateAddress.host, port: privateAddress.port, path: 'http://[/', method: 'POST' }, res => { res.resume(); resolve(res.statusCode); }); req.on('error', reject); req.end(); }), 400);
    const t = await (await post(issue())).json(); ok(typeof t.code === 'string', 'dedicated Access header still verifies signed issuer token');
    equal((await post({ ...claim, code: t.code, proof: proof(enrollmentProofMessage('device-a', t.code)) })).status, 200);
    equal((await post(readBody(jwt()))).status, 200);
    const ambiguous = await fetch(relayUrl, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${jwt()}`, 'cf-access-jwt-assertion': jwt() }, body: JSON.stringify(issue()) }); equal(ambiguous.status, 401);
  } finally { await privateRelay.close(); }
  // The actual signed response arrives after another process-visible instance revokes the device.
  let releaseWire, wireEntered;
  const entered = new Promise(resolve => { wireEntered = resolve; });
  peer.close(); peer = createDurableRemoteDevicePeer({ ...peerConfig, readInventory: () => { wireEntered(); return new Promise(resolve => { releaseWire = resolve; }); } }); handler = peer.handle;
  const wireDir = fixtureDir('wire-revocation');
  const wireService = createDurableRemoteEnrollment({ config: assemblyConfig, stateDirectory: wireDir, transport: transportConfig, now: () => clock }); await enroll(wireService);
  const wireRead = wireService.execute(jwt(), readBody(jwt())); await entered;
  const wireRevoker = createRemoteEnrollment({ config: assemblyConfig, now: () => clock, store: openRemoteEnrollmentStore(wireDir, assemblyConfig), readInventory: async () => ({ working: 0, idle: 0, blocked: 0 }) });
  await wireRevoker.execute(jwt(), { operation: 'device.revoke', deviceId: 'device-a' }); releaseWire({ working: 9, idle: 0, blocked: 0 });
  await assert.rejects(wireRead, /device_inactive/); checks++; wireService.close(); wireRevoker.close();
  peer.close(); peer = createDurableRemoteDevicePeer(peerConfig); handler = peer.handle;
  for (const endpoint of ['http://example.invalid/agent-base/remote/inventory', 'http://localhost/agent-base/remote/inventory', peerUrl + '?target=other', peerUrl + '#fragment']) { assert.throws(() => createRemoteInventoryTransport({ ...transportConfig, devices: [{ ...transportConfig.devices[0], url: endpoint }] })); checks++; }
  assert.throws(() => createRemoteInventoryTransport({ ...transportConfig, allowLoopbackHttpForTests: false })); checks++;
  const signedFake = mutate => async (req, res) => { let body = ''; for await (const chunk of req) body += chunk; const { request } = JSON.parse(body); const response = { version: 1, requestId: request.id, requestHash: createHash('sha256').update(deviceRequestMessage(request)).digest('hex'), deviceId: request.deviceId, tenant: request.tenant, issuedAt: Date.now(), expiresAt: request.expiresAt, inventory: { working: 1, idle: 0, blocked: 0 } }; mutate(response); res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ...response, signature: sign(null, Buffer.from(deviceResponseMessage(response)), device.privateKey).toString('base64url') })); };
  for (const mutate of [r => { r.requestId = randomUUID(); }, r => { r.tenant = 'tenant-b'; }, r => { r.requestHash = '0'.repeat(64); }, r => { r.inventory.working = -1; }, r => { r.expiresAt--; }]) { handler = signedFake(mutate); await transportDenied(() => createRemoteInventoryTransport(transportConfig)({ id: 'device-a', tenant: 'tenant-a' }), 'transport_response_invalid'); }
  handler = (_req, res) => { res.writeHead(302, { location: peerUrl }); res.end(); };
  await transportDenied(() => createRemoteInventoryTransport(transportConfig)({ id: 'device-a', tenant: 'tenant-a' }), 'transport_response_invalid');
  handler = (_req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('x'.repeat(9000)); };
  await transportDenied(() => createRemoteInventoryTransport(transportConfig)({ id: 'device-a', tenant: 'tenant-a' }), 'transport_response_too_large');
  handler = (_req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.write(' '); };
  const startDeadline = Date.now();
  await transportDenied(() => createRemoteInventoryTransport({ ...transportConfig, deadlineMs: 100 })({ id: 'device-a', tenant: 'tenant-a' }), 'transport_deadline'); ok(Date.now() - startDeadline < 1500, 'absolute deadline bounds incomplete response');
  handler = signedFake(() => {}); const capped = createRemoteInventoryTransport(transportConfig);
  for (let i = 0; i < 30; i++) await capped({ id: 'device-a', tenant: 'tenant-a' });
  await transportDenied(() => capped({ id: 'device-a', tenant: 'tenant-a' }), 'transport_rate_limited');
  const held = []; const fake = signedFake(() => {}); handler = (req, res) => { held.push(() => fake(req, res)); };
  const parallelClient = createRemoteInventoryTransport(transportConfig);
  const parallelReads = [parallelClient({ id: 'device-a', tenant: 'tenant-a' }), parallelClient({ id: 'device-a', tenant: 'tenant-a' })];
  await transportDenied(() => parallelClient({ id: 'device-a', tenant: 'tenant-a' }), 'transport_busy');
  while (held.length < 2) await new Promise(resolve => setTimeout(resolve, 2));
  for (const release of held) void release(); await Promise.all(parallelReads); checks++;
  let abortSeen = false;
  peer.close(); peer = createDurableRemoteDevicePeer({ ...peerConfig, readInventory: signal => new Promise((resolve, reject) => { signal.addEventListener('abort', () => { abortSeen = true; reject(new Error('cancelled')); }, { once: true }); }) }); handler = peer.handle;
  await transportDenied(() => createRemoteInventoryTransport({ ...transportConfig, deadlineMs: 100 })({ id: 'device-a', tenant: 'tenant-a' }), 'transport_deadline');
  await new Promise(resolve => setTimeout(resolve, 50)); ok(abortSeen, 'peer aborts provider on deadline/disconnect');
} finally { peer.close(); peerServer.closeAllConnections(); await new Promise(resolve => peerServer.close(resolve)); }
// An untrusted self-signed TLS peer is rejected; production transport never disables certificate verification.
const tlsKey = path.join(fixtureRoot, 'dummy-tls-key.pem'), tlsCert = path.join(fixtureRoot, 'dummy-tls-cert.pem');
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', tlsKey, '-out', tlsCert, '-subj', '/CN=localhost', '-days', '1'], { stdio: 'ignore' }); chmodSync(tlsKey, 0o600);
const tlsServer = createHttpsServer({ key: readFileSync(tlsKey), cert: readFileSync(tlsCert) }, (_req, res) => res.end('{}'));
await new Promise(resolve => tlsServer.listen(0, '127.0.0.1', resolve));
try { const transport = createRemoteInventoryTransport({ ...transportConfig, allowLoopbackHttpForTests: false, devices: [{ ...transportConfig.devices[0], url: `https://127.0.0.1:${tlsServer.address().port}/agent-base/remote/inventory` }] }); await transportDenied(() => transport({ id: 'device-a', tenant: 'tenant-a' }), 'transport_unavailable'); }
finally { tlsServer.closeAllConnections(); await new Promise(resolve => tlsServer.close(resolve)); }
// Review regression 1: rejected traffic has bounded summaries, never consumes authorization history.
const attackDir = fixtureDir('review-denial-attack'); const attackSvc = persisted(attackDir); await enroll(attackSvc);
for (let i = 0; i < 500; i++) {
  await assert.rejects(attackSvc.execute('invalid.jwt.' + i, issue()), /identity_invalid/);
  await assert.rejects(attackSvc.execute(jwt('helper-a'), issue()), /owner_required/);
}
db = new DatabaseSync(path.join(attackDir, 'remote-access.sqlite'));
equal(db.prepare('SELECT COUNT(*) AS count FROM audit').get().count, 2);
equal(db.prepare('SELECT COUNT(*) AS count FROM denials').get().count, 2); db.close();
await attackSvc.execute(jwt(), { operation: 'device.revoke', deviceId: 'device-a' }); attackSvc.close();
db = new DatabaseSync(path.join(attackDir, 'remote-access.sqlite'));
equal(db.prepare('SELECT COUNT(*) AS count FROM audit').get().count, 3);
const denialSummaries = db.prepare('SELECT bucket,payload FROM denials ORDER BY bucket').all().map(row => ({ bucket: row.bucket, ...JSON.parse(row.payload) }));
equal(denialSummaries.map(row => row.count), [500, 500]);
ok(denialSummaries.every(row => row.reasons.length <= 16 && !JSON.stringify(row).includes('invalid.jwt.')), 'bounded denial reasons retain counts without raw credentials'); db.close();
const attackRestart = persisted(attackDir); await denied(attackRestart, jwt(), issue(), 'device_inactive'); attackRestart.close();

// Fill the actual immutable-history limit, then prove reserved capacity permits both kinds of revoke.
const fullDir = fixtureDir('review-audit-full'); let fullSvc = persisted(fullDir); await enroll(fullSvc);
const fullGrant = await fullSvc.execute(jwt(), { ...grantBody, expiresAt: clock + 300 }); fullSvc.close();
db = new DatabaseSync(path.join(fullDir, 'remote-access.sqlite')); db.exec('BEGIN IMMEDIATE');
let fullMeta = db.prepare('SELECT sequence,head FROM state').get(), fullSequence = fullMeta.sequence, fullHead = fullMeta.head;
const insertAudit = db.prepare('INSERT INTO audit VALUES(?,?,?,?)'), historicalPayload = JSON.stringify({ at: clock, event: 'fixture.accepted-history', outcome: 'allowed' });
while (fullSequence < 100000) { const next = createHash('sha256').update(`${fullHead}\n${historicalPayload}`).digest('hex'); insertAudit.run(++fullSequence, historicalPayload, fullHead, next); fullHead = next; }
db.prepare('UPDATE state SET sequence=?,head=? WHERE id=1').run(fullSequence, fullHead); db.exec('COMMIT'); db.close();
fullSvc = persisted(fullDir);
await denied(fullSvc, jwt('owner-b'), { operation: 'enroll.issue', deviceId: 'device-b' }, 'audit_capacity');
for (let i = 0; i < 50; i++) { await assert.rejects(fullSvc.execute('bad-token', issue()), /identity_invalid/); await assert.rejects(fullSvc.execute(jwt('helper-a'), issue()), /owner_required/); }
equal(await fullSvc.execute(jwt(), { operation: 'support.revoke', deviceId: 'device-a', grantId: fullGrant.grantId }), { revoked: true });
equal(await fullSvc.execute(jwt(), { operation: 'device.revoke', deviceId: 'device-a' }), { deviceId: 'device-a', state: 'revoked' });
await fullSvc.execute(jwt(), { operation: 'device.revoke', deviceId: 'device-a' }); fullSvc.close();
db = new DatabaseSync(path.join(fullDir, 'remote-access.sqlite')); equal(db.prepare('SELECT sequence FROM state').get().sequence, 100002); equal(db.prepare('SELECT COUNT(*) AS count FROM audit').get().count, 100002); db.close();
fullSvc = persisted(fullDir); await denied(fullSvc, jwt(), readBody(jwt()), 'device_inactive'); fullSvc.close();

// Review regression 2: early identity refusal, an absolute trickle deadline, global/principal admission and cancellation.
const parserConfig = { ...config, principals: [...config.principals, ...['helper-a2', 'helper-a3', 'helper-a4'].map(subject => ({ subject, tenant: 'tenant-a', role: 'support' }))] };
const parserRelay = createPrivateRemoteRelay({ config: parserConfig, stateDirectory: fixtureDir('review-parser'), transport: { privateKey: privatePem(hubKeys.privateKey), devices: config.devices.map(d => ({ id: d.id, tenant: d.id === 'device-a' ? 'tenant-a' : 'tenant-b', publicKey: d.publicKey, url: 'https://fixture.invalid/agent-base/remote/inventory' })) }, allowedOrigins: [] });
const parserAddress = await parserRelay.listen(), parserUrl = `http://${parserAddress.host}:${parserAddress.port}/api/remote/access`;
const ownedRequests = new Set(); let observedBodyDeadlineMs;
const partial = token => {
  let finish, settled = false; const started = Date.now();
  const result = new Promise(resolve => { finish = value => { if (!settled) { settled = true; clearTimeout(fallback); resolve({ ...value, elapsedMs: Date.now() - started }); } }; });
  const fallback = setTimeout(() => finish({ timedOut: true }), 6500);
  const req = httpRequest(parserUrl, { method: 'POST', headers: { 'content-type': 'application/json', 'cf-access-jwt-assertion': token, 'content-length': '200' } }, res => { const status = res.statusCode; res.resume(); res.on('end', () => finish({ status })); });
  ownedRequests.add(req); req.on('error', () => finish({ disconnected: true })); req.on('close', () => { ownedRequests.delete(req); finish({ disconnected: true }); }); req.write('{');
  return { req, result };
};
const parserPost = (body, subject = 'owner-a') => fetch(parserUrl, { method: 'POST', headers: { 'content-type': 'application/json', 'cf-access-jwt-assertion': jwt(subject) }, body: JSON.stringify(body) });
try {
  const t = await (await parserPost(issue())).json(); equal((await parserPost({ ...claim, code: t.code, proof: proof(enrollmentProofMessage('device-a', t.code)) })).status, 200);
  const invalidPartial = partial('unverified-assertion'); const invalidResult = await invalidPartial.result;
  equal(invalidResult.status, 401); ok(invalidResult.elapsedMs < 1000, 'invalid identity refused before waiting for body');
  const trickle = partial(jwt('helper-a')); const interval = setInterval(() => { if (!trickle.req.destroyed) trickle.req.write(' '); }, 200);
  try { const result = await trickle.result; observedBodyDeadlineMs = result.elapsedMs; equal(result.status, 408); ok(result.elapsedMs >= 4800 && result.elapsedMs < 6000, 'trickle cannot renew absolute five-second body deadline'); } finally { clearInterval(interval); trickle.req.destroy(); }
  const supportHeld = [];
  for (const subject of ['helper-a', 'helper-a2', 'helper-a3']) { supportHeld.push(partial(jwt(subject)), partial(jwt(subject))); await new Promise(resolve => setTimeout(resolve, 25)); }
  equal((await parserPost(issue(), 'helper-a')).status, 429); // same-principal parser cap
  equal((await parserPost(issue(), 'helper-a4')).status, 429); // support cannot consume owner reserve
  const ownerHeld = [partial(jwt()), partial(jwt())]; await new Promise(resolve => setTimeout(resolve, 25));
  equal((await parserPost({ operation: 'enroll.issue', deviceId: 'device-b' }, 'owner-b')).status, 429); // global cap
  for (const held of ownerHeld) held.req.destroy(); await Promise.all(ownerHeld.map(held => held.result)); await new Promise(resolve => setTimeout(resolve, 25));
  equal((await parserPost({ operation: 'device.revoke', deviceId: 'device-a' })).status, 200); // owner works while all support parser slots are occupied
  supportHeld[0].req.destroy(); await supportHeld[0].result; await new Promise(resolve => setTimeout(resolve, 25));
  equal((await parserPost(issue(), 'helper-a')).status, 403); // cancelled parser released the principal slot
  for (const held of supportHeld) held.req.destroy(); await Promise.all(supportHeld.map(held => held.result));
} finally { for (const req of ownedRequests) req.destroy(); await parserRelay.close(); }
console.log(JSON.stringify({ status: 'PASS', checks, transportCalls, auditEvents: audits.length, fixtureRoot, denialAttackAttempts: 1100, fullAuditRowsAfterRevocations: 100002, observedBodyDeadlineMs, scope: 'synthetic contracts, durable SQLite, concurrent subprocesses, crash recovery, loopback signed peers and TLS refusal; no cloud or friend device' }));

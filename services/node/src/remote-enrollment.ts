import { createHash, createPublicKey, randomBytes, randomUUID, verify, type KeyObject } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, realpathSync, fsyncSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createRemoteIdentity, decodeRemoteBase64, RemoteAccessError, remoteId, createRemoteInventoryTransport, createRemoteInventoryPeerHandler, type RemoteDevicePeerOptions, type RemoteTransportConfig, type RemoteIdentityConfig, type RemotePrincipal } from './remote-identity.ts';

export type RelayInventory = { working: number; idle: number; blocked: number };
export type RemoteAudit = { at: number; event: string; outcome: 'allowed' | 'denied'; subject?: string; tenant?: string; deviceId?: string; code?: string; grantId?: string; supportSubject?: string; expiresAt?: number; scope?: 'inventory.read' };
export type RemoteEnrollmentConfig = RemoteIdentityConfig & { enabled: true; devices: { id: string; ownerSubject: string; publicKey: string }[] };
type Binding = { id: string; owner: string; tenant: string; key: KeyObject };
type Device = { state: 'unregistered' | 'active' | 'revoked'; generation: number };
type Grant = { id: string; device: string; subject: string; expiresAt: number; generation: number };
type Pending = { hash: string; subject: string; expiresAt: number };
type Rate = { start: number; count: number };
type State = { version: 1; lastTime: number; devices: [string, Device][]; pending: [string, Pending][]; grants: [string, Grant][]; nonces: [string, number][]; rates: [string, Rate][] };
type DenialBatch = { firstAt: number; lastAt: number; count: number; last: RemoteAudit; reasons: [string, number][]; otherCount: number };
const NORMAL_AUDIT_LIMIT = 100000, NORMAL_DATABASE_LIMIT = 96 * 1024 * 1024;
const addCount = (a: number, b: number) => Math.min(Number.MAX_SAFE_INTEGER, a + b);
function mergeDenials(a: DenialBatch, b: DenialBatch): DenialBatch {
  const reasons = new Map(a.reasons); let otherCount = addCount(a.otherCount, b.otherCount);
  for (const [reason, count] of b.reasons) { if (reasons.has(reason) || reasons.size < 16) reasons.set(reason, addCount(reasons.get(reason) ?? 0, count)); else otherCount = addCount(otherCount, count); }
  return { firstAt: Math.min(a.firstAt, b.firstAt), lastAt: Math.max(a.lastAt, b.lastAt), count: addCount(a.count, b.count), last: b.lastAt >= a.lastAt ? b.last : a.last, reasons: [...reasons], otherCount };
}
type Transaction = <T>(work: (state: State, audit: (event: RemoteAudit) => void) => T) => T;
export type RemoteStore = { binding: string; persistent: boolean; transaction: Transaction; recordDenials: (batches: DenialBatch[]) => void; close: () => void };
export type RemoteEnrollmentOptions = {
  config?: RemoteEnrollmentConfig; now?: () => number; store?: RemoteStore;
  /** Synthetic-only sink. Production factory uses the transactional SQLite audit ledger. */
  audit?: (event: RemoteAudit) => void;
  readInventory?: (device: Readonly<{ id: string; tenant: string }>) => Promise<RelayInventory>;
};
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const reject = (code: string, status = 403): never => { throw new RemoteAccessError(code, status); };
function shape(body: Record<string, unknown>, required: string[]) { if (required.some(k => body[k] === undefined) || Object.keys(body).some(k => !required.includes(k))) reject('invalid_request', 400); }
const initialState = (ids: string[]): State => ({ version: 1, lastTime: 0, devices: ids.map(id => [id, { state: 'unregistered', generation: 0 }]), pending: [], grants: [], nonces: [], rates: [] });
function configBinding(config: RemoteEnrollmentConfig) { return hash(JSON.stringify({ ...config, keys: [...config.keys].sort((a, b) => a.kid.localeCompare(b.kid)), principals: [...config.principals].sort((a, b) => a.subject.localeCompare(b.subject)), devices: [...config.devices].sort((a, b) => a.id.localeCompare(b.id)) })); }
function validateState(state: State, ids: string[]) {
  const integer = (v: unknown) => Number.isSafeInteger(v) && Number(v) >= 0;
  const rows = (v: unknown, max: number): v is [string, any][] => Array.isArray(v) && v.length <= max && v.every(row => Array.isArray(row) && row.length === 2 && typeof row[0] === 'string' && row[0].length <= 300) && new Set(v.map(row => row[0])).size === v.length;
  if (!state || state.version !== 1 || !integer(state.lastTime) || !rows(state.devices, 1000) || !rows(state.pending, 1000) || !rows(state.grants, 1000) || !rows(state.nonces, 10000) || !rows(state.rates, 1000)) reject('state_corrupt', 503);
  if (state.devices.length !== ids.length || state.devices.some(([id, d]) => !ids.includes(id) || !d || !['unregistered', 'active', 'revoked'].includes(d.state) || !integer(d.generation) || (d.state === 'unregistered' ? d.generation !== 0 : d.generation < 1))) reject('state_corrupt', 503);
  if (state.pending.some(([id, p]) => !ids.includes(id) || !p || !/^[a-f0-9]{64}$/.test(p.hash) || !remoteId(p.subject) || !integer(p.expiresAt) || p.expiresAt > state.lastTime + 300)) reject('state_corrupt', 503);
  if (state.grants.some(([id, g]) => !g || id !== g.id || !remoteId(id) || !ids.includes(g.device) || !remoteId(g.subject) || !integer(g.generation) || !integer(g.expiresAt) || g.expiresAt > state.lastTime + 900)) reject('state_corrupt', 503);
  if (state.nonces.some(([id, expiry]) => !/^[a-f0-9]{64}$/.test(id) || !integer(expiry) || expiry > state.lastTime + 61) || state.rates.some(([id, r]) => !ids.includes(id) || !r || !integer(r.start) || r.start > state.lastTime || !integer(r.count) || r.count > 30)) reject('state_corrupt', 503);
}
function memoryStore(config: RemoteEnrollmentConfig, sink: NonNullable<RemoteEnrollmentOptions['audit']>): RemoteStore {
  let state = initialState(config.devices.map(d => d.id));
  return { binding: configBinding(config), persistent: false, recordDenials(batches) { for (const batch of batches) { const result: unknown = sink(Object.freeze({ ...batch.last })); if (result && typeof (result as { then?: unknown }).then === 'function') { void Promise.resolve(result).catch(() => {}); reject('audit_unavailable', 503); } } }, close() {}, transaction(work) {
    const draft = structuredClone(state), events: RemoteAudit[] = [];
    const result = work(draft, event => events.push(event));
    try { for (const event of events) { const output: unknown = sink(Object.freeze({ ...event })); if (output && typeof (output as { then?: unknown }).then === 'function') { void Promise.resolve(output).catch(() => {}); throw new Error('async audit'); } } } catch { return reject('audit_unavailable', 503); }
    state = draft; return result;
  } };
}

/** Private SQLite state and audit are committed together. No migration/reset is attempted on mismatch or corruption. */
export function openRemoteEnrollmentStore(directory: string, config: RemoteEnrollmentConfig): RemoteStore {
  return openRemoteState(directory, configBinding(config), config.devices.map(d => d.id), config.principals.map(p => p.subject));
}
function openRemoteState(directory: string, binding: string, ids: string[], subjects: string[] = []): RemoteStore {
  // Once ordinary history is full, each current grant and device still has one guaranteed revocation slot.
  const emergencyAuditLimit = NORMAL_AUDIT_LIMIT + ids.length + 1000;
  if (!path.isAbsolute(directory) || path.normalize(directory) !== directory) reject('state_path_invalid', 503);
  // The parent must already exist and resolve without symlinks. Only this private leaf is created.
  const secureParents = () => {
    if (realpathSync(path.dirname(directory)) !== path.dirname(directory)) reject('state_path_invalid', 503);
    for (let parent = path.dirname(directory); ; parent = path.dirname(parent)) {
      const stat = lstatSync(parent), uid = process.getuid?.();
      if (!stat.isDirectory() || ![0, uid].includes(stat.uid) || ((stat.mode & 0o022) !== 0 && !(stat.uid === 0 && (stat.mode & 0o1000) !== 0))) reject('state_path_invalid', 503);
      if (parent === path.dirname(parent)) break;
    }
  };
  secureParents();
  try { mkdirSync(directory, { mode: 0o700 }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  const privateDir = () => { const stat = lstatSync(directory); if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid?.() || (stat.mode & 0o777) !== 0o700) reject('state_path_invalid', 503); return stat; };
  const dirStat = privateDir(), file = path.join(directory, 'remote-access.sqlite');
  let created = false;
  try { const fd = openSync(file, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600); fsyncSync(fd); closeSync(fd); created = true; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW), original = fstatSync(fd); closeSync(fd);
  if (!original.isFile() || original.nlink !== 1 || original.uid !== process.getuid?.() || (original.mode & 0o777) !== 0o600 || (!created && original.size === 0)) reject('state_path_invalid', 503);
  const checkPath = () => {
    secureParents(); const d = privateDir(), s = lstatSync(file);
    if (d.ino !== dirStat.ino || d.dev !== dirStat.dev || !s.isFile() || s.ino !== original.ino || s.dev !== original.dev || s.nlink !== 1 || s.uid !== original.uid || (s.mode & 0o777) !== 0o600 || s.size > 128 * 1024 * 1024) reject('state_unavailable', 503);
    for (const suffix of ['-journal', '-wal', '-shm']) { try { const side = lstatSync(file + suffix); if (!side.isFile() || side.nlink !== 1 || side.uid !== original.uid || (side.mode & 0o077) !== 0) reject('state_path_invalid', 503); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; } }
  };
  let db: DatabaseSync | undefined;
  try {
    checkPath(); db = new DatabaseSync(file); db.exec('PRAGMA busy_timeout=1000; PRAGMA trusted_schema=OFF; PRAGMA foreign_keys=ON; PRAGMA journal_mode=DELETE; PRAGMA synchronous=EXTRA;');
    if (created) {
      db.exec('BEGIN IMMEDIATE');
      db.exec('CREATE TABLE state (id INTEGER PRIMARY KEY CHECK(id=1), binding TEXT NOT NULL, payload TEXT NOT NULL, digest TEXT NOT NULL, sequence INTEGER NOT NULL, head TEXT NOT NULL); CREATE TABLE audit (sequence INTEGER PRIMARY KEY, payload TEXT NOT NULL, previous TEXT NOT NULL, digest TEXT NOT NULL); CREATE TABLE denials (bucket TEXT PRIMARY KEY, payload TEXT NOT NULL, digest TEXT NOT NULL);');
      const payload = JSON.stringify(initialState(ids));
      db.prepare('INSERT INTO state VALUES(1,?,?,?,?,?)').run(binding, payload, hash(payload), 0, '0'.repeat(64)); db.exec('COMMIT');
      const parentFd = openSync(directory, constants.O_RDONLY); fsyncSync(parentFd); closeSync(parentFd);
    }
    const integrity = db.prepare('PRAGMA integrity_check').get() as Record<string, unknown>;
    if (Object.values(integrity)[0] !== 'ok') reject('state_corrupt', 503);
    const read = () => {
      const row = db!.prepare('SELECT * FROM state WHERE id=1').get() as { binding: string; payload: string; digest: string; sequence: number; head: string } | undefined;
      if (!row || row.binding !== binding) reject('state_binding_mismatch', 503);
      if (row!.payload.length > 8 * 1024 * 1024 || hash(row!.payload) !== row!.digest || !Number.isSafeInteger(row!.sequence) || row!.sequence < 0 || row!.sequence > emergencyAuditLimit) reject('state_corrupt', 503);
      let state: State; try { state = JSON.parse(row!.payload); } catch { return reject('state_corrupt', 503); }
      validateState(state, ids);
      const tail = db!.prepare('SELECT * FROM audit ORDER BY sequence DESC LIMIT 1').get() as { sequence: number; payload: string; previous: string; digest: string } | undefined;
      if (row!.sequence === 0 ? !!tail || row!.head !== '0'.repeat(64) : !tail || tail.sequence !== row!.sequence || tail.digest !== row!.head || hash(`${tail.previous}\n${tail.payload}`) !== tail.digest) reject('audit_corrupt', 503);
      return { row: row!, state };
    };
    const verifyLedger = (expected: { sequence: number; head: string }) => {
      let head = '0'.repeat(64), sequence = 0;
      for (const row of db!.prepare('SELECT * FROM audit ORDER BY sequence').iterate() as Iterable<{ sequence: number; previous: string; payload: string; digest: string }>) {
        sequence++; if (row.sequence !== sequence || row.previous !== head || hash(`${head}\n${row.payload}`) !== row.digest) reject('audit_corrupt', 503); head = row.digest;
      }
      if (sequence !== expected.sequence || head !== expected.head) reject('audit_corrupt', 503);
    };
    const dataVersion = () => Number(db!.prepare('PRAGMA data_version').get()!.data_version);
    db.exec('BEGIN IMMEDIATE'); verifyLedger(read().row); let knownVersion = dataVersion(); db.exec('COMMIT');
    let closed = false;
    const store: RemoteStore = { binding, persistent: true, recordDenials(batches) {
      if (batches.length > subjects.length + 1) reject('denial_capacity', 503);
      store.transaction(() => {
        for (const batch of batches) {
          const bucket = batch.last.subject ?? '@anonymous';
          if (bucket !== '@anonymous' && !subjects.includes(bucket)) reject('denial_identity_invalid', 503);
          const old = db!.prepare('SELECT payload,digest FROM denials WHERE bucket=?').get(bucket) as { payload: string; digest: string } | undefined;
          let merged = batch;
          if (old) {
            if (old.payload.length > 4096 || hash(old.payload) !== old.digest) reject('denial_corrupt', 503);
            const prior = JSON.parse(old.payload) as DenialBatch;
            if (!Number.isSafeInteger(prior.count) || prior.count < 1 || !Array.isArray(prior.reasons) || prior.reasons.length > 16 || !Number.isSafeInteger(prior.otherCount)) reject('denial_corrupt', 503);
            merged = mergeDenials(prior, batch);
          }
          const payload = JSON.stringify(merged); if (payload.length > 4096) reject('denial_capacity', 503);
          db!.prepare('INSERT INTO denials VALUES(?,?,?) ON CONFLICT(bucket) DO UPDATE SET payload=excluded.payload,digest=excluded.digest').run(bucket, payload, hash(payload));
        }
      });
    }, close() { if (!closed) { closed = true; db!.close(); } }, transaction(work) {
      if (closed) return reject('state_unavailable', 503);
      try {
        checkPath(); db!.exec('BEGIN IMMEDIATE'); const { row, state } = read(), version = dataVersion(); if (version !== knownVersion) verifyLedger(row); let sequence = row.sequence, head = row.head;
        const result = work(state, event => {
          const revocation = event.outcome === 'allowed' && ['device.revoke', 'support.revoke'].includes(event.event);
          if ((!revocation && (sequence >= NORMAL_AUDIT_LIMIT || lstatSync(file).size >= NORMAL_DATABASE_LIMIT)) || ++sequence > emergencyAuditLimit) reject('audit_capacity', 503);
          const payload = JSON.stringify(event); if (payload.length > 4096) reject('audit_unavailable', 503);
          const digest = hash(`${head}\n${payload}`); db!.prepare('INSERT INTO audit VALUES(?,?,?,?)').run(sequence, payload, head, digest); head = digest;
        });
        if (result && typeof (result as { then?: unknown }).then === 'function') reject('transaction_async', 503);
        validateState(state, ids); const payload = JSON.stringify(state);
        db!.prepare('UPDATE state SET payload=?,digest=?,sequence=?,head=? WHERE id=1').run(payload, hash(payload), sequence, head);
        db!.exec('COMMIT'); knownVersion = version; return result;
      } catch (error) { try { db!.exec('ROLLBACK'); } catch {} if (error instanceof RemoteAccessError) throw error; return reject('state_unavailable', 503); }
    } };
    return store;
  } catch (error) { try { db?.exec('ROLLBACK'); } catch {} db?.close(); if (error instanceof RemoteAccessError) throw error; return reject('state_unavailable', 503); }
}

export function enrollmentProofMessage(deviceId: string, code: string) { return JSON.stringify(['agent-base/enroll/v1', deviceId, code]); }
export function relayProofMessage(deviceId: string, token: string, nonce: string, at: number) { return JSON.stringify(['agent-base/relay/v1', deviceId, 'inventory.read', hash(token), nonce, at]); }
export function createRemoteEnrollment(options: RemoteEnrollmentOptions = {}) {
  const now = options.now ?? (() => Math.floor(Date.now() / 1000)), config = options.config;
  const enabled = config?.enabled === true && (!!options.store || typeof options.audit === 'function');
  const identity = enabled && config ? createRemoteIdentity(config) : undefined, bindings = new Map<string, Binding>();
  const store = identity && config ? options.store ?? memoryStore(config, options.audit!) : undefined;
  if (identity && config) {
    if (!config.devices.length || config.devices.length > 1000 || store!.binding !== configBinding(config)) throw new Error('incomplete or mismatched device configuration');
    for (const row of config.devices) {
      const owner = identity.principal(row.ownerSubject), key = createPublicKey(row.publicKey);
      if (!remoteId(row.id) || bindings.has(row.id) || owner?.role !== 'owner' || key.asymmetricKeyType !== 'ed25519') throw new Error('invalid device binding');
      bindings.set(row.id, { id: row.id, owner: owner.subject, tenant: owner.tenant, key });
    }
  }
  const deviceFor = (p: RemotePrincipal, id: unknown) => { const d = typeof id === 'string' ? bindings.get(id) : undefined; if (!d || d.tenant !== p.tenant) return reject('device_unavailable', 404); return d; };
  const owner = (p: RemotePrincipal, d: Binding) => { if (p.role !== 'owner' || p.subject !== d.owner) reject('owner_required'); };
  function live(p: RemotePrincipal, d: Binding, state: State) {
    if (p.expiresAt <= now()) reject('identity_expired', 401);
    const current = new Map(state.devices).get(d.id)!; if (current.state !== 'active') reject('device_inactive');
    if (p.subject === d.owner && p.role === 'owner') return undefined;
    const grant = state.grants.find(([, g]) => g.device === d.id && g.subject === p.subject && g.expiresAt > now() && g.generation === current.generation)?.[1];
    if (p.role !== 'support' || !grant) return reject('consent_required'); return grant.id;
  }
  function signature(d: Binding, message: string, proof: unknown) { let valid = false; try { if (typeof proof === 'string' && proof.length <= 128) valid = verify(null, Buffer.from(message), d.key, decodeRemoteBase64(proof)); } catch {} if (!valid) reject('device_proof_invalid', 401); }
  const checkClock = (s: State) => { const at = now(); if (!Number.isSafeInteger(at) || at < s.lastTime) reject('clock_regressed', 503); s.lastTime = at; };
  // Denials have fixed per-verified-subject/anonymous aggregates, separate from immutable authorization history.
  // Writes are admitted per process (60/minute globally, 4/minute per bucket); excess stays in bounded counters.
  const denied = new Map<string, DenialBatch>(), denialWrites = new Map<string, number>();
  let denialWindow = -1, totalDenialWrites = 0, denialAccountingDegraded = false;
  const flushDenials = (closing = false) => {
    if (!store || !denied.size) return;
    const window = Math.floor(Date.now() / 60000); if (window !== denialWindow) { denialWindow = window; totalDenialWrites = 0; denialWrites.clear(); }
    const entries = [...denied].filter(([bucket]) => closing || (totalDenialWrites < 60 && (denialWrites.get(bucket) ?? 0) < 4)).slice(0, closing ? 1001 : Math.max(0, 60 - totalDenialWrites));
    if (!entries.length) return;
    for (const [bucket] of entries) { totalDenialWrites++; denialWrites.set(bucket, (denialWrites.get(bucket) ?? 0) + 1); }
    try { store.recordDenials(entries.map(([, batch]) => batch)); denialAccountingDegraded = false; for (const [bucket] of entries) denied.delete(bucket); } catch { denialAccountingDegraded = true; }
  };
  const recordDenial = (event: RemoteAudit) => {
    const bucket = event.subject ?? '@anonymous', one: DenialBatch = { firstAt: event.at, lastAt: event.at, count: 1, last: event, reasons: [[`${event.event}:${event.code ?? 'unknown'}`.slice(0, 128), 1]], otherCount: 0 };
    denied.set(bucket, denied.has(bucket) ? mergeDenials(denied.get(bucket)!, one) : one); flushDenials();
  };
  const denialTimer = store?.persistent ? setInterval(flushDenials, 60000) : undefined; denialTimer?.unref();
  return {
    status: () => ({ enabled: !!identity, scope: 'local-contract', relayOperations: ['inventory.read'], controlEnabled: false, transportConfigured: !!options.readInventory, persistentEnrollment: !!store?.persistent, denialAccountingDegraded, pendingDenialBuckets: denied.size }),
    authenticate(token: string) {
      if (!identity) return reject('remote_access_disabled', 503);
      try { return identity.authenticate(token, now()); } catch (error) { recordDenial({ at: now(), event: 'identity', outcome: 'denied', code: 'identity_invalid' }); throw error; }
    },
    close: () => { if (denialTimer) clearInterval(denialTimer); flushDenials(true); store?.close(); },
    async execute(token: string, input: unknown): Promise<unknown> {
      if (!identity || !store) return reject('remote_access_disabled', 503);
      let p: RemotePrincipal | undefined, d: Binding | undefined, operation = 'invalid';
      try {
        p = identity.authenticate(token, now());
        if (!input || typeof input !== 'object' || Array.isArray(input)) reject('invalid_request', 400);
        const body = input as Record<string, unknown>;
        if (typeof body.operation !== 'string' || !['enroll.issue', 'enroll.claim', 'device.revoke', 'support.grant', 'support.revoke', 'relay.read'].includes(body.operation)) reject('unsupported_operation', 400);
        operation = body.operation as string; d = deviceFor(p, body.deviceId);
        const principal = p, device = d;
        // Owner-only operations reject support principals before acquiring the durable transaction lock.
        if (operation !== 'relay.read') owner(principal, device);
        const event = (name: string): RemoteAudit => ({ at: now(), event: name, outcome: 'allowed', subject: principal.subject, tenant: principal.tenant, deviceId: device.id });
        const result = store.transaction((state, audit) => {
          checkClock(state); const current = new Map(state.devices).get(device.id)!;
          if (operation === 'enroll.issue') {
            shape(body, ['operation', 'deviceId']); owner(principal, device); if (current.state !== 'unregistered') reject('device_inactive');
            const code = randomBytes(32).toString('base64url'), expiresAt = now() + 300;
            audit(event(operation)); state.pending = state.pending.filter(([id]) => id !== device.id); state.pending.push([device.id, { hash: hash(code), subject: principal.subject, expiresAt }]); return { code, expiresAt };
          }
          if (operation === 'enroll.claim') {
            shape(body, ['operation', 'deviceId', 'code', 'proof']); owner(principal, device); const ticket = new Map(state.pending).get(device.id);
            if (current.state !== 'unregistered' || typeof body.code !== 'string' || body.code.length !== 43 || !ticket || ticket.subject !== principal.subject || ticket.expiresAt <= now() || ticket.hash !== hash(body.code)) reject('enrollment_invalid');
            signature(device, enrollmentProofMessage(device.id, body.code as string), body.proof); audit(event(operation)); state.pending = state.pending.filter(([id]) => id !== device.id); current.state = 'active'; current.generation++; return { deviceId: device.id, state: current.state };
          }
          if (operation === 'device.revoke') {
            shape(body, ['operation', 'deviceId']); owner(principal, device); if (current.state === 'revoked') return { deviceId: device.id, state: current.state }; audit(event(operation)); current.state = 'revoked'; current.generation++;
            state.pending = state.pending.filter(([id]) => id !== device.id); state.grants = state.grants.filter(([, g]) => g.device !== device.id); return { deviceId: device.id, state: current.state };
          }
          if (operation === 'support.grant') {
            shape(body, ['operation', 'deviceId', 'subject', 'expiresAt', 'scope']); owner(principal, device); live(principal, device, state);
            const support = typeof body.subject === 'string' ? identity.principal(body.subject) : undefined;
            if (!support || support.tenant !== principal.tenant || support.role !== 'support' || body.scope !== 'inventory.read' || typeof body.expiresAt !== 'number' || !Number.isSafeInteger(body.expiresAt) || body.expiresAt <= now() || body.expiresAt > Math.min(now() + 900, principal.expiresAt)) reject('invalid_consent', 400);
            state.grants = state.grants.filter(([, g]) => g.expiresAt > now()); if (state.grants.length >= 1000) reject('consent_capacity', 503);
            const id = randomUUID(); audit({ ...event(operation), grantId: id, supportSubject: support!.subject, expiresAt: body.expiresAt as number, scope: 'inventory.read' });
            state.grants.push([id, { id, device: device.id, subject: support!.subject, expiresAt: body.expiresAt as number, generation: current.generation }]); return { grantId: id, expiresAt: body.expiresAt, scope: 'inventory.read' };
          }
          if (operation === 'support.revoke') {
            shape(body, ['operation', 'deviceId', 'grantId']); owner(principal, device); const grant = state.grants.find(([id, g]) => id === body.grantId && g.device === device.id)?.[1];
            if (!grant) reject('consent_unavailable', 404); audit({ ...event(operation), grantId: grant!.id, supportSubject: grant!.subject }); state.grants = state.grants.filter(([id]) => id !== grant!.id); return { revoked: true };
          }
          shape(body, ['operation', 'deviceId', 'nonce', 'at', 'proof']); const consent = live(principal, device, state);
          if (typeof body.nonce !== 'string' || !/^[a-zA-Z0-9_-]{22,64}$/.test(body.nonce) || typeof body.at !== 'number' || !Number.isSafeInteger(body.at) || Math.abs(now() - body.at) > 30) reject('relay_proof_invalid', 401);
          signature(device, relayProofMessage(device.id, token, body.nonce as string, body.at as number), body.proof);
          state.nonces = state.nonces.filter(([, expiry]) => expiry >= now()); const nonce = hash(`${device.id}:${body.nonce}`);
          if (state.nonces.some(([id]) => id === nonce)) reject('relay_replay', 409); if (state.nonces.length >= 10000) reject('relay_capacity', 503);
          if (!options.readInventory) reject('transport_unavailable', 503);
          let rate = state.rates.find(([id]) => id === device.id)?.[1]; if (!rate) { rate = { start: now(), count: 0 }; state.rates.push([device.id, rate]); }
          if (now() - rate.start >= 60) { rate.start = now(); rate.count = 0; } if (rate.count >= 30) reject('relay_rate_limited', 429); rate.count++;
          audit(event('relay.dispatch')); state.nonces.push([nonce, now() + 61]); return { dispatch: true as const, consent, generation: current.generation };
        });
        if (!('dispatch' in result)) return result;
        const inventory = await options.readInventory!(Object.freeze({ id: device.id, tenant: device.tenant }));
        return store.transaction((state, audit) => {
          checkClock(state); if (live(principal, device, state) !== result.consent) reject('consent_changed'); if (new Map(state.devices).get(device.id)!.generation !== result.generation) reject('device_inactive');
          if (!inventory || ![inventory.working, inventory.idle, inventory.blocked].every(v => Number.isSafeInteger(v) && v >= 0 && v <= 100000)) reject('inventory_invalid', 502);
          audit(event('relay.complete')); return { deviceId: device.id, inventory: { working: inventory.working, idle: inventory.idle, blocked: inventory.blocked } };
        });
      } catch (error) {
        const safe = error instanceof RemoteAccessError ? error : new RemoteAccessError('remote_unavailable', 503);
        recordDenial({ at: now(), event: operation, outcome: 'denied', ...(p ? { subject: p.subject, tenant: p.tenant } : {}), ...(d ? { deviceId: d.id } : {}), code: safe.code }); throw safe;
      }
    },
  };
}

/** Explicit production assembly. It opens private state, but never starts a listener or contacts a device on construction. */
export function createDurableRemoteEnrollment(options: { config: RemoteEnrollmentConfig; stateDirectory: string; transport: RemoteTransportConfig; now?: () => number }) {
  createRemoteEnrollment({ config: options.config, audit: () => {} });
  for (const device of options.config.devices) {
    const peer = options.transport.devices.find(p => p.id === device.id), principal = options.config.principals.find(p => p.subject === device.ownerSubject);
    if (!peer || peer.tenant !== principal?.tenant || createPublicKey(peer.publicKey).export({ format: 'der', type: 'spki' }).toString('hex') !== createPublicKey(device.publicKey).export({ format: 'der', type: 'spki' }).toString('hex')) throw new Error('transport device binding mismatch');
  }
  const readInventory = createRemoteInventoryTransport(options.transport), store = openRemoteEnrollmentStore(options.stateDirectory, options.config);
  try { return createRemoteEnrollment({ config: options.config, now: options.now, store, readInventory }); } catch (error) { store.close(); throw error; }
}

/** Device-side private-origin adapter; caller owns listening/TLS/tunnel setup after authorization. */
export function createDurableRemoteDevicePeer(options: Omit<RemoteDevicePeerOptions, 'reserve' | 'complete'> & { stateDirectory: string }) {
  const hubKey = createPublicKey(options.hubPublicKey), deviceKey = createPublicKey(options.privateKey);
  if (!remoteId(options.id) || !remoteId(options.tenant) || hubKey.asymmetricKeyType !== 'ed25519' || deviceKey.asymmetricKeyType !== 'ed25519') throw new Error('invalid peer configuration');
  const binding = hash(JSON.stringify([options.id, options.tenant, hubKey.export({ format: 'der', type: 'spki' }).toString('hex'), deviceKey.export({ format: 'der', type: 'spki' }).toString('hex')]));
  const store = openRemoteState(options.stateDirectory, binding, [options.id]);
  const event = (name: string): RemoteAudit => ({ at: Math.floor(Date.now() / 1000), event: name, outcome: 'allowed', tenant: options.tenant, deviceId: options.id });
  try {
    const handle = createRemoteInventoryPeerHandler({ ...options, reserve(request) {
      store.transaction((state, audit) => {
        const at = Math.floor(Date.now() / 1000); if (at < state.lastTime) reject('clock_regressed', 503); state.lastTime = at;
        state.nonces = state.nonces.filter(([, expiry]) => expiry >= at); const nonce = hash(request.id);
        if (state.nonces.some(([id]) => id === nonce)) reject('device_replay', 409); if (state.nonces.length >= 10000) reject('device_capacity', 503);
        let rate = state.rates.find(([id]) => id === options.id)?.[1]; if (!rate) { rate = { start: at, count: 0 }; state.rates.push([options.id, rate]); }
        if (at - rate.start >= 60) { rate.start = at; rate.count = 0; } if (rate.count >= 30) reject('device_rate_limited', 429); rate.count++;
        state.nonces.push([nonce, Math.ceil(request.expiresAt / 1000) + 1]); audit(event('device.dispatch'));
      });
    }, complete() { store.transaction((_state, audit) => audit(event('device.complete'))); } });
    return { handle, close: () => store.close() };
  } catch (error) { store.close(); throw error; }
}

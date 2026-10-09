import { createPublicKey, verify, type KeyObject } from 'node:crypto';

export class RemoteAccessError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status = 403) { super(code); this.code = code; this.status = status; }
}
export type RemotePrincipal = { subject: string; tenant: string; role: 'owner' | 'support'; expiresAt: number };
export type RemoteIdentityConfig = {
  account: string;
  issuer: string;
  audience: string;
  keys: { kid: string; publicKey: string }[];
  principals: { subject: string; tenant: string; role: 'owner' | 'support' }[];
};
const fail = () => { throw new RemoteAccessError('identity_invalid', 401); };
export const remoteId = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:@-]{0,127}$/.test(v);
export function decodeRemoteBase64(value: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return fail();
  const bytes = Buffer.from(value, 'base64url');
  if (bytes.toString('base64url') !== value) return fail();
  return bytes;
}
function object(part: string): Record<string, unknown> {
  try { const result = JSON.parse(decodeRemoteBase64(part).toString('utf8')); if (result && typeof result === 'object' && !Array.isArray(result)) return result; } catch {}
  return fail();
}
/** Pinned issuer keys only: never fetch jku/x5u/iss supplied in an untrusted token. */
export function createRemoteIdentity(config: RemoteIdentityConfig) {
  if (!remoteId(config.account) || !/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(config.issuer) || !remoteId(config.audience)) throw new Error('invalid identity configuration');
  const issuer = config.issuer, audience = config.audience;
  const keys = new Map<string, KeyObject>();
  for (const row of config.keys) {
    const key = createPublicKey(row.publicKey);
    if (!remoteId(row.kid) || keys.has(row.kid) || key.asymmetricKeyType !== 'rsa' || (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) throw new Error('invalid identity key');
    keys.set(row.kid, key);
  }
  const principals = new Map<string, Omit<RemotePrincipal, 'expiresAt'>>();
  for (const row of config.principals) {
    if (!remoteId(row.subject) || !remoteId(row.tenant) || !['owner', 'support'].includes(row.role) || principals.has(row.subject)) throw new Error('invalid principal binding');
    principals.set(row.subject, { subject: row.subject, tenant: row.tenant, role: row.role });
  }
  if (!keys.size || !principals.size || keys.size > 16 || principals.size > 1000) throw new Error('incomplete identity configuration');
  return {
    principal: (subject: string) => { const p = principals.get(subject); return p ? { ...p } : undefined; },
    authenticate(token: string, now: number): RemotePrincipal {
      if (typeof token !== 'string' || token.length > 12000) return fail();
      const parts = token.split('.'); if (parts.length !== 3) return fail();
      const header = object(parts[0]), claims = object(parts[1]);
      if (header.alg !== 'RS256' || typeof header.kid !== 'string' || header.crit !== undefined || header.jku !== undefined || header.x5u !== undefined) return fail();
      const key = keys.get(header.kid); if (!key) return fail();
      let verified = false;
      try { verified = verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), key, decodeRemoteBase64(parts[2])); } catch {}
      if (!verified || claims.iss !== issuer || !Array.isArray(claims.aud) || !claims.aud.includes(audience)) return fail();
      const exp = claims.exp, iat = claims.iat, nbf = claims.nbf;
      if (!Number.isSafeInteger(exp) || !Number.isSafeInteger(iat) || typeof exp !== 'number' || typeof iat !== 'number' || exp <= now || iat > now || exp <= iat || exp - iat > 3600 || (nbf !== undefined && (typeof nbf !== 'number' || !Number.isSafeInteger(nbf) || nbf > now))) return fail();
      const principal = typeof claims.sub === 'string' ? principals.get(claims.sub) : undefined;
      if (!principal) return fail();
      // JWT tenant/email/role claims and request tenant selectors confer no authority.
      return { ...principal, expiresAt: exp };
    },
  };
}

// The transport is separate from the operator's SSH inventory and never accepts caller-selected URLs.
import { createHash, createPrivateKey, randomUUID, sign } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import type { IncomingMessage, ServerResponse } from 'node:http';
export type RemoteInventory = { working: number; idle: number; blocked: number };
export type RemoteTransportConfig = {
  privateKey: string;
  devices: { id: string; tenant: string; url: string; publicKey: string }[];
  deadlineMs?: number;
  /** Fixtures only. Still restricted to literal loopback addresses; never accepts arbitrary HTTP hosts. */
  allowLoopbackHttpForTests?: boolean;
};
export type DeviceRequest = { version: 1; id: string; deviceId: string; tenant: string; operation: 'inventory.read'; issuedAt: number; expiresAt: number };
type DeviceResponse = { version: 1; requestId: string; requestHash: string; deviceId: string; tenant: string; issuedAt: number; expiresAt: number; inventory: RemoteInventory; signature: string };
const digest = (text: string) => createHash('sha256').update(text).digest('hex');
const transportError = (code: string, status = 502): never => { throw new RemoteAccessError(code, status); };
function fields(value: unknown, keys: string[]): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)); }
export function deviceRequestMessage(r: DeviceRequest) { return JSON.stringify(['agent-base/device-request/v1', r.id, r.deviceId, r.tenant, r.operation, r.issuedAt, r.expiresAt]); }
export function deviceResponseMessage(r: Omit<DeviceResponse, 'signature'>) { return JSON.stringify(['agent-base/device-response/v1', r.requestId, r.requestHash, r.deviceId, r.tenant, r.issuedAt, r.expiresAt, r.inventory.working, r.inventory.idle, r.inventory.blocked]); }
function inventoryValid(value: unknown): value is RemoteInventory { return fields(value, ['working', 'idle', 'blocked']) && Object.values(value).every(n => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 && n <= 100000); }
function edPublic(pem: string) { const key = createPublicKey(pem); if (key.asymmetricKeyType !== 'ed25519') throw new Error('Ed25519 key required'); return key; }
function edPrivate(pem: string) { const key = createPrivateKey(pem); if (key.asymmetricKeyType !== 'ed25519') throw new Error('Ed25519 key required'); return key; }
function signatureValid(key: KeyObject, message: string, signature: unknown) { try { return typeof signature === 'string' && signature.length <= 128 && verify(null, Buffer.from(message), key, decodeRemoteBase64(signature)); } catch { return false; } }
function deadlineValue(value = 5000) { if (!Number.isSafeInteger(value) || value < 100 || value > 5000) throw new Error('deadline must be 100..5000 ms'); return value; }

/** Outbound HTTPS only; fixed URL, TLS verification, no redirect, no cookies/tokens, <=8 KiB and <=5 seconds. */
export function createRemoteInventoryTransport(config: RemoteTransportConfig) {
  const key = edPrivate(config.privateKey), deadlineMs = deadlineValue(config.deadlineMs);
  const peers = new Map<string, { tenant: string; url: URL; key: KeyObject; active: number; start: number; count: number }>();
  if (!config.devices.length || config.devices.length > 1000) throw new Error('device transport configuration required');
  for (const device of config.devices) {
    const url = new URL(device.url);
    const loopbackFixture = config.allowLoopbackHttpForTests === true && url.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(url.hostname);
    if (!remoteId(device.id) || !remoteId(device.tenant) || peers.has(device.id) || (!loopbackFixture && url.protocol !== 'https:') || url.username || url.password || url.hash || url.search || url.pathname !== '/agent-base/remote/inventory') throw new Error('invalid device transport endpoint');
    peers.set(device.id, { tenant: device.tenant, url, key: edPublic(device.publicKey), active: 0, start: 0, count: 0 });
  }
  return async (device: Readonly<{ id: string; tenant: string }>): Promise<RemoteInventory> => {
    const peer = peers.get(device.id); if (!peer || peer.tenant !== device.tenant) return transportError('transport_device_unavailable', 403);
    const at = Date.now(); if (at < peer.start) return transportError('transport_clock_regressed', 503);
    if (at - peer.start >= 60000) { peer.start = at; peer.count = 0; }
    if (peer.count >= 30) return transportError('transport_rate_limited', 429); if (peer.active >= 2) return transportError('transport_busy', 429);
    peer.count++; peer.active++;
    const request: DeviceRequest = { version: 1, id: randomUUID(), deviceId: device.id, tenant: device.tenant, operation: 'inventory.read', issuedAt: at, expiresAt: at + deadlineMs };
    const body = JSON.stringify({ request, signature: sign(null, Buffer.from(deviceRequestMessage(request)), key).toString('base64url') });
    try {
      const raw = await new Promise<string>((resolve, reject) => {
        let settled = false;
        const req = (peer.url.protocol === 'https:' ? https : http).request(peer.url, { method: 'POST', agent: false, headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), accept: 'application/json' } });
        const timer = setTimeout(() => { finish(new RemoteAccessError('transport_deadline', 504)); req.destroy(); }, deadlineMs);
        const finish = (error?: Error, value?: string) => { if (settled) return; settled = true; clearTimeout(timer); if (error) reject(error); else resolve(value!); };
        req.on('error', () => finish(new RemoteAccessError('transport_unavailable', 502)));
        req.on('response', res => {
          if (res.statusCode !== 200 || res.headers['content-type'] !== 'application/json' || res.headers['content-encoding'] !== undefined || Number(res.headers['content-length'] ?? 0) > 8192) { finish(new RemoteAccessError(res.statusCode === 504 ? 'transport_deadline' : 'transport_response_invalid', res.statusCode === 504 ? 504 : 502)); res.destroy(); req.destroy(); return; }
          const chunks: Buffer[] = []; let size = 0;
          res.on('data', (chunk: Buffer) => { size += chunk.length; if (size > 8192) { finish(new RemoteAccessError('transport_response_too_large', 502)); res.destroy(); req.destroy(); } else chunks.push(chunk); });
          res.on('error', () => finish(new RemoteAccessError('transport_unavailable', 502)));
          res.on('aborted', () => finish(new RemoteAccessError('transport_unavailable', 502)));
          res.on('end', () => finish(undefined, Buffer.concat(chunks).toString('utf8')));
        });
        req.end(body);
      });
      let response: DeviceResponse; try { response = JSON.parse(raw); } catch { return transportError('transport_response_invalid'); }
      if (!fields(response, ['version', 'requestId', 'requestHash', 'deviceId', 'tenant', 'issuedAt', 'expiresAt', 'inventory', 'signature']) || response.version !== 1 || response.requestId !== request.id || response.requestHash !== digest(deviceRequestMessage(request)) || response.deviceId !== device.id || response.tenant !== device.tenant || response.expiresAt !== request.expiresAt || !Number.isSafeInteger(response.issuedAt) || response.issuedAt < request.issuedAt || response.issuedAt > Date.now() || Date.now() >= request.expiresAt || !inventoryValid(response.inventory) || !signatureValid(peer.key, deviceResponseMessage(response), response.signature)) return transportError('transport_response_invalid');
      return { ...response.inventory };
    } finally { peer.active--; }
  };
}

export type RemoteDevicePeerOptions = {
  id: string; tenant: string; hubPublicKey: string; privateKey: string;
  /** Commits request replay/rate reservation and audit atomically, or throws. Production assembly supplies SQLite. */
  reserve: (request: DeviceRequest) => void;
  complete: (request: DeviceRequest) => void;
  readInventory: (signal: AbortSignal) => Promise<RemoteInventory>;
};
/** Handler only: the caller must bind a private origin. It never opens a listener. */
export function createRemoteInventoryPeerHandler(options: RemoteDevicePeerOptions) {
  if (!remoteId(options.id) || !remoteId(options.tenant)) throw new Error('invalid peer identity');
  const hub = edPublic(options.hubPublicKey), key = edPrivate(options.privateKey), id = options.id, tenant = options.tenant;
  let active = 0;
  return async (req: IncomingMessage, res: ServerResponse) => {
    const send = (status: number, body: unknown) => { if (!res.destroyed && !res.writableEnded) { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); } };
    if (req.method !== 'POST' || req.url !== '/agent-base/remote/inventory' || req.headers.origin !== undefined || req.headers['content-type'] !== 'application/json' || req.headers['content-encoding'] !== undefined) return send(400, { error: 'device_request_invalid' });
    if (active >= 2) return send(429, { error: 'device_busy' }); active++;
    let parsingTimer: ReturnType<typeof setTimeout> | undefined, providerStarted = false;
    const controller = new AbortController();
    const disconnect = () => controller.abort(); res.on('close', disconnect);
    try {
      parsingTimer = setTimeout(() => { controller.abort(); req.destroy(); }, 5000);
      const chunks: Buffer[] = []; let size = 0;
      for await (const raw of req) { const bytes = Buffer.from(raw); size += bytes.length; if (size > 4096) return send(413, { error: 'device_request_too_large' }); chunks.push(bytes); }
      clearTimeout(parsingTimer); parsingTimer = undefined;
      let envelope: { request: DeviceRequest; signature: string }; try { envelope = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return send(400, { error: 'device_request_invalid' }); }
      const r = envelope?.request, at = Date.now();
      if (!fields(envelope, ['request', 'signature']) || !fields(r, ['version', 'id', 'deviceId', 'tenant', 'operation', 'issuedAt', 'expiresAt']) || r.version !== 1 || !/^[a-f0-9-]{36}$/.test(r.id) || r.deviceId !== id || r.tenant !== tenant || r.operation !== 'inventory.read' || !Number.isSafeInteger(r.issuedAt) || !Number.isSafeInteger(r.expiresAt) || r.issuedAt > at || r.expiresAt <= at || r.expiresAt - r.issuedAt > 5000 || r.expiresAt <= r.issuedAt || !signatureValid(hub, deviceRequestMessage(r), envelope.signature)) return send(401, { error: 'device_identity_invalid' });
      const reserved: unknown = options.reserve(r); if (reserved && typeof (reserved as { then?: unknown }).then === 'function') { void Promise.resolve(reserved).catch(() => {}); return send(503, { error: 'device_state_unavailable' }); }
      let timer: ReturnType<typeof setTimeout> | undefined;
      const provider = Promise.resolve().then(() => options.readInventory(controller.signal));
      providerStarted = true; void provider.finally(() => { active--; }).catch(() => {});
      try {
        const inventory = await Promise.race([provider, new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new RemoteAccessError('device_deadline', 504)); }, Math.max(1, r.expiresAt - Date.now())); })]);
        if (controller.signal.aborted || Date.now() >= r.expiresAt) return send(504, { error: 'device_deadline' });
        if (!inventoryValid(inventory)) return send(502, { error: 'device_inventory_invalid' });
        const response: Omit<DeviceResponse, 'signature'> = { version: 1, requestId: r.id, requestHash: digest(deviceRequestMessage(r)), deviceId: id, tenant, issuedAt: Date.now(), expiresAt: r.expiresAt, inventory: { ...inventory } };
        const completed: unknown = options.complete(r); if (completed && typeof (completed as { then?: unknown }).then === 'function') { void Promise.resolve(completed).catch(() => {}); return send(503, { error: 'device_state_unavailable' }); }
        return send(200, { ...response, signature: sign(null, Buffer.from(deviceResponseMessage(response)), key).toString('base64url') });
      } finally { if (timer) clearTimeout(timer); }
    } catch (error) { return error instanceof RemoteAccessError ? send(error.status, { error: error.code }) : send(503, { error: 'device_unavailable' }); }
    finally { if (parsingTimer) clearTimeout(parsingTimer); res.off('close', disconnect); if (!providerStarted) active--; }
  };
}

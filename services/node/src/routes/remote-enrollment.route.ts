import { createServer } from 'node:http';
import type { Route } from './registry.ts';
import { createRemoteEnrollment, createDurableRemoteEnrollment } from '../remote-enrollment.ts';
import { RemoteAccessError } from '../remote-identity.ts';

export const REMOTE_BODY_LIMITS = Object.freeze({ deadlineMs: 5000, bytes: 4096, pending: 8, perSubject: 2, supportPending: 6 });

/** The shipped route is disabled. Activated parsers require a verified identity before reserving a slot. */
export function remoteEnrollmentRoute(service = createRemoteEnrollment(), allowedOrigins: ReadonlySet<string> = new Set(), identitySource: 'bearer' | 'cloudflare-access' = 'bearer'): Route {
  let pending = 0, supportPending = 0;
  const perSubject = new Map<string, number>();
  return { method: 'POST', path: /^\/api\/remote\/access$/, async handle(req, res) {
    const send = (status: number, body: unknown, close = false) => {
      if (res.destroyed || res.writableEnded) return;
      res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...(close ? { connection: 'close' } : {}) });
      res.end(JSON.stringify(body), () => { if (close) req.destroy(); });
    };
    const peer = req.socket.remoteAddress, origin = req.headers.origin;
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(peer ?? '') || (origin !== undefined && !allowedOrigins.has(origin))) return send(403, { error: 'local_contract_only' }, true);
    if (new URL(req.url ?? '/', 'http://node').search) return send(400, { error: 'invalid_request' }, true);
    if (!service.status().enabled) return send(503, { error: 'remote_access_disabled' }, true);
    const authorization = req.headers.authorization, assertion = req.headers['cf-access-jwt-assertion'];
    if (authorization !== undefined && assertion !== undefined) return send(401, { error: 'identity_ambiguous' }, true);
    const token = identitySource === 'cloudflare-access' ? assertion : typeof authorization === 'string' && authorization.startsWith('Bearer ') ? authorization.slice(7) : undefined;
    if (typeof token !== 'string' || !token) return send(401, { error: 'identity_required' }, true);
    if (req.headers['content-type'] !== 'application/json') return send(415, { error: 'json_required' }, true);
    if (req.headers['content-encoding'] !== undefined) return send(415, { error: 'encoding_unsupported' }, true);
    let principal;
    try { principal = service.authenticate(token); } catch (error) { return send(error instanceof RemoteAccessError ? error.status : 401, { error: 'identity_invalid' }, true); }
    const subject = principal.subject, support = principal.role === 'support';
    if (pending >= REMOTE_BODY_LIMITS.pending || (perSubject.get(subject) ?? 0) >= REMOTE_BODY_LIMITS.perSubject || (support && supportPending >= REMOTE_BODY_LIMITS.supportPending)) return send(429, { error: 'request_parser_busy' }, true);
    pending++; if (support) supportPending++; perSubject.set(subject, (perSubject.get(subject) ?? 0) + 1);
    try {
      const raw = await new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = []; let size = 0, settled = false;
        const finish = (error?: Error) => { if (settled) return; settled = true; clearTimeout(timer); req.off('data', data); req.off('end', end); req.off('aborted', aborted); req.off('error', aborted); req.off('close', closed); if (error) reject(error); else resolve(Buffer.concat(chunks)); };
        const data = (chunk: Buffer) => { const bytes = Buffer.from(chunk); size += bytes.length; if (size > REMOTE_BODY_LIMITS.bytes) finish(new RemoteAccessError('body_too_large', 413)); else chunks.push(bytes); };
        const end = () => finish();
        const aborted = () => finish(new RemoteAccessError('request_cancelled', 499));
        const closed = () => { if (!req.complete) aborted(); };
        // Absolute from admission: receiving another byte never renews this timer.
        const timer = setTimeout(() => finish(new RemoteAccessError('request_body_deadline', 408)), REMOTE_BODY_LIMITS.deadlineMs);
        req.on('data', data); req.once('end', end); req.once('aborted', aborted); req.once('error', aborted); req.once('close', closed);
        if (req.destroyed || req.aborted) aborted(); else if (req.readableEnded) end();
      });
      let body: unknown;
      try { body = JSON.parse(raw.toString('utf8')); } catch { throw new RemoteAccessError('invalid_json', 400); }
      // The operation revalidates identity/time and full authorization after body completion.
      return send(200, await service.execute(token, body));
    } catch (error) { return error instanceof RemoteAccessError ? send(error.status, { error: error.code }, true) : send(503, { error: 'remote_unavailable' }, true); }
    finally { pending--; if (support) supportPending--; const count = (perSubject.get(subject) ?? 1) - 1; if (count) perSubject.set(subject, count); else perSubject.delete(subject); }
  } };
}
export const route = remoteEnrollmentRoute();

/** Dedicated private relay origin. Construction does not listen; listen() can bind only loopback. */
export function createPrivateRemoteRelay(options: Parameters<typeof createDurableRemoteEnrollment>[0] & { allowedOrigins: string[] }) {
  const allowed = new Set(options.allowedOrigins);
  for (const origin of allowed) { const url = new URL(origin); if (url.origin !== origin || !['https:', 'http:'].includes(url.protocol)) throw new Error('invalid allowed origin'); }
  const service = createDurableRemoteEnrollment(options), access = remoteEnrollmentRoute(service, allowed, 'cloudflare-access');
  const server = createServer({ requestTimeout: 5000, headersTimeout: 5000, keepAliveTimeout: 1000, maxHeaderSize: 16384 }, (req, res) => {
    let pathname: string;
    try { if (!req.url?.startsWith('/')) throw new Error('invalid request target'); pathname = new URL(req.url, 'http://node').pathname; } catch { res.writeHead(400); res.end(); return; }
    if (req.method !== access.method || !access.path.test(pathname)) { res.writeHead(404, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify({ error: 'not_found' })); return; }
    void Promise.resolve(access.handle(req, res, pathname.match(access.path)!)).catch(() => { if (!res.headersSent) res.writeHead(503); if (!res.writableEnded) res.end(); });
  });
  let closed = false;
  return {
    status: service.status,
    async listen(port = 0) {
      if (closed || server.listening || !Number.isInteger(port) || port < 0 || port > 65535) throw new Error('invalid private relay listener');
      return await new Promise<{ host: '127.0.0.1'; port: number }>((resolve, reject) => {
        const fail = (error: Error) => reject(error); server.once('error', fail);
        server.listen(port, '127.0.0.1', () => { server.off('error', fail); const address = server.address(); if (!address || typeof address === 'string') return reject(new Error('listener unavailable')); resolve({ host: '127.0.0.1', port: address.port }); });
      });
    },
    async close() { if (closed) return; closed = true; server.closeAllConnections(); if (server.listening) await new Promise<void>(resolve => server.close(() => resolve())); service.close(); },
  };
}

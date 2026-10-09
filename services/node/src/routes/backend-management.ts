import type { IncomingMessage, ServerResponse } from 'node:http';
import { backendManagementFailure, backendManagementStatus, changeBackendSelection } from '../backend-management.ts';

const respond = (res: ServerResponse, code: number, body: unknown, allow?: string) => {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store', ...(allow ? { allow } : {}) }); res.end(JSON.stringify(body));
};
export async function handleBackendManagement(req: IncomingMessage, res: ServerResponse, url: URL, allowedOrigins: Set<string>) {
  if (url.pathname !== '/api/backends' && !url.pathname.startsWith('/api/backends/')) return false;
  const action = url.pathname === '/api/backends/select' ? 'select' : url.pathname === '/api/backends/rollback' ? 'rollback' : null;
  if (action) {
    if (req.method !== 'POST') { respond(res, 405, { error: 'POST only' }, 'POST'); return true; }
    const origin = String(req.headers.origin ?? '');
    if (origin && !allowedOrigins.has(origin)) { respond(res, 403, { error: 'not this app' }); return true; }
    if (String(req.headers['content-type'] ?? '').toLowerCase().split(';')[0].trim() !== 'application/json') { respond(res, 415, { error: 'application/json required' }); return true; }
    let body: any;
    try {
      const chunks: Buffer[] = []; let length = 0;
      for await (const chunk of req.iterator({ destroyOnReturn: false })) { length += chunk.length; if (length > 8192) throw Error('large'); chunks.push(Buffer.from(chunk)); }
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const keys = ['serviceId', 'expectedRevision', action === 'select' ? 'catalogId' : 'targetRevision'];
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== keys.length || Object.keys(body).some(key => !keys.includes(key)) || typeof body.serviceId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(body.serviceId) || !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0 || (action === 'select' ? typeof body.catalogId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(body.catalogId) : !Number.isSafeInteger(body.targetRevision) || body.targetRevision < 1)) throw Error('shape');
    } catch { req.resume(); respond(res, 400, { error: 'Use only service/catalog IDs and explicit selection revisions' }); return true; }
    try { respond(res, 200, await changeBackendSelection({ ...body, action })); }
    catch (error) { const failure = backendManagementFailure(error); respond(res, failure.status, { error: failure.reason }); }
    return true;
  }
  if (req.method !== 'GET') { respond(res, 405, { error: 'GET only' }, 'GET'); return true; }
  const id = url.pathname === '/api/backends' ? undefined : url.pathname.match(/^\/api\/backends\/([A-Za-z0-9_-]{1,128})$/)?.[1];
  if (url.pathname !== '/api/backends' && !id) { respond(res, 404, { error: 'service-not-found' }); return true; }
  try { respond(res, 200, await backendManagementStatus(id)); }
  catch (error) { const failure = backendManagementFailure(error); respond(res, failure.status, { error: failure.reason }); }
  return true;
}

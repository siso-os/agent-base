import { createInterface } from 'node:readline';
const mode = process.argv[2] ?? 'ok';
const methods = [], requests = [];
const send = value => process.stdout.write(JSON.stringify(value) + '\n');
createInterface({ input: process.stdin }).on('line', line => {
  const request = JSON.parse(line); methods.push(request.method); requests.push(request);
  if (mode === 'hang') { process.on('SIGTERM', () => {}); return; }
  if (mode === 'malformed') { process.stdout.write('not-json\n'); return; }
  if (mode === 'oversized') { process.stdout.write('x'.repeat(1024 * 1024 + 1)); return; }
  if (mode === 'mutation') { send({ id: 88, method: 'account/chatgptAuthTokens/refresh', params: { reason: 'expired' } }); return; }
  if (mode === 'provider-error') { process.stderr.write('PRIVATE-ERROR-BODY'); send({ id: request.id, error: { message: 'PRIVATE-ERROR-BODY' } }); return; }
  if (request.method === 'initialize') { send({ id: request.id, result: { userAgent: 'fixture' } }); return; }
  if (request.method === 'initialized') return;
  if (request.method === 'account/read') { send({ id: request.id, result: { account: { type: mode === 'api-key' ? 'apiKey' : 'chatgpt' } } }); return; }
  if (request.method !== 'account/rateLimits/read') { process.exitCode = 3; process.stdin.destroy(); return; }
  const now = Date.now(), window = duration => ({ windowDurationMins: duration, usedPercent: mode === 'exhausted' ? 100 : 10, resetsAt: Math.floor(now / 1000) + 120 });
  const bucket = { limitId: 'codex', primary: window(300), secondary: window(10080), spendControlReached: false, rateLimitReachedType: null, individualLimit: null };
  const result = { accountId: mode === 'wrong-account' ? 'other-account' : 'fixture-account', ordinaryUsageAllowed: mode === 'permission-missing' ? null : true, rateLimits: bucket, rateLimitsByLimitId: { codex: bucket }, _methods: methods, _requests: requests, _pid: process.pid };
  send({ id: request.id, result });
});

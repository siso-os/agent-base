// Only used by review-wiring-audit.mjs: a synthetic node must not reach credentials or external services.
import cp from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import { appendFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { promisify } from 'node:util';
import { EventEmitter } from 'node:events';
const root = process.env.REVIEW_AUDIT_ROOT;
if (!root) throw Error('Review audit preload requires its private fixture directory');
const denied = kind => { appendFileSync(`${root}/denied.jsonl`, JSON.stringify({ kind }) + '\n'); return Error('Blocked by isolated review audit'); };
os.homedir = () => root;
const originalExecFile = cp.execFile;
function execFile(file, args, options, callback) {
  if (typeof options === 'function') { callback = options; options = undefined; }
  if (file === process.execPath && args?.[0] === process.env.REVIEW_AUDIT_HERDR) return originalExecFile(file, args, options, callback);
  const error = denied(`command:${String(file).split('/').at(-1)}`);
  queueMicrotask(() => callback?.(error, '', ''));
  return new EventEmitter();
}
execFile[promisify.custom] = (file, args, options) => new Promise((resolve, reject) => execFile(file, args, options, (error, stdout, stderr) => error ? reject(error) : resolve({ stdout, stderr })));
cp.execFile = execFile;
cp.execFileSync = () => { throw denied('execFileSync'); };
cp.execSync = () => { throw denied('execSync'); };
cp.spawn = () => { throw denied('spawn'); };
cp.spawnSync = () => { throw denied('spawnSync'); };
const allowedPorts = new Set((process.env.REVIEW_AUDIT_PORTS ?? '').split(','));
function guard(args) {
  const value = args[0];
  const options = typeof value === 'string' || value instanceof URL ? new URL(value) : value;
  const host = String(options.hostname ?? options.host ?? 'localhost');
  if (!['127.0.0.1', 'localhost'].includes(host) || !allowedPorts.has(String(options.port ?? '80'))) throw denied('http');
}
for (const key of ['request', 'get']) {
  const original = http[key];
  http[key] = function (...args) { guard(args); return original.apply(this, args); };
  https[key] = () => { throw denied('https'); };
}
globalThis.fetch = async () => { throw denied('fetch'); };
syncBuiltinESMExports();

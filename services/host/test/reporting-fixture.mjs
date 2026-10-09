// Source-loaded host fixture: synthetic SDK, real fake-herdr processes, controlled completions.
// Loaded with --import and AB_HOST_SDK; never used by an installed host.
import fs from 'node:fs';
import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';

const tell = event => process.send?.(event);
const files = new Map();
const originalOpen = fs.openSync, originalClose = fs.closeSync;
fs.openSync = function (file, ...rest) {
  const fd = originalOpen.call(this, file, ...rest);
  files.set(fd, String(file));
  return fd;
};
fs.closeSync = function (fd) { files.delete(fd); return originalClose.call(this, fd); };
const originalWrite = fs.writeFileSync;
fs.writeFileSync = function (file, data, ...rest) {
  const result = originalWrite.call(this, file, data, ...rest);
  const name = typeof file === 'number' ? files.get(file) ?? '' : String(file);
  if (name.startsWith(process.env.AB_HOSTS_DIR + '/')) {
    let body;
    try { body = JSON.parse(String(data)); } catch {}
    tell({ kind: 'write', target: body?.pid ? 'host' : 'settings' });
  } else if (name.startsWith(process.env.AB_PROMPT_QUEUE_DIR + '/')) tell({ kind: 'write', target: 'queue' });
  return result;
};
let hold = false, sequence = 0;
const pending = new Map();
const originalExec = cp.execFile;
function settle(call) {
  if (!call.done || !call.release) return;
  pending.delete(call.id);
  const err = call.fail ? new Error('synthetic herdr failure') : call.error;
  call.callback(err, call.stdout, call.stderr);
  tell({ kind: 'herdr-settled', id: call.id, failed: !!err });
}
cp.execFile = function (file, args, options, callback) {
  if (file !== process.env.HERDR_BIN_PATH) throw Error('Fixture refused an external executable');
  const call = { id: ++sequence, callback, release: !hold, done: false };
  pending.set(call.id, call);
  tell({ kind: 'herdr', id: call.id, args });
  return originalExec.call(this, file, args, options, (error, stdout, stderr) => {
    Object.assign(call, { error, stdout, stderr, done: true });
    settle(call);
  });
};
syncBuiltinESMExports();

const events = [];
let wake, sdkOptions, closed = false;
const push = event => { events.push(event); wake?.(); wake = undefined; };
process.on('message', command => {
  if (command.op === 'hold') hold = true;
  if (command.op === 'settle') {
    hold = false;
    for (const call of [...pending.values()]) {
      call.release = true;
      call.fail = command.fail === call.id;
      settle(call);
    }
  }
  if (command.op === 'events') for (const event of command.events) push(event);
  if (command.op === 'tool') {
    void sdkOptions.canUseTool(command.tool, command.input, { signal: new AbortController().signal, toolUseID: command.id })
      .then(result => tell({ kind: 'tool-result', id: command.id, result }));
  }
  tell({ kind: 'ack', id: command.id });
});

export async function getSessionMessages() { return []; }
export function query({ prompt, options }) {
  sdkOptions = options;
  void (async () => {
    for await (const message of prompt) tell({ kind: 'input', id: message.uuid, text: message.message.content });
  })();
  push({ type: 'system', subtype: 'init', session_id: options.resume ?? options.sessionId, model: 'synthetic', apiKeySource: 'oauth' });
  return {
    close() { closed = true; wake?.(); },
    supportedCommands: async () => [],
    getContextUsage: async () => { tell({ kind: 'context-read' }); return { totalTokens: 321, rawMaxTokens: 200000 }; },
    usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: async () => {
      tell({ kind: 'usage-read' });
      return { rate_limits_available: true, rate_limits: { five_hour: { utilization: 7 }, seven_day: { utilization: 18 } } };
    },
    async *[Symbol.asyncIterator]() {
      while (!closed) {
        if (events.length) yield events.shift();
        else await new Promise(resolve => { wake = resolve; });
      }
    },
  };
}

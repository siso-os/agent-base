// Run with Node 22.13+: heavy -- node services/node/test/safe-controls.test.mjs
// Execute the actual terminal handler in a sealed VM. No server bootstrap, sockets,
// subprocesses, account files, real transcripts, HOME overrides, or dependencies.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

// --source-stdin accepts a git-show baseline without writing another source tree.
const source = readFileSync(process.argv.includes('--source-stdin') ? 0 : new URL('../src/server.ts', import.meta.url), 'utf8');
const begin = source.indexOf('const paneSends =');
const end = source.indexOf('/** siso-host, the SDK chat', begin);
assert.ok(begin > 0 && end > begin, 'bounded production handler located');
const code = stripTypeScriptTypes(source.slice(begin, end)) + '\nglobalThis.openChat = serveTranscript;';
const alpha = { id: 'fixture-old', pane: 'fixture:p1', session: 'fixture-alpha', host: false };
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

function fixture({ session = alpha.session } = {}) {
  let rows = [{ ...alpha, session }], unavailable = false, onCommand;
  let hold = false;
  const timers = [], commands = [], chats = [], maps = {};
  for (const name of ['paneOf', 'sessionOf', 'nameOf', 'statusOf', 'toolOf', 'cwdOf', 'successor']) maps[name] = new Map();
  const refresh = () => {
    maps.paneOf.clear();
    for (const row of rows) {
      maps.paneOf.set(row.id, row.pane);
      // Deliberately mirror the production map's missing-session retention.
      if (row.session) maps.sessionOf.set(row.id, row.session);
    }
  };
  refresh();
  const denied = () => { throw new Error('Unexpected external capability in sealed handler fixture'); };
  const context = vm.createContext({
    ...maps, process: Object.freeze({ env: Object.freeze({}) }),
    Date, console, path: { basename: denied }, UPLOADS: '/fixture/uploads', uploadPath: denied,
    statSync: denied, sessionFile: denied,
    chatWindow: () => ({ shown: [], before: null, more: false, stash: [] }),
    olderPage: () => ({ t: 'older', log: [] }),
    hostsByPane: () => new Map(), watchStates: () => () => {},
    listAgents: async (age) => {
      assert.equal(age, 0, 'every authorization requires a fresh list');
      if (unavailable) throw new Error('synthetic herdr unavailable');
      refresh(); return rows.map(row => ({ ...row }));
    },
    herdr: async (args) => {
      const command = { args: Array.from(args), rows: rows.map(row => ({ ...row })) };
      commands.push(command);
      return onCommand ? onCommand(command) : '{}';
    },
    setTimeout: (callback) => {
      if (hold) timers.push(callback); else queueMicrotask(callback);
    },
  }, { codeGeneration: { strings: false, wasm: false } });
  vm.runInContext(code, context, { timeout: 1000 });
  const open = () => {
    const events = [], handlers = new Map();
    const socket = {
      OPEN: 1, readyState: 1, send: raw => events.push(JSON.parse(raw)),
      on: (event, handler) => handlers.set(event, handler),
      close: () => { socket.readyState = 3; handlers.get('close')?.(); },
    };
    context.openChat(socket, alpha.id, { log: [], catchUp() {}, subscribe: () => () => {} });
    const chat = { events, send: msg => handlers.get('message')(JSON.stringify(msg)), close: socket.close };
    chats.push(chat); return chat;
  };
  return {
    commands, open, maps, timers,
    replace(next, heir) { rows = next; if (heir) maps.successor.set(alpha.id, heir); },
    unavailable() { unavailable = true; },
    command(fn) { onCommand = fn; },
    hold() { hold = true; },
    release() { hold = false; for (const fn of timers.splice(0)) fn(); },
    close() { for (const chat of chats) chat.close(); assert.equal(timers.length, 0); },
  };
}
const prompt = key => ({ t: 'prompt', key, text: `synthetic-${key}` });
const ack = (chat, key, outcome) => {
  assert.deepEqual(chat.events.filter(e => ['sent', 'unsent'].includes(e.t) && e.key === key).map(e => e.t), [outcome]);
};
const checks = [];
async function check(name, run) {
  try { await run(); checks.push(true); console.log(JSON.stringify({ name, passed: true })); }
  catch (error) { checks.push(false); console.log(JSON.stringify({ name, passed: false, error: String(error) })); }
}

await check('unchanged prompt sends exact text and Enter; Stop stays immediate during paste', async () => {
  const f = fixture(), chat = f.open(); f.hold();
  const pending = chat.send(prompt('ok')); await flush();
  assert.equal(f.timers.length, 1);
  await chat.send({ t: 'interrupt' });
  assert.deepEqual(f.commands.map(c => c.args), [
    ['pane', 'send-text', alpha.pane, 'synthetic-ok'], ['pane', 'send-keys', alpha.pane, 'esc'],
  ]);
  f.release(); await pending; ack(chat, 'ok', 'sent');
  assert.equal(f.commands.at(-1).args[3], 'Enter'); f.close();
});

for (const control of ['prompt', 'interrupt', 'stop_task']) {
  for (const change of ['replacement', 'missing-session', 'ended', 'host-takeover', 'list-failure']) {
    await check(`${control} rejects ${change} before display refresh`, async () => {
      const f = fixture(), chat = f.open();
      if (change === 'replacement') f.replace([{ ...alpha, session: 'fixture-beta' }]);
      if (change === 'missing-session') f.replace([{ ...alpha, session: null }]);
      if (change === 'ended') f.replace([]);
      if (change === 'host-takeover') f.replace([{ ...alpha, host: true }]);
      if (change === 'list-failure') f.unavailable();
      await chat.send(control === 'prompt' ? prompt('blocked') : { t: control, id: 'task-fixture' });
      assert.equal(f.commands.length, 0, 'zero commands to unverified recipient');
      assert.ok(chat.events.some(e => e.t === 'note'));
      if (control === 'prompt') ack(chat, 'blocked', 'unsent'); f.close();
    });
  }
}
for (const session of [alpha.session, 'fixture-beta', null]) {
  await check(`successor control requires opened session: ${session}`, async () => {
    const f = fixture(), chat = f.open(), next = { ...alpha, id: 'fixture-new', pane: 'fixture:p2', session };
    f.replace([next], next.id); await chat.send(prompt('move'));
    await chat.send({ t: 'interrupt' });
    assert.ok(chat.events.some(e => e.t === 'moved' && e.id === next.id));
    if (session === alpha.session) {
      ack(chat, 'move', 'sent'); assert.equal(f.commands.length, 3);
      assert.ok(f.commands.every(c => c.args[2] === next.pane));
    } else { ack(chat, 'move', 'unsent'); assert.equal(f.commands.length, 0); }
    f.close();
  });
}
await check('unknown opened identity cannot adopt later session', async () => {
  const f = fixture({ session: null }), chat = f.open(); f.replace([alpha]);
  await chat.send(prompt('unknown')); ack(chat, 'unknown', 'unsent');
  assert.equal(f.commands.length, 0); f.close();
});
await check('two viewers share queue; session change blocks delayed Enter and waiting paste', async () => {
  const f = fixture(), first = f.open(), second = f.open(); f.hold();
  const a = first.send(prompt('first')); await flush();
  const b = second.send(prompt('second')); await flush();
  assert.equal(f.commands.length, 1);
  f.replace([{ ...alpha, session: 'fixture-beta' }]); f.release(); await Promise.all([a, b]);
  assert.equal(f.commands.length, 1);
  for (const chat of [first, second]) { ack(chat, 'first', 'unsent'); ack(chat, 'second', 'unsent'); }
  f.close();
});
for (const failed of ['send-text', 'Enter']) {
  for (const change of ['none', 'session', 'pane', 'outage']) {
    await check(`${failed} retry checks current recipient after ${change}`, async () => {
      const f = fixture(), chat = f.open(); let once = false;
      f.command(({ args }) => {
        if (!once && (failed === 'send-text' ? args[1] === failed : args[3] === failed)) {
          once = true;
          if (change === 'session') f.replace([{ ...alpha, session: 'fixture-beta' }]);
          if (change === 'pane') f.replace([{ ...alpha, pane: 'fixture:p2' }]);
          if (change === 'outage') f.unavailable();
          throw new Error('synthetic first attempt failed');
        }
        return '{}';
      });
      await chat.send(prompt('retry'));
      ack(chat, 'retry', change === 'none' ? 'sent' : 'unsent');
      assert.equal(f.commands.length, change === 'none' ? 3 : failed === 'send-text' ? 1 : 2);
      assert.ok(f.commands.every(c => c.rows[0].session === alpha.session && c.args[2] === alpha.pane)); f.close();
    });
  }
}
console.log(JSON.stringify({ passed: checks.filter(Boolean).length, total: checks.length, proof: 'sealed production-handler synthetic fixtures only' }));
process.exitCode = checks.every(Boolean) ? 0 : 1;

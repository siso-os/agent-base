// Run with Node 22+ through heavy. Executes the actual ChatView hook block,
// using deterministic hook dependency semantics; this is not a browser/CPU test.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { execFileSync } from 'node:child_process';
import { prepareChat, projectChat, doing } from '../src/lib/chat.ts';

const hudPath = 'apps/web/src/components/Hud.tsx';
function hudFixture(source) {
  const start = source.indexOf('function useActivity(');
  const end = source.indexOf('/** Groups with thin rules', start);
  assert.ok(start >= 0 && end > start, 'actual HUD activity hook exists');
  const compile = new Function('useState', 'useEffect', 'window', stripTypeScriptTypes(source.slice(start, end)) + '\nreturn useActivity;');
  let state = null, updates = 0, listener;
  const useState = () => [state, next => {
    const value = typeof next === 'function' ? next(state) : next;
    if (!Object.is(value, state)) updates++;
    state = value;
  }];
  const useActivity = compile(useState, fn => fn(), {
    addEventListener: (_type, on) => { listener = on; }, removeEventListener() {},
  });
  useActivity('fixture-agent');
  return {
    receive: detail => listener({ detail }),
    get updates() { return updates; },
    get state() { return state; },
  };
}
const path = 'apps/web/src/components/ChatView.tsx';
function fixture(source, hudSource) {
  const hud = hudFixture(hudSource);
  const start = source.indexOf('  // Sub-agent counts change') >= 0
    ? source.indexOf('  // Sub-agent counts change') : source.indexOf('  // What the bottom bar counts');
  const end = source.indexOf('  // The working line', start);
  assert.ok(start >= 0 && end > start, 'actual activity hook block exists');
  const run = new Function('useMemo', 'useEffect', 'chat', 'settled', 'taskByTool', 'shells', 'agentId', 'doing', 'window', 'CustomEvent', stripTypeScriptTypes(source.slice(start, end)));
  const slots = [], emitted = [];
  let cursor = 0, scanned = 0;
  const hook = (fn, deps) => {
    const index = cursor++, old = slots[index];
    if (old && deps.every((d, i) => Object.is(d, old.deps[i]))) return old.value;
    const value = fn(); slots[index] = { deps, value }; return value;
  };
  const count = chat => ({ ...chat, turns: new Proxy(chat.turns, { get(target, key) {
    if (key === 'flatMap') return fn => { scanned += target.length; return target.flatMap(fn); };
    return Reflect.get(target, key);
  } }) });
  let lastSettled, wrappedSettled;
  return {
    emitted, hud,
    get scanned() { return scanned; },
    render({ chat, settled, tasks, shells, agentId = 'fixture-agent' }) {
      cursor = 0;
      if (settled !== lastSettled) { lastSettled = settled; wrappedSettled = count(settled); }
      run(hook, hook, count(chat), wrappedSettled, tasks, shells, agentId, doing,
        { dispatchEvent: event => { emitted.push(event.detail); hud.receive(event.detail); } }, class { constructor(type, init) { this.type = type; this.detail = init.detail; } });
    },
  };
}
const events = [];
for (let i = 0; i < 1000; i++) {
  events.push({ t: 'user', id: `u${i}`, text: 'fixture prompt', at: i * 10, from: 'user' });
  if (i === 0) events.push({ t: 'tool', id: 'helper', name: 'Agent', summary: 'fixture helper', input: {}, at: 1 });
  events.push({ t: 'text', id: `r${i}`, text: 'fixture answer', at: i * 10 + 2 });
}
events.push({ t: 'user', id: 'current', text: 'stream fixture', at: 10001, from: 'user' });
let prepared = prepareChat(events), settled = projectChat(prepared, {}, true);
let tasks = new Map(), shells = [];
const current = fixture(readFileSync(path, 'utf8'), readFileSync(hudPath, 'utf8'));
const before = process.argv[2] ? fixture(execFileSync('git', ['show', `${process.argv[2]}:${path}`], { encoding: 'utf8' }), execFileSync('git', ['show', `${process.argv[2]}:${hudPath}`], { encoding: 'utf8' })) : null;
let text = 'Stable first line\n';
const render = (agentId) => {
  const input = { chat: projectChat(prepared, { stream: text }, true), settled, tasks, shells, agentId };
  current.render(input); before?.render(input);
};
for (let i = 0; i < 500; i++) { text += 'word '; render(); }
assert.equal(current.emitted.length, 500, 'existing announcement cadence is preserved for late listeners');
assert.equal(current.hud.updates, 1, 'unchanged HUD snapshots update state once across 500 streamed frames');
assert.equal(current.scanned, settled.turns.length, 'history scanned once across 500 frames');
const stream = { frames: 500, turns: settled.turns.length, after: { events: current.emitted.length, hudStateUpdates: current.hud.updates, turnVisits: current.scanned }, before: before && { events: before.emitted.length, hudStateUpdates: before.hud.updates, turnVisits: before.scanned } };
assert.equal(current.emitted.at(-1).last, 'Stable first line');
text = 'Changing first line'; render();
assert.equal(current.emitted.at(-1).last, text, 'first-line streaming stays immediate');
text += ' now'; render();
assert.equal(current.emitted.at(-1).last, text);
assert.equal(current.hud.updates, 1, 'header-only text changes do not update the HUD counters');
assert.equal(current.emitted.at(-1).running, 1);
tasks = new Map([['helper', { status: 'done' }]]); render();
assert.equal(current.emitted.at(-1).running, 0, 'task completion reaches HUD');
assert.equal(current.hud.state.running, 0);
assert.equal(current.hud.updates, 2);
shells = [{ id: 'shell', kind: 'bash', description: 'fixture shell' }]; render();
assert.equal(current.emitted.at(-1).bg, 1);
assert.deepEqual(current.emitted.at(-1).shells, shells);
shells = [{ ...shells[0], description: 'updated shell' }]; render();
assert.equal(current.emitted.at(-1).shells[0].description, 'updated shell');
assert.equal(current.hud.state.shells[0].description, 'updated shell');
// A newly mounted HUD must receive the next streamed snapshot even if nothing changed.
const lateHud = hudFixture(readFileSync(hudPath, 'utf8'));
render(); lateHud.receive(current.emitted.at(-1));
assert.deepEqual(lateHud.state, current.hud.state);
render('other-agent'); assert.equal(current.emitted.at(-1).agentId, 'other-agent');
events.push({ t: 'tool', id: 'second', name: 'Agent', summary: 'second helper', input: {}, at: 10002 });
prepared = prepareChat(events); settled = projectChat(prepared, {}, true); render();
assert.equal(current.emitted.at(-1).total, 2, 'new settled sub-agent is counted');
prepared = prepareChat([]); settled = projectChat(prepared, {}, false); text = ''; tasks = new Map(); shells = []; render();
assert.deepEqual(current.emitted.at(-1), { agentId: 'fixture-agent', running: 0, total: 0, bg: 0, shells: [], last: '' });
if (before) {
  assert.deepEqual(current.emitted, before.emitted, 'every activity payload agrees with pre-fix implementation');
  assert.deepEqual(current.hud.state, before.hud.state, 'HUD final state agrees with pre-fix implementation');
}
console.log(JSON.stringify({ status: 'PASS', stream, checks: 'streamed first line, task completion, shell changes, recipient change, new agent, empty reset, late HUD mount, before/after payload parity' }, null, 2));

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';

// Source-extracted unit contract only. No React/browser, network, terminal, or service is started.
const app = readFileSync(process.argv.find(a => a.startsWith('--app='))?.slice(6) ?? resolve(import.meta.dirname, '../src/App.tsx'), 'utf8');
const ownerView = app.split('\n').find(line => line.includes('<OwnerPage '));
assert.ok(ownerView, 'OwnerPage wiring must be present');
const availability = ownerView.match(/chatAvailable={(.*?)} onChat=/)?.[1];
const callback = ownerView.match(/onChat={(.*)} \/>}/)?.[1];
assert.ok(availability && callback, 'Extract the actual owner-chat props, not a rewritten model');
const target = app.match(/const ownerChat = (.*);/)?.[1] ?? 'undefined';
const chatPredicate = app.match(/{((?:pinnedChats\[id\] \|\| )?byId\.get\(id\)\?\.chat && !asTerminal\[id\]) \? \(/)?.[1];
assert.ok(chatPredicate, 'Actual App chat/terminal branch must remain detectable');
const workerPredicate = app.match(/{(space !== "pinboard" && active\?\.codexWorker(?: && !activeConversationTarget)?) \? <CodexWorkerPage/)?.[1];
assert.ok(workerPredicate, 'Actual outer Codex worker branch must remain detectable');
const hub = readFileSync(resolve(import.meta.dirname, '../src/lib/hub.ts'), 'utf8');
const canonSource = hub.match(/^export const canon = (.+);$/m)?.[1];
assert.ok(canonSource, 'Extract the production owner-name canonicalizer');
const canon = new Function(stripTypeScriptTypes('const canon = ' + canonSource + ';') + '\nreturn canon;')();

function invoke(agents, ownerInfo = 'STREAM-QUALITY', asTerminal = {}) {
  const opened = [];
  const ownerChat = new Function('agents', 'ownerInfo', 'canon', 'return ' + target)(agents, ownerInfo, canon);
  const enabled = new Function('agents', 'ownerInfo', 'canon', 'ownerChat', 'return ' + availability)(agents, ownerInfo, canon, ownerChat);
  const setAsTerminal = change => { asTerminal = change(asTerminal); };
  const open = (agent, how) => opened.push({ agent, how });
  const onChat = new Function('agents', 'ownerInfo', 'canon', 'ownerChat', 'setAsTerminal', 'open', 'return (' + callback + ')')(agents, ownerInfo, canon, ownerChat, setAsTerminal, open);
  if (enabled) onChat();
  const selected = opened.at(-1)?.agent;
  const byId = new Map((agents ?? []).map(a => [a.id, a]));
  const workerSurface = selected ? Boolean(new Function('space', 'active', 'activeConversationTarget', 'return ' + workerPredicate)('agents', selected, undefined)) : false;
  const chatSurface = !!selected && !workerSurface && Boolean(new Function('byId', 'id', 'asTerminal', 'pinnedChats', 'return ' + chatPredicate)(byId, selected.id, asTerminal, {}));
  return { enabled, opened, asTerminal, chatSurface, workerSurface };
}
const terminal = { id: 'terminal-only', name: 'STREAM-QUALITY', chat: false, session: null };
const chat = { id: 'sdk-chat', name: 'STREAM-QUALITY', chat: true, session: 'fixture-session' };

test('a reported owner with only a terminal does not advertise an openable chat', () => {
  const r = invoke([terminal]);
  assert.equal(r.enabled, false);
  assert.equal(r.opened.length, 0);
});
test('a same-name terminal before the chat cannot steal the owner-chat action', () => {
  const r = invoke([terminal, chat]);
  assert.equal(r.enabled, true);
  assert.equal(r.opened[0].agent.id, chat.id);
  assert.equal(r.chatSurface, true);
});
test('Open owner chat overrides this agent’s remembered Terminal view only', () => {
  const r = invoke([chat], 'STREAM-QUALITY', { [chat.id]: true, other: true });
  assert.equal(r.chatSurface, true);
  assert.equal(r.asTerminal.other, true);
});
test('a single eligible chat still opens through the existing open handler', () => {
  const r = invoke([chat]);
  assert.equal(r.enabled, true);
  assert.equal(r.chatSurface, true);
  assert.deepEqual(r.opened[0].how, { chat: true });
});
test('missing, empty, and unrelated agent lists do not open an owner', () => {
  for (const agents of [undefined, null, [], [{ ...chat, name: 'OPERATOR-DESIGN' }]]) {
    const r = invoke(agents);
    assert.equal(r.enabled, false);
    assert.equal(r.opened.length, 0);
  }
});
test('the existing canonical owner-name match is retained', () => {
  const r = invoke([{ ...chat, name: 'Focused lane | sol-STREAM-QUALITY' }]);
  assert.equal(r.enabled, true);
  assert.equal(r.opened[0].agent.id, chat.id);
});
test('a real-shape Codex worker keeps its distinct CodexWorkerPage route', () => {
  const r = invoke([{ ...chat, id: 'codex-worker:STREAM-QUALITY', codexWorker: true }]);
  assert.equal(r.enabled, true);
  assert.equal(r.workerSurface, true);
  assert.equal(r.chatSurface, false);
});

test('PR23 owner-question identity guard and OwnerPage connection are preserved', () => {
  assert.match(app, /const ownerCandidates = ownerInfo \? \(agents \?\? \[\]\)\.filter\(a => canon\(a\.name\) === canon\(ownerInfo\)\) : \[\];/);
  assert.match(app, /const ownerQuestionConnection = ownerCandidates\.length === 1 \? ownerQuestions\[ownerCandidates\[0\]\.id\] : undefined;/);
  assert.match(ownerView, /questions=\{ownerQuestionConnection\}/);
});


test('an explicit sealed pin selects ChatView even for a remembered terminal or worker row', () => {
  const conversationTarget = { kind: 'conversation', machine: 'laptop', harness: 'claude', session: 'pinned-session' };
  for (const agent of [terminal, chat, { ...chat, codexWorker: true }]) {
    const pinnedChats = { [agent.id]: { agent, target: conversationTarget } };
    const byId = new Map([[agent.id, agent]]);
    const asTerminal = { [agent.id]: true };
    const workerSurface = Boolean(new Function('space', 'active', 'activeConversationTarget', 'return ' + workerPredicate)('agents', agent, conversationTarget));
    const chatSurface = Boolean(new Function('byId', 'id', 'asTerminal', 'pinnedChats', 'return ' + chatPredicate)(byId, agent.id, asTerminal, pinnedChats));
    assert.equal(workerSurface, false, 'A conversation pin cannot fall into the worker page');
    assert.equal(chatSurface, true, 'A conversation pin cannot fall into a terminal');
  }
});

test('ordinary unsealed rows retain their remembered terminal and worker routing', () => {
  const byId = new Map([[chat.id, chat]]);
  assert.equal(Boolean(new Function('byId', 'id', 'asTerminal', 'pinnedChats', 'return ' + chatPredicate)(byId, chat.id, { [chat.id]: true }, {})), false);
  assert.equal(Boolean(new Function('space', 'active', 'activeConversationTarget', 'return ' + workerPredicate)('agents', { ...chat, codexWorker: true }, undefined)), true);
});

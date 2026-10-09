#!/usr/bin/env node
// Deterministic managed child runtime. No provider calls or native child spawning.
import readline from 'node:readline';
import { randomUUID } from 'node:crypto';
if (process.argv[2] !== '-m' || !process.argv[3]) process.exit(2);
const send = m => process.stdout.write(JSON.stringify(m) + '\n');
let thread = randomUUID(), turn = 0, active, timer, marker = '';
readline.createInterface({ input: process.stdin }).on('line', line => {
  const m = JSON.parse(line), p = m.params ?? {};
  const result = r => send({ id: m.id, result: r });
  if (m.method === 'initialize') result({});
  else if (['thread/start','thread/resume'].includes(m.method)) {
    if (p.dynamicTools?.length || p.sandbox !== (process.env.AB_WORKSPACE_RECEIPT ? 'workspace-write' : 'read-only')) process.exit(3);
    thread = p.threadId ?? thread; result({ thread: { id: thread, turns: [], createdAt: 1 } });
  } else if (m.method === 'turn/start') {
    const id = `turn-${++turn}`; active = id;
    send({ method: 'turn/started', params: { threadId: thread, turn: { id } } }); result({ turn: { id } });
    const input = p.input[0].text;
    marker ||= input;
    send({ method: 'item/started', params: { threadId: thread, item: { type: 'commandExecution', id: `tool-${turn}`, command: 'Read fixture', status: 'inProgress' } } });
    timer = setTimeout(() => {
      if (active !== id) return;
      send({ method: 'item/completed', params: { threadId: thread, item: { type: 'agentMessage', id: `answer-${turn}`, text: `Remembered ${marker}; ${input}` } } });
      send({ method: 'thread/tokenUsage/updated', params: { threadId: thread, tokenUsage: { last: { outputTokens: 12 }, total: { inputTokens: 50, outputTokens: turn*12 }, modelContextWindow: 1000 } } });
      send({ method: 'turn/completed', params: { threadId: thread, turn: { id, status: 'completed' } } }); active = null;
    }, input.includes('hold') ? 5000 : 900);
  } else if (m.method === 'turn/steer') {
    if (p.expectedTurnId !== active) return send({ id: m.id, error: { message: 'stale_turn' } });
    result({ turnId: active });
    send({ method: 'item/completed', params: { threadId: thread, item: { type: 'agentMessage', id: `steer-${turn}`, text: `Steered ${p.input[0].text}` } } });
  } else if (m.method === 'turn/interrupt') {
    if (p.turnId !== active) return send({ id: m.id, error: { message: 'stale_turn' } });
    clearTimeout(timer); result({});
    send({ method: 'turn/completed', params: { threadId: thread, turn: { id: active, status: 'interrupted' } } }); active = null;
  }
});

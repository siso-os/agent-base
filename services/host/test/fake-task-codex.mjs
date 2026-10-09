#!/usr/bin/env node
import readline from 'node:readline';
import { randomUUID } from 'node:crypto';
const send = m => process.stdout.write(JSON.stringify(m) + '\n');
let thread = randomUUID(), turn = 0, active = null;
readline.createInterface({ input: process.stdin }).on('line', line => {
  const m = JSON.parse(line), p = m.params ?? {};
  const result = r => send({ id: m.id, result: r });
  if (m.method === 'initialize') result({});
  else if (m.method === 'thread/start') { thread = p.threadId ?? thread; result({ thread: { id: thread, turns: [] } }); }
  else if (m.method === 'thread/resume') { thread = p.threadId; result({ thread: { id: thread, turns: [] } }); }
  else if (m.method === 'turn/start') {
    const id = `turn-${++turn}`; active = id; result({ turn: { id } });
    send({ method: 'turn/started', params: { threadId: thread, turn: { id } } });
    const totals = [[100,10],[160,20],[190,25]][turn - 1] ?? [190,25];
    send({ method: 'thread/tokenUsage/updated', params: { threadId: thread, turnId: 'other-turn-9999', tokenUsage: { last: { outputTokens: 999 }, total: { inputTokens: 9999, outputTokens: 9999 }, modelContextWindow: 1000 } } });
    send({ method: 'thread/tokenUsage/updated', params: { threadId: thread, tokenUsage: { last: { outputTokens: 888 }, total: { inputTokens: 8888, outputTokens: 8888 }, modelContextWindow: 1000 } } });
    if (process.env.FAKE_TASK_UNTAGGED_ONLY !== '1') send({ method: 'thread/tokenUsage/updated', params: { threadId: thread, turnId: id, tokenUsage: { last: { outputTokens: totals[1] }, total: { inputTokens: totals[0], outputTokens: totals[1], cacheReadInputTokens: 3, cacheCreationInputTokens: 1 }, modelContextWindow: 1000 } } });
    setTimeout(() => { if (active !== id) return; const status = turn === 2 ? 'failed' : turn === 3 ? 'interrupted' : 'completed'; send({ method: 'turn/completed', params: { threadId: thread, turn: { id, status } } }); active = null; }, 30);
  } else if (m.method === 'turn/interrupt') { result({}); if (active) { send({ method: 'turn/completed', params: { threadId: thread, turn: { id: active, status: 'interrupted' } } }); active = null; } }
});

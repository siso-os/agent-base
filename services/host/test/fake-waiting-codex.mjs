#!/usr/bin/env node
// Regression: a parent remains in a waiting turn; child returns must enter that turn rather than queue behind it.
if (process.env.AB_CHILD_ID) {
  await import('./fake-child-codex.mjs');
} else {
  const { createInterface } = await import('node:readline');
  const send = m => process.stdout.write(JSON.stringify(m) + '\n');
  const session = 'waiting-parent', turn = 'waiting-turn';
  const received = [];
  let spawned = 0;
  const spawnChild = () => send({ id: `spawn-${++spawned}`, method: 'item/tool/call', params: {
    threadId: session, turnId: turn, callId: `spawn-${spawned}`, tool: 'spawn_codex', arguments: { name: `WAIT-${spawned}`, brief: `marker-${spawned}` },
  } });
  createInterface({ input: process.stdin }).on('line', line => {
    const m = JSON.parse(line), p = m.params ?? {};
    const result = r => send({ id: m.id, result: r });
    if (m.method === 'initialize') result({});
    else if (m.method === 'thread/start') {
      if (p.dynamicTools?.length !== 4) process.exit(3);
      result({ thread: { id: session, turns: [], createdAt: 1 } });
    } else if (m.method === 'turn/start') {
      if (received.length < 2 && p.input[0].text.includes('<task-notification>')) process.exit(4);
      send({ method: 'turn/started', params: { threadId: session, turn: { id: turn } } }); result({ turn: { id: turn } }); spawnChild();
    } else if (String(m.id).startsWith('spawn-') && !m.method) {
      if (!m.result?.success) process.exit(5);
      if (spawned < 2) spawnChild();
      // Deliberately no turn/completed until two steered task notifications arrive.
    } else if (m.method === 'turn/steer') {
      if (p.expectedTurnId !== turn || !p.input[0].text.includes('<task-notification>')) process.exit(6);
      received.push(p.input[0].text); result({ turnId: turn });
      if (received.length === 2) {
        send({ method: 'item/completed', params: { threadId: session, item: { type: 'agentMessage', id: 'combined', text: 'Both waiting children: '+received.join('\n') } } });
        send({ method: 'turn/completed', params: { threadId: session, turn: { id: turn, status: 'completed' } } });
      }
    }
  });
}

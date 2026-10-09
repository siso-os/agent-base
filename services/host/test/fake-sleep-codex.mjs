#!/usr/bin/env node
// Synthetic provider for sleep/wake lifecycle checks; never calls a model.
import readline from 'node:readline';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
if (process.argv[2] !== '-m') process.exit(2);
const send = m => process.stdout.write(JSON.stringify(m) + '\n');
let thread = `sleep-${process.env.AB_HOST_NAME}`, turn = 0, approval;
const historyFile = `${process.env.SLEEP_HISTORY}-${process.env.AB_HOST_NAME}`;
readline.createInterface({ input: process.stdin }).on('line', line => {
  const m = JSON.parse(line), p = m.params ?? {}, result = r => send({ id: m.id, result: r });
  if (m.method === 'initialize') result({});
  else if (m.method === 'model/list') result({ data: [] });
  else if (['thread/start', 'thread/resume'].includes(m.method)) {
    thread = p.threadId ?? thread;
    let turns = []; try { turns = JSON.parse(readFileSync(historyFile, 'utf8')); } catch {}
    result({ thread: { id: thread, turns, createdAt: 1 } });
  } else if (m.method === 'turn/start') {
    const id = `turn-${process.pid}-${++turn}`, input = p.input[0].text;
    appendFileSync(process.env.SLEEP_DELIVERIES, JSON.stringify({ input, id, thread, pid: process.pid }) + '\n');
    send({ method: 'turn/started', params: { threadId: thread, turn: { id } } }); result({ turn: { id } });
    if (input === 'grandchild') {
      const child = spawn('/bin/sleep', ['999'], { stdio: 'ignore' });
      writeFileSync(process.env.SLEEP_GRANDCHILD, String(child.pid));
    }
    const finish = () => {
      const item = { type: 'agentMessage', id: `answer-${id}`, text: `Reply: ${input}` };
      send({ method: 'item/completed', params: { threadId: thread, item } });
      const completed = { id, status: 'completed', startedAt: Date.now() / 1000, items: [item] };
      writeFileSync(historyFile, JSON.stringify([completed]));
      send({ method: 'turn/completed', params: { threadId: thread, turn: completed } });
    };
    if (input === 'blocked') { approval = finish; send({ id: 100, method: 'item/commandExecution/requestApproval', params: { threadId: thread, command: 'fixture approval' } }); return; }
    if (input === 'child') {
      setTimeout(() => send({ id: 77, method: 'item/tool/call', params: { threadId: thread, turnId: id, tool: 'spawn_codex', arguments: { name: 'SLEEP-CHILD', brief: 'working', cwd: process.cwd(), model: 'gpt-6.1-sol', effort: 'low' } } }), 80);
      setTimeout(finish, 300);
    } else if (input === 'follow-child') {
      setTimeout(() => send({id:78,method:'item/tool/call',params:{threadId:thread,turnId:id,tool:'message_codex',arguments:{id:readFileSync(process.env.SLEEP_CHILD_ID,'utf8'),text:'child-follow-up'}}}),80);
      setTimeout(finish,300);
    } else setTimeout(finish, input === 'working' ? 5500 : 30);
  } else if (m.id === 77 && m.result?.success) writeFileSync(process.env.SLEEP_CHILD_ID,JSON.parse(m.result.contentItems[0].text).id);
  else if (m.id === 100) approval?.();
});

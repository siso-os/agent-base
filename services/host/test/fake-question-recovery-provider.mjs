#!/usr/bin/env node
// Isolated provider protocol fixture. Imported as a fake Claude SDK or executed as a fake Codex binary.
import { appendFileSync } from 'node:fs';
import readline from 'node:readline';
const stage = process.env.AB_FAKE_QUESTION_STAGE;
const record = value => appendFileSync(process.env.AB_FAKE_QUESTION_PROOF, JSON.stringify(value) + '\n');
const questions = [{ id: 'choice', question: 'Which fixture?', header: 'Fixture', options: [{ label: 'A' }, { label: 'B' }], isOther: false }];
export async function getSessionMessages() { return []; }
export function query({ options }) {
  let closed = false, wake;
  const events = [], signal = new AbortController();
  const push = e => { events.push(e); wake?.(); };
  return {
    close() { closed = true; signal.abort(); wake?.(); },
    supportedCommands: async () => [], getContextUsage: async () => ({ totalTokens: 1, maxTokens: 1000 }),
    usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: async () => ({ rate_limits_available: false }),
    async *[Symbol.asyncIterator]() {
      yield { type: 'system', subtype: 'init', session_id: options.resume ?? options.sessionId, model: 'fixture' };
      if (stage !== 'quiet') void (async () => {
        const result = await options.canUseTool('AskUserQuestion', { questions }, { signal: signal.signal, toolUseID: 'native-recovery-tool' });
        if (result.behavior === 'allow') {
          record({ provider: 'claude', answer: result.updatedInput.answers['Which fixture?'] });
          push({ type: 'assistant', uuid: 'provider-proof', message: { content: [{ type: 'text', text: 'Provider accepted fixture answer' }] } });
          push({ type: 'result', subtype: 'success', duration_ms: 1 });
        }
      })();
      while (!closed) { if (events.length) yield events.shift(); else await new Promise(r => { wake = r; }); }
    },
  };
}
if (process.argv[1] === import.meta.filename) {
  const send = m => process.stdout.write(JSON.stringify(m) + '\n');
  let thread = 'question-recovery-thread';
  const question = () => {
    send({ method: 'turn/started', params: { threadId: thread, turn: { id: 'native-recovery-turn' } } });
    send({ id: 'native-recovery-envelope', method: 'item/tool/requestUserInput', params: { threadId: thread, turnId: 'native-recovery-turn', itemId: 'native-recovery-tool', questions } });
  };
  readline.createInterface({ input: process.stdin }).on('line', line => {
    const m = JSON.parse(line), p = m.params ?? {};
    if (m.method === 'initialize') send({ id: m.id, result: {} });
    else if (m.method === 'thread/start' || m.method === 'thread/resume') {
      thread = p.threadId ?? thread;
      send({ id: m.id, result: { thread: { id: thread, turns: [], createdAt: 1 } } });
      if (stage !== 'quiet') setTimeout(question, 100);
    } else if (m.method === 'model/list') send({ id: m.id, result: { data: [] } });
    else if (m.id === 'native-recovery-envelope' && m.result) {
      record({ provider: 'codex', answer: m.result.answers.choice.answers[0] });
      send({ method: 'item/completed', params: { threadId: thread, item: { type: 'agentMessage', id: 'provider-proof', text: 'Provider accepted fixture answer' } } });
      send({ method: 'turn/completed', params: { threadId: thread, turn: { id: 'native-recovery-turn', status: 'completed' } } });
    }
  });
}

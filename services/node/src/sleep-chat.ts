import { chatWindow, olderPage, type ChatEv } from './transcript.ts';
import { watch } from 'node:fs';
import path from 'node:path';
import type { WebSocket } from 'ws';
import { alive, readSleepHost, wakeRunner } from '../../host/src/idle-sleep.ts';
import type { ServiceHost } from './service-hosts.ts';

/** A sleeping seat is readable without starting its runtime. Only an explicit send/control wakes it. */
export function serveAsleepChat(ws: WebSocket, host: ServiceHost, history: unknown[], connect: (host: any, frames: string[]) => void, fileSource: Parameters<typeof chatWindow>[1] = null) {
  const send = (frame: unknown) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(frame)); };
  let waking = false, transferred = false;
  const pending: string[] = [];
  const window = chatWindow(history as ChatEv[], fileSource);
  const sleep = { asleepAt: host.asleepAt, rssAtSleep: host.rssAtSleep, keepAwake: host.keepAwake };
  send({ t: 'hello', name: host.name, session: host.session, model: host.model, state: 'idle', log: window.shown, before: window.before, more: window.more, partial: {}, tasks: [], bg: [], sleep,
    capabilities: { version: 1, auto: true, steer: false, images: host.conversationHarness === 'claude', activeTurnId: null, compacting: false } });
  function transfer(next: any) {
    if (transferred || ws.readyState !== ws.OPEN) return;
    if (next.session !== host.session || next.name !== host.name || next.runnerPid !== host.runnerPid) throw Error('Could not wake: host identity changed');
    transferred = true; cleanup(); connect(next, pending.splice(0));
  }
  async function wake() {
    if (waking || transferred) return;
    waking = true; send({ t: 'sleep', ...sleep, waking: true });
    try { transfer(await wakeRunner(host.file)); }
    catch (error) {
      const text = (error as Error).message;
      waking = false; send({ t: 'sleep', ...sleep, error: text });
      for (const frame of pending.splice(0)) {
        const m = JSON.parse(frame);
        if (m.t === 'prompt') send({ t: 'prompt.receipt', key: m.key, id: m.messageId, phase: 'failed', text, code: 'wake_failed', queueRevision: 0 });
      }
    }
  }
  function onMessage(raw: Buffer) {
    let m: any; try { m = JSON.parse(raw.toString()); } catch { return; }
    if (!m || typeof m !== 'object' || Array.isArray(m)) return;
    if (m.t === 'older') { send(olderPage(m, window.stash, fileSource)); return; }
    if (m.t !== 'prompt' && m.t !== 'wake' && m.t !== 'keep_awake' && m.t !== 'set_model' && m.t !== 'set_effort') return;
    if (raw.length > 512 * 1024 || pending.length >= 32) {
      const text = 'Wake input limit reached; keep this message and retry.';
      if (m.t === 'prompt') send({t:'prompt.receipt',key:m.key,id:m.messageId,phase:'failed',code:'wake_failed',text,queueRevision:0});
      else send({t:'error',kind:'api',text});
      return;
    }
    if (m.t !== 'wake') pending.push(raw.toString());
    void wake();
  }
  // Watching the containing directory sees atomic descriptor replacements. It never polls or wakes a host.
  let watcher: ReturnType<typeof watch> | undefined;
  try { watcher = watch(path.dirname(host.file), (_event, file) => {
    if (file !== path.basename(host.file) || waking || transferred) return;
    try { const next = readSleepHost(host.file); if (next.state !== 'asleep' && alive(next.pid)) transfer(next); } catch { /* Wait for an explicit wake or the next atomic replacement. */ }
  }); watcher.on('error', () => watcher?.close()); } catch { /* Explicit wake still works if directory watching is unavailable. */ }
  const cleanup = () => { watcher?.close(); ws.off('message', onMessage); ws.off('close', cleanup); };
  ws.on('message', onMessage); ws.once('close', cleanup);
}

import { openSync, closeSync, fstatSync, readSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { wakeRunner, readSleepHost } from '../../host/src/idle-sleep.ts';
import type { ServiceHost } from './service-hosts.ts';

export function sleepSummary(file = path.join(process.env.AB_HOSTS_DIR ?? path.join(homedir(), '.local/state/agent-base/hosts'), '..', 'sleep.jsonl'), now = Date.now()) {
  let fd: number | undefined;
  try {
    fd = openSync(file, 'r'); const stat = fstatSync(fd);
    if (!stat.isFile()) throw Error('not a file');
    const size = Math.min(stat.size, 256 * 1024), buffer = Buffer.alloc(size);
    readSync(fd, buffer, 0, size, stat.size - size);
    const lines = buffer.toString('utf8').split('\n'); if (stat.size > size) lines.shift();
    const rows = lines.flatMap(line => { try { const row = JSON.parse(line); return Number.isFinite(row.at) && row.at <= now && row.at >= now - 3600_000 && typeof row.name === 'string' ? [row] : []; } catch { return []; } });
    return { count: rows.length, chats: new Set(rows.map(r => r.name)).size, rssMB: rows.reduce((n, r) => n + (Number.isFinite(r.rssMB) && r.rssMB >= 0 ? r.rssMB : 0), 0), measured: rows.filter(r => Number.isFinite(r.rssMB) && r.rssMB >= 0).length, lastAt: rows.at(-1)?.at ?? null };
  } catch { return { count: 0, chats: 0, rssMB: 0, measured: 0, lastAt: null }; }
  finally { if (fd !== undefined) closeSync(fd); }
}

export async function controlSleep(host: ServiceHost, keepAwake?: boolean) {
  const next = await wakeRunner(host.file);
  if (next.session !== host.session || next.name !== host.name || (host.runnerPid && next.runnerPid !== host.runnerPid)) throw Error('Host identity changed');
  if (keepAwake === undefined) return;
  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${next.port}/ws?token=${encodeURIComponent(next.token)}`);
    const finish = (error?: Error) => { clearTimeout(timer); ws.close(); error ? reject(error) : resolve(); };
    const timer = setTimeout(() => finish(Error('Keep awake change not confirmed')), 5000);
    ws.on('message', raw => {
      let m: any; try { m = JSON.parse(String(raw)); } catch { return; }
      if (m.t === 'hello') {
        if (m.session !== host.session || m.name !== host.name) return finish(Error('Host identity changed'));
        ws.send(JSON.stringify({ t: 'keep_awake', value: keepAwake }));
      } else if (m.t === 'sleep.policy') {
        try {
          const saved = readSleepHost(host.file);
          if (saved.session === host.session && saved.keepAwake === keepAwake) finish();
          else finish(Error('Keep awake change not saved'));
        } catch { finish(Error('Keep awake change not saved')); }
      }
    });
    ws.on('error', () => finish(Error('Host control unavailable')));
    ws.once('close', () => { clearTimeout(timer); reject(Error('Host closed before control receipt')); });
  });
}

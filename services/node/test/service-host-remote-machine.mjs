// A host mirrored from the Mac mini (ab-remote bridge, `remote.machine`) is labelled with its machine, not this laptop's
// (Shaan via Agent Zero, 8 Oct: "make your chat header and fleet row say 'Mac mini' so one click tells him").
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { listServiceHosts, bindServiceRows } from '../src/service-hosts.ts';

test('mirrored mini host rows carry machineKey mini and "Mac mini"; local hosts keep the defaults', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ab-remote-machine-'));
  const rec = (name, extra = {}) => ({ pid: process.pid, port: 1, token: 't', name, state: 'idle', ...extra });
  writeFileSync(path.join(dir, 'remote-mini-1.json'), JSON.stringify(rec('AGENT-BASE', { remote: { machine: 'mini', ssh: 'mini-fast', pid: 9, port: 2 } })));
  writeFileSync(path.join(dir, 'remote-mini-2.json'), JSON.stringify(rec('OPTION', { remote: { machine: 'mini', ssh: '-oProxyCommand=touch /tmp/x', pid: 9 } })));
  writeFileSync(path.join(dir, 'name-LOCAL.json'), JSON.stringify(rec('LOCAL')));
  writeFileSync(path.join(dir, 'remote-bad-1.json'), JSON.stringify(rec('BAD', { remote: { machine: '../x' } })));
  const hosts = await listServiceHosts({ dir, processAlive: () => true, portHealthy: () => true, launchdLoaded: () => false });
  assert.equal(hosts.find(h => h.name === 'AGENT-BASE')?.remoteMachine, 'mini');
  assert.equal(hosts.find(h => h.name === 'BAD')?.remoteMachine, null);
  assert.deepEqual(hosts.find(h => h.name === 'AGENT-BASE')?.remote, { ssh: 'mini-fast', pid: 9 });
  assert.equal(hosts.find(h => h.name === 'OPTION')?.remote, null, 'an alias that reads as an ssh option is no remote');
  const rows = bindServiceRows([], hosts, { machine: 'MB', machineKey: 'laptop' });
  const by = n => rows.find(r => r.name === n);
  assert.deepEqual([by('AGENT-BASE').machineKey, by('AGENT-BASE').machine], ['mini', 'Mac mini']);
  assert.equal(by('AGENT-BASE').away, true);
  assert.deepEqual([by('LOCAL').machineKey, by('LOCAL').machine, by('LOCAL').away], ['laptop', 'MB', undefined]);
  assert.deepEqual([by('BAD').machineKey, by('BAD').machine], ['laptop', 'MB']);
});

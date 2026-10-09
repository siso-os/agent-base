// t-0577: switching a Claude agent's login from the dropdown. Sealed temp dirs and fake scripts only; the real switch
// scripts, HOSTS_DIR and Claude config folders are never touched.
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { accountSwitchBlocked, accountSwitchDeps, accountSwitchError, accountSwitchStatus, failureLine, switchAccount } from '../src/account-switch.ts';

const root = mkdtempSync(path.join(tmpdir(), '.siso-ephemeral-t0577.'));
after(() => rmSync(root, { recursive: true }));
const home = path.join(root, 'home'), bin = path.join(root, 'bin');
for (const d of [home, bin, path.join(home, '.claude-siso'), path.join(home, '.config/claude-siso-3')]) mkdirSync(d, { recursive: true });
const LORD = path.join(home, '.config/claude-siso-3'), FUZE = path.join(home, '.claude-siso');
process.env.AB_SWITCH_BIN_DIR = bin;

/** Each case gets its own hosts dir and call log; a fake script logs its argv and may flip the host record. */
function lab(id, { script, body, hosts, agent }) {
  const hostsDir = path.join(root, `hosts-${id}`), log = path.join(root, `calls-${id}.log`);
  mkdirSync(hostsDir, { recursive: true });
  for (const h of hosts) writeFileSync(path.join(hostsDir, `${h.file}.json`), JSON.stringify(h));
  writeFileSync(path.join(bin, script), `#!/bin/bash\nprintf '%s\\n' "$*" >> '${log}'\nHOSTS='${hostsDir}'\n${body}\n`);
  chmodSync(path.join(bin, script), 0o755);
  const readHosts = async () => readdirSync(hostsDir).filter(f => f.endsWith('.json')).map(f => JSON.parse(readFileSync(path.join(hostsDir, f), 'utf8')))
    .map(h => ({ name: h.name, session: h.session, pane: h.pane ?? null, configDir: h.configDir ?? null, pid: h.pid, machine: h.remote?.machine ?? null, harness: h.harness ?? null, busy: h.state === 'working' }));
  const deps = { ...accountSwitchDeps({ listAgents: async () => [agent], hostsDir }), readHosts, home, pollMs: 20, confirmMs: 400 };
  return { deps, calls: () => existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : [], hostsDir };
}
const owner = (name, configDir, extra = {}) => ({ file: 'w7_p37', name, session: 'sess-1', pane: 'w7:p37', configDir, pid: 4242, ...extra });
// The fake's flip: the host restarts (new pid) on the login it was given, same session.
const flip = (name, dirArg) => `sleep 0.1; printf '{"name":"${name}","session":"sess-1","pane":"w7:p37","pid":5151,"configDir":"%s"}' "${dirArg}" > "$HOSTS/w7_p37.json"`;

test('a pane owner: the script gets its name and the chosen dir; done only once the host record flips', async () => {
  const { deps, calls } = lab('happy', { script: 'owner-switch-login', body: flip('OWNER-A', '$2'), hosts: [owner('OWNER-A', LORD)], agent: { name: 'OWNER-A', tool: 'siso', session: 'sess-1' } });
  const status = await switchAccount('OWNER-A', 'claude-siso', deps);
  assert.equal(status.state, 'done', status.message);
  assert.deepEqual(calls(), [`OWNER-A ${FUZE}`]);
  assert.deepEqual(status.stages.slice(0, 2), ['Queued', 'Waiting for idle']);
  assert.ok(status.stages.includes('Confirming on fuzeheritage'), status.stages.join(' · '));
  assert.equal(accountSwitchStatus('OWNER-A').state, 'done');
});

test('script exit 0 but the record never flips: failed, never "done"', async () => {
  const { deps } = lab('noflip', { script: 'owner-switch-login', body: 'exit 0', hosts: [owner('OWNER-B', LORD)], agent: { name: 'OWNER-B', tool: 'siso', session: 'sess-1' } });
  const status = await switchAccount('OWNER-B', 'claude-siso', deps);
  assert.equal(status.state, 'failed');
  assert.equal(status.message, 'The script finished but OWNER-B is not on fuzeheritage; check the pane');
});

test('script exits 1: failed with its last stderr line, home as ~ and no email or token', async () => {
  const body = `echo "starting" >&2; echo "OWNER-C: no sess-1.jsonl under ${home}/.config/claude-siso-3/projects (me@example.com, sk-ant-abcdefghijklmnop)" >&2; exit 1`;
  const { deps } = lab('exit1', { script: 'owner-switch-login', body, hosts: [owner('OWNER-C', LORD)], agent: { name: 'OWNER-C', tool: 'siso', session: 'sess-1' } });
  const status = await switchAccount('OWNER-C', 'claude-siso', deps);
  assert.equal(status.state, 'failed');
  assert.match(status.message, /^OWNER-C: no sess-1\.jsonl under ~\/\.config\/claude-siso-3\/projects/);
  assert.doesNotMatch(status.message, /@|sk-ant|\/Users\/|ephemeral/);
  assert.equal(failureLine('x at /Users/someone/.claude-siso', '/nowhere'), 'x at ~/.claude-siso');
});

test('the read-only account is refused and nothing runs', async () => {
  const { deps, calls } = lab('readonly', { script: 'owner-switch-login', body: 'exit 0', hosts: [owner('OWNER-D', LORD)], agent: { name: 'OWNER-D', tool: 'siso', session: 'sess-1' } });
  const status = await switchAccount('OWNER-D', 'claude-fahmy', deps);
  assert.equal(status.state, 'failed'); assert.match(status.message, /read-only/);
  assert.match(accountSwitchError('claude-fahmy'), /read-only/); assert.ok(accountSwitchError('nope')); assert.equal(accountSwitchError('claude-siso'), null);
  assert.deepEqual(calls(), []); assert.equal(accountSwitchStatus('OWNER-D'), null);
});

test('a Codex agent is refused and nothing runs', async () => {
  const { deps, calls } = lab('codex', { script: 'owner-switch-login', body: 'exit 0', hosts: [owner('CODEX-A', LORD)], agent: { name: 'CODEX-A', tool: 'codex', session: 'sess-1' } });
  const status = await switchAccount('CODEX-A', 'claude-siso', deps);
  assert.equal(status.state, 'failed'); assert.equal(status.message, 'Codex agents have no Claude account');
  assert.equal(await accountSwitchBlocked('CODEX-A', deps), 'Codex agents have no Claude account');
  assert.deepEqual(calls(), []);
});

test('already on the chosen login: done without running anything', async () => {
  const { deps, calls } = lab('already', { script: 'owner-switch-login', body: 'exit 0', hosts: [owner('OWNER-E', FUZE)], agent: { name: 'OWNER-E', tool: 'siso', session: 'sess-1' } });
  const status = await switchAccount('OWNER-E', 'claude-siso', deps);
  assert.equal(status.state, 'done'); assert.equal(status.message, 'Already on fuzeheritage');
  assert.deepEqual(calls(), []);
});

test('Agent Zero runs a0-switch-login CONFIG_DIR --after 3, detached, and is confirmed from the host record', async () => {
  const a0 = { file: 'w1_p1', name: 'A0', session: 'sess-1', pane: 'w1:p1', configDir: FUZE, pid: 7070 };
  const body = `sleep 0.1; printf '{"name":"A0","session":"sess-1","pane":"w1:p1","pid":7171,"configDir":"%s"}' "$1" > "$HOSTS/w1_p1.json"`;
  const { deps, calls } = lab('a0', { script: 'a0-switch-login', body, hosts: [a0], agent: { name: 'Agent Zero', tool: 'siso', zero: true, session: 'sess-1' } });
  const status = await switchAccount('Agent Zero', 'claude-siso-3', deps);
  assert.equal(status.state, 'done', status.message);
  assert.deepEqual(calls(), [`${LORD} --after 3`]);
  assert.equal(status.stages[1], 'Moving the conversation');
});

test('a Mac mini owner runs mini-switch-login with the mini-side dir; another remote machine is not offered', async () => {
  const mini = { file: 'remote-mini-99', name: 'MINI-A', session: 'sess-1', pane: null, configDir: '/Users/x/.config/claude-siso-3', pid: 1, remote: { machine: 'mini', pid: 99 } };
  const body = `printf '{"name":"MINI-A","session":"sess-1","pane":null,"pid":1,"configDir":"/Users/x/.claude-siso","remote":{"machine":"mini","pid":100}}' > "$HOSTS/remote-mini-100.json"; rm "$HOSTS/remote-mini-99.json"`;
  const { deps, calls } = lab('mini', { script: 'mini-switch-login', body, hosts: [mini], agent: { name: 'MINI-A', tool: 'siso', session: 'sess-1' } });
  const status = await switchAccount('MINI-A', 'claude-siso', { ...deps, remoteIdleMs: 0 });
  assert.equal(status.state, 'done', status.message);
  assert.deepEqual(calls(), ['MINI-A ~/.claude-siso']);
  const vps = lab('vps', { script: 'owner-switch-login', body: 'exit 0', hosts: [{ ...mini, name: 'VPS-A', remote: { machine: 'vps', pid: 5 } }], agent: { name: 'VPS-A', tool: 'siso', session: 'sess-1' } });
  assert.match(await accountSwitchBlocked('VPS-A', vps.deps), /runs on vps/);
});

test('a second request while one runs is refused', async () => {
  const { deps, calls } = lab('twice', { script: 'owner-switch-login', body: 'sleep 0.3; ' + flip('OWNER-F', '$2'), hosts: [owner('OWNER-F', LORD)], agent: { name: 'OWNER-F', tool: 'siso', session: 'sess-1' } });
  const first = switchAccount('OWNER-F', 'claude-siso', deps);
  assert.equal(accountSwitchStatus('OWNER-F').state, 'queued');
  const second = await switchAccount('OWNER-F', 'claude-siso', deps);
  assert.equal(second.state, 'failed'); assert.equal(second.message, 'A switch is already running for this agent');
  assert.equal((await first).state, 'done');
  assert.equal(calls().length, 1);
});

test('Agent Zero mid-answer: the app waits for idle before running a0-switch-login, and gives up rather than cut the turn', async () => {
  const a0 = { file: 'w7_p37', name: 'A0', session: 'sess-1', pane: 'w7:p37', configDir: LORD, pid: 6161, state: 'working' };
  const { deps, calls, hostsDir } = lab('a0-busy', { script: 'a0-switch-login', body: 'true', hosts: [a0], agent: { name: 'Agent Zero', tool: 'siso', zero: true, session: 'sess-1' } });
  const gaveUp = await switchAccount('Agent Zero', 'claude-siso', { ...deps, idleMs: 150 });
  assert.equal(gaveUp.state, 'failed'); assert.match(gaveUp.message, /still working/);
  assert.ok(gaveUp.stages.includes('Waiting for idle')); assert.deepEqual(calls(), [], 'nothing ran while it worked');
  // It goes idle part way through the wait: then the script runs.
  setTimeout(() => writeFileSync(path.join(hostsDir, 'w7_p37.json'), JSON.stringify({ ...a0, state: 'idle' })), 80);
  await switchAccount('Agent Zero', 'claude-siso', { ...deps, idleMs: 5000, confirmMs: 60 });
  assert.deepEqual(calls(), [`${FUZE} --after 3`]);
});

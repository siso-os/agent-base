/** Receipt-bound Claude service launch. The HTTP owner supplies its existing command executor.
 * No launch on import, no default login, and no fallback to a terminal pane. */
import { closeSync, existsSync, openSync, readFileSync, readSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import { listServiceHosts } from './service-hosts.ts';
import { configDir, readSeat, safeName, type Seat } from '../../host/src/service.ts';
import { validateWorkspaceReceipt, type WorkspaceReceipt } from '../../host/src/worktree-contract.ts';

export type ClaudeServiceOptions = { loginLauncher: string; hostsDir: string; permissionMode: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' };
export type ServiceCommand = { command: string; args: string[]; env: Record<string, string> };
export type ServiceExecutor = (command: ServiceCommand) => Promise<unknown>;

export type ClaudeLaunchProfile = { version: 1; loginLauncher: string; permissionMode: ClaudeServiceOptions['permissionMode'] };
/** Server-owned profile, persisted in the launch fingerprint before any asynchronous preparation.
 * A browser cannot supply a config directory or change the account on a replayed launch. */
export function configuredClaudeProfile(directory: string): ClaudeLaunchProfile {
  const loginLauncher = ['claude','claude-siso','claude-siso-3'].find(login => path.resolve(configDir(login)) === path.resolve(directory));
  if (!loginLauncher) throw new Error('The configured Claude login has no supervised launcher; current account preserved');
  return { version: 1, loginLauncher, permissionMode: 'bypassPermissions' };
}
export function receiptClaudeProfile(r: WorkspaceReceipt): ClaudeLaunchProfile | null {
  const profile = (r.input as typeof r.input & { claudeProfile?: ClaudeLaunchProfile }).claudeProfile;
  if (profile === undefined) return null; // Existing pre-profile receipts retain their recorded seat/recovery path.
  if (profile.version !== 1 || !['default','acceptEdits','bypassPermissions','plan'].includes(profile.permissionMode)) throw new Error('Invalid saved Claude launch profile');
  configDir(profile.loginLauncher);
  return profile;
}

export type SupervisedResume = {
  name: string; harness: 'claude' | 'codex'; session: string; cwd: string; model: string; hostsDir: string;
  loginLauncher?: string; transcriptFile?: string; permissionMode?: ClaudeServiceOptions['permissionMode'];
};

/** Resume only. The caller must resolve the original run/fork identity before entering this boundary.
 * No inferred home directory, source-login migration, fresh conversation or terminal fallback. */
export function supervisedResumeCommand(o: SupervisedResume): ServiceCommand {
  safeName(o.name);
  if (o.name === 'A0') throw new Error('Standing owner service is outside ordinary chat launch');
  if (!['claude', 'codex'].includes(o.harness) || !/^[A-Za-z0-9_-]{1,128}$/.test(o.session)) throw new Error('Explicit supported harness and session are required');
  if (!o.model?.trim() || o.model.startsWith('-') || /[\r\n\0]/.test(o.model)) throw new Error('Explicit model is required');
  if (!path.isAbsolute(o.cwd) || !path.isAbsolute(o.hostsDir) || !statSync(o.cwd).isDirectory() || !statSync(o.hostsDir).isDirectory()) throw new Error('Existing absolute working and hosts directories are required');
  if (o.harness === 'claude') {
    if (!o.loginLauncher || !o.transcriptFile || !path.isAbsolute(o.transcriptFile)) throw new Error('Explicit Claude login and transcript are required');
    configDir(o.loginLauncher);
    if (!o.permissionMode || !['default','acceptEdits','bypassPermissions','plan'].includes(o.permissionMode)) throw new Error('Explicit Claude permission mode is required');
  } else if (o.loginLauncher || o.transcriptFile || o.permissionMode) throw new Error('Claude login options cannot be applied to Codex');
  return {
    command: path.resolve(import.meta.dirname, '../../host/bin/siso-host-service'),
    args: ['install', '--harness', o.harness, '--name', o.name, '--label', `com.siso.host-${o.name}`, '--model', o.model, '--cwd', o.cwd, '--resume', o.session, ...(o.permissionMode ? ['--permission-mode', o.permissionMode] : [])],
    // Explicitly clear an ambient workspace receipt: this is the original session's CWD.
    env: { AB_WORKSPACE_RECEIPT: '', AB_EXACT_RESUME: o.session, AB_SEAT_FILE: path.join(o.hostsDir, `resume-${o.name}.seat.json`), AB_HOSTS_DIR: o.hostsDir },
  };
}

/** Durable name/session claims intentionally survive an uncertain install. Never retry by creating
 * a different name: reconcile the saved service explicitly after inspecting its outcome. */
export async function resumeSupervisedSession(o: SupervisedResume, execute: ServiceExecutor) {
  const command = supervisedResumeCommand(o);
  const hostFile = path.join(o.hostsDir, `name-${o.name}.json`);
  if (existsSync(hostFile)) throw new Error('Existing host name preserved; inspect its exact session before reuse');
  for (const name of readdirSync(o.hostsDir).filter(n => n.endsWith('.json'))) {
    const saved = JSON.parse(readFileSync(path.join(o.hostsDir, name), 'utf8'));
    if ((name.startsWith('name-') || Number.isInteger(saved.pid)) && saved.session === o.session && (saved.harness ?? 'claude') === o.harness) throw new Error('Session already has a host owner; explicit recovery is required');
  }
  if (o.harness === 'claude') {
    const config = realpathSync(configDir(o.loginLauncher!));
    const transcript = realpathSync(o.transcriptFile!);
    const relative = path.relative(path.join(config, 'projects'), transcript).split(path.sep);
    if (relative.length !== 2 || relative[0] === '..' || relative[1] !== `${o.session}.jsonl`) throw new Error('Transcript does not belong to the exact Claude login/session');
    // Transcript headers carry CWD. Read a bounded prefix without loading conversation contents.
    const fd = openSync(transcript, 'r'), prefix = Buffer.alloc(128 * 1024);
    let count: number;
    try { count = readSync(fd, prefix, 0, prefix.length, 0); } finally { closeSync(fd); }
    const lines = prefix.subarray(0, count).toString('utf8').split('\n');
    if (count === prefix.length) lines.pop();
    let observed = false;
    for (const line of lines) {
      let row; try { row = JSON.parse(line); } catch { continue; }
      if (typeof row.cwd !== 'string') continue;
      if (!path.isAbsolute(row.cwd) || realpathSync(row.cwd) !== realpathSync(o.cwd)) throw new Error('Transcript working directory differs from requested resume');
      observed = true;
    }
    if (!observed) throw new Error('Transcript working directory is unavailable; resume requires exact evidence');
  }
  const claim = path.join(o.hostsDir, `resume-${o.harness}-${o.session}.claim.json`);
  const identity = { name: o.name, harness: o.harness, session: o.session, cwd: o.cwd, model: o.model, label: `com.siso.host-${o.name}` };
  writeFileSync(claim, JSON.stringify(identity), { mode: 0o600, flag: 'wx' });
  writeFileSync(command.env.AB_SEAT_FILE, JSON.stringify({ ...identity, ...(o.loginLauncher ? { login_launcher: o.loginLauncher } : {}) }), { mode: 0o600, flag: 'wx' });
  await execute(command);
  return { ...identity, installed: true as const, ready: false as const };
}

/** Installation is not readiness. Verify the live file and authenticated hello, then optionally
 * submit once through the existing durable prompt queue and wait for its receipt. */
export async function confirmSupervisedResume(o: SupervisedResume, say?: string) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const host = (await listServiceHosts({ dir: o.hostsDir })).find(h => h.name === o.name);
    if (host) {
      const saved = JSON.parse(readFileSync(host.file, 'utf8'));
      if ((host.harness ?? 'claude') !== o.harness || !host.cwd || realpathSync(host.cwd) !== realpathSync(o.cwd) || saved.label !== `com.siso.host-${o.name}` || host.session && host.session !== o.session) throw new Error('Resumed host identity differs; no message sent');
      if (host.state === 'live' && host.session === o.session) {
        await new Promise<void>((resolve, reject) => {
          const ws = new WebSocket(`ws://127.0.0.1:${host.port}/ws?token=${host.token}`);
          const key = randomUUID();
          let sent = false, settled = false;
          const done = (error?: Error) => { if (settled) return; settled = true; clearTimeout(timer); ws.close(); error ? reject(error) : resolve(); };
          const timer = setTimeout(() => done(new Error(sent ? 'Message delivery is uncertain; inspect the queue before retrying' : 'Resumed host did not confirm its session; no message sent')), 5000);
          ws.on('error', () => done(new Error(sent ? 'Message delivery is uncertain; inspect the queue before retrying' : 'Resumed host is unavailable; no message sent')));
          ws.on('close', () => { if (!settled) done(new Error(sent ? 'Message delivery is uncertain; inspect the queue before retrying' : 'Resumed host closed before identity confirmation')); });
          ws.on('message', raw => {
            let frame; try { frame = JSON.parse(String(raw)); } catch { return; }
            if (frame.t === 'hello') {
              if (frame.name !== o.name || frame.session !== o.session || frame.child === 'stopped') return done(new Error('Resumed socket identity differs; no message sent'));
              if (!say) return done();
              if (!sent) { sent = true; ws.send(JSON.stringify({ t: 'prompt', key, messageId: key, text: say, images: [], delivery: 'next' }), error => { if (error) done(new Error('Message delivery is uncertain; inspect the queue before retrying')); }); }
            } else if (frame.t === 'prompt.receipt' && frame.key === key && sent) {
              if (['saved','accepted','completed'].includes(frame.phase)) done();
              else if (['failed','unknown'].includes(frame.phase)) done(new Error('Message delivery was not confirmed; inspect the queue before retrying'));
            }
          });
        });
        return;
      }
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Resume is still pending; inspect the existing service before retrying');
}

/** Also used after reboot; keep install arguments stable so reconciliation can verify the saved plist. */
export function claudeServiceCommand(r: WorkspaceReceipt, file: string, options: ClaudeServiceOptions, reconcile = false): ServiceCommand {
  safeName(r.name);
  configDir(options.loginLauncher);
  if (!['default','acceptEdits','bypassPermissions','plan'].includes(options.permissionMode)) throw new Error('Explicit Claude permission mode is required');
  if (r.input.harness !== 'claude' || !r.input.model?.trim() || r.input.model.startsWith('-')) throw new Error('Explicit Claude harness and model are required');
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(r.workspaceId) || !path.isAbsolute(file) || !path.isAbsolute(options.hostsDir)) throw new Error('Absolute receipt/hosts paths and workspace identity are required');
  const label = `com.siso.host-${r.name}`;
  return {
    command: path.resolve(import.meta.dirname, '../../host/bin/siso-host-service'),
    args: [reconcile ? 'reconcile' : 'install', '--harness', 'claude', '--name', r.name, '--label', label, '--model', r.input.model, '--permission-mode', options.permissionMode, '--cwd', r.worktreePath],
    env: { AB_WORKSPACE_RECEIPT: file, AB_SEAT_FILE: `${file}.claude-seat`, AB_HOSTS_DIR: options.hostsDir },
  };
}

/** Invoke inside agent-launch's existing withLaunch lock, after it records handoffAttempted.
 * A failed/ambiguous install deliberately retains its seat. Never retry a fresh start automatically. */
export async function startSupervisedClaude(r: WorkspaceReceipt, file: string, options: ClaudeServiceOptions, execute: ServiceExecutor) {
  const command = claudeServiceCommand(r, file, options);
  const saved = validateWorkspaceReceipt(file, r.worktreePath, r.name);
  if (saved.workspaceId !== r.workspaceId || saved.inputFingerprint !== r.inputFingerprint || saved.input.harness !== 'claude' || saved.input.model !== r.input.model || saved.phase !== 'starting' || !saved.handoffAttempted) throw new Error('Workspace handoff ownership changed');
  if (existsSync(path.join(options.hostsDir, `name-${r.name}.json`))) throw new Error('Existing host preserved; reconcile its owned session explicitly');
  const seat: Seat = { name: r.name, session: null, login_launcher: options.loginLauncher, harness: 'claude', model: r.input.model, workspaceId: r.workspaceId, cwd: r.worktreePath, label: `com.siso.host-${r.name}`, startAttempted: false };
  writeFileSync(command.env.AB_SEAT_FILE, JSON.stringify(seat), { mode: 0o600, flag: 'wx' });
  await execute(command);
  return { label: seat.label! };
}

/** Explicit reconciliation only. The controller checks the receipt, host ownership and unchanged plist.
 * Loaded services return unchanged; missing/foreign/ambiguous records fail closed. */
export async function reconcileSupervisedClaude(r: WorkspaceReceipt, file: string, options: ClaudeServiceOptions, execute: ServiceExecutor) {
  const command = claudeServiceCommand(r, file, options, true);
  readSeat(command.env.AB_SEAT_FILE, r.name);
  // The runner may have died after the host published its session but before updating this seat.
  // The controller adopts that identity only after checking host ownership against the receipt.
  const saved = validateWorkspaceReceipt(file, r.worktreePath);
  if (saved.workspaceId !== r.workspaceId || saved.inputFingerprint !== r.inputFingerprint) throw new Error('Workspace recovery ownership changed');
  await execute(command);
  return { label: `com.siso.host-${r.name}` };
}

/** Package ownership is the update boundary. Reading a pin does not claim an installed/live version. */
export function backendVersionOwnership() {
  const pkg = JSON.parse(readFileSync(path.resolve(import.meta.dirname, '../../host/package.json'), 'utf8'));
  return { claude: { source: 'services/host/package.json', sdk: pkg.dependencies['@anthropic-ai/claude-agent-sdk'] as string, installedVersion: null }, codex: { source: 'AB_CODEX_BIN or PATH', installedVersion: null }, automaticUpdates: false as const };
}

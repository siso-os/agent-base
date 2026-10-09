/** Read-only, task-owned Codex metadata probe. Never starts a thread or a turn. */
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir, hostname } from 'node:os';
import path from 'node:path';
import { CODEX_QUOTA_SOURCE, type QuotaTarget, type QuotaReading } from './quota-provenance.ts';

type Context = { model: string; repo: string };
export type CodexLaunchBinding = {
  target: QuotaTarget; fingerprint: string; executable: string; args: string[];
  cwd: string; env: NodeJS.ProcessEnv;
};
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const unavailable = () => new Error('Authenticated Codex quota source is unavailable');
const bounded = (file: string, privateFile = false) => {
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024 || stat.mode & 0o022 ||
      ![0, process.getuid?.()].includes(stat.uid) || privateFile && stat.mode & 0o077) throw unavailable();
  return readFileSync(file, 'utf8');
};

// The supported local policy is deliberately narrow: the current ordinary Codex route.
// New specialized models/buckets need an explicit policy, never a first-bucket guess.
const ORDINARY_MODELS = new Set(['gpt-6-astra']);
const CONFIG = String.raw`
import json, pathlib, sys, tomllib
root=pathlib.Path(sys.argv[1]); cwd=pathlib.Path(sys.argv[2]); files=[]
paths=[pathlib.Path('/etc/codex/config.toml'), root/'config.toml']
for parent in reversed([cwd,*cwd.parents]): paths.append(parent/'.codex/config.toml')
seen=set()
for p in paths:
 if str(p) in seen or not p.exists(): continue
 seen.add(str(p)); s=p.lstat()
 if p.is_symlink() or not p.is_file() or s.st_size>1048576 or s.st_mode & 0o022: raise RuntimeError('unsafe config')
 raw=p.read_bytes(); d=tomllib.loads(raw.decode()); files.append(str(p))
 # The managed launch uses no --profile or config override. Unsupported identity routing fails closed.
 for key in ['profile','model_provider','chatgpt_base_url','forced_login_method','forced_chatgpt_workspace_id','cli_auth_credentials_store']:
  if key in d and not (key=='model_provider' and d[key]=='openai') and not (key=='cli_auth_credentials_store' and d[key]=='file') and not (key=='forced_login_method' and d[key]=='chatgpt'):
   raise RuntimeError('unsupported identity routing')
 for settings in d.get('projects',{}).values():
  if any(k in settings for k in ['profile','model_provider','chatgpt_base_url','cli_auth_credentials_store','forced_chatgpt_workspace_id']): raise RuntimeError('project identity override')
 if 'openai' in d.get('model_providers',{}): raise RuntimeError('custom openai provider')
print(json.dumps(files))
`;

/** Resolve the same default local profile, PATH executable and roles_model as the managed launch.
 * IDs come only from Codex's private authentication store, never from the quota response.
 * root must pass a different resolver when its launch adapter has a non-default profile/remote host.
 */
export function resolveLocalCodexBinding(context: Context): CodexLaunchBinding {
  if (!ORDINARY_MODELS.has(context.model)) throw unavailable();
  // service-control persists PATH but inherits other login environment from launchd.
  // A different launchd profile/proxy would mean this process is not the launch authority.
  if (process.platform !== 'darwin') throw unavailable();
  for (const key of ['CODEX_HOME', 'AB_CODEX_BIN', 'AB_BACKEND_SELECTION', 'OPENAI_API_KEY', 'CODEX_API_KEY', 'OPENAI_BASE_URL', 'CODEX_PROFILE']) {
    if (process.env[key]) throw unavailable();
    const inherited = execFileSync('/bin/launchctl', ['getenv', key], { timeout: 1000, maxBuffer: 8192, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
    if (inherited.trim()) throw unavailable();
  }
  const home = realpathSync(homedir()), cwd = realpathSync(context.repo), codexHome = path.join(home, '.codex');
  const launchHome = execFileSync('/bin/launchctl', ['getenv', 'HOME'], { timeout: 1000, maxBuffer: 8192, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' }).trim();
  if (launchHome && launchHome !== home) throw unavailable();
  if (realpathSync(codexHome) !== codexHome) throw unavailable();
  const routingPath = path.join(home, 'SISO_Workspace/SISO_Agents/agent-zero/siso-agent-zero/routing.json');
  const routing = bounded(routingPath);
  if (JSON.parse(routing).roles_model !== context.model) throw unavailable();
  const auth = bounded(path.join(codexHome, 'auth.json'), true), saved = JSON.parse(auth);
  if (saved.auth_mode !== 'chatgpt' || saved.OPENAI_API_KEY || typeof saved.tokens?.account_id !== 'string' || !saved.tokens.account_id ||
      typeof saved.tokens.access_token !== 'string' || !saved.tokens.access_token) throw unavailable();
  // Avoid asking the runtime to recover an expired credential while doing a metadata-only read.
  const parts = saved.tokens.access_token.split('.');
  if (parts.length !== 3) throw unavailable();
  const expiry = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')).exp;
  if (!Number.isSafeInteger(expiry) || expiry * 1000 <= Date.now() + 60_000) throw unavailable();
  const configs = JSON.parse(execFileSync('python3', ['-c', CONFIG, codexHome, cwd], { timeout: 2000, maxBuffer: 16_384, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' })) as string[];
  const configHashes = configs.map(file => [file, hash(bounded(file))]);
  const entry = (process.env.PATH ?? '').split(path.delimiter).map(dir => path.join(dir, 'codex')).find(file => existsSync(file));
  if (!entry) throw unavailable();
  const wrapper = realpathSync(entry), pkgFile = path.resolve(path.dirname(wrapper), '../package.json');
  const pkgText = bounded(pkgFile), pkg = JSON.parse(pkgText), platformName = `@openai/codex-${process.platform}-${process.arch}`;
  if (pkg.name !== '@openai/codex' || !/^\d+\.\d+\.\d+$/.test(pkg.version)) throw unavailable();
  const nativePkgFile = createRequire(pkgFile).resolve(`${platformName}/package.json`), nativeText = bounded(nativePkgFile), native = JSON.parse(nativeText);
  const triple = process.platform === 'darwin' ? `${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}-apple-darwin` : process.platform === 'linux' ? `${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}-unknown-linux-musl` : '';
  if (!triple || !['arm64', 'x64'].includes(process.arch) || native.version !== `${pkg.version}-${process.platform}-${process.arch}`) throw unavailable();
  const nativeRoot = path.join(path.dirname(nativePkgFile), 'vendor', triple), layoutText = bounded(path.join(nativeRoot, 'codex-package.json')), layout = JSON.parse(layoutText);
  if (layout.version !== pkg.version || layout.target !== triple || layout.variant !== 'codex' || layout.layoutVersion !== 1 || typeof layout.entrypoint !== 'string' || layout.entrypoint.split('/').some((p: string) => !p || p === '..' || p === '.')) throw unavailable();
  const executable = path.join(nativeRoot, layout.entrypoint), info = lstatSync(executable);
  if (realpathSync(executable) !== executable || !info.isFile() || !(info.mode & 0o111) || info.mode & 0o022 || info.size > 512 * 1024 * 1024) throw unavailable();
  const executableHash = hash(readFileSync(executable));
  const target: QuotaTarget = { hostId: `local:${hostname()}:${process.getuid?.()}`, accountId: saved.tokens.account_id, model: context.model, limitId: 'codex' };
  const args = ['-m', context.model, '-c', 'features.multi_agent=false', '-c', 'features.multi_agent_v2=false', 'app-server', '--listen', 'stdio://'];
  // No inherited API keys, routing proxy or other agent's runtime context.
  const env = { HOME: home, USER: process.env.USER, PATH: process.env.PATH ?? '/usr/bin:/bin', LANG: process.env.LANG ?? 'en_US.UTF-8', HERDR_ENV: '0' };
  const fingerprint = hash(JSON.stringify({ target, cwd, codexHome, routing: hash(routing), auth: hash(auth), configHashes, wrapper, wrapperHash: hash(bounded(wrapper)), pkg: hash(pkgText), native: hash(nativeText), layout: hash(layoutText), executable, executableHash, env }));
  return { target, fingerprint, executable, args, cwd, env };
}

/** Only the three allowlisted metadata requests can be written; all stderr and provider errors stay private. */
export async function probeCodexQuota(binding: CodexLaunchBinding, signal: AbortSignal, timeoutMs = 4500): Promise<QuotaReading> {
  if (signal.aborted || !Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 4500) throw unavailable();
  const child = spawn(binding.executable, binding.args, { cwd: binding.cwd, env: binding.env, stdio: ['pipe', 'pipe', 'pipe'] });
  const exited = new Promise<void>(resolve => child.once('close', () => resolve()));
  child.stderr.resume();
  const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  let sequence = 0, buffer = '', received = 0, closed = false;
  const fail = () => { for (const waiter of pending.values()) waiter.reject(unavailable()); pending.clear(); };
  const close = () => { if (!closed) child.kill('SIGKILL'); closed = true; child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy(); fail(); };
  const timer = setTimeout(close, timeoutMs);
  signal.addEventListener('abort', close, { once: true });
  child.on('error', close); child.on('exit', () => { closed = true; fail(); }); child.stdin.on('error', close);
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    received += Buffer.byteLength(chunk); buffer += chunk;
    if (received > 1024 * 1024 || buffer.length > 256 * 1024) { close(); return; }
    let end: number;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      if (!line.trim()) continue;
      try {
        const message = JSON.parse(line);
        if (message.method && message.id != null) { close(); return; } // Never authorize a server-requested mutation.
        const waiter = pending.get(message.id);
        if (waiter) { pending.delete(message.id); if (message.error || !Object.hasOwn(message, 'result')) waiter.reject(unavailable()); else waiter.resolve(message.result); }
      } catch { close(); return; }
    }
  });
  const rpc = (method: 'initialize' | 'account/read' | 'account/rateLimits/read', params: unknown) => new Promise<any>((resolve, reject) => {
    if (closed) return reject(unavailable());
    const id = ++sequence; pending.set(id, { resolve, reject }); child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
  });
  try {
    await rpc('initialize', { clientInfo: { name: 'siso_agent_base_quota', title: 'Agent Base quota reader', version: '1.0.0' }, capabilities: { experimentalApi: true } });
    child.stdin.write(`${JSON.stringify({ method: 'initialized' })}\n`);
    const account = await rpc('account/read', { refreshToken: false });
    if (account?.account?.type !== 'chatgpt') throw unavailable();
    const response = await rpc('account/rateLimits/read', { excludeResetCreditDetails: true });
    return { source: CODEX_QUOTA_SOURCE, hostId: binding.target.hostId, observedAt: Date.now(), stale: false, response };
  } finally {
    clearTimeout(timer); signal.removeEventListener('abort', close); close();
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(unavailable()), 250);
      exited.then(() => { clearTimeout(timer); resolve(); });
    });
  }
}

/** One request gets one binding. Re-resolve independently on every check, including after the child exits. */
export function createCodexQuotaSource(context: Context, options: {
  resolve?: (context: Context) => CodexLaunchBinding;
  probe?: typeof probeCodexQuota;
} = {}) {
  const resolve = options.resolve ?? resolveLocalCodexBinding;
  let original: CodexLaunchBinding | null = null;
  return {
    quotaTarget: () => {
      const current = resolve(context);
      if (original && original.fingerprint !== current.fingerprint) throw unavailable();
      original ??= current;
      return { ...current.target };
    },
    quota: async (target: QuotaTarget, signal: AbortSignal) => {
      const before = resolve(context);
      if (!original || original.fingerprint !== before.fingerprint || JSON.stringify(target) !== JSON.stringify(before.target)) throw unavailable();
      const reading = await (options.probe ?? probeCodexQuota)(before, signal);
      const after = resolve(context);
      if (before.fingerprint !== after.fingerprint) throw unavailable();
      // The current ordinary route is only verified against a sole, explicitly named Codex bucket.
      // A newly introduced specialized bucket requires a model mapping from the launch owner.
      const response = reading.response as any, buckets = response?.rateLimitsByLimitId;
      if (!buckets || Object.keys(buckets).length !== 1 || !Object.hasOwn(buckets, 'codex') ||
          buckets.codex?.limitId !== 'codex' || response.rateLimits?.limitId !== 'codex') throw unavailable();
      return reading;
    },
    /** For the final managed launch gate: pin the same native binary that served the quota read. */
    launchEnvironment: () => {
      const current = resolve(context);
      if (!original || original.fingerprint !== current.fingerprint) throw unavailable();
      return { AB_CODEX_BIN: current.executable };
    },
  };
}

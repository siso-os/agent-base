// Real scheduler/retry/ownership and extracted server adapter; fake quota and service execution only.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, realpathSync, renameSync } from 'node:fs';
import { tmpdir, hostname } from 'node:os';
import path from 'node:path';
import ts from '../../../apps/web/node_modules/typescript/lib/typescript.js';
import { createTaskActionsHandler } from '../src/task-actions.ts';
import { scheduleLaunch } from '../src/agent-launch.ts';
import { acceptLaunch, getWorkspace, save, receiptFile, WorkspaceError } from '../src/worktrees.ts';
import { workspacesRoutes } from '../src/routes/workspaces.area.ts';

const root = path.resolve(import.meta.dirname, '../../..');
const scratch = realpathSync(mkdtempSync(path.join(tmpdir(), '.siso-ephemeral-quota-handoff.')));
const repo = path.join(scratch, 'repo'), stateDir = path.join(scratch, 'allocations'), hosts = path.join(scratch, 'hosts');
for (const dir of [repo, stateDir, hosts, path.join(repo, '.agents'), path.join(scratch, 'receipts')]) mkdirSync(dir, { recursive: true });
process.env.AB_WORKSPACES_DIR = path.join(scratch, 'receipts');
delete process.env.AB_WORKTREE_FIXTURE; delete process.env.AB_CODEX_BIN;
const ordered = v => Array.isArray(v) ? v.map(ordered) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, ordered(v[k])])) : v;
const digest = v => createHash('sha256').update(JSON.stringify(ordered(v))).digest('hex');
const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
git('init', '-q', '-b', 'dev'); git('config', 'user.name', 'Quota fixture'); git('config', 'user.email', 'fixture@example.invalid');
const config = { version: 1, fetch: false, submodules: 'none', setup: [] };
writeFileSync(path.join(repo, '.agents/workspace.json'), JSON.stringify(config)); writeFileSync(path.join(repo, 'fixture.txt'), 'Synthetic quota handoff fixture.\n');
git('add', '.'); git('commit', '-qm', 'Synthetic fixture');
const sha = git('rev-parse', 'HEAD'), common = realpathSync(path.join(repo, '.git'));
const writer = { version: 1, surface: 'fixture', sourceRevision: sha, dossierDigest: 'a'.repeat(64) };
const hostRows = new Map(), receipts = new Map(), commands = [], quotaContexts = [];
let sequence = 0, quotaAllowed = true, checks = 0, scenarios = [];
const check = (name, fn) => { fn(); checks++; console.log(`PASS ${name}`); };
const until = async predicate => { const end = Date.now() + 8000; while (Date.now() < end) { if (predicate()) return; await new Promise(r => setTimeout(r, 20)); } throw Error('Synthetic lifecycle did not settle'); };
const settled = r => until(() => { const saved = getWorkspace(r.workspaceId); return !saved.preparationPid && ['active', 'failed'].includes(saved.phase); });
const allocationFile = taskId => path.join(stateDir, `${digest(taskId)}.json`);
function makeReceipt(kind = 'automatic', changes = {}) {
  const number = ++sequence, taskId = kind === 'automatic' ? `t-fixture-${number}` : undefined;
  const launchId = kind === 'automatic' ? `task-${digest(number).slice(0, 40)}` : `manual-${number}`;
  const input = { launchId, ...(taskId ? { taskId } : {}), name: `Fixture-${number}`, repo, harness: kind === 'claude' ? 'claude' : 'codex', model: kind === 'claude' ? 'opus' : kind === 'automatic' ? 'gpt-6-astra' : 'gpt-6-luna', workspace: { type: 'isolated' }, ...(kind === 'automatic' ? { writer } : {}), ...changes };
  const workspaceId = `ws-${digest(input.taskId ?? input.launchId).slice(0, 24)}`, worktreePath = path.join(scratch, `worktree-${number}`), branch = `codex/fixture-${number}`;
  git('worktree', 'add', '-q', '-b', branch, worktreePath, sha);
  const r = { version: 1, workspaceId, launchId: input.launchId, taskId: input.taskId ?? null, name: input.name, machine: hostname(), repoKey: 'fixture', repoPath: repo, commonGitDir: common, worktreePath, branch, baseRef: 'dev', baseSha: sha, recipeHash: digest(config), inputFingerprint: digest(input), input, config, phase: 'ready', stages: ['validate', 'fetch', 'checkout', 'submodules', 'copy-files', 'setup', 'agent'].map(id => ({ id, status: id === 'agent' ? 'pending' : 'done', startedAt: null, endedAt: null, exitCode: 0, detail: null })), sequence: 0, error: null, agentId: null, agent: null, preparationPid: null, setupPid: null, checkoutAttempted: true, handoffAttempted: false };
  save(r); receipts.set(r.name, r);
  if (kind === 'automatic') writeFileSync(allocationFile(r.taskId), JSON.stringify({ version: 1, taskId: r.taskId, expectedRevision: 'b'.repeat(64), taskRevision: 'c'.repeat(64), idempotencyKey: r.launchId, input, workspaceId, accepted: true, boardUpdated: false, createdAt: new Date().toISOString() }), { mode: 0o600 });
  return r;
}
function publishHost(r) {
  const file = path.join(hosts, `${r.name}.json`); writeFileSync(file, JSON.stringify({ workspaceId: r.workspaceId }));
  hostRows.set(r.name, { name: r.name, state: 'live', session: `session-${r.workspaceId}`, cwd: r.worktreePath, file });
}
const executor = async (command, args, options) => {
  const name = args[args.indexOf('--name') + 1], r = receipts.get(name);
  assert.ok(r, 'Only fixture receipts may reach the fake executor'); commands.push({ command, args, env: options.env, name }); publishHost(r); return {};
};

// Extract the actual adapter object, leaving the full server and its listeners unstarted.
const source = readFileSync(path.join(root, 'services/node/src/server.ts'), 'utf8');
const ast = ts.createSourceFile('server.ts', source, ts.ScriptTarget.Latest, true);
let initializer;
for (const statement of ast.statements) if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) if (declaration.name.getText(ast) === 'workspaceAdapters') initializer = declaration.initializer.getText(ast);
assert.ok(initializer);
const code = ts.transpileModule(`const adapters = ${initializer.replaceAll('import.meta.dirname', JSON.stringify(path.join(root, 'services/node/src')))};`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
let taskActions;
const values = {
  taskActions: { automaticAllocationOwnership: r => taskActions.automaticAllocationOwnership(r) },
  currentResourceAdmission: async context => { quotaContexts.push(context); return quotaAllowed ? { ok: true, launchEnvironment: { AB_CODEX_BIN: '/fixture/pinned-codex' } } : { ok: false, reason: 'Synthetic quota exhausted' }; },
  listServiceHosts: async () => [...hostRows.values()], HOSTS_DIR: hosts, path, readFileSync, listAgents: async () => [], WorkspaceError,
  process, fixtureHosts: new Set(), spawn: () => { throw Error('A real process is forbidden'); }, run: executor,
  receiptClaudeProfile: () => ({ loginLauncher: 'fixture-claude', permissionMode: 'default' }), configuredClaudeProfile: () => { throw Error('Unexpected fallback'); }, NEW_AGENT_CLAUDE_DIR: '/fixture/claude',
  startSupervisedClaude: async (r, _file, _profile, execute) => { await execute({ command: '/fixture/claude-service', args: ['--name', r.name], env: { CLAUDE_CONFIG_DIR: '/fixture/claude' } }); return { label: `fixture-${r.name}` }; },
};
const adapters = new Function(...Object.keys(values), `${code}\nreturn adapters;`)(...Object.values(values));
taskActions = createTaskActionsHandler({ read: async () => null, write: async () => { throw Error('No board writes in this fixture'); }, projects: () => [], adapters, admit: async () => { throw Error('Readiness is not part of this handoff fixture'); }, stateDir });
const routes = workspacesRoutes({ ALLOWED_ORIGINS: new Set(), HOSTS_DIR: hosts, json: (response, status, body) => { Object.assign(response, { status, body }); return true; }, listAgents: async () => [], registry: { projects: [] }, workspaceAdapters: adapters });
const retry = async r => { const response = {}; await routes.handle({ method: 'POST', headers: {} }, response, [], new URL(`http://fixture/api/workspaces/${r.workspaceId}/retry`)); assert.equal(response.status, 202); return response; };

const automatic = makeReceipt(); quotaAllowed = false;
scheduleLaunch(automatic, adapters); await settled(automatic);
check('quota denial invokes no service', () => assert.equal(commands.length, 0));
check('denial leaves handoff unattempted', () => assert.equal(getWorkspace(automatic.workspaceId).handoffAttempted, false));
check('denial leaves agent stage pending', () => assert.equal(getWorkspace(automatic.workspaceId).stages.at(-1).status, 'pending'));
check('preflight uses actual prepared worktree', () => assert.deepEqual(quotaContexts[0], { repo: automatic.worktreePath, model: automatic.input.model }));
quotaAllowed = true; await retry(automatic); await settled(automatic);
check('general retry rechecks automatic quota', () => assert.equal(quotaContexts.length, 2));
check('retry after denial starts exactly once', () => assert.equal(commands.length, 1));
check('exact ephemeral executable pin reaches service', () => assert.equal(commands[0].env.AB_CODEX_BIN, '/fixture/pinned-codex'));
check('pin is never persisted in receipt', () => assert.equal(readFileSync(receiptFile(automatic.workspaceId), 'utf8').includes('/fixture/pinned-codex'), false));
scenarios.push('Automatic denial then allowed direct workspace retry with exact pin');

for (const [kind, changes] of [['manual', {}], ['manual', { backendCatalogId: 'retained-fixture-version' }], ['claude', {}]]) {
  const r = makeReceipt(kind, changes), before = quotaContexts.length;
  scheduleLaunch(r, adapters); await settled(r);
  const command = commands.at(-1);
  check(`${kind} ${changes.backendCatalogId ?? ''} skips automatic quota`, () => assert.equal(quotaContexts.length, before));
  check(`${kind} keeps its unpinned launch environment`, () => assert.equal(command.env.AB_CODEX_BIN, undefined));
  check(`${kind} starts the selected fixture`, () => assert.equal(command.name, r.name));
  if (changes.backendCatalogId) check('catalog selection retained on immutable receipt', () => assert.equal(getWorkspace(r.workspaceId).input.backendCatalogId, changes.backendCatalogId));
  if (kind === 'claude') check('Claude profile preserved', () => assert.equal(command.env.CLAUDE_CONFIG_DIR, '/fixture/claude'));
}
scenarios.push('Manual non-astra, catalog-selected and Claude unchanged');

let beforeQuota = quotaContexts.length, beforeCommands = commands.length;
await retry(automatic); await new Promise(r => setTimeout(r, 30));
check('active retry has no new quota probe', () => assert.equal(quotaContexts.length, beforeQuota));
check('active retry has no duplicate start', () => assert.equal(commands.length, beforeCommands));
const ambiguous = makeReceipt(); ambiguous.phase = 'starting'; ambiguous.handoffAttempted = true; save(ambiguous);
let finds = 0;
scheduleLaunch(ambiguous, { ...adapters, find: async () => ++finds > 1 ? { id: 'existing-host', session: 'existing-session' } : null }); await settled(ambiguous);
check('ambiguous prior handoff reconciles without probe', () => assert.equal(quotaContexts.length, beforeQuota));
check('ambiguous prior handoff never repeats start', () => assert.equal(commands.length, beforeCommands));
scenarios.push('Active and ambiguous existing handoffs preserve no-repeat behavior');

const reusedInput = { ...automatic.input, workspace: { type: 'existing', workspaceId: automatic.workspaceId } }; delete reusedInput.writer;
const reused = await acceptLaunch(reusedInput);
check('manual reuse retains original writer', () => assert.deepEqual(reused.input.writer, writer));
check('manual reuse retains automatic ownership', () => assert.equal(reused.launchId, automatic.launchId));
await adapters.beforeStart(reused, receiptFile(reused.workspaceId));
check('reused automatic receipt still gates', () => assert.equal(quotaContexts.length, beforeQuota + 1));
const claimed = makeReceipt('manual', { taskId: 't-manual-claim', launchId: `task-${'d'.repeat(40)}` });
const count = quotaContexts.length; scheduleLaunch(claimed, adapters); await settled(claimed);
check('browser-shaped task identity alone is ordinary', () => assert.equal(quotaContexts.length, count));
scenarios.push('Retained reuse provenance and no trust in browser task labels');

for (const condition of ['missing-record', 'unreadable-record', 'different-input', 'different-workspace', 'auto-catalog']) {
  const r = makeReceipt('automatic', condition === 'auto-catalog' ? { backendCatalogId: 'contradictory-catalog' } : {}), file = allocationFile(r.taskId);
  if (condition === 'missing-record') renameSync(file, `${file}.preserved`);
  if (condition === 'unreadable-record') { writeFileSync(`${file}.preserved`, readFileSync(file)); writeFileSync(file, '{'); }
  if (condition === 'different-input') { const record = JSON.parse(readFileSync(file)); record.input = { ...record.input, model: 'gpt-6-sol' }; writeFileSync(file, JSON.stringify(record)); }
  if (condition === 'different-workspace') { r.workspaceId = `ws-${'f'.repeat(24)}`; save(r); }
  const calls = commands.length, probes = quotaContexts.length;
  scheduleLaunch(r, adapters); await settled(r);
  check(`${condition} denies before a provider read`, () => assert.equal(quotaContexts.length, probes));
  check(`${condition} invokes no service`, () => assert.equal(commands.length, calls));
  check(`${condition} remains safely unattempted`, () => assert.equal(getWorkspace(r.workspaceId).handoffAttempted, false));
}
scenarios.push('Lost, unreadable, mismatched and catalog-conflicting automatic provenance denied');
console.log(JSON.stringify({ ok: true, checks, scenarios, scratch, serviceCommandsSimulated: commands.length, quotaReadsSimulated: quotaContexts.length, realQuotaReads: 0, realAgentLaunches: 0 }));

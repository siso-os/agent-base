/** Migration parity against the immutable installed baseline. No server boot, real files, agents or network calls. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import path from 'node:path';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import ts from '../../../apps/web/node_modules/typescript/lib/typescript.js';
import { dispatchRoute } from '../src/routes/registry.ts';
import { migrateAgentPins, needsPinRows, projectAgentPins } from '../src/agent-pins.ts';

import { isClaudeAgent, validCompactAt } from '../src/compact-at.ts';

const root = path.resolve(import.meta.dirname, '../../..');
const baseline = execFileSync('git', ['show', '25e5837c:services/node/src/server.ts'], { cwd: root, encoding: 'utf8', maxBuffer: 2_000_000 });
const current = readFileSync(path.join(root, 'services/node/src/server.ts'), 'utf8');
function callback(source) {
  const ast = ts.createSourceFile('server.ts', source, ts.ScriptTarget.Latest, true);
  let found;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'server' && node.initializer && ts.isCallExpression(node.initializer)) found = node.initializer.arguments[0].getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(found, 'HTTP callback found');
  return found;
}
function script(source, filename) {
  // Only the dynamic feedback import needs substitution; every other effect is a named fixture dependency.
  source = source.replace(/\(await import\("\.\.?\/feedback\.ts"\)\)\.feedback/g, 'fixtureFeedback');
  return new vm.Script(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, { filename });
}
const beforeScript = script('handler = ' + callback(baseline), 'installed-http-dispatch');
const afterScript = script('handler = ' + callback(current), 'extracted-http-dispatch');
const routeDirectory = path.join(root, 'services/node/src/routes');
const areaFiles = readdirSync(routeDirectory).filter(file => file.endsWith('.area.ts')).sort();
function withoutImports(source) {
  const ast = ts.createSourceFile('area.ts', source, ts.ScriptTarget.Latest, true);
  return ast.statements.filter(n => !ts.isImportDeclaration(n)).map(n => n.getText(ast).replace(/^export /, '')).join('\n');
}
const areaScripts = areaFiles.map(file => script(withoutImports(readFileSync(path.join(routeDirectory, file), 'utf8')), file));
const miniAgentsScript = script(withoutImports(readFileSync(path.join(root, 'services/node/src/mini-agents.ts'), 'utf8')), 'mini-agents');
const registration = script(withoutImports(readFileSync(path.join(routeDirectory, 'builtin.ts'), 'utf8')), 'builtin-registration');
const versionLine = { source: { ref: 'HEAD', sha: 'a'.repeat(40) }, preview: { ref: 'refs/preview', sha: 'b'.repeat(40) }, live: { ref: 'refs/live', sha: 'c'.repeat(40) }, layers: { web: 'c'.repeat(40), node: 'unknown' } };
const fixedNow = Date.parse('2026-10-06T04:00:00Z');
class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : [fixedNow])); } static now() { return fixedNow; } }
class Response extends EventEmitter {
  status = null; headers = {}; chunks = []; ended = false;
  writeHead(status, headers) { this.status = status; this.headers = headers; return this; }
  write(chunk) { this.chunks.push(String(chunk)); return true; }
  end(chunk) { if (chunk !== undefined) this.chunks.push(String(chunk)); this.ended = true; this.emit('finish'); return this; }
}
const clean = value => JSON.parse(JSON.stringify(value));
function fixture(overrides = {}) {
  const effects = [], timers = new Set(), files = new Map();
  const hit = (name, result) => (...args) => { effects.push([name, clean(args)]); return typeof result === 'function' ? result(...args) : result; };
  const row = { id: 'a1', key: 'laptop/Fixture', name: 'Fixture', tool: 'claude', session: 's1', pane: 'p1', cwd: '/fixture/repo', row: 'live', pages: [], pinned: false };
  const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
  const d = {
    Buffer, URL, Error, TypeError, SyntaxError, Set, Map, Date: FixedDate,
    isClaudeAgent, validCompactAt, launchCompactAt: hit('launchCompactAt', undefined), compactAtRows: async rows => rows.map(row => isClaudeAgent(row) ? { ...row, compactAt: 35 } : row),
    migrateAgentPins, needsPinRows, projectAgentPins, randomUUID: () => 'fixture-pin-id',
    process: { env: {} }, console: { log: (...a) => effects.push(['log', ...a]), error: (...a) => effects.push(['error', ...a]) },
    fetch: hit('fetch', Promise.resolve({ ok: true })),
    setInterval: fn => { timers.add(fn); return fn; }, clearInterval: fn => timers.delete(fn),
    path, createHash, randomBytes: n => Buffer.alloc(n), homedir: () => '/fixture',
    promisify: fn => fn,
    execFile: hit('execFile', Promise.resolve({ stdout: '' })),
    existsSync: file => files.has(file), statSync: file => ({ isFile: () => files.has(file) }),
    readFileSync: file => { if (!files.has(file)) throw Error('fixture file missing'); return files.get(file); },
    mkdirSync: hit('mkdir', undefined), writeFileSync: hit('write', undefined), appendFileSync: hit('append', undefined),
    createReadStream: file => ({ pipe: res => { effects.push(['stream', file]); res.end('fixture image'); } }),
    inFlight: new Map(), json, dispatchRoute,
    readBody: async (req, limit = 64000) => { if (req.fixtureBody.length > limit) throw Error('body too large'); return req.fixtureBody; },
    ALLOWED_ORIGINS: new Set(['http://app']), APP_ROOT: '/fixture/app', BOOT_SHA: 'fixture-boot',
    BROWSER_HISTORY: '/fixture/browser-history', BROWSER_STATE: '/fixture/browser-state',
    HERDR: ['fixture-herdr'], HOSTS_DIR: '/fixture/hosts', IMAGE_EXT: { 'image/png': 'png' },
    LIFE: {}, MACHINE: 'Fixture machine', MACHINE_KEY: 'fixture', SELECTION_LOG: '/fixture/selection.jsonl',
    TYPES: { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png' }, UPLOADS: '/fixture/uploads', WEB_DIST: '/fixture/dist', WHATSAPP: {},
    A0_TASKS_ROOT: '/fixture/tasks', zeroStarting: false,
    registry: { agents: { Fixture: { project: 'p1' } }, projects: [{ id: 'p1', name: 'Fixture project', path: '/fixture/repo', order: 0 }], domains: ['Fixture project'], workspaces: [{ id: 'lab' }], aliases: {}, pinned: [], pinRefs: [], pinnedPages: [], recentPages: [] },
    registryStore: { fresh() { effects.push(['registry.fresh']); } },
    rows: { order: ['laptop/Other'], projectOrder: [] },
    keyOf: new Map([['a1', 'laptop/Fixture']]), nameOf: new Map([['a1', 'Fixture']]),
    paneOf: new Map([['a1', 'p1']]), sessionOf: new Map([['a1', 's1']]), cwdOf: new Map([['a1', '/fixture/repo']]),
    listAgents: hit('listAgents', async () => [row]), listEnded: hit('listEnded', []),
    act: hit('act', true), addProject: hit('addProject', undefined), edit: hit('edit', null),
    freshRows: hit('freshRows', undefined), saveRows: hit('saveRows', undefined), saveRegistry: hit('saveRegistry', undefined), placeNew: hit('placeNew', undefined),
    herdr: hit('herdr', Promise.resolve('fixture terminal text')), run: hit('run', Promise.resolve({})),
    machines: hit('machines', []), liveOrg: hit('liveOrg', Promise.resolve({ groups: [] })),
    deliveredWork: hit('deliveredWork', { deliveries: [] }), remoteInventory: {},
    a0Tasks: hit('a0Tasks', Promise.resolve({ status: 200, body: { tasks: [] } })),
    a0TaskWrite: hit('a0TaskWrite', Promise.resolve({ status: 200, body: { ok: true } })),
    a0TaskEvents: (_req, res) => { effects.push(['taskEvents']); res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write('data: fixture\n\n'); },
    a0Transcript: { page: hit('transcript.page', Promise.resolve({ turns: [] })), intent: hit('transcript.intent', null) },
    taskActions: { readiness: hit('task.readiness', Promise.resolve({ status: 200, body: { ready: true } })), allocate: hit('task.allocate', Promise.resolve({ status: 202, body: { ok: true } })) },
    attention: { healthy: true, settings: () => ({}), configure: hit('attention.configure', {}), list: () => [], get: id => id === 'n1' ? { id } : null, mark: hit('attention.mark', true) },
    readAttentionRequest: hit('attention.request', Promise.resolve({ choices: [] })), executeAttentionCommand: hit('attention.command', Promise.resolve({ status: 'queued' })),
    changes: {},
    spaces: { read: hit('spaces.read', { pins: [] }), patch: hit('spaces.patch', []), addPin: hit('spaces.pin', { id: 'pin' }) },
    resolveSpace: hit('resolveSpace', { key: 'p1', id: 'p1', name: 'Fixture project', repo: '/fixture/repo' }), spaceAgents: () => [],
    orgMigrate: x => x, orgReaders: () => ({ clients: async () => [], industries: async () => [] }), agencyFolders: () => [], orgApply: x => x,
    agentNavigation: rows => rows, navFromRecords: rows => rows, codexWorkerRows: () => [], readRunParents: () => [], codexWorkers: () => [],
    fleetJobOutput: hit('fleet.output', Promise.resolve(null)), fleetManifests: async () => ({ manifests: [], miniEnabled: false }), groupFleet: () => [], readDispatch: () => ({}),
    listSubagents: () => ({ rows: [] }), fleetRuns: () => [], subagentEvents: () => null,
    defaultClaudeDir: () => '/fixture/claude', usageDirectories: () => ['/fixture/claude'], claudeUsage: { get: () => null, refresh: hit('claudeUsage.refresh', Promise.resolve()) },
    readVersion: () => ({ boot: 'fixture' }), readVersionLine: () => versionLine, gitSha: () => 'fixture-head', changesSince: () => [], changesWithAreas: () => [], notesFile: () => '/fixture/notes', readNotes: () => [], noteFor: () => null,
    readPad: () => ({ items: [] }), applyPad: hit('applyPad', { ok: true }),
    readBrowserState: () => ({ tabs: [] }), cleanState: state => state && typeof state === 'object' ? state : null,
    writeBrowserState: hit('browser.write', undefined), mergeBrowserState: hit('browser.merge', undefined),
    readBrowserImport: () => ({ spaces: [] }), readHistory: () => [], saveHistory: hit('history.save', undefined), importCounts: () => ({ spaces: 0 }),
    downloadInfo: () => null, downloadFile: () => null, canOpen: () => false, reach: hit('reach', Promise.resolve({ reachable: false })), suggest: () => [],
    rolodexList: () => [], whatsappPeople: async () => [], rolodexContacts: () => [], rolodexSources: () => [], rolodexEveryone: () => [], rolodexLookup: () => null,
    whatsappProxy: async (_req, res, _url, _config, fromApp, body) => { effects.push(['whatsapp', fromApp, body]); json(res, 200, { fixture: 'whatsapp' }); },
    lifeProxy: async (_req, res, _url, _config, fromApp, body) => { effects.push(['life', fromApp, body]); json(res, 200, { fixture: 'life' }); },
    openApp: hit('openApp', Promise.resolve({ status: 200, ok: true })), revealBuilding: hit('reveal', Promise.resolve({ status: 200, ok: true })),
    MOVE_TARGETS: ['codex'], MOVE_EFFORTS: ['high'], moveStatus: () => null, moveAgent: hit('move', Promise.resolve({ state: 'done' })),
    accountSwitchDeps: options => ({ hostsDir: options.hostsDir }), accountSwitchError: to => ['claude-siso', 'claude-siso-3'].includes(to) ? null : 'Choose one of the Claude accounts',
    accountSwitchStatus: name => name === 'Fixture' && effects.some(e => e[0] === 'switchAccount') ? { state: 'queued', message: 'Queued', to: 'claude-siso', stages: ['Queued'] } : null,
    accountSwitching: () => false, accountSwitchBlocked: async () => null, switchAccount: hit('switchAccount', Promise.resolve({ state: 'done' })),
    listNotifications: async () => [], markNotification: hit('notification.mark', Promise.resolve()), notificationReact: () => ({ target: { kind: 'chat' }, text: 'fixture reaction' }), notificationReply: () => ({ target: { kind: 'chat' }, text: 'fixture reply' }),
    hubCached: async (_key, read) => read(), hubHome: {}, hubRows: async () => [], buildHubAgents: async () => [], buildHubA0: async () => ({ needsYou: [] }), buildHubProject: async () => null, buildHubOrg: async () => ({}), buildOrgTour: () => ({}), spendToday: async () => null,
    tellA0: hit('tellA0', Promise.resolve({ ok: true })), readAsks: async () => [], readReviewsCached: async () => [], openedReview: hit('openedReview', Promise.resolve()),
    createBoardWriter: () => hit('board.write', Promise.resolve({ status: 200, body: { ok: true } })), readBoard: async () => ({ lanes: {} }), readSpec: async () => null,
    readTasks: () => [], isPrivatePath: () => false, buildEntityPage: async () => ({}), thumbPath: () => null,
    uploadPath: () => null,
    getWorkspace: hit('getWorkspace', { sequence: 1, name: 'Fixture', input: {} }), snapshot: x => x, retryLaunch: hit('retryLaunch', { ok: true }), cancelPreparation: hit('cancelPreparation', true), archiveWorkspace: hit('archiveWorkspace', Promise.resolve({ archived: true })),
    workspaceAdapters: {}, listServiceHosts: async () => [], launchRepo: () => '/fixture/repo', launchAgent: hit('launchAgent', Promise.resolve({ accepted: true })),
    claudeLaunchProfile: () => ({ version: 1, loginLauncher: 'claude-siso-3', permissionMode: 'bypassPermissions' }),
    safeName: name => { if (typeof name !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(name)) throw Error('bad name'); return name; },
    fromWords: () => ({ name: 'Fixture', project: 'p1' }), startZero: hit('startZero', Promise.resolve({ ok: true })), startAgent: hit('startAgent', Promise.resolve({ ok: true })), moveToHost: hit('moveToHost', Promise.resolve(null)),
    sayTo: hit('sayTo', Promise.resolve({ ok: true })), talkTo: hit('talkTo', Promise.resolve({ ok: true })), forkChat: hit('forkChat', Promise.resolve({ ok: true })),
    sessionFile: () => '/fixture/session', contextMix: () => ({ used: 5 }), galleryFile: () => null,
    pipelineMoments: () => ({ pending: [], landed: [], unavailable: [] }), dayMoments: () => ({ events: [] }), timelineOf: async () => [], taskMoves: () => [], findSession: () => '/fixture/session', statsOf: async () => ({ tokens: 1 }), readHud: () => ({ costUsd: 0 }),
    sendStatic: async (_req, res, file, type, cache) => { effects.push(['static', file]); res.writeHead(200, { 'content-type': type, 'cache-control': cache }); res.end('fixture static'); },
    worldBody: () => ({ key: 'fixture-world', raw: Buffer.from('raw'), br: Buffer.from('br'), gz: Buffer.from('gzip') }),
    fixtureFeedback: async (_req, res) => json(res, 201, { fixture: 'feedback' }),
    ROUTES: [{ method: 'GET', path: /^\/api\/loaded$/, handle: (_req, res) => json(res, 200, { loaded: true }) }],
  };
  d.ChangesError = class extends Error { constructor(code, message, status = 409) { super(message); this.code = code; this.status = status; } };
  d.WorkspaceError = class extends Error { constructor(message, code = 400) { super(message); this.code = code; } };
  for (const method of ['preview','file','turns','comments','deliveries','createComment','resolveComment','dispatchReviewFeedback','turnBoundary']) d.changes[method] = hit('changes.' + method, Promise.resolve({ fixture: method }));
  d.remoteInventoryRoute = () => async (_req, _res, url) => { effects.push(['remote.probe', url.pathname]); return false; };
  d.handleProductMap = async (_req, res, options) => { effects.push(['productMap', clean(options)]); json(res, 200, { rows: [] }); return true; };
  for (const name of ['handleReleases','handleLanding','handleDictation','handleVoice','handleMiniLanes','handleServers','handleLaunchd','handleCodexLanes','handleA0Now','handleResearch','handleTokens','handleTokensMoney','handleUsage','handleShip','handleSpend']) d[name] = async (_req, _res, url) => { effects.push([name, url.pathname]); return false; };
  // Releases is synchronous in the production dispatch.
  d.handleReleases = (_req, _res, url) => { effects.push(['handleReleases', url.pathname]); return false; };
  // Routes yield to the event loop between heavy steps (/api/fleet-board, t-0539).
  d.setImmediate ??= setImmediate;
  Object.assign(d, overrides);
  return { d, effects, timers, files, row };
}
async function run(spec, after) {
  const f = fixture(spec.overrides);
  spec.configure?.(f);
  const context = vm.createContext(f.d);
  if (after) {
    for (const module of areaScripts) module.runInContext(context);
    miniAgentsScript.runInContext(context);
    registration.runInContext(context);
    context.HTTP_ROUTES = context.builtinRoutes(context);
  }
  (after ? afterScript : beforeScript).runInContext(context);
  const body = spec.body === undefined ? '' : typeof spec.body === 'string' ? spec.body : JSON.stringify(spec.body);
  const req = Readable.from([Buffer.from(body)]);
  req.url = spec.url; req.method = spec.method ?? 'GET'; req.headers = spec.headers ?? {}; req.fixtureBody = body;
  const res = new Response();
  await context.handler(req, res);
  const timersBeforeClose = f.timers.size;
  for (const fn of f.timers) fn(); // unchanged snapshots must not emit duplicates.
  req.emit('close'); res.emit('close');
  assert.equal(f.timers.size, 0, 'stream timer is released on close');
  assert.equal(f.d.inFlight.size, 0, 'request accounting is released on close');
  const result = clean({ status: res.status, headers: res.headers, body: res.chunks.join(''), ended: res.ended, effects: f.effects, timersBeforeClose, zeroStarting: f.d.zeroStarting });
  assert.ok(!result.body.includes('is not defined'), `Missing fixture dependency: ${spec.url}: ${result.body}`);
  return result;
}
const cases = [
  ['/api/health', 200], ['/api/agents', 200], ['/api/org', 200], ['/api/workspace-registry', 200], ['/api/workspace-logos/missing', 404], ['/api/fleet-board', 200], ['/api/fleet-board/output?id=missing', 404], ['/api/codex-workers/missing', 404],
  ['/api/delight', 400], ['/api/delight?agent=a1', 200], ['/api/delight?agent=missing', 409], ['/api/product-map', 200], ['/api/version', 200], ['/api/version/changes?since=abcdef01', 200], ['/api/scratchpad', 200], ['/api/claude-usage', 200],
  ['/api/browser/state', 200], ['/api/browser/import', 200], ['/api/browser/blank', 200], ['/api/browser/suggest?q=fixture', 200],
  ['/api/rolodex', 200], ['/api/rolodex/sources', 200], ['/api/rolodex/everyone?limit=bad', 200], ['/api/rolodex/lookup', 400], ['/api/rolodex/lookup?q=fixture', 200], ['/api/whatsapp/health', 200], ['/api/life/health', 200],
  ['/api/agents/a1/move', 200], ['/api/agents/a1/notifications', 200], ['/api/hub/agents', 200], ['/api/hub/project/p1', 404], ['/api/hub/a0', 200], ['/api/hub/org', 200], ['/api/org/tour', 200],
  ['/api/a0/tasks/events', 200], ['/api/a0/transcript', 200], ['/api/a0/intent/missing', 404], ['/api/a0/tasks/t-1/actions', 200], ['/api/a0/tasks/t-1/allocate', 405], ['/api/a0/tasks', 200], ['/api/asks', 200], ['/api/reviews', 200],
  ['/api/tasks?project=p1', 200], ['/api/tasks?project=missing', 404], ['/api/org/project/missing', 404], ['/api/org/thumb?folder=p1&file=x.png', 404], ['/api/uploads/missing.png', 404],
  ['/api/workspaces/repos', 200], ['/api/workspaces/ws-1', 200], ['/api/workspaces/ws-1/events', 200], ['/api/workspaces/ws-1/archive', 405], ['/api/ended?limit=7', 200], ['/api/machines', 200],
  ['/api/agents/a1/subagents', 200], ['/api/agents/missing/subagents', 404], ['/api/agents/a1/subagents/missing', 404], ['/api/agents/a1/context', 200],
  ['/api/timeline/gallery/missing.png', 404], ['/api/pipeline?agent=a1', 200], ['/api/timeline?agent=a1&day=2026-10-06', 200], ['/api/timeline?agent=a1&day=2026-02-30', 400], ['/api/agents/a1/timeline', 200], ['/api/agents/a1/stats', 200], ['/api/agents/a1/read?lines=9', 200],
  ['/api/attention/settings', 200], ['/api/attention', 200], ['/api/attention/n1', 200], ['/api/attention/n1/request', 200], ['/api/attention/missing', 404],
  ['/api/agents/a1/changes?sessionId=s1', 200], ['/api/agents/a1/changes/files/f1?sessionId=s1', 200], ['/api/agents/a1/changes/turns', 200], ['/api/agents/a1/changes/comments', 200], ['/api/agents/a1/changes/feedback/r1', 200], ['/api/agents/a1/changes/invalid', 405],
  ['/api/spaces/p1', 200], ['/api/spaces/p1/layout', 405], ['/estate-world', 404], ['/api/loaded', 200], ['/api/unknown', 404],
].map(([url, expected]) => ({ url, expected }));
for (const [url, body, expected, method = 'POST'] of [
  ['/api/browser/diagnostic', { command: 'bad' }, 400], ['/api/browser/diagnostic', { command: 'browser_open', status: 'ok', tab: 'fixture' }, 200],
  ['/api/feedback', {}, 201], ['/api/scratchpad', {}, 200], ['/api/claude-usage', {}, 200],
  ['/api/open', {}, 400], ['/api/open', { url: 'https://example.test' }, 200],
  ['/api/browser/state', null, 400, 'PUT'], ['/api/browser/state', { tabs: [] }, 200, 'PUT'], ['/api/browser/state', { tabs: [] }, 200, 'PATCH'],
  ['/api/browser/import', {}, 200], ['/api/browser/chrome-passwords', {}, 200], ['/api/browser/reveal-download', {}, 404], ['/api/browser/download-info', {}, 404], ['/api/browser/open-download', {}, 404],
  ['/api/browser/reach', { url: 'https://example.test' }, 200], ['/api/browser/open-in-chrome', { url: 'file:///secret' }, 400], ['/api/browser/open-in-chrome', { url: 'https://example.test' }, 200],
  ['/api/library/open-app', { id: 'fixture' }, 200], ['/api/library/reveal', { postcode: 'fixture' }, 200],
  ['/api/agents/a1/move', { to: 'bad' }, 400], ['/api/agents/a1/move', { to: 'codex', effort: 'high' }, 200],
  ['/api/agents/a1/notifications/n1', { read: true }, 200], ['/api/agents/a1/notifications/n1/reply', { text: 'fixture' }, 200],
  ['/api/selection', {}, 400], ['/api/selection', { cause: 'click', from: 'a1', to: 'a2', at: fixedNow }, 200],
  ['/api/a0/tell', { text: 'fixture' }, 200], ['/api/a0/tasks/t-1', '{bad', 400], ['/api/a0/tasks/t-1', { stage: 'done' }, 200], ['/api/a0/tasks/t-1/allocate', {}, 202],
  ['/api/reviews/r1/opened', {}, 200], ['/api/registry', {}, 200], ['/api/order', { ids: ['a1'] }, 200], ['/api/order', { projects: [5] }, 400], ['/api/order', { projects: ['p1'] }, 200], ['/api/agents/a1/seen', {}, 200],
  ['/api/uploads', 'fixture', 415], ['/api/workspaces/ws-1/retry', {}, 202], ['/api/workspaces/ws-1/cancel', {}, 200], ['/api/workspaces/ws-1/archive', {}, 200],
  ['/api/agents/start-codex', {}, 400], ['/api/agents/start-codex', { name: 'A0', model: 'fixture' }, 400], ['/api/agents/start-codex', { name: 'Fixture', model: 'fixture' }, 202], ['/api/agents/start-zero', {}, 200], ['/api/agents/start', '{bad', 400], ['/api/agents/start', {}, 200], ['/api/agents/start', { launchId: 'l1', name: 'Fixture' }, 202],
  ['/api/agents/a1/to-host', {}, 200], ['/api/agents/say', {}, 400], ['/api/agents/say', { name: 'Fixture', text: 'fixture' }, 200], ['/api/agents/a1/subagents/run1/talk', {}, 200], ['/api/agents/a1/fork', { back: 2 }, 200],
  ['/api/attention/settings', {}, 200], ['/api/attention/n1/read', {}, 200], ['/api/attention/n1/command', {}, 200],
  ['/api/changes/turns', {}, 403], ['/api/agents/a1/changes/comments', {}, 201], ['/api/agents/a1/changes/comments/c1/resolve', {}, 200], ['/api/agents/a1/changes/feedback', {}, 202],
  ['/api/spaces/p1/layout', {}, 200, 'PUT'], ['/api/spaces/p1/pins', {}, 201],
]) cases.push({ url, body, expected, method });

for (const spec of cases) test(`${spec.method ?? 'GET'} ${spec.url}`, async () => {
  const before = await run(spec, false), after = await run(spec, true);
  assert.equal(before.status, spec.expected, `baseline fixture status: ${before.body}`);
  if (spec.url === '/api/agents/start' && spec.body?.launchId) {
    const input = after.effects.find(effect => effect[0] === 'launchAgent')?.[1]?.[0];
    assert.deepEqual(input?.claudeProfile, { version: 1, loginLauncher: 'claude-siso-3', permissionMode: 'bypassPermissions' });
    delete input.claudeProfile; // Intentional new server-owned fingerprint field; all other dispatch behavior remains equal.
  }
  if (spec.url === '/api/version') {
    const response = JSON.parse(after.body);
    assert.deepEqual(response.line, versionLine);
    delete response.line; // Explicit additive provenance field; retain every legacy response and dispatch assertion.
    after.body = JSON.stringify(response);
  }
  if (spec.url === '/api/agents') {
    const response = JSON.parse(after.body);
    assert.deepEqual(response.pins, []);
    for (const row of response.agents) { assert.equal(row.compactAt, 35); delete row.compactAt; assert.deepEqual(row.pinIds, []); delete row.pinIds; delete row.pinTarget; }
    delete response.pins;
    // Only the explicit additive pin projection and post-await registry refresh change this endpoint.
    after.body = JSON.stringify(response);
    after.effects = after.effects.filter(effect => effect[0] !== 'registry.fresh');
    const previous = JSON.parse(before.body);
    assert.deepEqual(response, previous);
    after.body = before.body; // JSON object property order is not part of the API contract.
  }
  assert.deepEqual(after, before);
});

test('all mutation verbs reject foreign origins before any area or leaf effect', async () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) for (const url of ['/api/agents/start','/api/browser/state','/api/product-map/chat/rating','/api/changes/turns','/api/loaded']) {
    const spec = { url, method, headers: { origin: 'https://foreign.test' }, body: {} };
    const before = await run(spec, false), after = await run(spec, true);
    assert.equal(after.status, 403); assert.equal(after.effects.length, 0); assert.deepEqual(after, before);
  }
});

test('read-specific origin restrictions, method errors and unchecked legacy methods retain parity', async () => {
  for (const spec of [
    { url: '/api/delight?agent=a1', headers: { origin: 'https://foreign.test' } },
    { url: '/api/a0/tasks/t-1/actions', headers: { origin: 'https://foreign.test' } },
    { url: '/api/workspaces/ws-1', headers: { origin: 'https://foreign.test' } },
    { url: '/api/delight?agent=a1', method: 'PATCH' },
    { url: '/api/health', method: 'HEAD' },
    { url: '/api/agents/a1/read', method: 'POST' },
    { url: '/api/agents/a1/move', method: 'PUT' },
    { url: '/api/browser/state', method: 'OPTIONS' },
    { url: '/api/attention/n1', method: 'DELETE' },
    { url: '/api/loaded', method: 'POST' },
  ]) assert.deepEqual(await run(spec, true), await run(spec, false));
});

test('outer error projection, local errors and shared launch lock retain parity', async () => {
  for (const spec of [
    { url: '/api/health', overrides: { remoteInventoryRoute: () => async () => { throw Error('fixture first line\nprivate second line'); } } },
    { url: '/api/agents/a1/read', overrides: { herdr: async () => { throw Error('fixture read failure\nsecond line'); } } },
    { url: '/api/agents/start-zero', method: 'POST', overrides: { zeroStarting: true } },
    { url: '/api/agents/start-zero', method: 'POST', overrides: { startZero: async () => { throw Error('fixture start failure'); } } },
    { url: '/api/spaces/p1', overrides: { resolveSpace: () => { throw TypeError('Unknown project'); } } },
    { url: '/api/browser/state', method: 'PUT', body: {}, overrides: { writeBrowserState: () => { throw Error('fixture state too large'); } } },
    { url: '/api/agents/a1/changes', configure: f => { f.d.changes.preview = async () => { throw Error('unavailable'); }; } },
  ]) assert.deepEqual(await run(spec, true), await run(spec, false));
});

test('static precedence, world compression, uploads and streamed workspace snapshots retain headers and cleanup', async () => {
  for (const spec of [
    { url: '/api/loaded', configure: f => f.files.set('/fixture/dist/api/loaded', 'static wins') },
    { url: '/client/route', configure: f => f.files.set('/fixture/dist/index.html', '<main>fixture</main>') },
    { url: '/assets/app-12345678.js', configure: f => f.files.set('/fixture/dist/assets/app-12345678.js', 'fixture') },
    { url: '/estate-world', configure: f => { f.d.process.env.AB_ESTATE_WORLD = '/fixture/world'; f.files.set('/fixture/world', 'world'); } },
    { url: '/estate-world?v=fixture-world', headers: { 'accept-encoding': 'br, gzip' }, configure: f => { f.d.process.env.AB_ESTATE_WORLD = '/fixture/world'; f.files.set('/fixture/world', 'world'); } },
    { url: '/api/uploads', method: 'POST', body: 'synthetic PNG fixture', headers: { 'content-type': 'image/png' } },
    { url: '/api/uploads/fixture.png', overrides: { uploadPath: () => '/fixture/uploads/fixture.png' } },
    { url: '/api/workspaces/ws-1/events' },
  ]) assert.deepEqual(await run(spec, true), await run(spec, false));
});

test('each pre-existing leaf retains its exact position and terminates dispatch when handled', async () => {
  for (const name of ['handleReleases','handleLanding','handleDictation','handleVoice','handleMiniLanes','handleServers','handleLaunchd','handleCodexLanes','handleA0Now','handleResearch','handleTokens','handleTokensMoney','handleUsage','handleShip','handleSpend']) {
    const spec = { url: '/api/leaf-probe', configure: f => { f.d[name] = (_req, res) => { f.effects.push(['chosen-leaf', name]); f.d.json(res, 207, { name }); return true; }; } };
    const before = await run(spec, false), after = await run(spec, true);
    assert.equal(after.status, 207); assert.deepEqual(after, before);
  }
});

test('all areas receive the same parsed URL object as the original dispatch', async () => {
  const spec = { url: '/api/url-identity-probe', overrides: { remoteInventoryRoute: () => async (_req, _res, url) => { url.pathname = '/api/health'; return false; } } };
  const before = await run(spec, false), after = await run(spec, true);
  assert.equal(after.status, 200);
  assert.deepEqual(after, before);
});

test('host turn boundaries retain credential and unique-owner gates before changes intake', async () => {
  for (const variant of ['valid', 'wrong-token', 'ambiguous-host', 'missing-row']) {
    const spec = {
      url: '/api/changes/turns', method: 'POST', body: { sessionId: 's1', turnId: 'turn1', phase: 'start' },
      headers: { authorization: variant === 'wrong-token' ? 'Bearer wrong-fixture' : 'Bearer fixture-only' },
      configure: f => {
        const host = { session: 's1', token: 'fixture-only', state: 'live', pane: 'p1', name: 'Fixture' };
        f.d.listServiceHosts = async () => variant === 'ambiguous-host' ? [host, host] : [host];
        if (variant === 'missing-row') f.d.listAgents = async () => [];
      },
    };
    const before = await run(spec, false), after = await run(spec, true);
    assert.equal(after.status, variant === 'valid' ? 200 : variant === 'missing-row' ? 409 : 403);
    assert.deepEqual(after, before);
    assert.equal(after.effects.some(effect => effect[0] === 'changes.turnBoundary'), variant === 'valid');
  }
});

test('area dependency contracts cannot import the running server', () => {
  for (const file of [...areaFiles, 'builtin.ts']) {
    const source = readFileSync(path.join(routeDirectory, file), 'utf8');
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    for (const node of ast.statements.filter(ts.isImportDeclaration)) {
      if (node.moduleSpecifier.text.endsWith('/server.ts')) assert.equal(node.importClause?.isTypeOnly, true, `${file} must use a type-only server import`);
    }
  }
});

test('unmodified transport and shutdown declarations retain installed baseline behavior', () => {
  const marker = '// ---------------------------------------------------------------- terminals';
  // Review, resume, sleeping history and identity-bound launch intentionally change these functions.
  // Their actual boundaries are covered by review-delivery, new-starts and
  // codex-quota-handoff plus sleep-wake-lab/host-sleep in this same release suite.
  const changedFunctions = new Set(['serveTranscript', 'forkChat', 'talkTo', 'passThrough', 'sleepingChat', 'startZero', 'startAgent']);
  // ALLOWED_ORIGINS: the window's origin is the public port (the front, t-0539), not the node's own slot port.
  const changedVariables = new Set(['reviewDeliveryOptions', 'PROMPTS', 'ALLOWED_ORIGINS']);
  function unchanged(source) {
    const ast = ts.createSourceFile('server.ts', source, ts.ScriptTarget.Latest, true);
    return ast.statements.filter(node => {
      if (node.getStart(ast) <= source.indexOf(marker)) return false;
      if (ts.isFunctionDeclaration(node) && changedFunctions.has(node.name?.text)) return false;
      if (ts.isVariableStatement(node) && node.declarationList.declarations.some(d => changedVariables.has(d.name.getText(ast)))) return false;
      // VOICE step 1 (9 Oct): shutdown waits for a take being written; dictation.mjs stops its node with SIGTERM.
      if (ts.isForOfStatement(node) && node.statement.getText(ast).startsWith('process.once(signal')) return false;
      if (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)) {
        const call = node.expression;
        if (call.expression.getText(ast) === 'server.on' && ts.isStringLiteral(call.arguments[0]) && call.arguments[0].text === 'upgrade') return false;
      }
      return true;
    }).map(node => {
      if (ts.isVariableStatement(node)) {
        const adapter = node.declarationList.declarations.find(d => d.name.getText(ast) === 'workspaceAdapters');
        if (adapter && ts.isObjectLiteralExpression(adapter.initializer)) {
          // Admission/start are intentionally revised; every other adapter stays pinned.
          return adapter.initializer.properties.filter(p => !['beforeStart', 'start'].includes(p.name?.getText(ast))).map(p => p.getText(ast)).join('\n');
        }
      }
      return node.getText(ast);
    });
  }
  assert.deepEqual(unchanged(current), unchanged(baseline));
});


test('compact-at is additive, validates requests and passes an exact Claude name to the launcher', async () => {
  const spec = { url: '/api/agents/Fixture/compact-at', method: 'POST', body: { pct: 50 } };
  const before = await run(spec, false), after = await run(spec, true);
  assert.equal(before.status, 404); assert.equal(after.status, 202);
  assert.deepEqual(JSON.parse(after.body), { pending: true, pct: 50 });
  assert.deepEqual(after.effects.find(e => e[0] === 'launchCompactAt'), ['launchCompactAt', ['Fixture', 50]]);
  for (const [body, status] of [[{pct:9},400],[{pct:91},400],[{pct:20.5},400],[{pct:'50'},400],[null,400]]) {
    const result = await run({...spec, body}, true); assert.equal(result.status, status);
    assert.ok(!result.effects.some(e => e[0] === 'launchCompactAt'));
  }
  const foreign = await run({...spec, headers:{origin:'https://foreign.test'}},true);
  assert.equal(foreign.status,403); assert.equal(foreign.effects.length,0);
});

test('claude-account is additive: 202 with the queued status, refuses read-only, reports idle before any switch', async () => {
  const spec = { url: '/api/agents/Fixture/claude-account', method: 'POST', body: { to: 'claude-siso' } };
  const before = await run(spec, false), after = await run(spec, true);
  assert.equal(before.status, 404); assert.equal(after.status, 202);
  assert.deepEqual(JSON.parse(after.body), { state: 'queued', message: 'Queued', to: 'claude-siso', stages: ['Queued'] });
  assert.deepEqual(after.effects.find(e => e[0] === 'switchAccount'), ['switchAccount', ['Fixture', 'claude-siso', { hostsDir: '/fixture/hosts' }]]);
  for (const body of [{ to: 'claude-fahmy' }, { to: 'codex' }, {}, '{bad']) {
    const result = await run({ ...spec, body }, true); assert.equal(result.status, 400);
    assert.ok(!result.effects.some(e => e[0] === 'switchAccount'));
  }
  const foreign = await run({ ...spec, headers: { origin: 'https://foreign.test' } }, true);
  assert.equal(foreign.status, 403); assert.equal(foreign.effects.length, 0);
  const read = await run({ url: '/api/agents/Fixture/claude-account' }, true);
  assert.equal(read.status, 200); assert.deepEqual(JSON.parse(read.body), { state: 'idle', message: 'No account switch has been requested', blocked: null });
});

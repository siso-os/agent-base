import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const root = path.resolve(import.meta.dirname, '..'), deps = process.env.AB_DEPENDENCY_ROOT ?? root;
const out = process.env.AB_PANEL_OUTPUT ?? path.join(root, '.agents/scratchpads/agent-panel');
fs.mkdirSync(out, { recursive: true });
const require = createRequire(path.join(deps, 'apps/web/package.json'));
const { build } = createRequire(require.resolve('vite'))('esbuild');
const packages = new Map(fs.readdirSync(path.join(root, 'packages')).flatMap(dir => {
  const file = path.join(root, 'packages', dir, 'package.json');
  if (!fs.existsSync(file)) return [];
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  return [[data.name, { dir: path.dirname(file), exports: data.exports }]];
}));
const workspace = { name: 'local-workspace', setup(build) { build.onResolve({ filter: /^@siso\// }, args => {
  const parts = args.path.split('/'), pkg = packages.get(parts.slice(0, 2).join('/'));
  if (!pkg) return;
  const sub = parts.length > 2 ? './' + parts.slice(2).join('/') : '.';
  let target = typeof pkg.exports === 'string' ? pkg.exports : pkg.exports?.[sub];
  if (target && typeof target === 'object') target = target.import || target.default;
  return typeof target === 'string' ? { path: path.resolve(pkg.dir, target) } : undefined;
}); } };
const baseline = process.env.AB_PANEL_BASELINE === '1';
const name = baseline ? 'agent-companion-before' : 'agent-companion';
const baselinePaths = new Set(['apps/web/src/components/AgentPanel.tsx','apps/web/src/components/panel/PanelTabs.tsx','apps/web/src/components/TaskWorkspaceGroups.tsx','apps/web/src/components/OwnerTasksPanel.tsx','apps/web/src/components/Timeline.tsx']);
const original = { name: 'observed-base', setup(build) { if (baseline) build.onLoad({ filter: /\.tsx$/ }, args => {
  const relative = path.relative(root, args.path);
  if (!baselinePaths.has(relative)) return;
  return { contents: execFileSync('git', ['show', '41d9f50e653032c4f6ac5a402e30976914959635:' + relative], { cwd: root, encoding: 'utf8' }), loader: 'tsx', resolveDir: path.dirname(args.path) };
}); } };
const entry = path.join(root, 'apps/web/preview/agent-companion.tsx');
const result = await build({ entryPoints: [entry], bundle: true, outfile: path.join(out, `${name}.js`), jsx: 'automatic', format: 'iife', minify: true, metafile: true,
  nodePaths: [path.join(deps, 'apps/web/node_modules'), path.join(deps, 'node_modules'), path.join(deps, 'node_modules/.pnpm/node_modules'), ...[...packages.values()].map(pkg => path.join(pkg.dir.replace(root, deps), 'node_modules'))], plugins: [workspace, original],
  alias: { react: path.join(deps, 'apps/web/node_modules/react'), 'react-dom': path.join(deps, 'apps/web/node_modules/react-dom') },
  loader: { '.woff2': 'dataurl', '.woff': 'dataurl', '.png': 'dataurl', '.svg': 'dataurl' },
  define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env.DEV': 'false' } });
const js = fs.readFileSync(path.join(out, `${name}.js`), 'utf8').replace(/<\/script/gi, '<\\/script');
const css = fs.readFileSync(path.join(out, `${name}.css`), 'utf8');
fs.writeFileSync(path.join(out, `${name}.html`), `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><title>Agent Base · Agent panel</title><style>${css}</style></head><body><div id="root"></div><script>${js}</script></body></html>`);
fs.writeFileSync(path.join(out, `${name}-build-meta.json`), JSON.stringify(result.metafile, null, 2));
console.log(JSON.stringify({ html: path.join(out, `${name}.html`), inputs: Object.keys(result.metafile.inputs).length, bytes: fs.statSync(path.join(out, `${name}.html`)).size }));

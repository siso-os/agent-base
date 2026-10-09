import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
const root = path.resolve(import.meta.dirname, '..'), deps = process.env.AB_DEPENDENCY_ROOT ?? root;
const require = createRequire(path.join(deps, 'apps/web/package.json'));
const ts = require('typescript');
const files = ['apps/web/src/components/AgentPanel.tsx','apps/web/src/components/TaskWorkspaceDeck.tsx','apps/web/src/lib/panel-team.ts','apps/web/preview/agent-companion.tsx'].map(file => path.join(root, file));
files.push(path.join(deps, 'apps/web/node_modules/vite/client.d.ts'));
const nodeRequire = createRequire(path.join(deps, 'services/node/package.json'));
const options = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, jsx: ts.JsxEmit.ReactJSX, strict: true, noUnusedLocals: true, noUnusedParameters: true, skipLibCheck: true, noEmit: true, allowImportingTsExtensions: true, types: ['node'], typeRoots: [path.dirname(path.dirname(nodeRequire.resolve('@types/node/package.json')))], lib: ['lib.es2022.d.ts','lib.dom.d.ts','lib.dom.iterable.d.ts'] };
options.paths = { 'react': [path.join(path.dirname(require.resolve('@types/react/package.json')), 'index.d.ts')], 'react/*': [path.join(path.dirname(require.resolve('@types/react/package.json')), '*')], 'react-dom': [path.join(path.dirname(require.resolve('@types/react-dom/package.json')), 'index.d.ts')], 'react-dom/*': [path.join(path.dirname(require.resolve('@types/react-dom/package.json')), '*')] };
for (const dir of fs.readdirSync(path.join(root, 'packages'))) {
  const file = path.join(root, 'packages', dir, 'package.json');
  if (!fs.existsSync(file)) continue;
  const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const [sub, item] of Object.entries(typeof pkg.exports === 'string' ? { '.': pkg.exports } : pkg.exports ?? {})) {
    const target = typeof item === 'string' ? item : item.types || item.import || item.default;
    if (typeof target === 'string') options.paths[pkg.name + (sub === '.' ? '' : sub.slice(1))] = [path.resolve(path.dirname(file), target)];
  }
}
const host = ts.createCompilerHost(options);
host.resolveModuleNames = (names, containing) => names.map(name => {
  const local = ts.resolveModuleName(name, containing, options, ts.sys).resolvedModule;
  if (local) return local;
  return ts.resolveModuleName(name, containing.replace(root, deps), options, ts.sys).resolvedModule;
});
const diagnostics = ts.getPreEmitDiagnostics(ts.createProgram(files, options, host));
const format = d => `${d.file ? path.relative(root,d.file.fileName) + ':' + (d.file.getLineAndCharacterOfPosition(d.start ?? 0).line + 1) : 'compiler'} TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText,' ')}`;
const result = { checked: files.map(file => path.relative(root,file)), diagnostics: diagnostics.map(format) };
if (process.env.AB_PANEL_OUTPUT) fs.writeFileSync(path.join(process.env.AB_PANEL_OUTPUT,'typecheck.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
if (diagnostics.length) process.exitCode = 1;

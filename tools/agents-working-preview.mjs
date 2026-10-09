import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const root = path.resolve(import.meta.dirname, '..');
const deps = process.env.AB_DEPENDENCY_ROOT ?? root;
const out = process.env.AB_ACTIVITY_OUTPUT ?? path.join(root, '.agents/scratchpads/agents-working');
fs.mkdirSync(out, { recursive: true });
const require = createRequire(path.join(deps, 'apps/web/package.json'));
const { build } = createRequire(require.resolve('vite'))('esbuild');
const entry = path.join(root, 'apps/web/preview/agents-working.tsx');
const result = await build({ entryPoints: [entry], bundle: true, outfile: path.join(out, 'agents-working.js'), jsx: 'automatic', format: 'iife', minify: true, metafile: true,
  nodePaths: [path.join(deps, 'apps/web/node_modules'), path.join(deps, 'node_modules')], alias: { react: path.join(deps, 'apps/web/node_modules/react'), 'react-dom': path.join(deps, 'apps/web/node_modules/react-dom') }, define: { 'process.env.NODE_ENV': '"production"' } });
const js = fs.readFileSync(path.join(out, 'agents-working.js'), 'utf8').replace(/<\/script/gi, '<\\/script');
const css = fs.readFileSync(path.join(out, 'agents-working.css'), 'utf8');
fs.writeFileSync(path.join(out, 'agents-working.html'), `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><title>Agent Base · Agents working</title><style>${css}</style></head><body><div id="root"></div><script>${js}</script></body></html>`);
fs.writeFileSync(path.join(out, 'build-meta.json'), JSON.stringify(result.metafile, null, 2));
console.log(JSON.stringify({ html: path.join(out, 'agents-working.html'), source: entry }));

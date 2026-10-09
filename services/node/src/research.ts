import { execFile } from 'node:child_process';
import { open, readdir, readFile, realpath, stat } from 'node:fs/promises';
import type http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { Block } from './a0-now.ts';

export type ResearchOutput = { output: string | null; error: string | null };
export type ResearchJob = ResearchOutput & { id: string; status: string; name?: string; tokens?: number | null; tokensIn?: number | null; tokensOut?: number | null; usageSource?: 'manifest' | 'run-log' | null };
export type ResearchSelection = { fleet: string; job?: string };
export type ResearchFleet = { name: string; created: string; finished: string | null; model: string; topic: string; machine?: string; jobs: ResearchJob[]; then: (ResearchOutput & { model: string; status: string }) | null };
export type ResearchTopic = { id: string; title: string; updated: number; preview: string; markdown: string | null; error: string | null; fleets: string[] };
export type Research = { fleets: Block<ResearchFleet[]>; topics: Block<ResearchTopic[]> };
const run = promisify(execFile);
const cache = new Map<string, { block?: Block<unknown>; pending?: Promise<Block<unknown>> }>();
const safeName = (name: unknown): name is string => typeof name === 'string' && !!name && name !== '.' && name !== '..' && !/[\/\\\0]/.test(name);
const inside = (root: string, file: string) => file.startsWith(root + path.sep);

async function source<T>(key: string, read: () => Promise<T>): Promise<Block<T>> {
  let entry = cache.get(key);
  if (!entry) cache.set(key, (entry = {}));
  if (entry.block && Date.now() - entry.block.at < 10_000) return entry.block as Block<T>;
  const current = entry;
  const fresh = current.pending ??= (async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const data = await Promise.race([read(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), 10_000); })]);
      return { at: Date.now(), data, error: null };
    } catch { return { at: Date.now(), data: null, error: 'Source unavailable; retrying' }; }
    finally { clearTimeout(timer); }
  })().then((block) => { current.block = block; return block; }).finally(() => { current.pending = undefined; });
  // t-0458: `fleet status` takes ~7 s; a stale reading answers at once while the next one is made, so the app's 10 s poll
  // never holds one of the browser's six connections for 7 s (it was queueing Agent Zero's start-up reads behind it).
  if (current.block) return current.block as Block<T>;
  return await fresh as Block<T>;
}

async function output(root: string, name: string, id: string): Promise<ResearchOutput> {
  try {
    const base = await realpath(root);
    const file = await realpath(path.join(base, name, `${id}.out`));
    if (!inside(base, file)) throw new Error('Outside fleet state');
    const handle = await open(file, 'r');
    try {
      const size = (await handle.stat()).size;
      const buffer = Buffer.alloc(Math.min(size, 64 * 1024));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, Math.max(0, size - buffer.length));
      const tail = buffer.subarray(0, bytesRead).toString('utf8').trimEnd().split('\n').slice(-25);
      let start = -1;
      for (let i = tail.length - 1; i >= 0; i--) if (/^\s*RETURN\b/.test(tail[i])) { start = i; break; }
      return { output: (start >= 0 ? tail.slice(start) : tail.slice(-25)).join('\n'), error: null };
    } finally { await handle.close(); }
  } catch { return { output: null, error: 'Output not available yet' }; }
}

const count = (value: unknown): number | null => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
const label = (value: unknown): string | undefined => typeof value === 'string' && value.trim() ? value.replace(/^#+\s*/, '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, 120) : undefined;

/** Only explicit usage counters are counts. A missing counter remains null, including on a finished job. */
export function researchJobMetadata(job: Record<string, any>): Pick<ResearchJob, 'name' | 'tokens' | 'tokensIn' | 'tokensOut' | 'usageSource'> {
  const usage = job.usage && typeof job.usage === 'object' ? job.usage : job;
  const estimated = job.estimated === true || usage.estimated === true;
  const tokensIn = estimated ? null : count(usage.input_tokens ?? usage.tokensIn);
  const tokensOut = estimated ? null : count(usage.output_tokens ?? usage.tokensOut);
  const explicit = estimated ? null : count(usage.total_tokens ?? usage.tokens);
  const sum = tokensIn !== null && tokensOut !== null ? count(tokensIn + tokensOut) : null;
  const tokens = explicit ?? sum;
  return { name: label(job.title) ?? label(job.name) ?? label(job.label), tokens, tokensIn, tokensOut, usageSource: tokens !== null ? 'manifest' : null };
}

export function reportedRunUsage(raw: string): Pick<ResearchJob, 'tokens' | 'tokensIn' | 'tokensOut' | 'usageSource'> {
  let tokensIn = 0, tokensOut = 0, reported = false;
  for (const line of raw.split('\n')) {
    let event: any; try { event = JSON.parse(line); } catch { continue; }
    if (event?.type !== 'turn.completed') continue;
    const input = count(event.usage?.input_tokens), output = count(event.usage?.output_tokens);
    if (input === null || output === null) return { tokens: null, tokensIn: null, tokensOut: null, usageSource: null };
    tokensIn += input; tokensOut += output; reported = true;
  }
  const tokens = reported ? count(tokensIn + tokensOut) : null;
  return { tokens, tokensIn: tokens === null ? null : tokensIn, tokensOut: tokens === null ? null : tokensOut, usageSource: tokens === null ? null : 'run-log' };
}

export async function researchRunMetadata(text: string | null, machine: unknown, expectedWorker: string): Promise<Partial<ResearchJob>> {
  // Remote output can mention the same home path as this machine; never assign a local run's usage to it.
  if (machine && !['local', 'laptop'].includes(String(machine))) return {};
  const reported = [...(text?.matchAll(/^LOG ([^\r\n]+\.jsonl)$/gm) ?? [])].at(-1)?.[1];
  if (!reported) return {};
  try {
    const base = await realpath(process.env.AB_CODEX_RUNS ?? path.join(process.env.AB_HOME ?? os.homedir(), '.local/state/codex-run/runs'));
    const file = await realpath(reported);
    if (!inside(base, file)) return {};
    const info = await stat(file);
    if (!info.isFile() || info.size > 4 * 1024 * 1024) return {};
    const metaFile = await realpath(file.slice(0, -6) + '.meta.json');
    if (!inside(base, metaFile) || (await stat(metaFile)).size > 64 * 1024) return {};
    const meta = JSON.parse(await readFile(metaFile, 'utf8'));
    if (meta.worker !== expectedWorker) return {};
    const name = label(meta.title) ?? label(meta.about) ?? label(meta.name);
    const usage = reportedRunUsage(await readFile(file, 'utf8'));
    return { ...usage, ...(name ? { name } : {}) };
  } catch { return {}; }
}

async function readFleets(): Promise<ResearchFleet[]> {
  const [program, ...args] = (process.env.AB_FLEET_CMD ?? 'fleet status --json').trim().split(/\s+/);
  const { stdout } = await run(program, args, { timeout: 10_000, maxBuffer: 4 << 20 });
  const value = JSON.parse(stdout);
  const validStep = (s: any) => s && typeof s.status === 'string' && typeof s.model === 'string';
  if (!Array.isArray(value) || !value.every((f) => f && safeName(f.name) && typeof f.created === 'string' && typeof f.model === 'string' && (f.finished == null || typeof f.finished === 'string') && (f.topic == null || typeof f.topic === 'string') && (f.then == null || validStep(f.then)) && Array.isArray(f.jobs) && f.jobs.every((j: any) => j && safeName(j.id) && typeof j.status === 'string'))) throw new Error('Invalid fleets');
  const root = process.env.FLEET_STATE ?? path.join(process.env.AB_HOME ?? os.homedir(), '.local/state/fleet');
  return Promise.all(value.map(async (f) => ({ name: f.name, created: f.created, finished: f.finished ?? null, model: f.model, topic: f.topic ?? '', ...(typeof f.machine === 'string' ? { machine: f.machine } : {}), jobs: await Promise.all(f.jobs.map(async (j: any) => {
    const result = await output(root, f.name, j.id), manifest = researchJobMetadata(j);
    const run = manifest.tokens === null || !manifest.name ? await researchRunMetadata(result.output, f.machine, typeof j.worker === 'string' ? j.worker : `${f.name}/${j.id}`) : {};
    return { id: j.id, status: j.status, ...result, ...manifest, ...(manifest.tokens === null && run.tokens != null ? { tokens: run.tokens, tokensIn: run.tokensIn, tokensOut: run.tokensOut, usageSource: run.usageSource } : {}), name: manifest.name ?? run.name };
  })), then: f.then ? { model: f.then.model, status: f.then.status, ...await output(root, f.name, 'then') } : null })));
}

async function readTopics(): Promise<ResearchTopic[]> {
  const root = process.env.AB_RESEARCH_ROOT ?? path.join(os.homedir(), 'SISO_Workspace/SISO_Agents/agent-zero/siso-agent-zero/.agents/a0/research');
  const base = await realpath(root);
  const topics = await Promise.all((await readdir(base, { withFileTypes: true })).filter((d) => d.isDirectory()).map(async (dir): Promise<ResearchTopic | null> => {
    const file = path.join(base, dir.name, 'FINDINGS.md');
    try {
      const resolved = await realpath(file);
      if (!inside(base, resolved)) throw new Error('Outside research root');
      const info = await stat(resolved);
      if (!info.isFile() || info.size > 1 << 20) throw new Error('Invalid findings');
      const markdown = await readFile(resolved, 'utf8');
      return { id: dir.name, title: markdown.match(/^#{1,6}\s+(.+)$/m)?.[1] ?? dir.name, updated: info.mtimeMs, preview: markdown.split('\n').slice(0, 20).join('\n'), markdown, error: null, fleets: [] };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      return { id: dir.name, title: dir.name, updated: 0, preview: '', markdown: null, error: 'Findings unavailable', fleets: [] };
    }
  }));
  return topics.filter((t): t is ResearchTopic => t !== null).sort((a, b) => b.updated - a.updated);
}

export async function research(): Promise<Research> {
  const [fleets, topics] = await Promise.all([source('fleets', readFleets), source('topics', readTopics)]);
  const root = process.env.AB_RESEARCH_ROOT ?? path.join(os.homedir(), 'SISO_Workspace/SISO_Agents/agent-zero/siso-agent-zero/.agents/a0/research');
  return { fleets, topics: { ...topics, data: topics.data?.map((t) => ({ ...t, fleets: (fleets.data ?? []).filter((f) => f.topic && path.resolve(f.topic) === path.resolve(root, t.id)).map((f) => f.name) })) ?? null } };
}

export async function handleResearch(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<boolean> {
  if (url.pathname !== '/api/research') return false;
  if (req.method !== 'GET') { res.writeHead(405, { 'content-type': 'application/json', allow: 'GET' }).end(JSON.stringify({ error: 'GET only' })); return true; }
  res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(await research()));
  return true;
}

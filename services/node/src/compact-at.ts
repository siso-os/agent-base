import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

export const isClaudeAgent = (agent: { tool?: string }) => agent.tool === 'claude' || agent.tool === 'siso';
export const validCompactAt = (pct: unknown): pct is number => typeof pct === 'number' && Number.isInteger(pct) && pct >= 10 && pct <= 90;

/** The existing compact-at launcher owns persistence; the node only reads its saved values. */
export async function compactAtRows<T extends { name: string; tool?: string }>(rows: T[]): Promise<(T & { compactAt?: number })[]> {
  let saved: Record<string, unknown> = {};
  try {
    const value = JSON.parse(await readFile(process.env.AB_COMPACT_AT_FILE ?? path.join(homedir(), '.local/state/a0/compact-at.json'), 'utf8'));
    if (value && typeof value === 'object' && !Array.isArray(value)) saved = value;
  } catch { /* Missing selections use the launcher's default. */ }
  return rows.map(row => isClaudeAgent(row) ? { ...row, compactAt: validCompactAt(saved[row.name]) ? saved[row.name] as number : 35 } : row);
}

/** No shell: an agent name is a single argv entry. A failed spawn must never claim 202. */
export async function launchCompactAt(name: string, pct: number): Promise<void> {
  const bin = process.env.AB_COMPACT_AT_BIN ?? path.join(homedir(), 'SISO_Workspace/SISO_Agents/agent-zero/siso-agent-zero/bin/compact-at');
  await new Promise<void>((resolve, reject) => {
    const child = spawn(bin, [name, String(pct)], { detached: true, stdio: 'ignore' });
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}

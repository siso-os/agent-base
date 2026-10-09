import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// A terminal-backed host removes its connection descriptor at shutdown. Keep only the
// selected settings separately, scoped to the native conversation, so a new PID can resume them.
export type ModelSettings = { model: string | null; effort: string | null };
function file(dir: string, session: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(session)) throw Error('Invalid settings session');
  return path.join(dir, 'settings', `${session}.json`);
}
export function readModelSettings(dir: string, session: string): ModelSettings | null {
  try {
    const value = JSON.parse(readFileSync(file(dir, session), 'utf8'));
    if ((typeof value.model !== 'string' && value.model !== null) || (typeof value.effort !== 'string' && value.effort !== null)) return null;
    return { model: value.model, effort: value.effort };
  } catch { return null; }
}
export function saveModelSettings(dir: string, session: string, settings: ModelSettings) {
  const target = file(dir, session);
  mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const tmp = `${target}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(settings), { mode: 0o600 });
  renameSync(tmp, target);
}

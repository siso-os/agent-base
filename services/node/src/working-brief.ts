import { constants, closeSync, fstatSync, lstatSync, openSync, readSync, realpathSync } from 'node:fs';
import path from 'node:path';

export type WorkingBrief = {
  state: 'available' | 'missing' | 'unavailable' | 'private';
  source: string | null;
  updated: string | null;
  heading: string | null;
  text: string | null;
  truncated: boolean;
};
const empty = (state: WorkingBrief['state']): WorkingBrief => ({state,source:null,updated:null,heading:null,text:null,truncated:false});
const privatePath = (value:string) => /(^|\/)personal(\/|$)/.test(value.replaceAll('\\','/'));

/** Read only the server-resolved local workspace. No user-supplied path, ancestor search or symlink traversal. */
export function readWorkingBrief(cwd: string): WorkingBrief {
  if (!cwd || !path.isAbsolute(cwd)) return empty('unavailable');
  if (privatePath(cwd)) return empty('private');
  let root:string;
  try { root=realpathSync(cwd); } catch { return empty('unavailable'); }
  if (privatePath(root)) return empty('private');
  for (const relative of ['.agents/HANDOFF.md','HANDOFF.md']) {
    let fd:number|undefined;
    try {
      const file=path.join(root,relative);
      if (relative.startsWith('.agents/')) {
        const dir=lstatSync(path.join(root,'.agents'));
        if (!dir.isDirectory() || dir.isSymbolicLink()) return empty('unavailable');
      }
      if (lstatSync(file).isSymbolicLink() || realpathSync(file)!==file) return empty('unavailable');
      fd=openSync(file,constants.O_RDONLY|constants.O_NOFOLLOW);
      const stat=fstatSync(fd);
      if (!stat.isFile() || stat.size>1_000_000) return empty('unavailable');
      const bytes=Buffer.alloc(Math.min(stat.size,16_384));
      const count=readSync(fd,bytes,0,bytes.length,0);
      const raw=bytes.subarray(0,count).toString('utf8');
      if (raw.includes('\0')) return empty('unavailable');
      const lines=raw.split(/\r?\n/);
      const start=lines.findIndex(line=>/^##\s+/.test(line));
      const end=start<0?-1:lines.findIndex((line,i)=>i>start&&/^##\s+/.test(line));
      const section=(start<0?lines:lines.slice(start+1,end<0?undefined:end)).join('\n').trim();
      return {state:'available',source:relative,updated:stat.mtime.toISOString(),heading:start<0?null:lines[start].replace(/^##\s+/,''),text:section.slice(0,6000),truncated:section.length>6000||(count<stat.size&&end<0)};
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code!=='ENOENT') return empty('unavailable');
    } finally { if(fd!==undefined)closeSync(fd); }
  }
  return empty('missing');
}

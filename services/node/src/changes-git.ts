// Private-index snapshots independently implemented from T3 Code (MIT, T3 Tools Inc., 2026).
// Raw hash-object/update-index avoids repository clean filters, hooks, textconv and external diff helpers.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readFile, readlink, realpath, mkdtemp, unlink, rmdir, open, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { parseDiffHunks, type ChangedFile, type ReviewFile, type ReviewRevision, type ReviewScope } from '../../../apps/web/src/lib/changes.ts';
export const LIMITS = { previewBytes: 120_000, fileBytes: 1_048_576, hunkBytes: 16_384, feedbackBytes: 49_152 };
const META = 16 * 1024 * 1024, CAPTURE = 64 * 1024 * 1024;
export class ChangesError extends Error {
  code: import('../../../apps/web/src/lib/changes.ts').ChangesErrorCode; status: number;
  constructor(code: import('../../../apps/web/src/lib/changes.ts').ChangesErrorCode, detail: string, status = 409) { super(detail); this.code=code;this.status=status; }
}
export const hash = (v: string | Buffer) => createHash('sha256').update(v).digest('hex');
export function git(cwd: string, args: string[], input?: Buffer, env: Record<string, string> = {}, limit = META): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['-C', cwd, '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'core.splitIndex=false', '-c', 'core.untrackedCache=false', ...args], { env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', GIT_LITERAL_PATHSPECS: '1', ...env }, stdio: ['pipe','pipe','pipe'] });
    let size = 0, failure: Error | undefined; const chunks: Buffer[] = [];
    const timer = setTimeout(() => { failure = new ChangesError('output-limit', 'Git operation timed out'); child.kill('SIGKILL'); }, 10_000);
    child.stdout.on('data', (b: Buffer) => { size += b.length; if (size > limit) { failure = new ChangesError('output-limit', 'Git output exceeds its budget'); child.kill('SIGKILL'); } else chunks.push(b); });
    // Do not expose stderr: it can contain repo paths/configuration or private content.
    child.stderr.on('data', () => {}); child.stdin.on('error', () => {});
    child.once('error', () => { clearTimeout(timer); reject(new ChangesError('not-git', 'Git process unavailable')); });
    child.once('close', code => { clearTimeout(timer); if (failure) reject(failure); else if (code !== 0) reject(new ChangesError('not-git', `Git ${args[0]} failed (exit ${code})`)); else resolve(Buffer.concat(chunks)); });
    child.stdin.end(input);
  });
}
export const gitText = async (cwd: string, args: string[]) => (await git(cwd,args)).toString('utf8').trim();
const oid = (v: string) => /^[a-f0-9]{40,64}$/.test(v);
export async function canonicalWorktree(cwd: string) {
  const canonical = await realpath(cwd).catch(() => { throw new ChangesError('mapping-unavailable', 'Workspace no longer exists'); });
  if (canonical !== path.resolve(cwd)) throw new ChangesError('mapping-unavailable', 'Symlinked workspace root is not reviewable');
  const root = await realpath(await gitText(canonical,['rev-parse','--show-toplevel']));
  const common = await realpath(path.resolve(root, await gitText(root,['rev-parse','--git-common-dir'])));
  return { root, common };
}
async function ref(cwd: string, name: string) {
  if (typeof name !== 'string' || !name || name.startsWith('-') || name.length > 200 || /[\0\n\r]/.test(name)) throw new ChangesError('invalid-input','Invalid target',400);
  try { return await gitText(cwd,['rev-parse','--verify','--end-of-options',`${name}^{commit}`]); }
  catch { throw new ChangesError('target-unavailable','Requested target commit is unavailable'); }
}
async function head(cwd: string): Promise<string | null> {
  try { return await gitText(cwd,['rev-parse','--verify','HEAD']); } catch {
    const refs = await gitText(cwd,['show-ref','--head']).catch(() => '');
    if (refs) throw new ChangesError('not-git','HEAD is unreadable'); return null;
  }
}
async function captureTree(cwd: string) {
  const temp = await mkdtemp(path.join(tmpdir(),'ab-changes-index-')), index = path.join(temp,'index');
  const env = { GIT_INDEX_FILE: index };
  const payloads: { mode: string; name: string; spool: string }[] = [];
  try {
    await git(cwd,['read-tree','--empty'],undefined,env);
    const tracked = (await git(cwd,['ls-files','-z','--cached'])).toString('utf8').split('\0').filter(Boolean);
    const headOid=await head(cwd);
    if(headOid)tracked.push(...(await git(cwd,['ls-tree','-r','--name-only','-z',headOid])).toString('utf8').split('\0').filter(Boolean));
    const untracked = (await git(cwd,['ls-files','-z','--others','--exclude-standard'])).toString('utf8').split('\0').filter(Boolean);
    const entries: Buffer[] = [], fingerprints: string[] = []; let bytes = 0;
    const baseline = new Map<string,{ mode: string; blob: string }>();
    for (const item of (await git(cwd,['ls-files','--stage','-z'])).toString('utf8').split('\0').filter(Boolean)) {
      const match = /^(\d+) ([a-f0-9]+) (\d)\t([\s\S]+)$/.exec(item);
      if (!match || match[3] !== '0') throw new ChangesError('unstable-source','Resolve index conflicts before capturing');
      baseline.set(match[4], { mode: match[1], blob: match[2] });
    }
    for (const name of [...new Set([...tracked,...untracked])].sort()) {
      if (name.includes('\ufffd') || name.split('/').some(p=>p === '..' || p === '.git')) throw new ChangesError('invalid-input','Unsupported Git path');
      const full = path.join(cwd,name); let st;
      try { st = await lstat(full); } catch (e: any) { if (e.code === 'ENOENT') { fingerprints.push(`${name}:absent`); continue; } throw new ChangesError('unstable-source','Cannot read a workspace entry'); }
      const parent = await realpath(path.dirname(full));
      if (parent !== cwd && !parent.startsWith(cwd+path.sep)) throw new ChangesError('mapping-unavailable','Workspace entry escapes the root');
      const prev = baseline.get(name);
      if (st.isDirectory()) {
        if (prev?.mode === '160000') { entries.push(Buffer.from(`160000 ${prev.blob}\t${name}\0`)); fingerprints.push(`${name}:gitlink:${prev.blob}`); continue; }
        const nested=await lstat(path.join(full,'.git')).catch((e:any)=>{if(e.code==='ENOENT')return null;throw e;});
        if(nested)throw new ChangesError('invalid-input','Nested repositories are not captured');
        fingerprints.push(`${name}:directory`);continue;
      }
      if (!st.isFile() && !st.isSymbolicLink()) throw new ChangesError('invalid-input','Special files cannot be captured');
      if (st.size > META || (bytes += st.size) > CAPTURE) throw new ChangesError('output-limit','Workspace snapshot exceeds capture budget');
      let data: Buffer;
      if (st.isSymbolicLink()) {
        const link=await readlink(full),target=path.resolve(path.dirname(full),link);
        if(target!==cwd&&!target.startsWith(cwd+path.sep))throw new ChangesError('mapping-unavailable','Symlink target escapes workspace');
        data=Buffer.from(link);
      }
      else {
        // O_NOFOLLOW prevents a concurrent replacement with a symlink from reading outside the workspace.
        const { constants } = await import('node:fs');
        const fd = await open(full, constants.O_RDONLY | constants.O_NOFOLLOW);
        try { const now = await fd.stat(); if (!now.isFile() || now.size > META) throw new ChangesError('unstable-source','File changed during capture'); const bounded=Buffer.alloc(now.size+1);let used=0;while(used<bounded.length){const result=await fd.read(bounded,used,bounded.length-used,null);if(!result.bytesRead)break;used+=result.bytesRead;}if(used!==now.size)throw new ChangesError('unstable-source','File length changed during capture');data=bounded.subarray(0,used); } finally { await fd.close(); }
      }
      const mode = st.isSymbolicLink() ? '120000' : st.mode & 0o111 ? '100755' : '100644';
      // Keep captured bytes in private, generated filenames. Git reads the list in one
      // operation, so arbitrary worktree names (including whitespace/newlines) never
      // become stdin-paths syntax and clean filters are bypassed by --no-filters.
      const spool = path.join(temp, `payload-${payloads.length}`);
      payloads.push({ mode, name, spool });
      await writeFile(spool, data, { mode: 0o600 });
      fingerprints.push(`${name}:${mode}:${hash(data)}`);
    }
    if (payloads.length) {
      // stdin-paths uses Git's C quoting, including octal UTF-8 bytes. The
      // generated basename is safe; the OS temp directory can contain
      // quotes, backslashes or newlines too.
      const paths = payloads.map(p => '"' + [...Buffer.from(p.spool)].map(byte =>
        byte === 34 || byte === 92 ? '\\' + String.fromCharCode(byte) :
        byte < 32 || byte >= 127 ? '\\' + byte.toString(8).padStart(3, '0') : String.fromCharCode(byte)
      ).join('') + '"').join('\n') + '\n';
      const blobs = (await git(cwd, ['hash-object', '-w', '--no-filters', '--stdin-paths'], Buffer.from(paths), env)).toString('utf8').trim().split('\n');
      if (blobs.length !== payloads.length || blobs.some(blob => !oid(blob))) throw new ChangesError('snapshot-unavailable', 'Invalid batched blob response');
      payloads.forEach((p, i) => entries.push(Buffer.from(`${p.mode} ${blobs[i]}\t${p.name}\0`)));
    }
    if (entries.length) await git(cwd,['update-index','-z','--index-info'],Buffer.concat(entries),env);
    const treeOid = (await git(cwd,['write-tree'],undefined,env)).toString().trim();
    if (!oid(treeOid)) throw new ChangesError('snapshot-unavailable','Snapshot tree is invalid');
    return { treeOid, fingerprint: hash(JSON.stringify(fingerprints)), untracked };
  } finally {
    await Promise.all(payloads.map(p => unlink(p.spool).catch(() => undefined)));
    await unlink(index).catch(()=>{}); await unlink(index+'.lock').catch(()=>{}); await rmdir(temp).catch(()=>{});
  }
}
export async function captureReviewRevision(cwd: string, scope: ReviewScope, defaultBase?: string | null, turn?: { baseOid: string; treeOid: string }) {
  if (scope.kind === 'turn') {
    if (!turn) throw new ChangesError('snapshot-unavailable','This turn has no complete recorded baseline and completion');
    return revision(scope, turn.baseOid, null, turn.treeOid, null, []);
  }
  for (let attempt=0; attempt<2; attempt++) {
    const headOid = await head(cwd), targetOid = scope.kind === 'uncommitted' ? null : await ref(cwd,scope.targetRef ?? defaultBase ?? 'origin/dev');
    const empty = await gitText(cwd,['hash-object','-w','-t','tree','--stdin']);
    const baseOid = scope.kind === 'uncommitted' ? headOid ?? empty : headOid ? await gitText(cwd,['merge-base',headOid,targetOid!]) : empty;
    const first = scope.kind === 'committed' ? { treeOid: headOid ? await gitText(cwd,['rev-parse',`${headOid}^{tree}`]) : empty, fingerprint: '', untracked: [] } : await captureTree(cwd);
    const second = scope.kind === 'committed' ? first : await captureTree(cwd);
    if (headOid !== await head(cwd) || (targetOid && targetOid !== await ref(cwd,(scope as {targetRef?:string}).targetRef ?? defaultBase ?? 'origin/dev')) || first.fingerprint !== second.fingerprint) continue;
    // Owned refs retain immutable blobs for comments; no branch/index/ref owned by the user is changed.
    await git(cwd,['update-ref',`refs/agent-base/changes/${first.treeOid}`,first.treeOid]);
    const baseTree = await gitText(cwd,['rev-parse',`${baseOid}^{tree}`]);
    await git(cwd,['update-ref',`refs/agent-base/changes/${baseTree}`,baseTree]);
    for(const retained of new Set([baseOid,headOid,targetOid].filter((v):v is string=>!!v)))await git(cwd,['update-ref',`refs/agent-base/changes/${retained}`,retained]);
    return revision(scope,baseOid,headOid,first.treeOid,targetOid,first.untracked);
  }
  throw new ChangesError('unstable-source','Workspace changed repeatedly during capture; retry');
}
function revision(scope: ReviewScope, baseOid: string, headOid: string | null, treeOid: string, targetOid: string | null, untracked: string[]) {
  const r: ReviewRevision = { id: hash(JSON.stringify({scope,baseOid,headOid,treeOid,targetOid})), scope, baseOid, headOid, treeOid, targetOid, capturedAt: new Date().toISOString() };
  return { revision: r, untracked };
}
const diffArgs = ['diff','--no-ext-diff','--no-textconv','--no-color','--no-relative','--find-renames','--src-prefix=a/','--dst-prefix=b/'];
export async function listChangedFiles(cwd: string, r: ReviewRevision, untracked: string[]): Promise<ChangedFile[]> {
  const raw = (await git(cwd,[...diffArgs,'--raw','--no-abbrev','-z',r.baseOid,r.treeOid,'--'])).toString('utf8').split('\0');
  const files: ChangedFile[] = [];
  for (let i=0; i<raw.length && raw[i];) {
    const m = /^:(\d+) (\d+) ([a-f0-9]+) ([a-f0-9]+) ([A-Z])\d*$/.exec(raw[i++]);
    if (!m) throw new ChangesError('snapshot-unavailable','Cannot parse Git metadata');
    const p = raw[i++], next = ['R','C'].includes(m[5]) ? raw[i++] : p;
    const oldPath = m[5] === 'A' ? null : p, newPath = m[5] === 'D' ? null : next;
    const oldBlobOid = /^0+$/.test(m[3]) ? null : m[3], newBlobOid = /^0+$/.test(m[4]) ? null : m[4];
    const file: ChangedFile = { id: hash(JSON.stringify([oldPath,newPath,oldBlobOid,newBlobOid,m[1],m[2]])), oldPath,newPath,oldBlobOid,newBlobOid, oldMode: m[1] === '000000' ? null : m[1], newMode: m[2] === '000000' ? null : m[2], change: ({ A:'added',D:'deleted',R:'renamed',C:'copied' } as const)[m[5]] ?? (m[3] === m[4] ? 'mode' : 'modified'), additions: null,deletions: null,content:'available',untracked: !!newPath && untracked.includes(newPath) };
    const emptyBlob=await gitText(cwd,['hash-object','-w','--stdin']);
    const stat = file.oldMode==='160000'||file.newMode==='160000'?'':(await git(cwd,[...diffArgs,'--numstat','-z',oldBlobOid??emptyBlob,newBlobOid??emptyBlob,'--'])).toString('utf8');
    const counts = /^(\d+|-)\t(\d+|-)\t/.exec(stat);
    if (counts && counts[1] !== '-') { file.additions = Number(counts[1]); file.deletions = Number(counts[2]); }
    for (const [blob,mode] of [[oldBlobOid,file.oldMode],[newBlobOid,file.newMode]]) {
      if (!blob) continue;
      if (mode === '160000' || mode === '120000') { file.content='omitted'; continue; }
      const size = Number(await gitText(cwd,['cat-file','-s',blob]));
      if (size > LIMITS.fileBytes) { file.content='too-large'; continue; }
      const data = await git(cwd,['cat-file','blob',blob],undefined,{},LIMITS.fileBytes);
      try { new TextDecoder('utf-8',{fatal:true}).decode(data); if (data.includes(0)) file.content='binary'; } catch { file.content='binary'; }
    }
    files.push(file);
    if (files.length > 10_000) throw new ChangesError('output-limit','Too many changed files');
  }
  return files;
}
export async function readFilePatch(cwd: string, r: ReviewRevision, file: ChangedFile): Promise<ReviewFile> {
  if (file.content !== 'available') return { revisionId:r.id,file,patch:'',hunks:[],oldText:null,newText:null };
  const emptyBlob=await gitText(cwd,['hash-object','-w','--stdin']);
  const raw = (await git(cwd,[...diffArgs,'--patch',file.oldBlobOid??emptyBlob,file.newBlobOid??emptyBlob,'--'],undefined,{},LIMITS.fileBytes * 3)).toString('utf8');
  // Blob-to-blob diff avoids Git's directory-prefix pathspec matching when a file became a directory.
  let header=true;const patch=raw.split('\n').map(line=>{if(line.startsWith('@@'))header=false;if(!header)return line;
    if(line.startsWith('diff --git'))return `diff --git ${JSON.stringify('a/'+(file.oldPath??file.newPath))} ${JSON.stringify('b/'+(file.newPath??file.oldPath))}`;
    if(line.startsWith('--- '))return '--- '+(file.oldPath?JSON.stringify('a/'+file.oldPath):'/dev/null');
    if(line.startsWith('+++ '))return '+++ '+(file.newPath?JSON.stringify('b/'+file.newPath):'/dev/null');return line;}).join('\n');
  const text = async (blob: string | null) => blob ? (await git(cwd,['cat-file','blob',blob],undefined,{},LIMITS.fileBytes)).toString('utf8') : '';
  return { revisionId:r.id,file,patch,hunks:parseDiffHunks(patch),oldText:await text(file.oldBlobOid),newText:await text(file.newBlobOid) };
}

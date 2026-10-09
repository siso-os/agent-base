/** Provisioning only: external launchers receive a ready, guarded cwd before starting their host. */
import { readFileSync } from 'node:fs';
import { acceptLaunch, getWorkspace, snapshot, withLaunch } from './worktrees.ts';
const input=JSON.parse(readFileSync(process.argv[2] ?? 0,'utf8'));
const r=await acceptLaunch(input);
await withLaunch(r,async()=>{});
const result=snapshot(getWorkspace(r.workspaceId));
console.log(JSON.stringify({...result,...(result.phase==='ready'?{cwd:getWorkspace(r.workspaceId).worktreePath}:{})}));
if(result.phase!=='ready' && result.phase!=='active')process.exitCode=1;

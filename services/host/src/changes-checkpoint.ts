/** Node owns snapshots. Hosts await a baseline before provider handoff; a missing node means unavailable turn review. */
export async function recordChangesBoundary(sessionId: string | null, token: string, turnId: string, phase: 'baseline'|'completion', providerTurnId?: string, status?: string): Promise<boolean> {
  if (!sessionId || (!process.env.AB_WORKSPACE_RECEIPT && !process.env.AB_CHANGES_URL)) return false;
  try {
    const url = new URL('/api/changes/turns',process.env.AB_CHANGES_URL ?? 'http://127.0.0.1:5401');
    if (url.protocol !== 'http:' || !['127.0.0.1','localhost','[::1]'].includes(url.hostname)) return false;
    const response = await fetch(url,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${token}`},body:JSON.stringify({sessionId,turnId,phase,providerTurnId,status}),signal:AbortSignal.timeout(5000)});
    return response.ok;
  } catch { return false; }
}

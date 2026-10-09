import type { SubagentRowData } from '../components/SubagentRow';
import { FlightLedger } from './delight.ts';
/** A fresh baseline, then explicit start/end transitions. Disappearance, missing status and clock skew are never success. */
export class CodexTransitions {
  private previous: Map<string, SubagentRowData> | null = null;
  private since = 0;
  reset() { this.previous = null; this.since = 0; }
  observe(rows: SubagentRowData[], ledger: FlightLedger, now = Date.now()) {
    const current = new Map(rows.map(r => [`${r.id}:${r.start}`,r]));
    if (!this.previous) { this.since = now; ledger.baseline([...current.keys()], [...current].filter(([,r])=>r.running).map(([id])=>id)); this.previous=current; return; }
    for (const [id,row] of current) {
      const before = this.previous.get(id), start = Date.parse(row.start ?? '');
      if (!before && row.running && start >= this.since && start <= now) ledger.spawn(id);
      if (before?.running && !row.running && ['done','failed','blocked','stopped','killed','error'].includes(row.status ?? '') && !!row.end && Date.parse(row.end) >= start && Date.parse(row.end) <= now) ledger.returned(id);
    }
    this.previous=current;
  }
}

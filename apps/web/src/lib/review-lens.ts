import type { ReviewFile } from './changes';
import type { ChangeLensLine } from '../components/ChangeLens';

/** Keep each side's semantic coordinate; adjacent additions/deletions need not correspond. */
export function reviewLensLines(file: ReviewFile, revisionId: string): ChangeLensLine[] {
  if (file.revisionId !== revisionId || file.file.content !== 'available') return [];
  return file.hunks.flatMap((hunk, h) => hunk.rows.flatMap((row, r): ChangeLensLine[] => {
    const id = `${revisionId}:${file.file.id}:${h}:${r}`;
    if (row.kind === 'deleted' && row.oldLine !== null) return [{ id, before: row.text, beforeLine: row.oldLine }];
    if (row.kind === 'added' && row.newLine !== null) return [{ id, after: row.text, afterLine: row.newLine }];
    return [];
  }));
}

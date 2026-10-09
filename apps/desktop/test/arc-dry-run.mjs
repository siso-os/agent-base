// Counts only: no storage writes and no tab addresses in the result.
import { readFileSync } from 'node:fs';
import { parseArcSidebar } from '../../web/src/lib/webview.ts';
const profiles = parseArcSidebar(readFileSync(process.argv[2], 'utf8'));
console.log(JSON.stringify(profiles.map(p => ({ space: p.name, pinnedTabs: p.pins.length, bookmarks: p.pins.length })), null, 2));

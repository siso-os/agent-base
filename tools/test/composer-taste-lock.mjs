// Freeze dev's actual rendered rim in idle and typing states at 1440x900.
// The capture hides contents and fixes only geometry/animation time, so content changes cannot mask a rim regression.
import {spawnSync} from 'node:child_process';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..');
const result=spawnSync(process.execPath,[path.join(root,'tools/composer-shots.mjs'),'taste'],{cwd:root,stdio:'inherit'});
process.exit(result.status??1);

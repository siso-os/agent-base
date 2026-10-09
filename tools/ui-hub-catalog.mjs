#!/usr/bin/env node
import { syncComponentCatalog } from '../services/node/src/component-catalog.ts';

const [command, root, ...extra] = process.argv.slice(2);
if (!['check', 'sync'].includes(command) || extra.length) {
  console.error('Usage: node --experimental-strip-types tools/ui-hub-catalog.mjs <check|sync> [hub-root]');
  process.exitCode = 2;
} else {
  try {
    const result = syncComponentCatalog(root, command === 'check');
    console.log(JSON.stringify({ command, ...result }));
    if (command === 'check' && result.changed) process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

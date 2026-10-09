/** Test-only conversion prerequisite for the macOS service fixtures on Linux CI.
 * Parse the real generated plist, never return a canned ownership definition.
 * Production paths and all ownership checks remain unchanged.
 */
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';

export function installPlutilFixtureAdapter(definitionsDir) {
  if (existsSync('/usr/bin/plutil')) return { mode: 'native-plutil', restore() {} };
  const root = realpathSync(definitionsDir);
  assert.equal(root, definitionsDir, 'The fixture definitions directory must be canonical');
  const original = childProcess.execFileSync;
  childProcess.execFileSync = function (file, args, options) {
    if (file !== '/usr/bin/plutil') return original.apply(this, arguments);
    assert.equal(args.length, 5, 'Unexpected fixture plist invocation');
    assert.deepEqual(args.slice(0, 4), ['-convert', 'json', '-o', '-']);
    const definition = args[4];
    assert.equal(path.dirname(definition), root, 'Only this fixture can use the adapter');
    assert.match(path.basename(definition), /^[A-Za-z0-9_.-]+\.plist$/);
    assert.equal(realpathSync(definition), definition, 'Fixture plist cannot be a symlink');
    return original('/usr/bin/python3', ['-c',
      'import json,plistlib,sys; print(json.dumps(plistlib.load(open(sys.argv[1], "rb"))))',
      definition,
    ], options);
  };
  syncBuiltinESMExports();
  return {
    mode: 'python-plistlib-fixture',
    restore() { childProcess.execFileSync = original; syncBuiltinESMExports(); },
  };
}

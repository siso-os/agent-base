import assert from 'node:assert/strict';
import childProcess, { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { installPlutilFixtureAdapter } from './helpers/plutil-fixture.mjs';

test('fixture plist conversion parses actual bytes, preserves subprocesses, and restores imports', () => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), '.siso-ephemeral-backend-plutil.')));
  const definitions = path.join(root, 'plists');
  mkdirSync(definitions, { mode: 0o700 });
  const file = path.join(definitions, 'fixture.plist');
  const original = childProcess.execFileSync;
  const native = existsSync('/usr/bin/plutil');
  const adapter = installPlutilFixtureAdapter(definitions);
  const convert = (target = file, args = ['-convert', 'json', '-o', '-', target]) =>
    JSON.parse(execFileSync('/usr/bin/plutil', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  try {
    assert.equal(adapter.mode, native ? 'native-plutil' : 'python-plistlib-fixture');
    const xml = value => `<?xml version="1.0"?><plist version="1.0"><dict><key>Label</key><string>${value}</string><key>ProgramArguments</key><array><string>one</string><string>two &amp; three</string></array><key>Enabled</key><true/><key>Count</key><integer>2</integer></dict></plist>`;
    writeFileSync(file, xml('fixture &lt;A&gt;'), { mode: 0o600 });
    assert.deepEqual(convert(), { Label: 'fixture <A>', ProgramArguments: ['one', 'two & three'], Enabled: true, Count: 2 });
    writeFileSync(file, xml('changed'));
    assert.equal(convert().Label, 'changed', 'Conversion must read current bytes, not a cached definition');
    writeFileSync(file, '<plist><dict><key>broken</key></dict></plist>');
    assert.throws(() => convert(), 'Malformed plist must fail');
    writeFileSync(file, xml('restored'));
    assert.equal(childProcess.execFileSync(process.execPath, ['-e', 'process.stdout.write("forwarded")'], { encoding: 'utf8' }), 'forwarded');
    if (!native) {
      const outside = path.join(root, 'outside.plist');
      writeFileSync(outside, xml('outside'));
      assert.throws(() => convert(outside), /Only this fixture/);
      const link = path.join(definitions, 'link.plist');
      symlinkSync(file, link);
      assert.throws(() => convert(link), /cannot be a symlink/);
      assert.throws(() => convert(file, ['-convert', 'xml1', '-o', '-', file]));
      assert.throws(() => convert(file, ['-convert', 'json', '-o', '-', file, 'extra']));
    } else {
      assert.equal(childProcess.execFileSync, original, 'Native macOS conversion must remain untouched');
    }
  } finally {
    adapter.restore();
    assert.equal(childProcess.execFileSync, original);
    assert.equal(execFileSync, original);
    rmSync(root, { recursive: true, force: true });
  }
});

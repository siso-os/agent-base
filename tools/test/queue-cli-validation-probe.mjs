// Synthetic parser audit: loads tools/ab-queue before its CLI entrypoint and stubs git/runner effects.
// No network, repository mutation, deploy, or real queue runner is invoked.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const repo = path.resolve(import.meta.dirname, '../..');
const queue = path.join(repo, 'tools', 'ab-queue');
const scratch = mkdtempSync(path.join(tmpdir(), 'ab-queue-cli-validation-'));
const harness = path.join(scratch, 'probe.py');
const baseline = path.join(scratch, 'ab-queue-baseline');
writeFileSync(baseline, execFileSync('git', ['show', '0649007:tools/ab-queue'], { encoding: 'utf8' }));
writeFileSync(harness, `import json, os
source = open(os.environ['QUEUE_SOURCE']).read()
ns = {}
ns['__file__'] = os.environ['QUEUE_SOURCE']
ns['__name__'] = 'queue_probe'
exec(source[:source.rfind('\\nif __name__')], ns)
calls = []
class R:
    returncode = 1
    stdout = ''
    stderr = ''
def fake_git(*args, **kwargs):
    calls.append(args)
    return R()
ns['git'] = fake_git
cases = {}
baseline_ns = {'__file__': os.environ['QUEUE_BASELINE'], '__name__': 'queue_baseline'}
baseline_source = open(os.environ['QUEUE_BASELINE']).read()
exec(baseline_source[:baseline_source.rfind('\\nif __name__')], baseline_ns)
try: baseline_ns['add'](['fixture', '--tests'])
except Exception as e: cases['baseline_add_missing_tests'] = type(e).__name__
row_reads = []
ns['rows'] = lambda: row_reads.append('read') or []
import contextlib, io
def invoke(args):
    err = io.StringIO()
    with contextlib.redirect_stderr(err): code = ns['main'](args)
    return code, err.getvalue()
cases['add_missing_tests'], cases['add_missing_tests_stderr'] = invoke(['add', 'fixture', '--tests'])
cases['add_missing_tests_calls'] = calls[:]
calls.clear()
cases['add_missing_by'], cases['add_missing_by_stderr'] = invoke(['add', 'fixture', '--by'])
cases['add_missing_by_calls'] = calls[:]
calls.clear()
cases['add_unknown'], cases['add_unknown_stderr'] = invoke(['add', 'fixture', '--unknown'])
cases['add_unknown_calls'] = calls[:]
cases['status_missing_alarm'], cases['status_missing_alarm_stderr'] = invoke(['status', '--alarm'])
cases['status_missing_alarm_reads'] = row_reads[:]
row_reads.clear()
cases['status_nan_alarm'], cases['status_nan_alarm_stderr'] = invoke(['status', '--alarm', 'NaN'])
cases['status_nan_alarm_reads'] = row_reads[:]
lock_calls = []
ns['lock'] = lambda: lock_calls.append('lock') or True
ns['round_'] = lambda deploy: cases.setdefault('round_args', []).append(deploy) or False
ns['alarms'] = lambda: None
cases['run_unknown'], cases['run_unknown_stderr'] = invoke(['run', '--once', '--unknown'])
cases['run_unknown_lock_calls'] = lock_calls[:]
cases['drop_bad'], cases['drop_bad_stderr'] = invoke(['drop', 'fixture', 'extra'])
cases['drop_bad_reads'] = row_reads[:]
cases['valid_alarm'], cases['valid_alarm_stderr'] = invoke(['status', '--alarm', '0'])
cases['valid_add'], cases['valid_add_stderr'] = invoke(['add', 'fixture', '--tests', 'echo ok', '--by', 'FIXTURE'])
print(json.dumps(cases))
`);

test('queue CLI grammar rejects malformed flags before side effects', () => {
  try {
    const result = spawnSync('python3', [harness], { env: { ...process.env, HOME: scratch, AB_QUEUE_STATE: scratch, QUEUE_SOURCE: queue, QUEUE_BASELINE: baseline }, encoding: 'utf8', timeout: 5000 });
    assert.equal(result.status, 0, result.stderr);
    const cases = JSON.parse(result.stdout.trim());
    assert.equal(cases.baseline_add_missing_tests, 'IndexError');
    assert.equal(cases.add_missing_tests, 2);
    assert.match(cases.add_missing_tests_stderr, /^ab-queue: missing value for --tests\n$/);
    assert.deepEqual(cases.add_missing_tests_calls, []);
    assert.equal(cases.add_missing_by, 2);
    assert.match(cases.add_missing_by_stderr, /^ab-queue: missing value for --by\n$/);
    assert.deepEqual(cases.add_missing_by_calls, []);
    assert.equal(cases.add_unknown, 2);
    assert.match(cases.add_unknown_stderr, /^ab-queue: unknown add flag: --unknown\n$/);
    assert.deepEqual(cases.add_unknown_calls, []);
    assert.equal(cases.status_missing_alarm, 2);
    assert.match(cases.status_missing_alarm_stderr, /^ab-queue: --alarm requires one non-negative finite number\n$/);
    assert.deepEqual(cases.status_missing_alarm_reads, []);
    assert.equal(cases.status_nan_alarm, 2);
    assert.match(cases.status_nan_alarm_stderr, /^ab-queue: --alarm requires one non-negative finite number\n$/);
    assert.deepEqual(cases.status_nan_alarm_reads, []);
    assert.equal(cases.run_unknown, 2);
    assert.match(cases.run_unknown_stderr, /^ab-queue: run accepts only one each/);
    assert.deepEqual(cases.run_unknown_lock_calls, []);
    assert.equal(cases.drop_bad, 2);
    assert.match(cases.drop_bad_stderr, /^ab-queue: drop requires exactly one id\n$/);
    assert.deepEqual(cases.drop_bad_reads, []);
    assert.equal(cases.valid_alarm, 0);
    assert.equal(cases.valid_add, 2, 'valid grammar reaches stubbed git and reports no branch');
    assert.deepEqual(cases.add_unknown_calls, []);
    console.log(JSON.stringify({ check: 'queue CLI grammar validation', noFetch: true, noRowsRead: true, noRunnerLock: true, validAlarm: true }));
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

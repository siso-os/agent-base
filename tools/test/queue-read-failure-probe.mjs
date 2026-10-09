// Synthetic rows() read failures only. No queue paths, deploys, fetches, or real state are accessed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const repo = path.resolve(import.meta.dirname, '../..');
const queue = path.join(repo, 'tools', 'ab-queue');
const scratch = mkdtempSync(path.join(tmpdir(), 'ab-queue-read-failure-'));
const harness = path.join(scratch, 'probe.py');
const baseline = path.join(scratch, 'baseline.py');
writeFileSync(baseline, execFileSync('git', ['show', '11d2e98:tools/ab-queue'], { encoding: 'utf8' }));
writeFileSync(harness, `import contextlib, errno, io, json, os
source = open(os.environ['QUEUE_SOURCE']).read()
ns = {'__file__': os.environ['QUEUE_SOURCE'], '__name__': 'queue_probe'}
exec(source[:source.rfind('\\nif __name__')], ns)
def fail_open(kind):
    def fake_open(*args, **kwargs):
        if kind == 'enoent': raise OSError(errno.ENOENT, 'missing fixture')
        if kind == 'eio': raise OSError(errno.EIO, 'synthetic I/O failure')
        raise UnicodeDecodeError('utf-8', b'\\xff', 0, 1, 'synthetic invalid UTF-8')
    return fake_open
def run(kind, main=False):
    ns['open'] = fail_open(kind)
    if main:
        err = io.StringIO()
        with contextlib.redirect_stderr(err): code = ns['main'](['status', '--json'])
        return {'code': code, 'stderr': err.getvalue()}
    try: return {'rows': ns['rows']()}
    except Exception as e: return {'error': type(e).__name__, 'message': str(e)}
baseline_source = open(os.environ['QUEUE_BASELINE']).read()
b = {'__file__': os.environ['QUEUE_BASELINE'], '__name__': 'queue_baseline'}
exec(baseline_source[:baseline_source.rfind('\\nif __name__')], b)
b['open'] = fail_open('eio')
try: baseline_eio = {'rows': b['rows']()}
except Exception as e: baseline_eio = {'error': type(e).__name__}
print(json.dumps({'baseline_eio': baseline_eio, 'enoent': run('enoent'), 'eio': run('eio'), 'utf8': run('utf8'), 'main_eio': run('eio', True)}))
`);

test('rows distinguishes missing journals from I/O and UTF-8 failures', () => {
  try {
    const result = spawnSync('python3', [harness], { env: { ...process.env, HOME: scratch, AB_QUEUE_STATE: scratch, QUEUE_SOURCE: queue, QUEUE_BASELINE: baseline }, encoding: 'utf8', timeout: 5000 });
    assert.equal(result.status, 0, result.stderr);
    const out = JSON.parse(result.stdout.trim());
    assert.deepEqual(out.baseline_eio, { rows: [] }, 'pinned 11d2e98 broad OSError behavior');
    assert.deepEqual(out.enoent, { rows: [] });
    assert.equal(out.eio.error, 'JournalError');
    assert.match(out.eio.message, /queue\.jsonl unreadable/);
    assert.equal(out.utf8.error, 'JournalError');
    assert.match(out.utf8.message, /not valid UTF-8/);
    assert.equal(out.main_eio.code, 2);
    assert.match(out.main_eio.stderr, /refusing invalid queue journal: queue\.jsonl unreadable/);
    assert.doesNotMatch(out.main_eio.stderr, /Traceback/);
    console.log(JSON.stringify({ check: 'queue read failure boundary', baselineBroadOSError: true, enoentEmpty: true, eioFailClosed: true, utf8FailClosed: true }));
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

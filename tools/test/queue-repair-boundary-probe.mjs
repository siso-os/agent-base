// Pure byte-boundary fixture for a future operator repair workflow. No filesystem or CLI access.
import test from 'node:test';
import assert from 'node:assert/strict';

const valid = JSON.stringify({ id: 'fixture', state: 'queued', at: '2026-10-03T00:00:00+00:00' });
const classify = (bytes) => {
  if (bytes.at(-1) === 0x0a) return { kind: 'complete-journal', action: 'refuse-tail-truncate' };
  const offset = bytes.lastIndexOf(0x0a) + 1;
  const tail = bytes.subarray(offset);
  try {
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(tail));
    if (!value || Array.isArray(value) || typeof value !== 'object' || typeof value.id !== 'string' || typeof value.state !== 'string' || typeof value.at !== 'string') throw new Error('schema');
    return { kind: 'valid-unterminated', action: 'append-newline', truncateAt: bytes.length };
  } catch {
    return { kind: 'malformed-tail', action: 'archive-and-truncate', truncateAt: offset, archivedTail: Buffer.from(tail) };
  }
};

test('repair selection distinguishes valid tail, corrupt tail, invalid UTF-8, and complete malformed lines', () => {
  const complete = Buffer.from(`${valid}\n`);
  assert.deepEqual(classify(Buffer.from(valid)), { kind: 'valid-unterminated', action: 'append-newline', truncateAt: Buffer.byteLength(valid) });
  const malformed = Buffer.from(`${valid}\n{"id":"broken"`);
  const malformedResult = classify(malformed);
  assert.equal(malformedResult.kind, 'malformed-tail');
  assert.equal(malformedResult.action, 'archive-and-truncate');
  assert.equal(malformedResult.truncateAt, Buffer.byteLength(`${valid}\n`));
  assert.equal(malformedResult.archivedTail.toString(), '{"id":"broken"');
  const invalidUtf8 = Buffer.concat([Buffer.from(`${valid}\n`), Buffer.from([0xff, 0xfe])]);
  assert.equal(classify(invalidUtf8).truncateAt, Buffer.byteLength(`${valid}\n`));
  assert.deepEqual(classify(Buffer.concat([Buffer.from(`${valid}\n`), Buffer.from('not-json\n')])), { kind: 'complete-journal', action: 'refuse-tail-truncate' });
  assert.equal(complete.at(-1), 0x0a, 'fixture includes a complete newline boundary');
});

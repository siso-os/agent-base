import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, rm, chmod } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseBrief, findHandoff } from '../src/agent-brief.ts';

test('parseBrief: marker-delimited entry for the agent', async () => {
  const markdown = `
# Some file

<!-- AB-ZERO-20261008 START -->
## AB-ZERO — 8 Oct 2026

**Done:** Feature A landed
**Next:** Feature B
**Open threads:**
- Thread 1
- Thread 2
**Key paths:**
- path/to/file
<!-- AB-ZERO-20261008 END -->

<!-- OTHER-AGENT-DATE START -->
## OTHER

**Done:** Something else
<!-- OTHER-AGENT-DATE END -->
`;
  const brief = parseBrief(markdown, 'AB-ZERO');
  assert.equal(brief.found, true);
  assert.deepEqual(brief.done, ['Feature A landed']);
  assert.deepEqual(brief.next, ['Feature B']);
  assert.equal(brief.threads?.length, 2);
  assert.equal(brief.keyPaths?.length, 1);
});

test('parseBrief: heading-delimited entry', () => {
  const markdown = `
## OLD AGENT — date

Some content here

## BUILDER AGENT — 8 Oct 2026

**Done:** Work 1
**Next:** Work 2

## ANOTHER ONE

Other stuff
`;
  const brief = parseBrief(markdown, 'BUILDER AGENT');
  assert.equal(brief.found, true);
  assert.deepEqual(brief.done, ['Work 1']);
  assert.deepEqual(brief.next, ['Work 2']);
});

test('parseBrief: case-insensitive name matching', () => {
  const markdown = `
## ab-zero — 8 Oct 2026

**Done:** X
`;
  const brief = parseBrief(markdown, 'AB-ZERO');
  assert.equal(brief.found, true);
  assert.deepEqual(brief.done, ['X']);
});

test('parseBrief: no entry for the agent returns found=false', () => {
  const markdown = `
## OTHER AGENT

**Done:** Work
`;
  const brief = parseBrief(markdown, 'NONEXISTENT');
  assert.equal(brief.found, false);
});

test('parseBrief: no entry for agent when only other agents present', () => {
  const markdown = `
<!-- AGENT1-DATE START -->
## AGENT1

**Done:** Work
<!-- AGENT1-DATE END -->

<!-- AGENT2-DATE START -->
## AGENT2

**Done:** More work
<!-- AGENT2-DATE END -->
`;
  const brief = parseBrief(markdown, 'AGENT3');
  assert.equal(brief.found, false);
});

test('parseBrief: missing labels omit those fields', () => {
  const markdown = `
## TEST AGENT

**Done:** Only done
`;
  const brief = parseBrief(markdown, 'TEST AGENT');
  assert.equal(brief.found, true);
  assert.deepEqual(brief.done, ['Only done']);
  assert.equal(brief.next, undefined);
  assert.equal(brief.threads, undefined);
});

test('parseBrief: drops credential-like lines', () => {
  const markdown = `
## TEST AGENT

**Done:** Deployed code
Some line with sk-1234567890abcdef in it
**Next:** More work
`;
  const brief = parseBrief(markdown, 'TEST AGENT');
  assert.equal(brief.found, true);
  // The credential line should be skipped
  assert.deepEqual(brief.done, ['Deployed code']);
});

test('parseBrief: respects 400 KB size limit', () => {
  const large = 'x'.repeat(410 * 1024);
  const markdown = large + `
## TEST AGENT

**Done:** Should not reach here
`;
  const brief = parseBrief(markdown, 'TEST AGENT');
  // Since the entry is beyond 400 KB, it should not be found
  assert.equal(brief.found, false);
});

test('parseBrief: extracts Shaan\'s words', () => {
  const markdown = `
## TEST AGENT

**Shaan's words:** "this is what he said"

**Done:** Work done
`;
  const brief = parseBrief(markdown, 'TEST AGENT');
  assert.equal(brief.found, true);
  assert.equal(brief.words, '"this is what he said"');
});

test('parseBrief: dash-prefixed labels', () => {
  const markdown = `
## TEST AGENT

- **Done:** Item 1
- **Next:** Item 2
`;
  const brief = parseBrief(markdown, 'TEST AGENT');
  assert.equal(brief.found, true);
  assert.deepEqual(brief.done, ['Item 1']);
  assert.deepEqual(brief.next, ['Item 2']);
});

test('findHandoff: returns null when no handoff file exists', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'ab-brief-test-'));
  try {
    const ownersDir = path.join(tempDir, 'owners');
    const hostsDir = path.join(tempDir, 'hosts');
    await mkdir(ownersDir);
    await mkdir(hostsDir);

    const handoff = await findHandoff('NONEXISTENT', { ownersDir, hostsDir });
    assert.equal(handoff, null);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('parseBrief: list items under sections', () => {
  const markdown = `
## TEST AGENT

**Open threads:**
- First thread
- Second thread
- Third thread

**Key paths:**
- src/file.ts
- services/api.ts
`;
  const brief = parseBrief(markdown, 'TEST AGENT');
  assert.equal(brief.found, true);
  assert.deepEqual(brief.threads, ['First thread', 'Second thread', 'Third thread']);
  assert.deepEqual(brief.keyPaths, ['src/file.ts', 'services/api.ts']);
});

test('parseBrief: extracts date from heading', () => {
  const markdown = `
## 8 Oct 2026 · TEST AGENT: Description

**Done:** Work
`;
  const brief = parseBrief(markdown, 'TEST AGENT');
  assert.equal(brief.found, true);
  assert.ok(brief.writtenAt);
});

test('parseBrief: handles GitHub credential patterns', () => {
  const markdown = `
## TEST AGENT

**Done:** Work
Found token ghp_abc1234567890def12345 in config
**Next:** Deploy
`;
  const brief = parseBrief(markdown, 'TEST AGENT');
  assert.equal(brief.found, true);
  assert.deepEqual(brief.done, ['Work']);
  // The credential line should be skipped
});

test('parseBrief: handles Slack token patterns', () => {
  const markdown = `
## TEST AGENT

**Done:** Integrated
Set xoxb-token value in env
**Next:** Test
`;
  const brief = parseBrief(markdown, 'TEST AGENT');
  assert.equal(brief.found, true);
  assert.deepEqual(brief.done, ['Integrated']);
});

test('parseBrief: handles private key patterns', () => {
  const markdown = `
## TEST AGENT

**Done:** Configured
-----BEGIN RSA PRIVATE KEY-----
**Next:** Ship
`;
  const brief = parseBrief(markdown, 'TEST AGENT');
  assert.equal(brief.found, true);
  assert.deepEqual(brief.done, ['Configured']);
});

test('parseBrief: real HANDOFF entry pattern', () => {
  const markdown = `
<!-- AB-ZERO-20261008 START -->
## AB-ZERO — 8 Oct 2026 · the one Agent Base agent

Brief: \`~/path/to/brief.md\`

1. **Done: Rolodex v3 + Life live at \`2a473040\`** (PR #59, \`tools/ab-live\`)
2. **Done: the 36 designs rated** and the process reviewed: \`ui-hub/_astra/runs/\`
3. **Waiting on Shaan:** which of the six builds to run
4. **Next:** his queue, t-0508

Live is \`2a473040\`; main is ahead with docs only.
<!-- AB-ZERO-20261008 END -->
`;
  const brief = parseBrief(markdown, 'AB-ZERO');
  assert.equal(brief.found, true);
  assert.ok(brief.title?.includes('AB-ZERO'));
});

test('route refuses names that could leave the owners and hosts dirs', async () => {
  const { agentBriefRoute } = await import('../src/routes/agent-brief.route.ts');
  const route = agentBriefRoute();
  for (const raw of ['..%2F..%2Fetc', '..', '%2Fetc%2Fpasswd', 'a%00b']) {
    const m = `/api/agents/${raw}/brief`.match(route.path);
    assert.ok(m, raw);
    let code = 0;
    const res = { writeHead(c) { code = c; }, end() {} };
    await route.handle({}, res, m);
    assert.equal(code, 400, raw);
  }
});

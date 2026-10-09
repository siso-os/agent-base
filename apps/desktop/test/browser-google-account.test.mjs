import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createGoogleAccount, loadAccounts, loadArcProfiles } from '../../web/src/lib/webview.ts';
const script = readFileSync(new URL('../src/browser-google-account.js', import.meta.url), 'utf8');
const read = (host, label, protocol = 'https:') => runInNewContext(script, {
  location: { protocol, hostname: host },
  document: { querySelector: selector => {
    assert.equal(selector, '[aria-label^="Google Account:"]');
    return label ? { getAttribute: name => { assert.equal(name, 'aria-label'); return label; } } : null;
  } },
});
test('only the signed-in Google avatar supplies the fake account address', () => {
  assert.equal(read('myaccount.google.com', 'Google Account: Fake User (fake@example.invalid)'), 'fake@example.invalid');
  assert.equal(read('accounts.google.com', null), '');
  assert.equal(read('mail.google.com', 'Google Account: Fake User'), '');
  assert.equal(read('evil.invalid', 'Google Account: fake@example.invalid'), '');
  assert.equal(read('accounts.google.com.evil.invalid', 'Google Account: fake@example.invalid'), '');
  assert.equal(read('myaccount.google.com', 'Google Account: fake@example.invalid', 'http:'), '');
});
test('quick-add creates separate Google accounts (own stores) before authentication, and no spaces', () => {
  const values = new Map();
  const store = { getItem: k => values.get(k), setItem: (k, v) => values.set(k, v) };
  const first = createGoogleAccount(store), second = createGoogleAccount(store);
  assert.notEqual(first.id, second.id);
  assert.match(first.id, /^google:/);
  assert.equal(first.name, 'Google account 1');
  assert.equal(second.name, 'Google account 2');
  assert.deepEqual(loadAccounts(store).map(a => a.id), ['personal', first.id, second.id]);
  assert.ok(loadAccounts(store).slice(1).every(a => a.pendingGoogle));
  assert.equal(loadArcProfiles(store).length, 0);
});

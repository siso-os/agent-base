// Fake native bridge only: the sign-in check reads a boolean per account store (cookie names natively), never a value.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const signedIn = new Map();
const asked = [];
globalThis.window = { __TAURI_INTERNALS__: { invoke: async (command, args) => {
  if (command !== 'browser_session_state') throw new Error(`unexpected ${command}`);
  asked.push(args.account);
  return signedIn.get(args.account) ?? false;
} } };
const { accountStatus, checkSessions, loadAccounts, noteSession, saveAccounts, signInNext } = await import('../../web/src/lib/webview.ts');
const memory = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };

test('launch check: signed in before and now = survived the restart; signed in before, out now = Google signed it out', async () => {
  const store = memory();
  saveAccounts([
    { id: 'personal', name: 'Default', source: 'default' },
    { id: 'chrome:Default', name: 'one@example.invalid', email: 'one@example.invalid', signedIn: true },
    { id: 'chrome:Profile 2', name: 'two@example.invalid', email: 'two@example.invalid', signedIn: true },
    { id: 'chrome:Profile 3', name: 'three@example.invalid', email: 'three@example.invalid' },
  ], store);
  signedIn.set('chrome:Default', true);
  const after = await checkSessions(store, true);
  assert.deepEqual(asked, ['personal', 'chrome:Default', 'chrome:Profile 2', 'chrome:Profile 3']);
  const by = id => after.find(a => a.id === id);
  assert.ok(by('chrome:Default').restartOkAt);
  assert.match(accountStatus(by('chrome:Default')).detail, /^Still signed in after restart · /);
  assert.equal(accountStatus(by('chrome:Profile 2')).label, 'Google signed this out');
  assert.equal(accountStatus(by('chrome:Profile 3')).label, 'Needs sign-in');
  assert.deepEqual(loadAccounts(store), after, 'saved to the store (the node)');
  assert.equal(signInNext(after).id, 'chrome:Profile 2');
  assert.ok(!JSON.stringify(after).match(/cookie|SID/i));
});

test('a check that is not a launch never claims a restart; signing in clears "signed out" and the pending state', () => {
  const a = { id: 'g', name: 'x@example.invalid', email: 'x@example.invalid', signedIn: true };
  assert.equal(noteSession(a, true, 5).restartOkAt, undefined);
  const lost = noteSession(a, false, 6);
  assert.equal(lost.lostAt, 6);
  const back = noteSession({ ...lost, pendingGoogle: true }, true, 7);
  assert.equal(back.lostAt, undefined);
  assert.equal(back.pendingGoogle, false);
  assert.equal(accountStatus({ id: 'n', name: 'n' }).label, 'Not checked');
  assert.equal(accountStatus({ id: 'p', name: 'p', pendingGoogle: true }).label, 'Signing in…');
  assert.equal(signInNext([{ id: 'personal', name: 'Default' }, { ...a }]), undefined);
});

test('signed-in proof (t-0242): cookie names and a count from the store read, never a value; an older app answers a boolean', async () => {
  const { readSession } = await import('../../web/src/lib/webview.ts');
  const { checkedLine, proofText } = await import('../../web/src/lib/browser-setup.ts');
  assert.deepEqual(readSession(true), { signedIn: true });
  assert.deepEqual(readSession([true, ['SID', '__Secure-1PSID'], 23]), { signedIn: true, proof: { names: ['SID', '__Secure-1PSID'], count: 23 } });
  assert.deepEqual(readSession([false, [], 2]), { signedIn: false, proof: { names: [], count: 2 } });
  assert.deepEqual(readSession([true, ['SID', 'a value=with spaces', 7], -1]).proof, { names: ['SID'], count: 0 }, 'anything not a cookie name is dropped');
  assert.equal(readSession('yes'), null);
  const at = new Date(2026, 9, 3, 4, 31).getTime();
  const proved = noteSession({ id: 'a', name: 'a@example.invalid', email: 'a@example.invalid' }, true, at, false, { names: ['SID'], count: 9 });
  assert.deepEqual(proved.proof, { names: ['SID'], count: 9 });
  assert.match(checkedLine(proved, 'Signed in'), /^Signed in · checked 0?4:31/);
  assert.equal(proofText(proved), 'SID · 9 Google cookies');
  assert.equal(proofText(noteSession(proved, false, at, false, { names: [], count: 1 })), 'No Google session cookie · 1 Google cookie');
  assert.equal(noteSession(proved, true, at).proof, undefined, 'an older app: no stale proof kept');
  assert.equal(proofText({}), 'Not read yet');
  assert.equal(checkedLine({}, 'Needs sign-in'), 'Needs sign-in');
});

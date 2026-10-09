// FAKE data only. The sign-in sheet (A0 arc-edges §2.1): its steps from Google's address, what it keeps on the account
// (signed in when Google showed the address; "Didn't finish" at a step), "Keep it as <other>" and "Try again" in a fresh store.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { accountStatus, freshStore, loadAccounts, moveSignIn, noteSession, noteSignIn, saveAccounts, storeOf } = await import('../../web/src/lib/webview.ts');
const { proofText, signInStep } = await import('../../web/src/lib/browser-setup.ts');
const memory = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };

test('steps follow Google\'s address only; a refusal is "blocked"; other pages keep the step', () => {
  assert.equal(signInStep('https://accounts.google.com/AccountChooser?Email=fake%40example.invalid'), 0);
  assert.equal(signInStep('https://accounts.google.com/v3/signin/identifier?flowName=GlifWebSignIn'), 0);
  assert.equal(signInStep('https://accounts.google.com/v3/signin/challenge/pwd?TL=fake'), 1);
  assert.equal(signInStep('https://accounts.google.com/v3/signin/challenge/ipp/consent'), 2);
  assert.equal(signInStep('https://accounts.google.com/signin/rejected?rrk=46'), 'blocked');
  assert.equal(signInStep('https://mail.google.com/mail/u/0/'), null);
  assert.equal(signInStep('https://accounts.google.com.fake.invalid/challenge/pwd'), null);
  assert.equal(signInStep('not a url'), null);
});

test('Google showed the address: signed in now, with how it is known; closing early keeps the step until a sign-in', () => {
  const store = memory();
  saveAccounts([{ id: 'chrome:1', name: 'P1', email: 'fake.one@example.invalid', signedIn: false, lostAt: 5 }], store);
  let a = noteSignIn(store, 'chrome:1', 1000, 'password').find((x) => x.id === 'chrome:1');
  assert.deepEqual(a.signInStop, { step: 'password', at: 1000 });
  assert.equal(accountStatus(a, 2000).label, "Didn't finish");
  assert.match(accountStatus(a, 2000).detail, /^stopped at password · /);
  a = noteSignIn(store, 'chrome:1', 3000).find((x) => x.id === 'chrome:1');
  assert.deepEqual([a.signedIn, a.shownAt, a.checkedAt, a.lostAt, a.signInStop], [true, 3000, 3000, undefined, undefined]);
  assert.equal(accountStatus(a).label, 'Signed in');
  assert.match(proofText(a), /^Google showed this address in the sign-in sheet · /);
  assert.equal(proofText({ ...a, proof: { names: ['SID'], count: 4 } }), 'SID · 4 Google cookies', 'the store read wins once it ran');
  assert.equal(noteSession({ ...a, signInStop: { step: 'address', at: 1 } }, true, 4000).signInStop, undefined, 'a signed-in check clears a stop');
});

test('Keep it as <other>: that row takes the store, the asked-for row gets a fresh one; never onto itself', () => {
  const store = memory();
  saveAccounts([{ id: 'chrome:1', name: 'P1', email: 'fake.one@example.invalid', store: 'store:a' }, { id: 'chrome:2', name: 'P2', email: 'fake.two@example.invalid', signedIn: false }], store);
  assert.equal(moveSignIn(store, 'chrome:1', 'fake.two@example.invalid'), null, 'a named row moves only when asked');
  assert.equal(moveSignIn(store, 'chrome:1', 'FAKE.ONE@example.invalid', true), null);
  const r = moveSignIn(store, 'chrome:1', 'fake.two@example.invalid', true);
  assert.equal(r.to, 'chrome:2');
  const [one, two] = ['chrome:1', 'chrome:2'].map((id) => loadAccounts(store).find((a) => a.id === id));
  assert.equal(storeOf(two), 'store:a');
  assert.match(storeOf(one), /^store:[0-9a-f-]{36}$/);
});

test('Try again: a fresh empty store for that row only, its status starts over', () => {
  const store = memory();
  saveAccounts([{ id: 'chrome:1', name: 'P1', email: 'fake.one@example.invalid', store: 'store:a', signedIn: true, checkedAt: 1, proof: { names: ['SID'], count: 2 }, shownAt: 1 }, { id: 'chrome:2', name: 'P2', email: 'fake.two@example.invalid', signedIn: true }], store);
  const next = freshStore(store, 'chrome:1');
  const one = next.find((a) => a.id === 'chrome:1');
  assert.notEqual(storeOf(one), 'store:a');
  assert.deepEqual([one.signedIn, one.checkedAt, one.proof, one.shownAt, one.email], [undefined, undefined, undefined, undefined, 'fake.one@example.invalid']);
  assert.equal(next.find((a) => a.id === 'chrome:2').signedIn, true);
});

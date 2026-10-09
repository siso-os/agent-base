// Synthetic-only rendered regression. Run with heavy -- node apps/web/test/rolodex-preview.mjs [URL] [existing-shots-dir].
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '../../..');
const { webkit } = createRequire(path.join(root, 'services/node/package.json'))('playwright');
const url = process.argv[2] ?? 'http://127.0.0.1:5417/preview/rolodex.html';
const address = new URL(url);
assert.ok(['127.0.0.1', 'localhost'].includes(address.hostname) && address.pathname === '/preview/rolodex.html');
const shots = process.argv[3];
assert.ok(!shots || existsSync(shots), 'Use an existing evidence directory');
const checks = [], errors = [];
const browser = await webkit.launch({ headless: true });
const page = await browser.newPage();
page.on('pageerror', e => errors.push(e.message));
// The fixture intercepts /api in memory. Fail closed if any API or external request escapes it.
await page.route('**/*', async route => {
  const request = new URL(route.request().url());
  if (request.origin !== address.origin || request.pathname.startsWith('/api/')) {
    errors.push('Unexpected request outside the sealed preview');
    return route.abort();
  }
  return route.continue();
});
const go = async (query = '', ready = '.rolodex-list') => {
  await page.goto(url + query); await page.locator(ready).waitFor();
};
const ok = name => { checks.push(name); console.log('PASS ' + name); };
const wait = expression => page.waitForFunction(expression);
const shot = async name => { if (shots) await page.screenshot({ path: path.join(shots, name + '.png') }); };
try {
  for (const width of [1440, 1100, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    for (const [name, query, ready] of [['list', '', '.rolodex-list'], ['person', '?person=1', '.rolodex-person'], ['sort', '?sel=sort', '.rolodex-sortcard'], ['want', '?sel=want', '.rolodex-want']]) {
      await go(query, ready);
      await shot(`astra-after-${name}-${width}`);
      assert.ok(await page.evaluate(() => document.body.scrollWidth <= innerWidth), `${name} ${width}: page overflow`);
      assert.ok(await page.evaluate(() => [...document.querySelectorAll('.rolodex-space, .rolodex-person, .rolodex-sortcard')].every(e => e.scrollWidth <= e.clientWidth + 1)), `${name} ${width}: pane overflow`);
      if (width === 390) assert.ok(await page.locator('.rolodex-mobile-nav').isVisible() && !await page.locator('[data-rolodex-nav]').isVisible());
    }
    ok(`${width}px list, person, sort and want layouts fit`);
  }
  await go();
  await page.getByRole('searchbox').focus(); await page.keyboard.press('ArrowDown');
  assert.equal(await page.locator('.rolodex-person').count(), 0);
  await page.getByLabel('Rolodex page', { exact: true }).selectOption('sort'); await page.locator('.rolodex-sortcard').waitFor();
  ok('mobile navigation works; search arrows preserve the list');

  await go('?sel=sort', '.rolodex-sortcard');
  const seen = [];
  for (let i = 0; i < 7; i++) { seen.push(await page.locator('.rolodex-sortcard h2').innerText()); await page.getByRole('button', { name: 'Skip', exact: true }).click(); }
  assert.equal(new Set(seen.slice(0, 5)).size, 5); assert.deepEqual(seen.slice(5), seen.slice(0, 2));
  ok('Skip keeps rotating after a complete pass');

  await go('?sel=sort', '.rolodex-sortcard');
  // Enter on a focused level must activate that level, not the global proposal shortcut.
  await page.locator('.rolodex-levels [data-level=client]').focus(); await page.keyboard.press('Enter');
  await wait('document.querySelector(".rolodex-recent button")?.disabled === false');
  await page.locator('.rolodex-recent button').click(); await page.locator('.rolodex-person').waitFor();
  assert.equal(await page.locator('.rolodex-levelpill').innerText(), 'Client');
  ok('keyboard placement opens the created person at the selected level');

  await go('?sel=sort', '.rolodex-sortcard');
  for (let i = 0; i < 5; i++) await page.locator('.rolodex-levels .is-off:not(:disabled)').click();
  await page.getByRole('button', { name: 'Undo last placement' }).click(); await page.locator('.rolodex-sortcard').waitFor();
  ok('final-card Undo restores a dismissed card');

  await go('?sel=gaps', '.rolodex-ask');
  const asks = [];
  for (let i = 0; i < 12; i++) { asks.push(await page.locator('.rolodex-sortcard').getAttribute('aria-label')); await page.getByRole('button', { name: 'Skip', exact: true }).click(); }
  assert.notEqual(asks.at(-1), asks.at(-2));
  await go('?sel=gaps', '.rolodex-ask');
  await page.locator('.rolodex-voice input').fill('3 March'); await page.locator('.rolodex-voice button').click();
  await wait('document.querySelector(".rolodex-deck__head [role=status]").textContent.includes("1 answered")');
  ok('gap Skip rotates and an answer advances the deck');

  await go('?sel=want', '.rolodex-want');
  await page.getByLabel('Profile link', { exact: true }).fill('https://www.linkedin.com/in/rowan-synthetic');
  await page.getByLabel('Why you want to know them').fill('Synthetic product research');
  await page.locator('.rolodex-want button').click();
  await wait('document.querySelector(".rolodex-person__name")?.textContent === "Rowan Synthetic"');
  await page.getByRole('button', { name: "We've met → Network" }).click();
  await wait('document.querySelector(".rolodex-levelpill").textContent === "Network"');
  await page.getByLabel('Log a touch').fill('Synthetic introduction'); await page.locator('.rolodex-touch button').click();
  await wait('document.querySelector(".rolodex-timeline").textContent.includes("Synthetic introduction")');
  ok('profile link creates a card; met and touch update its history');

  await go('?person=1&delay=700', '.rolodex-notes');
  const notes = page.getByRole('textbox', { name: 'Notes', exact: true });
  for (const scenario of ['newer', 'revert']) {
    const newer = scenario === 'revert' ? await notes.inputValue() : 'Newer synthetic draft';
    await notes.fill('Submitted synthetic draft'); await page.locator('.rolodex-panel.is-next h3').click();
    await notes.fill(newer); await page.waitForTimeout(950);
    assert.equal(await notes.inputValue(), newer, 'Response overwrote a newer/reverted draft');
    await page.locator('.rolodex-panel.is-next h3').click();
    await wait('document.querySelector("[aria-label=Notes] [role=status]").textContent === "Saved"');
  }
  ok('delayed notes saves preserve both newer typing and intentional reverts');

  await go('?person=1&failOnce', '.rolodex-notes');
  await notes.fill('Retry synthetic draft'); await page.locator('.rolodex-panel.is-next h3').click();
  await page.getByRole('button', { name: 'Retry notes save' }).click();
  await wait('document.querySelector("[aria-label=Notes] [role=status]").textContent === "Saved"');
  ok('failed notes save retains its draft and retries');

  await go('?sel=sort&failOnce', '.rolodex-sortcard');
  await page.locator('.rolodex-levels [data-level=friend]').click(); await page.locator('.rolodex-person__error').waitFor();
  await page.locator('.rolodex-sortcard').waitFor(); assert.equal(await page.locator('.rolodex-recent').count(), 0);
  ok('failed placement restores the card without a success receipt');

  for (const [name, query, ready] of [['loading', '?loading', '.rolodex-skel'], ['error', '?error', '.rolodex-error'], ['empty', '?empty', '.rolodex-empty'], ['offline', '?sel=sort&offline', '.rolodex-done']]) {
    await go(query, ready); await shot(`astra-after-${name}-390`);
    if (name === 'offline') assert.ok(!(await page.locator('.rolodex-done').innerText()).includes("Everyone's sorted"));
  }
  ok('loading, error, empty and offline states render honestly');
  assert.deepEqual(errors, []); ok('no page errors or escaped API/external requests');
  if (shots) writeFileSync(path.join(shots, 'astra-checks.json'), JSON.stringify({ url, synthetic: true, browser: 'headless WebKit', checkedAt: new Date().toISOString(), checks }, null, 2) + '\n');
} finally { await browser.close(); }

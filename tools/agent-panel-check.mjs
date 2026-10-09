import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const root = path.resolve(import.meta.dirname, '..'), deps = process.env.AB_DEPENDENCY_ROOT ?? root;
const out = process.env.AB_PANEL_OUTPUT ?? path.join(root, '.agents/scratchpads/agent-panel');
const require = createRequire(path.join(deps, 'services/node/package.json'));
const { webkit } = require('playwright');
const url = process.env.AB_PANEL_URL ?? 'http://127.0.0.1:8878/agent-companion.html';
const result = { checks: [], errors: [], screenshots: [], engine: 'WebKit', url };
let browser;
const check = (name, passed) => { assert.ok(passed, name); result.checks.push(name); };
try {
  browser = await webkit.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1080 }, locale: 'en-GB', timezoneId: 'Asia/Ho_Chi_Minh', reducedMotion: 'reduce' });
  page.on('pageerror', e => result.errors.push(e.message));
  const fresh = async (state = 'working', width = 360) => { await page.goto(`${url}?state=${state}&width=${width}`); await page.getByTestId('companion-overview').waitFor(); await page.getByRole('button', { name: /CURRENT STEP|CURRENT FOCUS/ }).waitFor(); };
  const tab = async name => { await page.getByRole('tab', { name, exact: true }).click(); };
  const shot = async name => { const file = path.join(out, `${name}.png`); await page.screenshot({ path: file }); result.screenshots.push(file); };
  const bounds = async label => {
    const info = await page.getByTestId('agent-panel').evaluate(el => {
      const box = el.getBoundingClientRect(); const nav = el.querySelector('[role=tablist]');
      return { page: document.documentElement.scrollWidth <= innerWidth, panel: box.left >= -1 && box.right <= innerWidth + 1, nav: nav.scrollWidth <= nav.clientWidth + 1, clipped: [...el.querySelectorAll('.ac-team-copy strong,.ab-task__title,.ab-tcard__phase-step,.twd-head,.ac-delivery')].filter(x => x.getClientRects().length).filter(x => { const r = x.getBoundingClientRect(); return r.left < box.left - 1 || r.right > box.right + 1; }).map(x => x.className) };
    });
    check(`${label}: page and panel fit`, info.page && info.panel);
    check(`${label}: five tabs fit without horizontal scrolling`, info.nav);
    check(`${label}: content stays inside panel`, info.clipped.length === 0);
  };
  for (const [viewport, panel] of [[1440,320],[1440,360],[1440,520],[1100,360],[390,360]]) {
    await page.setViewportSize({ width: viewport, height: viewport === 390 ? 844 : 1080 });
    await fresh('working', panel);
    await page.getByTestId('companion-spend').getByText('$10.66', { exact: true }).waitFor();
    check(`five primary tabs ${viewport}/${panel}`, await page.getByRole('tab').count() === 5);
    await bounds(`overview ${viewport}/${panel}`); await shot(`overview-${viewport}-${panel}`);
    await tab('Team'); await page.getByTestId('companion-team').waitFor(); await bounds(`team ${viewport}/${panel}`);
    check(`worker nested under owner ${viewport}/${panel}`, await page.locator('[data-node-id=example-base] .ac-team-children [data-node-id=example-design]').count() === 1);
    check(`finished worker initially folded ${viewport}/${panel}`, !(await page.getByRole('button',{name:'Details for SOURCE REVIEW'}).isVisible()));
    await shot(`team-${viewport}-${panel}`);
    // A project is a row that opens its own view with Back (A0-PANEL, 6 Oct 22:35).
    await tab('Tasks'); await page.locator('[data-testid=task-project][data-project=agent-base]').click();
    const deck = page.getByTestId('task-project-view');
    check(`project view has its Back ${viewport}/${panel}`, await page.getByTestId('task-project-back').isVisible());
    const task = deck.locator('.ab-task__line').first();
    if (await task.getAttribute('aria-expanded') !== 'true') await task.click();
    await page.locator('[data-task-step=demo-02-build-2]').waitFor();
    // Finished steps fold into the phase's count since c25d4fc7 (open-only tree); the count is the completed context.
    check(`current step and completed context ${viewport}/${panel}`, (await deck.innerText()).includes('1/3'));
    await bounds(`tasks ${viewport}/${panel}`); await shot(`tasks-${viewport}-${panel}`);
    // Esc inside a project goes back to the projects, not out of Tasks.
    await page.keyboard.press('Escape'); await page.getByTestId('task-projects').waitFor();
    check(`Esc in a project returns to projects ${viewport}/${panel}`, await page.getByTestId('agent-panel').getAttribute('data-drill') === 'page');
    await tab('Activity'); await page.getByTestId('delivery-pipeline').waitFor(); await bounds(`activity ${viewport}/${panel}`); await shot(`activity-${viewport}-${panel}`);
  }
  await page.setViewportSize({ width: 1440, height: 1080 }); await fresh();
  await page.getByRole('tab',{name:'Overview',exact:true}).focus(); await page.keyboard.press('ArrowRight');
  check('ArrowRight selects Tasks and focuses its tab', await page.getByRole('tab',{name:'Tasks',exact:true}).evaluate(el => el === document.activeElement && el.getAttribute('aria-selected') === 'true'));
  await page.keyboard.press('End'); check('End selects Activity', await page.getByRole('tab',{name:'Activity',exact:true}).getAttribute('aria-selected') === 'true');
  await page.keyboard.press('Home'); check('Home selects Overview', await page.getByRole('tab',{name:'Overview',exact:true}).getAttribute('aria-selected') === 'true');
  await page.getByRole('button',{name:'Open Stats',exact:true}).click();
  check('Stats remains available from Overview', await page.getByTestId('stats-tiles').count() > 0);
  await page.keyboard.press('Escape'); await page.getByTestId('companion-overview').waitFor();
  check('Escape returns to the Overview tab', await page.getByRole('tab',{name:'Overview',exact:true}).evaluate(el => el === document.activeElement));
  await page.getByTestId('companion-spend').click(); await page.getByTestId('spend-total').waitFor();
  check('Spend opens existing attribution view', (await page.getByTestId('spend-total').innerText()).includes('$10.66'));
  await bounds('spend detail'); await shot('spend-detail'); await tab('Overview');
  await page.getByRole('button',{name:'More',exact:true}).click();
  check('Changes, Board and Widgets are secondary tools', (await page.locator('.ac-secondary-tools').innerText()).includes('Changes') && (await page.locator('.ac-secondary-tools').innerText()).includes('Your board') && (await page.locator('.ac-secondary-tools').innerText()).includes('Widgets'));
  check('Infrastructure is absent from agent navigation', await page.getByRole('tab',{name:'Infrastructure',exact:true}).count() === 0);
  await tab('Team'); await page.getByRole('button',{name:'Details for PANEL DESIGN',exact:true}).click();
  check('Team expands readable details in place', (await page.locator('.ac-team-detail').innerText()).includes('Fit the task tree'));
  await page.getByRole('button',{name:'Open conversation',exact:true}).click();
  check('Team invokes the existing conversation callback', (await page.getByTestId('preview-receipt').innerText()).includes('PANEL DESIGN'));
  await shot('team-detail');
  await page.getByRole('button',{name:'Open full org graph',exact:true}).click();
  check('Full org graph remains accessible', (await page.getByTestId('preview-receipt').innerText()).includes('Full org graph'));
  await page.getByRole('button',{name:'Active',exact:true}).click();
  check('Active filter retains owner context and hides idle-only owners', await page.getByRole('button',{name:'Details for AGENT BASE',exact:true}).isVisible() && !(await page.getByRole('button',{name:'Details for SISO AGENCY',exact:true}).isVisible()));
  await page.getByRole('button',{name:'Active',exact:true}).click();
  await page.getByRole('textbox',{name:'Find a team member'}).fill('keyboard');
  check('Worker search retains its parent owner', await page.getByRole('button',{name:'Details for AGENT BASE',exact:true}).isVisible() && await page.getByRole('button',{name:'Details for INTERACTION QA',exact:true}).isVisible());
  await page.getByRole('textbox',{name:'Find a team member'}).fill('SOURCE REVIEW');
  check('Search reveals a finished worker inside its owner', await page.getByRole('button',{name:'Details for SOURCE REVIEW',exact:true}).isVisible());
  await tab('Tasks'); await page.getByRole('textbox',{name:'Search tasks'}).fill('keyboard');
  check('Descendant search reveals its task and phase', await page.locator('[data-task-step=demo-02-build-3]').isVisible() && (await page.locator('[data-workspace=agent-base]').innerText()).includes('A quieter agent panel'));
  await page.getByRole('textbox',{name:'Search tasks'}).fill('Read the current routes');
  check('Completed step search retains its open parent', await page.locator('[data-task-step=demo-01-discover-1]').isVisible());
  await page.getByRole('textbox',{name:'Search tasks'}).fill('');
  check('Done counts root tasks, not completed child phases', await page.getByRole('button',{name:'Done 1',exact:true}).count() === 1);
  await tab('Pages'); await page.getByRole('button',{name:'Agent panel · component review example.test',exact:true}).click();
  check('Pages keeps its existing open callback', (await page.getByTestId('preview-receipt').innerText()).includes('Agent panel · component review'));
  await tab('Activity'); await page.getByRole('button',{name:'Review: 1 pending',exact:true}).click();
  check('Delivery stages filter the recorded pending rows', await page.locator('[data-testid=delivery-pipeline] [data-testid=timeline-moment]').count() === 1);
  await page.locator('[data-testid=delivery-pipeline] [data-testid=timeline-moment]').click();
  check('Pipeline detail retains delivery uncertainty', (await page.getByTestId('timeline-detail').innerText()).includes('delivery unverified'));
  await page.getByRole('button',{name:'Back to timeline',exact:true}).click();
  check('Pipeline details return to the selected stage', await page.getByRole('button',{name:'Review: 1 pending',exact:true}).getAttribute('aria-pressed') === 'true');
  for (const state of ['long','owner','empty','stale','unavailable']) {
    await fresh(state,320);
    if (state === 'stale' || state === 'unavailable') {
      await page.getByTestId('companion-spend').getByText('Current total unavailable',{exact:true}).waitFor();
      check(`${state}: missing spend does not become zero`, !(await page.getByTestId('companion-spend').innerText()).includes('$0.00') && (await page.getByTestId('companion-spend').innerText()).includes('—'));
    }
    if (state === 'unavailable') {
      await tab('Tasks'); await page.getByText("Agent Zero's task list is not readable right now.").waitFor(); check('Task source failure is visible',true);
      await tab('Activity'); await page.getByText(/Timeline unavailable \(503\)/).waitFor(); check('Timeline source failure is visible',true);
    }
    await tab('Team'); await page.getByTestId('companion-team').waitFor(); await bounds(`${state} team`);
    if (state === 'long') { check('Long names use compact type', await page.getByRole('button',{name:'Details for RESPONSIVE ACCESSIBILITY AND INTERACTION REVIEW',exact:true}).locator('strong').evaluate(el => parseFloat(getComputedStyle(el).fontSize) <= 12)); await page.getByRole('button',{name:'Details for RESPONSIVE ACCESSIBILITY AND INTERACTION REVIEW',exact:true}).click(); }
    if (state === 'owner') check('Owner view excludes other teams', !(await page.getByTestId('companion-team').innerText()).includes('SISO AGENCY'));
    if (state === 'empty') check('Empty team is explicit', (await page.getByTestId('companion-team').innerText()).includes('No team members recorded'));
    if (state === 'unavailable') { await page.getByText(/Could not refresh delegated runs/).waitFor(); check('Delegation outage remains explicit',true); }
    await shot(`state-${state}`);
  }
  await fresh(); await page.getByRole('tab',{name:'Overview',exact:true}).focus(); await page.keyboard.press('Escape'); await page.getByTestId('agent-panel').waitFor({state:'detached'});
  check('Escape closes the panel and restores the opener', await page.getByTestId('chat-panel-toggle').evaluate(el => el === document.activeElement));
  check('Preview sends no writes', await page.evaluate(() => window.__companionFixture.writes.length === 0));
  check('No browser errors', result.errors.length === 0);
  console.log(JSON.stringify({ passed:result.checks.length, errors:result.errors, screenshots:result.screenshots.length }));
} catch (error) { result.failure = String(error.stack || error); console.error(result.failure); process.exitCode = 1; }
finally { if (browser) await browser.close(); fs.writeFileSync(path.join(out,'browser-checks.json'),JSON.stringify(result,null,2)); }

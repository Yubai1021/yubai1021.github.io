'use strict';

// Optional browser checks, separate from the 46 dependency-free gameplay tests.
// Install playwright (or expose it with NODE_PATH), then:
// node games/life/tests/mobile-layout.cjs
// BROWSER_CHANNEL=msedge (default), chromium, or chrome; LIFE_HTML selects a baseline.
// MOBILE_SCREENSHOTS saves PNGs; MOBILE_REPORT optionally writes the JSON report.
// MOBILE_WIDTHS=360,390,430,1280 optionally selects a subset (e.g. for a baseline).
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const source = process.env.LIFE_HTML || path.join(__dirname, '..', 'index.html');
const screenshots = process.env.MOBILE_SCREENSHOTS;
const report = { browser: process.env.BROWSER_CHANNEL || 'msedge', checks: [], errors: [] };
const record = (scenario, name, pass, detail) => report.checks.push({ scenario, name, pass, detail });

async function inspect(page, scenario, { controls = '', text = '', font = 13 } = {}) {
  const metrics = await page.evaluate(({ controls, text }) => {
    const visible = el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
    const items = selector => selector ? [...document.querySelectorAll(selector)].filter(visible) : [];
    return {
      width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
      controls: items(controls).map(el => {
        const r = el.getBoundingClientRect();
        return { text: el.textContent.trim().slice(0, 30), width: r.width, height: r.height };
      }),
      text: items(text).map(el => ({ text: el.textContent.trim().slice(0, 30), size: parseFloat(getComputedStyle(el).fontSize) }))
    };
  }, { controls, text });
  record(scenario, 'no horizontal document overflow', metrics.scrollWidth <= metrics.width + 1, { viewport: metrics.width, content: metrics.scrollWidth });
  // The desktop keeps its original density; touch/font floors target phones.
  if (controls && metrics.width <= 600) record(scenario, 'controls at least 44 × 44 CSS px', metrics.controls.length > 0 && metrics.controls.every(x => x.width >= 43.9 && x.height >= 43.9), metrics.controls.filter(x => x.width < 43.9 || x.height < 43.9));
  if (text && metrics.width <= 600) record(scenario, `text at least ${font} CSS px`, metrics.text.length > 0 && metrics.text.every(x => x.size >= font), metrics.text.filter(x => x.size < font));
}

async function screenshot(page, name, locator) {
  if (!screenshots) return;
  fs.mkdirSync(screenshots, { recursive: true });
  const options = { path: path.join(screenshots, name + '.png'), animations: 'disabled' };
  if (locator) await page.locator(locator).screenshot(options);
  else {
    const modal = await page.locator('.motiveDrawModal.on, .explorationModal.on').count();
    await page.screenshot({ ...options, fullPage: !modal });
  }
}

async function reachable(page, selector, scenario) {
  const target = page.locator(selector);
  await target.scrollIntoViewIfNeeded();
  const result = await target.evaluate(el => {
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const hit = document.elementFromPoint(x, y);
    return { reachable: r.top >= 0 && r.bottom <= innerHeight + 1 && !!hit && el.contains(hit), top: r.top, bottom: r.bottom, viewport: innerHeight };
  });
  record(scenario, 'dialog control reachable by scrolling', result.reachable, result);
}

async function seedShelf(page) {
  // Fixture: only the isolated context's meta save is populated. Actual game
  // definitions, normalizers, renderers and click handlers create every DOM node.
  await page.evaluate(() => {
    const m = defaultMeta(), story = journeyDefinitions[0];
    const [endingId, ending] = Object.entries(story.endings)[0];
    m.lives = 5;
    m.unlockedBranches = branchDefinitions.map(b => b.id);
    m.storyProgress.unlocked = storyFeatureDefinitions.map(f => f.id);
    m.exploration.seenEvents = [...explorationEventIndex().keys()];
    m.exploration.resolvedEvents = m.exploration.seenEvents.slice(0, 25);
    m.exploration.storyEndings = [{ id: story.id + ':' + endingId, storyId: story.id, endingTitle: ending.title, text: ending.text }];
    m.exploration.milestones = explorationMilestones.map(x => x.id);
    m.exploration.lives = [{ id: 'layout-fixture', number: 5, name: '这是十个汉字的长名字', age: 88, ending: '平凡而绵长的一生', choices: 12, newEvents: 25, categories: modernCategories, stories: [{ title: story.title, endingTitle: ending.title }], lastChoice: '在熟悉的城市与远方之间，认真选择自己想过的生活。' }];
    localStorage.setItem(META_KEY, JSON.stringify(m));
  });
  await page.reload();
}

async function runViewport(browser, url, width) {
  const height = width === 1280 ? 900 : 844;
  const context = await browser.newContext({ viewport: { width, height }, isMobile: width < 600, hasTouch: width < 600 });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  page.on('pageerror', e => report.errors.push({ width, message: e.message }));
  const tag = name => `${width}-${name}`;
  try {
    await page.goto(url);
    await page.locator('#playerName').fill('这是十个汉字的长名字');
    await inspect(page, tag('allocation'), { controls: '.stepper button, #pointStage .btn', text: '.allocDesc' });
    await screenshot(page, tag('allocation'));
    await page.getByRole('button', { name: '全部为 5', exact: true }).click();
    await page.locator('.stepper button').first().click();
    await page.locator('.stepper button').nth(1).click();
    record(tag('allocation'), 'stepper updates and preserves 20 total points', await page.locator('#remaining').textContent() === '0' && await page.locator('#bodyValue').textContent() === '5');
    await page.locator('#startBtn').click();
    await inspect(page, tag('abilities'), { controls: '.abilityCard, #confirmAbilityBtn', text: '.abilityDesc, .abilityMods' });
    await screenshot(page, tag('abilities'));
    for (let i = 0; i < 3; i++) await page.locator('.abilityCard').nth(i).click();
    await page.locator('#confirmAbilityBtn').click();
    await inspect(page, tag('motive'), { controls: '.motiveDrawActions .btn', text: '.motiveDrawDesc, .motiveDrawEffects' });
    await inspect(page, tag('motive-labels'), { text: '.motiveDrawTag, .motiveDrawNote', font: 12 });
    await screenshot(page, tag('motive'));
    await page.setViewportSize({ width, height: 420 });
    await reachable(page, '#motiveDrawConfirm', tag('motive-short'));
    await screenshot(page, tag('motive-short'));
    await page.locator('#motiveDrawConfirm').click();
    await page.setViewportSize({ width, height });
    await inspect(page, tag('game'), { controls: '.gameHead button, #spinBtn' });
    await page.locator('#wheelCard').scrollIntoViewIfNeeded();
    // Render the real 5-, 9- and 14-category configurations, then restore modern.
    for (const count of [5, 9, 14]) {
      await page.evaluate(count => { categories = [...(count === 5 ? realmConfigs[1].categories : count === 9 ? awakeningCategories : modernCategories)]; renderWheelLabels(); }, count);
      const geometry = await page.evaluate(() => {
        const card = document.querySelector('#wheelCard').getBoundingClientRect();
        const wrap = document.querySelector('.wheelWrap').getBoundingClientRect();
        // The wheel is rotated: its bounding rectangle includes empty corners.
        // The unrotated wrapper describes the visible circular wheel extent.
        const labels = [...document.querySelectorAll('.wheelLabel')].map(el => {
          const r = el.getBoundingClientRect();
          return { text: el.textContent, left: r.left, right: r.right, top: r.top, bottom: r.bottom, size: parseFloat(getComputedStyle(el).fontSize) };
        });
        return { count: labels.length, contained: wrap.left >= card.left && wrap.right <= card.right && labels.every(r => r.left >= card.left && r.right <= card.right), labels };
      });
      record(tag('wheel-' + count), 'wheel and labels stay within card', geometry.count === count && geometry.contained, geometry);
      await screenshot(page, tag('wheel-' + count), '#wheelCard');
    }
    await page.locator('#spinBtn').click();
    await page.locator('#eventPanel.on').waitFor({ timeout: 20000 });
    await page.waitForFunction(() => !spinning);
    await inspect(page, tag('event'), { controls: '.choice', text: '.choice span', font: 12 });
    await screenshot(page, tag('event'), '#wheelCard');
    await page.locator('.choice:not(:disabled)').first().click();
    await page.locator('#result.on').waitFor();
    record(tag('event'), 'real spin and event choice show a result', true);
    await inspect(page, tag('result'), { controls: '#nextBtn' });
    // Fixture: expose the normal locked-stage message after the real event test.
    await page.evaluate(() => { state.majorDone = state.targetMajor; refreshWheelAvailability(); });
    await inspect(page, tag('locked-note'), { text: '.wheelLockedNote.on', font: 12 });
    // The isolated context exercises unlocked UI without altering a user's save.
    await page.evaluate(() => localStorage.removeItem(SAVE_KEY));
    await page.reload();
    await seedShelf(page);
    await page.locator('#lifeWishDetails summary').click();
    await inspect(page, tag('wishes'), { controls: '.wishOption, #lifeWishDetails summary', text: '.wishOption span' });
    await page.locator('.wishOption').first().click();
    record(tag('wishes'), 'wish selected through UI', await page.locator('.wishOption').first().evaluate(el => el.classList.contains('selected')));
    await screenshot(page, tag('wishes'));
    await page.getByRole('button', { name: '翻开书架', exact: true }).click();
    for (const tab of ['lives', 'stories', 'events', 'milestones']) {
      await page.locator('#explorationTab_' + tab).click();
      await inspect(page, tag('shelf-' + tab), { controls: '.shelfTabs button, .shelfFilter button, .shelfPager button, .shelfVolume .btn', text: '.shelfLead, .shelfVolume p' });
      await screenshot(page, tag('shelf-' + tab));
      if (tab === 'events') {
        await page.locator('.shelfPager button').last().click();
        record(tag('shelf-events'), 'pagination changes page', (await page.locator('.shelfPager span').textContent()).startsWith('2 /'));
        await page.locator('.shelfFilter button').nth(1).click();
        record(tag('shelf-events'), 'category filter works', await page.locator('.shelfFilter button').nth(1).evaluate(el => el.classList.contains('active')));
      }
    }
    await page.setViewportSize({ width, height: 420 });
    await reachable(page, '.shelfModalHead button', tag('shelf-short'));
    await page.locator('#explorationTab_events').click();
    await page.locator('.shelfFilter button').first().click();
    await reachable(page, '.shelfPager button:last-child', tag('shelf-short-pager'));
    await screenshot(page, tag('shelf-short'));
    await page.locator('.shelfModalHead button').click();
    record(tag('shelf'), 'dialog closes through UI', await page.locator('#explorationModal').isHidden());
  } catch (e) {
    report.errors.push({ width, message: e.stack });
  } finally { await context.close(); }
}

(async () => {
  const server = http.createServer((req, res) => {
    if (req.url !== '/') { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(fs.readFileSync(source));
  });
  let browser;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ headless: true, ...(report.browser === 'chromium' ? {} : { channel: report.browser }) });
    report.browserVersion = browser.version();
    const widths = (process.env.MOBILE_WIDTHS || '360,390,430,1280').split(',').map(Number);
    for (const width of widths) await runViewport(browser, `http://127.0.0.1:${server.address().port}/`, width);
  } catch (e) { report.errors.push({ message: e.stack }); }
  finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
  report.passed = report.checks.filter(x => x.pass).length;
  report.failed = report.checks.filter(x => !x.pass).length;
  const json = JSON.stringify(report, null, 2);
  if (process.env.MOBILE_REPORT) fs.writeFileSync(process.env.MOBILE_REPORT, json + '\n');
  console.log(json);
  process.exitCode = report.failed || report.errors.length ? 1 : 0;
})();

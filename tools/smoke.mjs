import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const shots = path.join(here, 'shots');
fs.mkdirSync(shots, { recursive: true });

const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const base = 'http://127.0.0.1:4173/';
const server = spawn(process.execPath, [path.join(here, 'serve.mjs'), root], {
  env: { ...process.env, PORT: '4173' }, stdio: 'inherit'
});

function assert(ok, msg) { if (!ok) throw new Error(msg); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function waitServer() {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(base); if (r.ok) return; } catch {}
    await sleep(150);
  }
  throw new Error('local server did not start');
}

let browser;
try {
  await waitServer();
  browser = await chromium.launch({ executablePath: edge, headless: true, args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars'] });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'zh-CN', timezoneId: 'Asia/Shanghai', acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));

  async function shot(name, fullPage = false) {
    await page.waitForTimeout(220);
    await page.screenshot({ path: path.join(shots, name + '.png'), fullPage });
  }

  async function canvasInk(selector) {
    return page.$eval(selector, cv => {
      const ctx = cv.getContext('2d');
      const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
      let dark = 0;
      for (let i = 0; i < d.length; i += 16) if (d[i] < 90 && d[i + 1] < 90 && d[i + 2] < 90) dark++;
      return { dark, width: cv.width, height: cv.height };
    });
  }

  await page.goto(base, { waitUntil: 'networkidle' });
  assert((await page.locator('h1').first().textContent()) === '今天', 'initial route is not Today');
  await shot('today');

  await page.click('[data-route="plan"]');
  await page.click('details[data-day-card="mon"] summary');
  await shot('plan-expanded');
  await page.click('[data-action="exercise-detail"][data-ex="pulldown"]');
  await page.waitForSelector('#detailCanvas');
  await page.waitForTimeout(500);
  const detailInk = await canvasInk('#detailCanvas');
  assert(detailInk.dark > 100, 'exercise detail canvas is blank');
  await shot('exercise-detail');
  await page.click('#modalContent [data-action="close-modal"]');

  await page.click('[data-route="settings"]');
  await shot('settings');
  await page.fill('#bodyWeightInput', '70');
  assert((await page.locator('#proteinRange').textContent()).includes('112–140 g / 天'), 'protein range incorrect');
  await page.selectOption('#gluteSelect', 'bodyweight');
  await page.click('[data-action="save-settings"]');
  const savedSettings = await page.evaluate(() => JSON.parse(localStorage.getItem('shoulderBackCoach.v1')).settings);
  assert(savedSettings.gluteBridge === 'bodyweight' && savedSettings.bodyWeightKg === 70, 'settings were not saved');
  await page.click('[data-route="plan"]');
  await page.click('details[data-day-card="fri"] summary');
  assert((await page.locator('body').innerText()).includes('自重臀桥'), 'bodyweight glute did not replace machine');
  await page.click('[data-route="log"]');
  await shot('log-empty');

  await page.evaluate(() => {
    localStorage.setItem('shoulderBackCoach.v1', JSON.stringify({
      version: 1,
      settings: { startDate: '2026-10-05', gluteBridge: 'machine', bodyWeightKg: null },
      weeks: {}, sessions: [], active: null
    }));
  });
  await page.goto(base, { waitUntil: 'networkidle' });
  assert((await page.locator('body').innerText()).includes('第 3 / 6 周'), 'week 3 was not calculated');
  assert((await page.locator('body').innerText()).includes('进入完整组数前先确认'), 'week confirmation card missing');

  await page.locator('label.switch-row').nth(0).click();
  await page.locator('label.switch-row').nth(1).click();
  await page.locator('label.switch-row').nth(2).click();
  await page.click('[data-action="confirm-week-full"]');
  await page.waitForTimeout(200);
  assert((await page.locator('body').innerText()).includes('本周已确认 · 完整组数'), 'week confirmation failed');
  await page.waitForTimeout(2700);
  await shot('today-confirmed');

  await page.click('[data-action="start-training"]');
  await page.waitForSelector('#trainLayer:not(.is-hidden)');
  await page.waitForTimeout(600);
  const trainInk = await canvasInk('#trainCanvas');
  assert(trainInk.dark > 100, 'training canvas is blank');
  await shot('training-correct');
  await page.click('[data-figure-mode="fault"]');
  await page.waitForTimeout(500);
  assert(!(await page.locator('#faultBadge').getAttribute('class')).includes('is-hidden'), 'fault badge not visible');
  await shot('training-fault');
  await page.click('[data-figure-mode="correct"]');

  await page.fill('#setupInput', '座椅3档 / 宽握');
  await page.fill('#kgInput', '40');
  await page.fill('#repsInput', '12');
  await page.fill('#rirInput', '2');
  await page.click('#completeSetBtn');
  await page.waitForSelector('#restLayer:not(.is-hidden)');
  const restText = await page.locator('#restTime').textContent();
  await shot('rest');
  await page.click('#restSkip');

  for (let i = 0; i < 80; i++) {
    if (await page.locator('#summaryLayer:not(.is-hidden)').count()) break;
    if (await page.locator('#restLayer:not(.is-hidden)').count()) {
      await page.click('#restSkip'); await page.waitForTimeout(80); continue;
    }
    const label = (await page.locator('#completeSetBtn').textContent()).trim();
    if (label === '完成训练') {
      await page.click('#completeSetBtn'); await page.waitForTimeout(250); break;
    }
    if (label === '下一个动作') {
      await page.click('#completeSetBtn'); await page.waitForTimeout(100); continue;
    }
    const readOnly = await page.$eval('#kgInput', el => el.readOnly);
    if (!readOnly) await page.fill('#kgInput', '40');
    await page.fill('#repsInput', '12');
    await page.fill('#rirInput', '2');
    await page.click('#completeSetBtn');
    await page.waitForTimeout(100);
    if (await page.locator('#restLayer:not(.is-hidden)').count()) {
      await page.click('#restSkip'); await page.waitForTimeout(80);
    }
  }

  await page.waitForSelector('#summaryLayer:not(.is-hidden)');
  const summarySets = await page.locator('#summaryBody .stat strong').first().textContent();
  assert(summarySets === '13', 'summary set count is ' + summarySets);
  await shot('summary');
  await page.click('#saveSummaryBtn');
  await page.waitForSelector('#view h1');
  assert((await page.locator('h1').first().textContent()) === '记录', 'did not navigate to log after save');
  await page.waitForTimeout(2800);
  await shot('log');

  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('shoulderBackCoach.v1')));
  assert(stored.sessions.length === 1, 'session was not saved');
  assert(stored.active === null, 'active session not cleared');
  const totalSets = stored.sessions[0].exercises.reduce((n, ex) => n + ex.sets.length, 0);
  assert(totalSets === 13, 'stored set count is ' + totalSets);
  await page.reload({ waitUntil: 'networkidle' });
  assert((await page.locator('h1').first().textContent()) === '记录', 'log disappeared after reload');
  await page.selectOption('#logFilter', 'mon:pulldown');
  await page.waitForTimeout(250);
  const filtered = await page.locator('body').innerText();
  assert(filtered.includes('上次摘要') && filtered.includes('40 kg'), 'exercise filter summary missing');
  await shot('log-filter');
  await page.click('.history-item');
  await page.waitForSelector('#modalLayer:not(.is-hidden)');
  assert((await page.locator('#modalContent').innerText()).includes('高位下拉'), 'session detail missing exercise');
  await shot('log-detail');
  await page.click('#modalContent [data-action="close-modal"]');
  await page.selectOption('#logFilter', '');

  const [download] = await Promise.all([page.waitForEvent('download'), page.click('[data-action="export"]')]);
  const suggested = download.suggestedFilename();
  const backupPath = path.join(shots, 'backup.json');
  await download.saveAs(backupPath);
  const payload = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
  assert(payload.app === 'shoulder-back-coach' && payload.version === 1, 'backup header invalid');
  assert(JSON.stringify(payload.data) === JSON.stringify(stored), 'exported JSON differs from localStorage');
  assert(suggested.startsWith('肩背教练-备份-') && suggested.endsWith('.json'), 'backup filename invalid: ' + suggested);

  const context2 = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' });
  const page2 = await context2.newPage();
  await page2.goto(base, { waitUntil: 'networkidle' });
  await page2.click('[data-route="settings"]');
  await page2.setInputFiles('#importFile', backupPath);
  await page2.waitForSelector('#modalLayer:not(.is-hidden)');
  assert((await page2.locator('#modalContent').innerText()).includes('导入并覆盖'), 'import confirmation missing');
  await page2.click('[data-action="modal-confirm"]');
  await page2.waitForTimeout(300);
  const imported = await page2.evaluate(() => JSON.parse(localStorage.getItem('shoulderBackCoach.v1')));
  assert(imported.sessions.length === 1, 'import did not restore session');
  await page2.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('shoulderBackCoach.v1'));
    s.settings.startDate = '2026-09-07';
    localStorage.setItem('shoulderBackCoach.v1', JSON.stringify(s));
  });
  await page2.reload({ waitUntil: 'networkidle' });
  assert((await page2.locator('body').innerText()).includes('进入复盘模式'), 'review mode missing after week 6');
  await page2.click('[data-action="next-round"]');
  await page2.waitForSelector('#modalLayer:not(.is-hidden)');
  await page2.click('[data-action="modal-confirm"]');
  await page2.waitForTimeout(250);
  const nextRound = await page2.evaluate(() => JSON.parse(localStorage.getItem('shoulderBackCoach.v1')));
  assert(nextRound.settings.startDate === '2026-10-19', 'next round start date is not this Monday');
  assert(nextRound.sessions.length === 1, 'next round cleared history');
  assert(Object.keys(nextRound.weeks).length === 0, 'next round did not clear week confirmations');
  await context2.close();

  const sw = await page.evaluate(() => navigator.serviceWorker.ready.then(r => ({ active: !!r.active, controller: !!navigator.serviceWorker.controller })));
  assert(sw.active, 'service worker not active');
  assert(sw.controller, 'page not controlled by service worker');
  const cacheKeys = await page.evaluate(() => caches.keys());
  await page.waitForTimeout(400);
  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  assert((await page.locator('#tabbar .tab').count()) === 4, 'offline page did not render tabs');
  assert((await page.locator('h1').first().textContent()) === '记录', 'offline route did not render');
  await shot('offline-log');
  await page.click('[data-route="plan"]');
  await page.click('details[data-day-card="mon"] summary');
  await page.click('[data-action="exercise-detail"][data-ex="row"]');
  await page.waitForSelector('#detailCanvas');
  await page.waitForTimeout(400);
  const offlineInk = await canvasInk('#detailCanvas');
  assert(offlineInk.dark > 100, 'offline canvas animation is blank');
  await shot('offline-detail');
  await page.click('#modalContent [data-action="close-modal"]');
  await context.setOffline(false);

  const result = {
    viewport: '390x844 @2x',
    screenshots: fs.readdirSync(shots).filter(x => x.endsWith('.png')).sort(),
    canvas: { training: trainInk, detail: detailInk, offline: offlineInk },
    restSeconds: restText,
    sessions: stored.sessions.length,
    savedSets: totalSets,
    backup: suggested,
    importedSessions: imported.sessions.length,
    serviceWorker: sw,
    cacheKeys,
    consoleErrors: errors
  };
  console.log(JSON.stringify(result, null, 2));
  assert(errors.length === 0, 'console errors: ' + errors.join(' | '));
} catch (err) {
  console.error('SMOKE FAILED:', err && err.stack ? err.stack : err);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  server.kill();
}

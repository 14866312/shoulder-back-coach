import { chromium } from 'playwright-core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const shots = path.join(here, 'shots');
const ids = ['pulldown', 'row', 'incline', 'lateral', 'reverseFly', 'shoulderPress', 'legPress', 'legCurl', 'calf', 'pushdown', 'biceps', 'deadbug', 'gluteMachine', 'gluteBodyweight', 'crunch'];
const groups = [ids.slice(0, 4), ids.slice(4, 8), ids.slice(8, 12), ids.slice(12, 15)];
const browser = await chromium.launch({ executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true, args: ['--no-sandbox', '--hide-scrollbars'] });
const context = await browser.newContext({ viewport: { width: 780, height: 1200 }, deviceScaleFactor: 2 });
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const results = [];
for (let i = 0; i < groups.length; i++) {
  const url = 'file:///' + path.join(here, 'figures-check.html').replace(/\\/g, '/') + '?ids=' + groups[i].join(',');
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(200);
  const stats = await page.$$eval('canvas', list => list.map(cv => {
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    let dark = 0;
    for (let k = 0; k < d.length; k += 16) if (d[k] < 90 && d[k + 1] < 90 && d[k + 2] < 90) dark++;
    return { id: cv.getAttribute('data-id'), fault: cv.getAttribute('data-fault'), dark, w: cv.width, h: cv.height };
  }));
  results.push({ group: i + 1, stats });
  await page.screenshot({ path: path.join(shots, 'figures-' + (i + 1) + '.png'), fullPage: true });
}
console.log(JSON.stringify({ results, errors }, null, 2));
await browser.close();
if (errors.length) process.exitCode = 1;
if (results.some(g => g.stats.some(s => s.dark < 40))) process.exitCode = 1;

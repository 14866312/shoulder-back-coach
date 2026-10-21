import { chromium } from 'playwright-core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const shots = path.join(here, 'shots');
fs.mkdirSync(shots, { recursive: true });

const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const browser = await chromium.launch({ executablePath: edge, headless: true, args: ['--no-sandbox', '--hide-scrollbars'] });
const page = await browser.newPage({ viewport: { width: 1560, height: 1200 }, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

const url = 'file:///' + path.join(here, 'samples.html').replace(/\\/g, '/');
await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(300);

const report = await page.evaluate(() => window.__report);

const metrics = await page.evaluate(() => {
  const out = [];
  document.querySelectorAll('canvas[data-id]').forEach(cv => {
    const ctx = cv.getContext('2d');
    const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
    let dark = 0;
    for (let i = 0; i < d.length; i += 16) if (d[i] < 90 && d[i + 1] < 90 && d[i + 2] < 90) dark++;
    out.push({ id: cv.dataset.id, p: cv.dataset.p, fault: cv.dataset.fault, dark });
  });
  return out;
});

await page.screenshot({ path: path.join(shots, 'samples-full.png'), fullPage: true });

const sections = await page.locator('section.fig').all();
for (let i = 0; i < sections.length; i++) {
  await sections[i].screenshot({ path: path.join(shots, 'sample-' + (i + 1) + '.png') });
}
await page.locator('.phone-row').screenshot({ path: path.join(shots, 'samples-ui.png') });

// 折叠默认全关
const closed = await page.evaluate(() => ({
  detail: document.querySelectorAll('#detailFolds details[open]').length,
  train: document.querySelectorAll('#trainPhone details[open]').length
}));
if (closed.detail !== 0 || closed.train !== 0) errors.push('折叠默认状态错误: ' + JSON.stringify(closed));

// 点“全部展开”
await page.click('#toggleAll');
await page.waitForTimeout(150);
const opened = await page.evaluate(() => ({
  count: document.querySelectorAll('#detailFolds details[open]').length,
  label: document.getElementById('toggleAll').textContent
}));
if (opened.count !== 4 || opened.label !== '全部收起') errors.push('全部展开失败: ' + JSON.stringify(opened));
await page.locator('#detailPhone').screenshot({ path: path.join(shots, 'samples-detail-open.png') });
await page.click('#toggleAll');

// 展开跟练页折叠
await page.click('#trainPhone details summary');
await page.waitForTimeout(150);
await page.locator('#trainPhone').screenshot({ path: path.join(shots, 'samples-train-open.png') });

// 390px 视口下不横向溢出
await page.setViewportSize({ width: 390, height: 900 });
await page.waitForTimeout(150);
const overflow390 = await page.evaluate(() => ({
  scrollWidth: document.documentElement.scrollWidth,
  clientWidth: document.documentElement.clientWidth
}));
if (overflow390.scrollWidth > overflow390.clientWidth) errors.push('390px 横向溢出: ' + JSON.stringify(overflow390));
await page.screenshot({ path: path.join(shots, 'samples-390.png'), fullPage: true });

console.log(JSON.stringify({ report, metrics, closed, opened, overflow390, errors }, null, 2));
await browser.close();
if (errors.length) process.exitCode = 1;
if (metrics.some(m => m.dark < 80)) process.exitCode = 1;
if (report.overflow) process.exitCode = 1;
if (Object.values(report.bones).some(d => d.worst > 2.5)) process.exitCode = 1;


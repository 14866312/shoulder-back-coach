import { chromium } from 'playwright-core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const shots = path.join(here, 'shots');
const base = 'https://14866312.github.io/shoulder-back-coach/';
const browser = await chromium.launch({ executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true, args: ['--no-sandbox', '--hide-scrollbars'] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' });
const page = await context.newPage();
const errors = [];
const badResponses = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push(e.message));
page.on('response', r => { if (r.status() >= 400) badResponses.push(r.status() + ' ' + r.url()); });
await page.goto(base, { waitUntil: 'networkidle' });
const title = await page.locator('h1').first().textContent();
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(shots, 'online-today.png') });
await page.click('[data-route="plan"]');
await page.click('details[data-day-card="mon"] summary');
await page.waitForTimeout(200);
await page.screenshot({ path: path.join(shots, 'online-plan.png') });
const sw = await page.evaluate(() => Promise.race([
  navigator.serviceWorker.ready.then(r => ({ scope: r.scope, active: !!r.active, controller: !!navigator.serviceWorker.controller })),
  new Promise(resolve => setTimeout(() => resolve({ timeout: true }), 10000))
]));
const manifest = await page.evaluate(() => fetch('./manifest.webmanifest').then(r => r.json()));
await page.click('[data-route="today"]');
await page.reload({ waitUntil: 'networkidle' });
const controller = await page.evaluate(() => !!navigator.serviceWorker.controller);
await context.setOffline(true);
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(400);
const offlineTitle = await page.locator('h1').first().textContent();
await page.screenshot({ path: path.join(shots, 'online-offline.png') });
await context.setOffline(false);
console.log(JSON.stringify({ title, sw, controller, offlineTitle, manifest: { start_url: manifest.start_url, scope: manifest.scope, display: manifest.display }, errors, badResponses }, null, 2));
await browser.close();
if (title !== '今天' || offlineTitle !== '今天' || !controller || errors.length || badResponses.length || sw.timeout) process.exitCode = 1;

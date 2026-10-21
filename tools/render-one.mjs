import { chromium } from 'playwright-core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

// 用法：node tools/render-one.mjs pulldown 0.5 0  或  node tools/render-one.mjs legPress 1 2
const here = path.dirname(fileURLToPath(import.meta.url));
const shots = path.join(here, 'shots');
fs.mkdirSync(shots, { recursive: true });
const [id = 'pulldown', p = '0.5', fault = '0'] = process.argv.slice(2);

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;padding:0;background:#F4F1EA}
canvas{display:block;width:960px;height:600px}
</style></head><body><canvas id="c" width="960" height="600"></canvas>
<script src="../figures.js"></script>
<script>
Figures2.drawFrame(document.getElementById('c').getContext('2d'), 960, 600, '${id}', ${Number(p)}, ${Number(fault)});
</script></body></html>`;

const tmp = path.join(here, '_render.html');
fs.writeFileSync(tmp, html);

const browser = await chromium.launch({ executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true, args: ['--no-sandbox', '--hide-scrollbars'] });
const page = await browser.newPage({ viewport: { width: 960, height: 600 }, deviceScaleFactor: 2 });
await page.goto('file:///' + tmp.replace(/\\/g, '/'), { waitUntil: 'load' });
await page.waitForTimeout(150);
const out = path.join(shots, 'one-' + id + '-p' + p + '-f' + fault + '.png');
await page.locator('#c').screenshot({ path: out });
console.log(out);
await browser.close();



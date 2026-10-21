import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(process.argv[2] || path.join(here, '..'));
const port = Number(process.env.PORT || 4173);
// 默认只监听本机；设 HOST=0.0.0.0 让同一 WiFi 下的手机也能访问。
const host = process.env.HOST || '127.0.0.1';
const types = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.json': 'application/json; charset=utf-8'
};

function send(res, status, body, type) {
  res.writeHead(status, { 'Content-Type': type || 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

http.createServer((req, res) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname); }
  catch { return send(res, 400, 'Bad request'); }
  if (pathname.endsWith('/')) pathname += 'index.html';
  const target = path.resolve(root, '.' + pathname);
  if (!target.startsWith(root + path.sep) && target !== root) return send(res, 403, 'Forbidden');
  fs.stat(target, (err, st) => {
    if (err || !st.isFile()) {
      if (req.headers.accept && req.headers.accept.includes('text/html')) {
        return send(res, 200, fs.readFileSync(path.join(root, 'index.html')), types['.html']);
      }
      return send(res, 404, 'Not found');
    }
    send(res, 200, fs.readFileSync(target), types[path.extname(target)] || 'application/octet-stream');
  });
}).listen(port, host, () => {
  console.log(`serve ${root} http://${host === '0.0.0.0' ? '<本机局域网 IP>' : host}:${port}/`);
  if (host === '0.0.0.0') console.log('手机用同一 WiFi 打开 http://<电脑局域网 IP>:' + port + '/');
});

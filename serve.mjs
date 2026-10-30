/**
 * 本地预览服务器：node serve.mjs [端口]
 *
 * 零依赖，只把 dist/ 目录当静态站点发出去（默认 http://localhost:8000）。
 * 用它的好处：相对链接、404 页、RSS 都和真正托管时一模一样——
 * 直接双击 dist/index.html 也能看，但那是 file:// 协议，行为不完全一样。
 */
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'dist');
const PORT = Number(process.argv[2] || process.env.PORT || 8000);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

if (!existsSync(path.join(ROOT, 'index.html'))) {
  console.error('没有找到 dist/index.html —— 先运行：node build.mjs');
  process.exit(1);
}

function resolveFile(pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel.endsWith('/')) rel += 'index.html';

  let file = path.join(ROOT, rel);
  // 防目录穿越
  if (!file.startsWith(ROOT)) return null;

  if (existsSync(file) && statSync(file).isFile()) return file;

  // 免扩展名：/about → /about.html
  if (!path.extname(file) && existsSync(`${file}.html`)) return `${file}.html`;

  return null;
}

const server = createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');
  const file = resolveFile(url.pathname);

  const send = (target, status, extraHeaders = {}) => {
    const type = MIME[path.extname(target)] || 'application/octet-stream';
    res.writeHead(status, {
      'Content-Type': type,
      'Cache-Control': 'no-store', // 本地预览永远拿最新的
      ...extraHeaders,
    });
    if (req.method === 'HEAD') {
      res.end();
    } else {
      createReadStream(target).pipe(res);
    }
    console.log(`${req.method} ${url.pathname} → ${status}`);
  };

  if (file) {
    send(file, 200);
  } else {
    const notFound = path.join(ROOT, '404.html');
    if (existsSync(notFound)) send(notFound, 404);
    else {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404');
      console.log(`${req.method} ${url.pathname} → 404`);
    }
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`端口 ${PORT} 被占用了，换一个：node serve.mjs 8001`);
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`本地预览：http://localhost:${PORT}`);
  console.log('按 Ctrl+C 停止');
});

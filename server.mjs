import { prospectos } from './backend/prospectos.mjs';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { brotliCompressSync, gzipSync } from 'node:zlib';

const types = { html: 'text/html', css: 'text/css', js: 'text/javascript', png: 'image/png', gif: 'image/gif', webp: 'image/webp', jpg: 'image/jpeg' };
const assets = new Map();
for (const name of ["assets/animaciones/avance-7285160706306002181.webp","assets/animaciones/avance-7300297308925627653.webp","assets/animaciones/avance-7318124955420347654.webp","assets/animaciones/avance-7597188569593023752.webp","assets/animaciones/avance-7599024395952164103.webp","assets/animaciones/avance-7638841915324026120.webp", 'index.html', 'privacidad.html', '404.html', '500.html', 'assets/css/anova.css', 'assets/js/anova.js', 'node_modules/motion/dist/motion.js', 'assets/imagenes/marca/anova-logo.png', 'assets/animaciones/avance-local-1.gif', 'assets/animaciones/avance-local-2.gif', 'assets/animaciones/avance-local-3.gif', 'assets/imagenes/marca/favicon.png', 'assets/imagenes/portadas/portada-local-1.jpg', 'assets/imagenes/portadas/portada-7597188569593023752.jpg', 'assets/imagenes/portadas/portada-7300297308925627653.jpg', 'assets/imagenes/portadas/portada-7569683411036605714.jpg', 'assets/imagenes/portadas/portada-7599024395952164103.jpg', 'assets/imagenes/portadas/portada-local-2.jpg', 'assets/imagenes/portadas/portada-7318124955420347654.jpg', 'assets/imagenes/portadas/portada-local-3.jpg', 'assets/imagenes/portadas/portada-7638841915324026120.jpg', 'assets/imagenes/portadas/portada-7285160706306002181.jpg']) {
  const raw = await readFile(new URL(name, import.meta.url));
  const type = types[name.split('.').pop().toLowerCase()];
  const variants = { identity: raw };
  if (type.startsWith('text/')) {
    variants.br = brotliCompressSync(raw);
    variants.gzip = gzipSync(raw);
  }
  const tags = Object.fromEntries(Object.entries(variants).map(([key, data]) =>
    [key, '"' + createHash('sha256').update(data).digest('hex') + '"']));
  assets.set('/' + name, { type, variants, tags });
}

function quality(header, encoding) {
  const preferences = new Map(header.toLowerCase().split(',').map(entry => {
    const [name, weight] = entry.trim().split(/\s*;\s*q=/);
    return [name, weight === undefined ? 1 : Number(weight)];
  }));
  return preferences.get(encoding) ?? (encoding === 'identity' ? (preferences.get('*') === 0 ? 0 : 1) : preferences.get('*') ?? 0);
}

const server = http.createServer((req, res) => {
  res.setHeader('Content-Security-Policy', "default-src 'self'; frame-src https://www.tiktok.com; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.url === '/api/calificar' || req.url === '/api/contacto') return prospectos(req, res);
  if (!['GET', 'HEAD'].includes(req.method)) {
    res.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  const path = req.url.split('?')[0];
  const found = assets.get(path === '/' ? '/index.html' : path);
  const asset = found ?? assets.get('/404.html');
  const status = !found || path === '/404.html' ? 404 : path === '/500.html' ? 500 : 200;
  const accept = req.headers['accept-encoding'] ?? '';
  const encoding = ['br', 'gzip', 'identity'].filter(key => asset.variants[key] && quality(accept, key) > 0)
    .sort((a, b) => quality(accept, b) - quality(accept, a))[0];
  res.setHeader('Vary', 'Accept-Encoding');
  if (!encoding) return res.writeHead(406).end();
  const tag = asset.tags[encoding];
  res.setHeader('ETag', tag);
  res.setHeader('Cache-Control', status === 200 ? 'public, max-age=0, must-revalidate' : 'no-store');
  const validators = (req.headers['if-none-match'] ?? '').split(',').map(item => item.trim().replace(/^W\//, ''));
  if (status === 200 && (validators.includes(tag) || validators.includes('*'))) return res.writeHead(304).end();
  res.setHeader('Content-Type', asset.type + (asset.type.startsWith('text/') ? '; charset=utf-8' : ''));
  if (encoding !== 'identity') res.setHeader('Content-Encoding', encoding);
  const body = asset.variants[encoding];
  if (asset.type.startsWith('video/')) {
    res.setHeader('Accept-Ranges', 'bytes');
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
    if (range && (range[1] || range[2])) {
      const start = range[1] ? Number(range[1]) : Math.max(0, body.length - Number(range[2]));
      const end = range[1] && range[2] ? Math.min(body.length - 1, Number(range[2])) : body.length - 1;
      if (start > end || start >= body.length) return res.writeHead(416, { 'Content-Range': 'bytes */' + body.length }).end();
      return res.writeHead(206, { 'Content-Range': 'bytes ' + start + '-' + end + '/' + body.length, 'Content-Length': end - start + 1 })
        .end(req.method === 'HEAD' ? undefined : body.subarray(start, end + 1));
    }
  }
  res.writeHead(status, { 'Content-Length': body.length }).end(req.method === 'HEAD' ? undefined : body);
});
server.listen(Number(process.env.PORT ?? 3000), '127.0.0.1', () => {
  console.log('ANOVA http://127.0.0.1:' + server.address().port);
});

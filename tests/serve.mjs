// Servidor estático mínimo para probar la app desde el móvil en la misma red WiFi.
// Uso: node tests/serve.mjs [puerto]   → imprime las URLs (localhost y IP de la LAN).
// Nota: sin HTTPS el navegador del móvil no registra el service worker ni ofrece
// "instalar", pero la app funciona igual y guarda los datos en localStorage.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', 'app');
const port = Number(process.argv[2] || 8080);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.css': 'text/css' };

http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.join(root, p);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('404'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}).listen(port, '0.0.0.0', () => {
  console.log(`Sirviendo ${root}`);
  console.log(`  http://localhost:${port}/`);
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const i of ifaces) if (i.family === 'IPv4' && !i.internal) console.log(`  http://${i.address}:${port}/   (desde el móvil, misma WiFi)`);
  }
});

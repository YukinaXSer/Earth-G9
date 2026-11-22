import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGzip } from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), process.env.STATIC_DIR || 'dist');
const port = Number(process.env.PORT || 4173);
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.ktx': 'image/ktx', '.hdr': 'application/octet-stream', '.glb': 'model/gltf-binary', '.webmanifest': 'application/manifest+json' };

const server = http.createServer(async (request, response) => {
  if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405, { Allow: 'GET, HEAD' }); response.end(); return; }
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const file = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!file.startsWith(root + sep)) { response.writeHead(403); response.end('Forbidden'); return; }
    const metadata = await stat(file);
    if (!metadata.isFile()) throw new Error('Not a file');
    const etag = `W/"${metadata.size.toString(16)}-${Math.trunc(metadata.mtimeMs).toString(16)}"`;
    const headers = {
      'Content-Type': mime[extname(file)] || 'application/octet-stream',
      'ETag': etag,
      'Vary': 'Accept-Encoding',
      'Cache-Control': pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' blob: data:; connect-src 'self' blob:; media-src 'self' blob:; object-src 'none'; base-uri 'self'",
    };
    if (request.headers['if-none-match'] === etag) { response.writeHead(304, headers); response.end(); return; }
    const acceptsGzip = (request.headers['accept-encoding'] || '').split(',').some(value => {
      const [encoding, ...parameters] = value.trim().split(';');
      const quality = parameters.map(parameter => parameter.trim()).find(parameter => parameter.startsWith('q='));
      return encoding === 'gzip' && (!quality || Number(quality.slice(2)) > 0);
    });
    const gzip = acceptsGzip && ['.glb', '.hdr', '.ktx', '.js', '.css', '.svg', '.ttf', '.txt', '.html', '.webmanifest'].includes(extname(file));
    if (gzip) headers['Content-Encoding'] = 'gzip';
    else headers['Content-Length'] = metadata.size;
    response.writeHead(200, headers);
    if (request.method === 'HEAD') response.end();
    else {
      const stream = createReadStream(file).on('error', () => response.destroy());
      response.on('close', () => stream.destroy());
      if (gzip) stream.pipe(createGzip().on('error', () => response.destroy())).pipe(response);
      else stream.pipe(response);
    }
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('页面不存在');
  }
});

server.listen(port, '0.0.0.0', () => console.log(`Earth 2 production server listening on ${server.address().port}`));

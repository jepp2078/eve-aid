/**
 * `npm run host`: serves the built site (`dist/`) and the game API to every device on the local network.
 * PORT (default 5180) and EVE_DATA_DIR (default `.eve-data`) can be set in the environment.
 */
import { createReadStream, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { networkInterfaces } from 'node:os';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApi, orderUrls } from './api';
import { GameHost } from './games';
import { fileStore } from './persist';

const DEFAULT_PORT = 5180;

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
};

const port = Number(process.env.PORT ?? DEFAULT_PORT);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error(`PORT must be a port number, not ${JSON.stringify(process.env.PORT)}`);
  process.exit(1);
}
const dataDir = resolve(process.env.EVE_DATA_DIR ?? '.eve-data');
const distDir = resolve(dirname(fileURLToPath(import.meta.url)), '../dist');
const indexFile = join(distDir, 'index.html');

function fileSize(path: string): number | null {
  try {
    const s = statSync(path);
    return s.isFile() ? s.size : null;
  } catch {
    return null;
  }
}

function lanUrls(p: number): string[] {
  const urls: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) {
      // Link-local addresses (169.254.x.x) only exist on one cable or bridge; phones on the Wi-Fi can't use them.
      if (a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.')) urls.push(`http://${a.address}:${p}`);
    }
  }
  return orderUrls(urls);
}

function plain(res: ServerResponse, status: number, text: string, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache', ...headers });
  res.end(text);
}

/** Files from `dist/` only; paths that are not files (no extension) get `index.html`, so the app handles them. */
function serveStatic(req: IncomingMessage, res: ServerResponse): void {
  if (req.method !== 'GET' && req.method !== 'HEAD') return plain(res, 405, 'Method not allowed', { Allow: 'GET, HEAD' });
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
  } catch {
    return plain(res, 400, 'Bad request');
  }
  const wanted = resolve(distDir, `.${pathname}`);
  if (wanted !== distDir && !wanted.startsWith(distDir + sep)) return plain(res, 404, 'Not found');

  let file = wanted;
  let size = fileSize(file);
  if (size === null && extname(pathname) === '') {
    file = indexFile;
    size = fileSize(file);
    if (size === null) return plain(res, 503, 'The site is not built yet: run `npm run build` (or `npm run host`).');
  }
  if (size === null) return plain(res, 404, 'Not found');

  const immutable = file !== indexFile && pathname.startsWith('/assets/');
  res.writeHead(200, {
    'Content-Type': CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'Content-Length': size,
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  createReadStream(file)
    .on('error', () => res.destroy())
    .pipe(res);
}

let boundPort = port;
const host = new GameHost(fileStore(dataDir), Date.now, Math.random);
const api = createApi(host, () => lanUrls(boundPort));
const server = createServer((req, res) => api(req, res, () => serveStatic(req, res)));

server.on('error', (e: NodeJS.ErrnoException) => {
  console.error(e.code === 'EADDRINUSE' ? `Port ${port} is already in use; set PORT to use another one.` : e);
  process.exit(1);
});

server.listen(port, '0.0.0.0', () => {
  const address = server.address();
  if (address !== null && typeof address === 'object') boundPort = address.port;
  const urls = lanUrls(boundPort);
  console.log(
    urls.length > 0
      ? `EVE companion running — open on phones: ${urls.join('  or  ')}`
      : `EVE companion running on http://localhost:${boundPort} — no network address found; join a Wi-Fi network so phones can connect`,
  );
  console.log(`On this laptop: http://localhost:${boundPort}`);
  console.log(`Games are saved in ${dataDir}`);
  if (fileSize(indexFile) === null) console.log(`Warning: ${distDir} has no index.html — run \`npm run build\` first.`);
});

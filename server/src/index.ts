import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '../../shared/Protocol.ts';
import { GAME_VERSION } from '../../shared/Constants.ts';
import { attachNetworkHandler } from './NetworkHandler';

const PORT = Number(process.env.PORT ?? process.env.LS_SERVER_PORT ?? 3001);
const CLIENT_DIST = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../client/dist');
const ORIGINS = process.env.CORS_ORIGIN?.split(',').map((s) => s.trim()).filter(Boolean);

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ktx2': 'image/ktx2', '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

let rooms: ReturnType<typeof attachNetworkHandler> | undefined;

/** Serves the built client so a single Render Web Service can host everything. */
async function handleHttp(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, version: GAME_VERSION, rooms: rooms?.size ?? 0 }));
    return;
  }
  const rel = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
  let file = join(CLIENT_DIST, rel);
  if (!file.startsWith(CLIENT_DIST)) { res.writeHead(403).end(); return; }
  try {
    const s = await stat(file).catch(() => null);
    if (!s || s.isDirectory()) file = join(CLIENT_DIST, 'index.html');
    const body = await readFile(file);
    const isAsset = file.includes(`${join(CLIENT_DIST, 'assets')}`);
    res.writeHead(200, {
      'content-type': MIME[extname(file)] ?? 'application/octet-stream',
      'cache-control': isAsset ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('LOST SIGNAL server is running. Build the client (npm run build) to serve it here.');
  }
}

const http = createServer((req, res) => { void handleHttp(req, res); });
const io = new Server<ClientToServerEvents, ServerToClientEvents>(http, {
  cors: ORIGINS ? { origin: ORIGINS } : undefined,
  maxHttpBufferSize: 64 * 1024,
  connectionStateRecovery: { maxDisconnectionDuration: 30_000 },
});
rooms = attachNetworkHandler(io);

http.listen(PORT, () => {
  console.log(`[lost-signal] server v${GAME_VERSION} listening on :${PORT}`);
});

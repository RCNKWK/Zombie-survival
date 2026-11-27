import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  AUTOSAVE_DEFAULT_MS,
  MAX_WS_PAYLOAD,
  RECONNECT_GRACE_DEFAULT_MS,
  WORLD_POLL_DEFAULT_MS,
} from '../shared/constants.js';
import type { ClientMsg } from '../shared/protocol.js';
import type { WorldPlatformAdapter } from './platform/adapter.js';
import { LocalAdapter } from './platform/local.js';
import { NakaWorldAdapter } from './platform/naka.js';
import { SaveQueue } from './saves.js';
import type { ConnectedMember, WorldInstance } from './world.js';
import { WorldManager } from './worlds.js';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function parseArgsPort(): number | undefined {
  const idx = process.argv.indexOf('--port');
  if (idx >= 0 && process.argv[idx + 1]) {
    const p = Number(process.argv[idx + 1]);
    if (Number.isInteger(p) && p > 0) return p;
  }
  return undefined;
}

export function createPlatformAdapterFromEnv(): { mode: 'local' | 'naka'; adapter: WorldPlatformAdapter } {
  const mode = process.env.PLATFORM === 'naka' ? 'naka' : 'local';
  if (mode === 'naka') {
    const apiUrl = process.env.NAKA_API_URL ?? '';
    const serverKey = process.env.NAKA_SERVER_KEY ?? '';
    return { mode, adapter: new NakaWorldAdapter({ apiUrl, serverKey }) };
  }
  return { mode, adapter: new LocalAdapter() };
}

export async function startServer(opts?: {
  port?: number;
  adapter?: WorldPlatformAdapter;
  distDir?: string;
  pendingFile?: string;
}) {
  const port = opts?.port ?? parseArgsPort() ?? Number(process.env.PORT ?? 2567);
  const { mode, adapter } = opts?.adapter
    ? { mode: 'custom', adapter: opts.adapter }
    : createPlatformAdapterFromEnv();

  const distDir = path.resolve(opts?.distDir ?? 'dist');
  const autosaveMs = Number(process.env.AUTOSAVE_MS ?? AUTOSAVE_DEFAULT_MS);
  const reconnectGraceMs = Number(process.env.RECONNECT_GRACE_MS ?? RECONNECT_GRACE_DEFAULT_MS);
  const worldPollMs = Number(process.env.WORLD_POLL_MS ?? WORLD_POLL_DEFAULT_MS);
  const closedPolicy = process.env.WORLD_CLOSED_POLICY === 'drain' ? 'drain' : 'continue';

  let manager: WorldManager;
  const saveQueue = new SaveQueue({
    adapter,
    pendingFile: opts?.pendingFile,
    onWorldGone: (wid) => manager?.unloadWorld(wid),
    onSaved: (wid, uid, at) => manager?.notifySaved(wid, uid, at),
  });

  manager = new WorldManager({
    adapter,
    saveQueue,
    autosaveMs,
    reconnectGraceMs,
    worldPollMs,
    closedPolicy,
  });

  // Flush any pending saves from previous run before accepting players
  await saveQueue.flushPending(true);
  saveQueue.startBackgroundFlush(1000);
  const periodicFlush = setInterval(() => void saveQueue.flushPending(false), 60_000);
  periodicFlush.unref?.();

  const server = http.createServer((req, res) => {
    const urlPath = (req.url ?? '/').split('?')[0] ?? '/';
    if (urlPath === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, platform: mode, worlds: manager.worldCount(), pendingSaves: saveQueue.pendingCount() }));
      return;
    }

    // Serve built static files from dist/ with path traversal protection
    const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
    const normalized = path.normalize(rel);
    if (normalized.startsWith('..') || path.isAbsolute(normalized)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    let filePath = path.resolve(distDir, normalized);
    if (!filePath.startsWith(distDir + path.sep) && filePath !== distDir) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = path.join(distDir, 'index.html');
    }

    if (!fs.existsSync(filePath)) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('Client not built yet. Run npm run build or use Vite dev server.');
      return;
    }

    const ext = path.extname(filePath);
    res.writeHead(200, { 'content-type': MIME_TYPES[ext] ?? 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  });

  const wss = new WebSocketServer({
    server,
    path: '/ws',
    maxPayload: MAX_WS_PAYLOAD,
  });

  wss.on('connection', (ws: WebSocket, req) => {
    const reqUrl = new URL(req.url ?? '/ws', 'http://localhost');
    const worldIdHint = reqUrl.searchParams.get('world') ?? undefined;

    let session: { world: WorldInstance; member: ConnectedMember } | null = null;

    ws.on('message', async (raw) => {
      let msg: unknown;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return;
      const typed = msg as ClientMsg;

      if (!session) {
        if (typed.t === 'join' && typeof typed.token === 'string') {
          session = await manager.handleJoin(ws, typed.token, worldIdHint);
        } else if (typed.t === 'resume' && typeof typed.rt === 'string') {
          session = manager.handleResume(ws, typed.rt, worldIdHint);
        }
        return;
      }

      manager.handleMessage(session.world, session.member, typed);
    });

    ws.on('close', () => {
      if (session) {
        session.world.handleDisconnect(session.member, ws);
      }
    });

    ws.on('error', () => {
      if (session) {
        session.world.handleDisconnect(session.member, ws);
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(port, resolve));
  console.log(`[deadzone] listening on :${port} (platform=${mode}, policy=${closedPolicy})`);

  const shutdown = async () => {
    console.log('[deadzone] graceful shutdown started...');
    clearInterval(periodicFlush);
    wss.close();
    await manager.shutdown();
    server.close(() => {
      console.log('[deadzone] shutdown complete');
    });
  };

  return { server, wss, manager, saveQueue, shutdown };
}

// Run directly when launched as CLI entrypoint
const isEntry = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (isEntry) {
  startServer()
    .then((handle) => {
      let stopping = false;
      const onSignal = (sig: string) => {
        if (stopping) return;
        stopping = true;
        console.log(`[deadzone] received ${sig}`);
        void handle.shutdown().finally(() => process.exit(0));
      };
      process.on('SIGTERM', () => onSignal('SIGTERM'));
      process.on('SIGINT', () => onSignal('SIGINT'));
    })
    .catch((err) => {
      console.error('[deadzone] startup failed:', err);
      process.exit(1);
    });
}

import {
  WorldPlatformError,
  type Member,
  type SaveBatchItem,
  type SaveDoc,
  type SaveInput,
  type WorldInfo,
  type WorldPlatformAdapter,
} from './adapter.js';

export interface NakaWorldAdapterOptions {
  apiUrl: string;
  serverKey: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export class NakaWorldAdapter implements WorldPlatformAdapter {
  private readonly baseUrl: string;
  private readonly serverKey: string;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;

  constructor(opts: NakaWorldAdapterOptions) {
    if (!opts.apiUrl || !opts.serverKey) {
      throw new Error('NAKA_API_URL and NAKA_SERVER_KEY are required when PLATFORM=naka');
    }
    this.baseUrl = opts.apiUrl.replace(/\/+$/, '');
    this.serverKey = opts.serverKey;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.fetchFn = opts.fetch ?? fetch;
  }

  private async request(method: 'GET' | 'POST', path: string, body?: unknown): Promise<{ status: number; json: any }> {
    let res: Response;
    try {
      res = await this.fetchFn(`${this.baseUrl}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${this.serverKey}`,
          'content-type': 'application/json',
        },
        signal: AbortSignal.timeout(this.timeoutMs),
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch (err) {
      throw new WorldPlatformError('unreachable', 0, `Platform unreachable: ${String(err)}`);
    }
    const json = await res.json().catch(() => ({}));
    return { status: res.status, json };
  }

  private mapError(status: number, json: any, context: string): WorldPlatformError {
    const msg = typeof json?.message === 'string' ? json.message : `HTTP ${status}`;
    if (status === 401) {
      return new WorldPlatformError(/server key/i.test(msg) ? 'badKey' : 'badToken', 401, msg);
    }
    if (status === 403) return new WorldPlatformError('notMember', 403, msg);
    if (status === 404) return new WorldPlatformError('worldGone', 404, msg);
    if (status === 409) {
      if (/conflict/i.test(msg) || /version/i.test(msg)) {
        return new WorldPlatformError('conflict', 409, msg);
      }
      return new WorldPlatformError('worldClosed', 409, msg);
    }
    if (status === 413) return new WorldPlatformError('payloadTooLarge', 413, msg);
    if (status === 429) return new WorldPlatformError('rate', 429, msg);
    if (status === 503) return new WorldPlatformError('notConfigured', 503, msg);
    if (status >= 400 && status < 500) return new WorldPlatformError('rejected', status, `${context}: ${msg}`);
    return new WorldPlatformError('server', status, `${context}: ${msg}`);
  }

  async identify(token: string) {
    const r = await this.request('POST', '/internal/worlds/identify', { token });
    if (r.status === 200 && r.json?.data) {
      return r.json.data as {
        player: { userId: string; username: string; avatar?: string };
        world: WorldInfo;
        me: { role: 'owner' | 'member'; save: SaveDoc | null };
      };
    }
    throw this.mapError(r.status, r.json, 'identify');
  }

  async getWorld(worldId: string, opts?: { saves?: boolean }) {
    const qs = opts?.saves ? '?saves=true' : '';
    const r = await this.request('GET', `/internal/worlds/${encodeURIComponent(worldId)}${qs}`);
    if (r.status === 200 && r.json?.data) {
      return r.json.data as { world: WorldInfo; members: Member[] };
    }
    throw this.mapError(r.status, r.json, 'getWorld');
  }

  async getMemberSave(worldId: string, userId: string): Promise<SaveDoc | null> {
    const r = await this.request(
      'GET',
      `/internal/worlds/${encodeURIComponent(worldId)}/members/${encodeURIComponent(userId)}/save`,
    );
    if (r.status === 200) {
      return (r.json?.data?.save ?? r.json?.data ?? null) as SaveDoc | null;
    }
    if (r.status === 404 && /save/i.test(String(r.json?.message ?? ''))) return null;
    throw this.mapError(r.status, r.json, 'getMemberSave');
  }

  async save(worldId: string, s: SaveInput) {
    const body = {
      userId: s.userId,
      data: s.data,
      reason: s.reason,
      saveKey: s.saveKey,
      ...(s.baseVersion !== undefined ? { baseVersion: s.baseVersion } : {}),
    };
    const r = await this.request('POST', `/internal/worlds/${encodeURIComponent(worldId)}/saves`, body);
    if (r.status === 200 && r.json?.data) {
      return r.json.data as { saveId: string; version: number; replayed: boolean };
    }
    throw this.mapError(r.status, r.json, 'save');
  }

  async saveBatch(worldId: string, saves: SaveInput[]): Promise<SaveBatchItem[]> {
    const r = await this.request('POST', `/internal/worlds/${encodeURIComponent(worldId)}/saves/batch`, {
      saves: saves.slice(0, 20),
    });
    if (r.status === 200 && Array.isArray(r.json?.data?.results ?? r.json?.data)) {
      return (r.json.data.results ?? r.json.data) as SaveBatchItem[];
    }
    throw this.mapError(r.status, r.json, 'saveBatch');
  }
}

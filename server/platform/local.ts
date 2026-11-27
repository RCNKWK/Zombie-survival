import fs from 'node:fs';
import path from 'node:path';
import { SAVE_MAX_BYTES } from '../../shared/constants.js';
import {
  WorldPlatformError,
  type Member,
  type SaveBatchItem,
  type SaveDoc,
  type SaveInput,
  type WorldInfo,
  type WorldPlatformAdapter,
} from './adapter.js';

interface StoredMemberFile {
  userId: string;
  username: string;
  latest: SaveDoc | null;
  keys: Record<string, { saveId: string; version: number }>;
}

interface StoredWorldMeta {
  id: string;
  name: string;
  status: 'open' | 'closed';
  maxPlayers: number;
  owner: { userId: string; username: string };
  members: Array<{ userId: string; username: string; role: 'owner' | 'member' }>;
}

export interface LocalAdapterOptions {
  dataDir?: string;
  failRate?: number;
  maxPlayers?: number;
}

function sanitizeId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'default';
}

function atomicWriteJson(filePath: string, data: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);
}

export class LocalAdapter implements WorldPlatformAdapter {
  private readonly baseDir: string;
  private failRate: number;
  private readonly maxPlayers: number;

  constructor(opts: LocalAdapterOptions = {}) {
    this.baseDir = opts.dataDir ?? path.resolve('.data/worlds');
    this.failRate = Math.max(0, Math.min(1, opts.failRate ?? Number(process.env.LOCAL_FAIL_RATE ?? 0)));
    this.maxPlayers = opts.maxPlayers ?? 8;
  }

  setFailRate(rate: number) {
    this.failRate = Math.max(0, Math.min(1, rate));
  }

  private worldDir(worldId: string): string {
    return path.join(this.baseDir, sanitizeId(worldId));
  }

  private metaPath(worldId: string): string {
    return path.join(this.worldDir(worldId), '_meta.json');
  }

  private memberPath(worldId: string, userId: string): string {
    return path.join(this.worldDir(worldId), `${sanitizeId(userId)}.json`);
  }

  private readMeta(worldId: string): StoredWorldMeta | null {
    try {
      return JSON.parse(fs.readFileSync(this.metaPath(worldId), 'utf8')) as StoredWorldMeta;
    } catch {
      return null;
    }
  }

  private readMemberFile(worldId: string, userId: string): StoredMemberFile | null {
    try {
      return JSON.parse(fs.readFileSync(this.memberPath(worldId, userId), 'utf8')) as StoredMemberFile;
    } catch {
      return null;
    }
  }

  private maybeInjectFailure() {
    if (this.failRate > 0 && Math.random() < this.failRate) {
      throw new WorldPlatformError('server', 503, 'Simulated local save failure (LOCAL_FAIL_RATE)');
    }
  }

  async identify(token: string, worldIdHint = 'dev') {
    if (!token.startsWith('local:')) {
      throw new WorldPlatformError('badToken', 401, 'Invalid local token (expected local:<name>)');
    }
    const rawName = token.slice('local:'.length).trim();
    if (!rawName) {
      throw new WorldPlatformError('badToken', 401, 'Missing username in local token');
    }
    const username = rawName.slice(0, 24);
    const userId = `local_${sanitizeId(username.toLowerCase())}`;
    const wid = sanitizeId(worldIdHint || 'dev');

    let meta = this.readMeta(wid);
    if (!meta) {
      meta = {
        id: wid,
        name: `Deadzone (${wid})`,
        status: 'open',
        maxPlayers: this.maxPlayers,
        owner: { userId, username },
        members: [{ userId, username, role: 'owner' }],
      };
      atomicWriteJson(this.metaPath(wid), meta);
    } else if (meta.status === 'closed') {
      throw new WorldPlatformError('worldClosed', 409, 'World is currently closed by the owner');
    } else if (!meta.members.some((m) => m.userId === userId)) {
      meta.members.push({ userId, username, role: 'member' });
      atomicWriteJson(this.metaPath(wid), meta);
    }

    const memberRec = meta.members.find((m) => m.userId === userId)!;
    const file = this.readMemberFile(wid, userId);

    const world: WorldInfo = {
      id: meta.id,
      name: meta.name,
      status: meta.status,
      maxPlayers: meta.maxPlayers,
      owner: meta.owner,
    };

    return {
      player: { userId, username },
      world,
      me: { role: memberRec.role, save: file?.latest ?? null },
    };
  }

  async getWorld(worldId: string, opts?: { saves?: boolean }) {
    const wid = sanitizeId(worldId);
    const meta = this.readMeta(wid);
    if (!meta) {
      throw new WorldPlatformError('worldGone', 404, `World ${wid} not found`);
    }
    const members: Member[] = meta.members.map((m) => ({
      userId: m.userId,
      username: m.username,
      role: m.role,
      online: true,
      ...(opts?.saves ? { save: this.readMemberFile(wid, m.userId)?.latest ?? null } : {}),
    }));
    // Owner first per spec
    members.sort((a, b) => (a.role === 'owner' ? -1 : b.role === 'owner' ? 1 : 0));

    return {
      world: {
        id: meta.id,
        name: meta.name,
        status: meta.status,
        maxPlayers: meta.maxPlayers,
        owner: meta.owner,
      },
      members,
    };
  }

  async getMemberSave(worldId: string, userId: string): Promise<SaveDoc | null> {
    const wid = sanitizeId(worldId);
    const meta = this.readMeta(wid);
    if (!meta) throw new WorldPlatformError('worldGone', 404, `World ${wid} not found`);
    return this.readMemberFile(wid, userId)?.latest ?? null;
  }

  async save(worldId: string, s: SaveInput) {
    this.maybeInjectFailure();

    const wid = sanitizeId(worldId);
    const meta = this.readMeta(wid);
    if (!meta) throw new WorldPlatformError('worldGone', 404, `World ${wid} not found`);
    if (!meta.members.some((m) => m.userId === s.userId)) {
      throw new WorldPlatformError('notMember', 403, `User ${s.userId} is not a member of ${wid}`);
    }
    if (!s.data || typeof s.data !== 'object' || Array.isArray(s.data)) {
      throw new WorldPlatformError('rejected', 400, 'Save data must be a JSON object');
    }

    const serialized = JSON.stringify(s.data);
    const bytes = new TextEncoder().encode(serialized).length;
    if (bytes > SAVE_MAX_BYTES) {
      throw new WorldPlatformError('payloadTooLarge', 413, `Save size ${bytes} exceeds 256 KB limit`);
    }

    const file: StoredMemberFile = this.readMemberFile(wid, s.userId) ?? {
      userId: s.userId,
      username: s.userId,
      latest: null,
      keys: {},
    };

    const existingReplay = file.keys[s.saveKey];
    if (existingReplay) {
      return { saveId: existingReplay.saveId, version: existingReplay.version, replayed: true };
    }

    const currentVersion = file.latest?.version ?? 0;
    if (s.baseVersion !== undefined && s.baseVersion !== currentVersion) {
      throw new WorldPlatformError('conflict', 409, `save_conflict: expected ${s.baseVersion}, got ${currentVersion}`);
    }

    const nextVersion = currentVersion + 1;
    const saveId = `loc_${wid}_${s.userId}_v${nextVersion}`;
    const doc: SaveDoc = {
      id: saveId,
      version: nextVersion,
      data: JSON.parse(serialized) as Record<string, unknown>,
      reason: s.reason,
      createdAt: new Date().toISOString(),
    };

    file.latest = doc;
    file.keys[s.saveKey] = { saveId, version: nextVersion };
    // Keep only recent 50 keys so file doesn't bloat forever
    const keyNames = Object.keys(file.keys);
    if (keyNames.length > 50) {
      for (const oldKey of keyNames.slice(0, keyNames.length - 50)) delete file.keys[oldKey];
    }

    atomicWriteJson(this.memberPath(wid, s.userId), file);
    return { saveId, version: nextVersion, replayed: false };
  }

  async saveBatch(worldId: string, saves: SaveInput[]): Promise<SaveBatchItem[]> {
    const results: SaveBatchItem[] = [];
    for (const s of saves.slice(0, 20)) {
      try {
        const res = await this.save(worldId, s);
        results.push({
          userId: s.userId,
          saveKey: s.saveKey,
          ok: true,
          status: 200,
          saveId: res.saveId,
          version: res.version,
          replayed: res.replayed,
        });
      } catch (err) {
        const e = err instanceof WorldPlatformError ? err : new WorldPlatformError('server', 500, String(err));
        results.push({
          userId: s.userId,
          saveKey: s.saveKey,
          ok: false,
          status: e.status,
          error: e.message,
        });
      }
    }
    return results;
  }
}

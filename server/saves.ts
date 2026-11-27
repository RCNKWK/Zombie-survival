import fs from 'node:fs';
import path from 'node:path';
import {
  WorldPlatformError,
  type SaveInput,
  type SaveReason,
  type WorldPlatformAdapter,
} from './platform/adapter.js';

export interface QueuedSave {
  worldId: string;
  userId: string;
  data: Record<string, unknown>;
  reason: SaveReason;
  saveKey: string;
  createdAt: number;
  attempts: number;
  nextAttemptAt: number;
}

export interface SaveQueueOptions {
  adapter: WorldPlatformAdapter;
  pendingFile?: string;
  rejectedDir?: string;
  retryDelaysMs?: number[];
  onWorldGone?: (worldId: string) => void;
  onSaved?: (worldId: string, userId: string, at: number) => void;
  log?: (msg: string) => void;
}

const DEFAULT_DELAYS = [1000, 3000, 10_000, 30_000, 60_000];

function atomicWriteJson(filePath: string, data: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data), 'utf8');
  fs.renameSync(tmp, filePath);
}

export class SaveQueue {
  private readonly adapter: WorldPlatformAdapter;
  private readonly pendingFile: string;
  private readonly rejectedDir: string;
  private readonly delays: number[];
  private readonly onWorldGone?: (worldId: string) => void;
  private readonly onSaved?: (worldId: string, userId: string, at: number) => void;
  private readonly log: (msg: string) => void;

  /** Map key: `${worldId}::${userId}` */
  private queue = new Map<string, QueuedSave>();
  private inFlight = new Set<string>();
  private seq = 0;
  private retryTimer: NodeJS.Timeout | null = null;
  private disposed = false;

  constructor(opts: SaveQueueOptions) {
    this.adapter = opts.adapter;
    this.pendingFile = opts.pendingFile ?? path.resolve('.data/pending-saves.json');
    this.rejectedDir = opts.rejectedDir ?? path.resolve('.data/rejected');
    this.delays = opts.retryDelaysMs ?? DEFAULT_DELAYS;
    this.onWorldGone = opts.onWorldGone;
    this.onSaved = opts.onSaved;
    this.log = opts.log ?? ((m) => console.log(m));

    this.loadFromDisk();
  }

  private key(worldId: string, userId: string): string {
    return `${worldId}::${userId}`;
  }

  private makeSaveKey(userId: string): string {
    const cleanUser = userId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 24) || 'u';
    this.seq = (this.seq + 1) % 100_000;
    return `${cleanUser}-${Date.now()}-${this.seq}`.slice(0, 64);
  }

  private loadFromDisk() {
    try {
      const raw = fs.readFileSync(this.pendingFile, 'utf8');
      const arr = JSON.parse(raw) as QueuedSave[];
      if (Array.isArray(arr)) {
        for (const item of arr) {
          if (item && typeof item.worldId === 'string' && typeof item.userId === 'string' && item.data) {
            this.queue.set(this.key(item.worldId, item.userId), item);
          }
        }
        if (this.queue.size > 0) {
          this.log(`[saves] loaded ${this.queue.size} pending saves from disk`);
        }
      }
    } catch {
      // No existing pending saves file
    }
  }

  private persistToDisk() {
    atomicWriteJson(this.pendingFile, [...this.queue.values()]);
  }

  private archiveRejected(item: QueuedSave, err: WorldPlatformError) {
    try {
      const fname = `${item.worldId}-${item.userId}-${Date.now()}-${err.status}.json`.replace(/[^a-zA-Z0-9._-]/g, '_');
      atomicWriteJson(path.join(this.rejectedDir, fname), {
        error: err.message,
        kind: err.kind,
        status: err.status,
        save: item,
      });
    } catch (e) {
      this.log(`[saves] failed to write rejected archive: ${String(e)}`);
    }
  }

  getLatestQueuedSave(worldId: string, userId: string): Record<string, unknown> | null {
    return this.queue.get(this.key(worldId, userId))?.data ?? null;
  }

  pendingCount(worldId?: string): number {
    if (!worldId) return this.queue.size;
    let n = 0;
    for (const q of this.queue.values()) if (q.worldId === worldId) n++;
    return n;
  }

  enqueue(worldId: string, userId: string, data: Record<string, unknown>, reason: SaveReason): QueuedSave {
    const k = this.key(worldId, userId);
    const existing = this.queue.get(k);
    const now = Date.now();

    // Never let an older/same-age autosave overwrite a disconnect save if createdAt is earlier
    if (existing && existing.reason === 'disconnect' && reason === 'autosave' && existing.createdAt >= now) {
      return existing;
    }

    const entry: QueuedSave = {
      worldId,
      userId,
      data,
      reason,
      saveKey: this.makeSaveKey(userId),
      createdAt: now,
      attempts: 0,
      nextAttemptAt: now,
    };
    this.queue.set(k, entry);
    this.persistToDisk();
    return entry;
  }

  async saveNow(worldId: string, userId: string, data: Record<string, unknown>, reason: SaveReason): Promise<boolean> {
    const entry = this.enqueue(worldId, userId, data, reason);
    return this.deliverOne(entry);
  }

  async saveManyBatch(worldId: string, items: Array<{ userId: string; data: Record<string, unknown>; reason: SaveReason }>) {
    const queuedItems = items.map((it) => this.enqueue(worldId, it.userId, it.data, it.reason));
    for (let i = 0; i < queuedItems.length; i += 20) {
      const slice = queuedItems.slice(i, i + 20);
      const inputs: SaveInput[] = slice.map((q) => ({
        userId: q.userId,
        data: q.data,
        reason: q.reason,
        saveKey: q.saveKey,
      }));
      try {
        const res = await this.adapter.saveBatch(worldId, inputs);
        const now = Date.now();
        for (const r of res) {
          const k = this.key(worldId, r.userId);
          const cur = this.queue.get(k);
          if (!cur || cur.saveKey !== r.saveKey) continue;
          if (r.ok) {
            this.queue.delete(k);
            this.onSaved?.(worldId, r.userId, now);
          } else if (r.status === 400 || r.status === 403 || r.status === 404 || r.status === 413) {
            this.queue.delete(k);
            this.archiveRejected(cur, new WorldPlatformError('rejected', r.status, r.error ?? 'rejected'));
          } else {
            cur.attempts += 1;
            const d = this.delays[Math.min(cur.attempts - 1, this.delays.length - 1)]!;
            cur.nextAttemptAt = now + d;
          }
        }
        this.persistToDisk();
      } catch (err) {
        this.log(`[saves] saveBatch failed for ${worldId}: ${String(err)}`);
      }
    }
  }

  private async deliverOne(entry: QueuedSave): Promise<boolean> {
    const k = this.key(entry.worldId, entry.userId);
    if (this.inFlight.has(k)) return false;
    this.inFlight.add(k);

    try {
      await this.adapter.save(entry.worldId, {
        userId: entry.userId,
        data: entry.data,
        reason: entry.reason,
        saveKey: entry.saveKey,
      });
      // Remove only if a newer save wasn't enqueued while in-flight
      const cur = this.queue.get(k);
      if (cur && cur.saveKey === entry.saveKey) {
        this.queue.delete(k);
        this.persistToDisk();
      }
      this.onSaved?.(entry.worldId, entry.userId, Date.now());
      return true;
    } catch (err) {
      const e = err instanceof WorldPlatformError ? err : new WorldPlatformError('server', 500, String(err));
      const cur = this.queue.get(k);
      if (!cur || cur.saveKey !== entry.saveKey) return false;

      if (e.kind === 'badKey') {
        console.error(`[ALERT][saves] PLATFORM REJECTED SERVER KEY (401): check NAKA_SERVER_KEY! Keeping save queued.`);
        cur.attempts += 1;
        cur.nextAttemptAt = Date.now() + 60_000;
        this.persistToDisk();
        return false;
      }

      if (e.kind === 'conflict') {
        this.log(`[saves] 409 conflict on ${entry.worldId}/${entry.userId}; retrying without baseVersion`);
        await this.adapter.getMemberSave(entry.worldId, entry.userId).catch(() => null);
        cur.saveKey = this.makeSaveKey(entry.userId);
        cur.nextAttemptAt = Date.now() + 1000;
        this.persistToDisk();
        return false;
      }

      if (e.kind === 'rejected' || e.kind === 'notMember' || e.kind === 'worldGone' || e.kind === 'payloadTooLarge') {
        this.log(`[saves] non-retryable ${e.status} (${e.kind}) for ${entry.worldId}/${entry.userId}: ${e.message}`);
        this.queue.delete(k);
        this.archiveRejected(cur, e);
        this.persistToDisk();
        if (e.kind === 'worldGone') this.onWorldGone?.(entry.worldId);
        return false;
      }

      // Retryable: 5xx, 408, 429, unreachable
      cur.attempts += 1;
      const delay = this.delays[Math.min(cur.attempts - 1, this.delays.length - 1)]!;
      cur.nextAttemptAt = Date.now() + delay;
      this.persistToDisk();
      return false;
    } finally {
      this.inFlight.delete(k);
    }
  }

  async flushPending(forceDue = false): Promise<number> {
    const now = Date.now();
    let delivered = 0;
    const candidates = [...this.queue.values()];
    for (const item of candidates) {
      if (!forceDue && item.nextAttemptAt > now) continue;
      const ok = await this.deliverOne(item);
      if (ok) delivered++;
    }
    return delivered;
  }

  startBackgroundFlush(intervalMs = 1000) {
    if (this.retryTimer) return;
    this.retryTimer = setInterval(() => {
      if (!this.disposed && this.queue.size > 0) {
        void this.flushPending(false);
      }
    }, intervalMs);
    this.retryTimer.unref?.();
  }

  async drainAll(maxWaitMs = 5000): Promise<void> {
    const deadline = Date.now() + maxWaitMs;
    while (this.queue.size > 0 && Date.now() < deadline) {
      await this.flushPending(true);
      if (this.queue.size === 0) break;
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  dispose() {
    this.disposed = true;
    if (this.retryTimer) {
      clearInterval(this.retryTimer);
      this.retryTimer = null;
    }
  }
}

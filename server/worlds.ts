import type { WebSocket } from 'ws';
import type { ClientMsg } from '../shared/protocol.js';
import {
  WorldPlatformError,
  type WorldPlatformAdapter,
} from './platform/adapter.js';
import type { SaveQueue } from './saves.js';
import { WorldInstance, type ConnectedMember } from './world.js';

export interface WorldManagerOptions {
  adapter: WorldPlatformAdapter;
  saveQueue: SaveQueue;
  autosaveMs: number;
  reconnectGraceMs: number;
  worldPollMs: number;
  closedPolicy: 'continue' | 'drain';
}

export class WorldManager {
  private readonly opts: WorldManagerOptions;
  private worlds = new Map<string, WorldInstance>();
  private loadingWorlds = new Map<string, Promise<WorldInstance>>();
  private pollTimer: NodeJS.Timeout | null = null;
  private shuttingDown = false;

  constructor(opts: WorldManagerOptions) {
    this.opts = opts;
    this.pollTimer = setInterval(() => void this.pollWorlds(), opts.worldPollMs);
    this.pollTimer.unref?.();
  }

  getWorld(worldId: string): WorldInstance | undefined {
    return this.worlds.get(worldId);
  }

  worldCount(): number {
    return this.worlds.size;
  }

  private async ensureWorld(
    info: Parameters<WorldPlatformAdapter['identify']> extends any
      ? Awaited<ReturnType<WorldPlatformAdapter['identify']>>['world']
      : never,
    meRole: 'owner' | 'member',
    meSaveRaw: unknown | null,
  ): Promise<WorldInstance> {
    const existing = this.worlds.get(info.id);
    if (existing) {
      existing.info = info;
      return existing;
    }

    const inflight = this.loadingWorlds.get(info.id);
    if (inflight) return inflight;

    const promise = (async () => {
      let ownerSaveRaw: unknown | null = null;
      if (meRole === 'owner') {
        ownerSaveRaw = this.opts.saveQueue.getLatestQueuedSave(info.id, info.owner.userId) ?? meSaveRaw;
      } else {
        const queued = this.opts.saveQueue.getLatestQueuedSave(info.id, info.owner.userId);
        if (queued) {
          ownerSaveRaw = queued;
        } else {
          const doc = await this.opts.adapter.getMemberSave(info.id, info.owner.userId);
          ownerSaveRaw = doc?.data ?? null;
        }
      }

      const instance = new WorldInstance({
        info,
        ownerSaveRaw,
        saveQueue: this.opts.saveQueue,
        autosaveMs: this.opts.autosaveMs,
        reconnectGraceMs: this.opts.reconnectGraceMs,
        closedPolicy: this.opts.closedPolicy,
        onEmpty: (wid) => this.unloadWorld(wid),
      });
      this.worlds.set(info.id, instance);
      return instance;
    })();

    this.loadingWorlds.set(info.id, promise);
    try {
      return await promise;
    } finally {
      this.loadingWorlds.delete(info.id);
    }
  }

  async handleJoin(
    ws: WebSocket,
    token: string,
    worldIdHint?: string,
  ): Promise<{ world: WorldInstance; member: ConnectedMember } | null> {
    if (this.shuttingDown) {
      ws.send(JSON.stringify({ t: 'error', code: 'worldClosed', msg: 'Server is restarting.' }));
      ws.close();
      return null;
    }

    try {
      const idRes = await this.opts.adapter.identify(token, worldIdHint);
      if (idRes.world.status === 'closed') {
        ws.send(JSON.stringify({ t: 'error', code: 'worldClosed', msg: 'World is closed by the owner.' }));
        ws.close();
        return null;
      }

      const world = await this.ensureWorld(idRes.world, idRes.me.role, idRes.me.save?.data ?? null);
      const member = world.joinPlayer(
        ws,
        idRes.player.userId,
        idRes.player.username,
        idRes.me.role,
        idRes.me.save?.data ?? null,
      );
      if (!member) return null;
      return { world, member };
    } catch (err) {
      const e = err instanceof WorldPlatformError ? err : new WorldPlatformError('server', 500, String(err));
      const code =
        e.kind === 'badToken' || e.kind === 'badKey'
          ? 'badToken'
          : e.kind === 'notMember'
            ? 'notMember'
            : e.kind === 'worldClosed'
              ? 'worldClosed'
              : e.kind === 'worldGone'
                ? 'worldGone'
                : 'relaunch';
      const friendly =
        code === 'badToken'
          ? 'Launch link expired or invalid. Please go back and press Play again.'
          : code === 'worldClosed'
            ? 'This world is currently closed. Wait for the owner to open it.'
            : code === 'worldGone'
              ? 'This world no longer exists.'
              : code === 'notMember'
                ? 'You are not a member of this world.'
                : e.message;
      ws.send(JSON.stringify({ t: 'error', code, msg: friendly }));
      ws.close();
      return null;
    }
  }

  handleResume(
    ws: WebSocket,
    rt: string,
    worldIdHint?: string,
  ): { world: WorldInstance; member: ConnectedMember } | null {
    if (this.shuttingDown) {
      ws.send(JSON.stringify({ t: 'error', code: 'worldClosed', msg: 'Server is restarting.' }));
      ws.close();
      return null;
    }
    if (worldIdHint) {
      const target = this.worlds.get(worldIdHint);
      if (target) {
        const m = target.resumePlayer(ws, rt);
        if (m) return { world: target, member: m };
        return null;
      }
    }
    for (const w of this.worlds.values()) {
      const m = w.resumePlayer(ws, rt);
      if (m) return { world: w, member: m };
    }
    ws.send(JSON.stringify({ t: 'error', code: 'relaunch', msg: 'Session expired. Please go back and press Play again.' }));
    ws.close();
    return null;
  }

  handleMessage(world: WorldInstance, member: ConnectedMember, msg: ClientMsg) {
    world.handleClientMessage(member, msg);
  }

  unloadWorld(worldId: string) {
    const w = this.worlds.get(worldId);
    if (!w) return;
    w.dispose();
    this.worlds.delete(worldId);
    console.log(`[worlds] unloaded world ${worldId} (active: ${this.worlds.size})`);
  }

  notifySaved(worldId: string, userId: string, at: number) {
    this.worlds.get(worldId)?.notifySaved(userId, at);
  }

  private async pollWorlds() {
    for (const [wid, instance] of [...this.worlds.entries()]) {
      try {
        const res = await this.opts.adapter.getWorld(wid);
        instance.info = res.world;
        if (res.world.status === 'closed') {
          instance.handleWorldClosedOnPlatform();
        }
        const memberIds = new Set(res.members.map((m) => m.userId));
        for (const uid of [...memberIds]) {
          void uid;
        }
        // Check if anyone currently in instance left the world on platform
        for (const p of instance.state.players.values()) {
          if (!memberIds.has(p.userId)) {
            instance.kickRemovedMember(p.userId);
          }
        }
      } catch (err) {
        if (err instanceof WorldPlatformError && err.kind === 'worldGone') {
          this.unloadWorld(wid);
        }
      }
    }
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    for (const [wid, instance] of this.worlds.entries()) {
      const batch = instance.collectShutdownSaves();
      instance.dispose();
      if (batch.length > 0) {
        await this.opts.saveQueue.saveManyBatch(wid, batch);
      }
    }
    this.worlds.clear();
    await this.opts.saveQueue.drainAll(4000);
    this.opts.saveQueue.dispose();
  }
}

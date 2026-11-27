import crypto from 'node:crypto';
import type { WebSocket } from 'ws';
import {
  EMOTE_IDS,
  MAX_MSG_PER_SEC,
  MIN_SAVE_INTERVAL_MS,
  TICK_DT,
} from '../shared/constants.js';
import type { ClientMsg, ErrorCode, ServerMsg } from '../shared/protocol.js';
import {
  FutureSaveVersionError,
  deserializePlayerSave,
  measureSaveBytes,
  serializePlayerSave,
  type SavedPlayerData,
  type SavedWorldData,
} from '../shared/save.js';
import {
  buildSnapshotForPlayer,
  createDefaultPlayerData,
  createWorldState,
  handlePlayerAttack,
  handlePlayerBuild,
  handlePlayerCraft,
  handlePlayerDropItem,
  handlePlayerInteract,
  handlePlayerLoot,
  handlePlayerRepair,
  handlePlayerRespawn,
  handlePlayerShove,
  handlePlayerUseItem,
  playerFromSaved,
  playerToSaved,
  stepWorld,
  worldToSaved,
  type SimPlayer,
  type SimWorldState,
} from '../shared/sim.js';
import type { SaveReason, WorldInfo } from './platform/adapter.js';
import type { SaveQueue } from './saves.js';

export interface ConnectedMember {
  simId: number;
  userId: string;
  username: string;
  role: 'owner' | 'member';
  socket: WebSocket | null;
  resumeToken: string;
  awaySince: number | null;
  lastSavedAt: number;
  lastManualSaveAt: number;
  msgCount: number;
  msgWindowStart: number;
}

export interface WorldInstanceOptions {
  info: WorldInfo;
  ownerSaveRaw: unknown | null;
  saveQueue: SaveQueue;
  autosaveMs: number;
  reconnectGraceMs: number;
  closedPolicy: 'continue' | 'drain';
  onEmpty: (worldId: string) => void;
}

export function hashSeed(worldId: string): number {
  let h = 2166136261;
  for (let i = 0; i < worldId.length; i++) {
    h = Math.imul(h ^ worldId.charCodeAt(i), 16777619);
  }
  return (h >>> 0) % 0x7fffffff || 1337;
}

export class WorldInstance {
  readonly worldId: string;
  info: WorldInfo;
  readonly state: SimWorldState;
  private readonly saveQueue: SaveQueue;
  private readonly autosaveMs: number;
  private readonly reconnectGraceMs: number;
  private readonly closedPolicy: 'continue' | 'drain';
  private readonly onEmpty: (worldId: string) => void;

  private membersByUserId = new Map<string, ConnectedMember>();
  private membersBySimId = new Map<number, ConnectedMember>();
  private resumeMap = new Map<string, string>(); // resumeToken -> userId
  private cachedOwnerPlayerSave: SavedPlayerData;
  private nextSimId = 1;

  private tickTimer: NodeJS.Timeout | null = null;
  private autosaveTimer: NodeJS.Timeout | null = null;
  private drainTimer: NodeJS.Timeout | null = null;
  private lastTickAt = Date.now();
  private accumulator = 0;
  private lastOwnerSaveAt = 0;
  private closing = false;
  private disposed = false;

  constructor(opts: WorldInstanceOptions) {
    this.worldId = opts.info.id;
    this.info = opts.info;
    this.saveQueue = opts.saveQueue;
    this.autosaveMs = opts.autosaveMs;
    this.reconnectGraceMs = opts.reconnectGraceMs;
    this.closedPolicy = opts.closedPolicy;
    this.onEmpty = opts.onEmpty;

    const defaultSeed = hashSeed(this.worldId);
    let savedWorld: SavedWorldData | undefined;
    if (opts.ownerSaveRaw) {
      const parsed = deserializePlayerSave(opts.ownerSaveRaw, defaultSeed);
      this.cachedOwnerPlayerSave = parsed.save.player;
      savedWorld = parsed.save.world;
      if (parsed.repaired) {
        console.warn(`[world:${this.worldId}] repaired corrupted fields in owner save`);
      }
    } else {
      this.cachedOwnerPlayerSave = createDefaultPlayerData();
    }

    this.state = createWorldState(defaultSeed, savedWorld, Date.now());
    this.startLoops();
  }

  private startLoops() {
    this.lastTickAt = Date.now();
    this.tickTimer = setInterval(() => this.loopTick(), 4);
    this.autosaveTimer = setInterval(() => this.runAutosave(), this.autosaveMs);
  }

  private send(ws: WebSocket | null, msg: ServerMsg) {
    if (!ws || ws.readyState !== 1) return;
    ws.send(JSON.stringify(msg));
  }

  sendErrorAndClose(ws: WebSocket, code: ErrorCode, msg: string) {
    this.send(ws, { t: 'error', code, msg });
    try {
      ws.close(4000, code);
    } catch {
      // ignore
    }
  }

  private loopTick() {
    if (this.disposed) return;
    const now = Date.now();
    const elapsed = Math.min(0.25, (now - this.lastTickAt) / 1000);
    this.lastTickAt = now;
    this.accumulator += elapsed;

    let stepped = false;
    while (this.accumulator >= TICK_DT) {
      stepWorld(this.state, TICK_DT);
      this.accumulator -= TICK_DT;
      stepped = true;
    }

    if (stepped) {
      // Check away grace expirations
      for (const m of [...this.membersByUserId.values()]) {
        if (m.awaySince !== null && now - m.awaySince >= this.reconnectGraceMs) {
          this.removeMember(m, false);
        }
      }

      // Broadcast snapshots
      for (const m of this.membersByUserId.values()) {
        if (m.socket && m.socket.readyState === 1) {
          const snap = buildSnapshotForPlayer(this.state, m.simId);
          this.send(m.socket, { t: 'snap', ...snap });
        }
      }
      this.state.events.length = 0;
    }
  }

  onlineCount(): number {
    let n = 0;
    for (const m of this.membersByUserId.values()) {
      if (m.socket && m.socket.readyState === 1) n++;
    }
    return n;
  }

  totalMembersInInstance(): number {
    return this.membersByUserId.size;
  }

  joinPlayer(
    ws: WebSocket,
    userId: string,
    username: string,
    role: 'owner' | 'member',
    platformSaveRaw: unknown | null,
  ): ConnectedMember | null {
    if (this.closing) {
      this.sendErrorAndClose(ws, 'worldClosed', 'World is closing.');
      return null;
    }

    const existing = this.membersByUserId.get(userId);
    if (existing) {
      // Kick old tab/socket seamlessly
      if (existing.socket && existing.socket !== ws) {
        this.sendErrorAndClose(existing.socket, 'relaunch', 'Signed in from another tab.');
      }
      existing.socket = ws;
      existing.awaySince = null;
      const simP = this.state.players.get(existing.simId);
      if (simP) {
        simP.away = false;
        simP.invDirty = true;
      }
      this.send(ws, {
        t: 'welcome',
        you: existing.simId,
        rt: existing.resumeToken,
        world: {
          id: this.worldId,
          name: this.info.name,
          ownerId: this.info.owner.userId,
          seed: this.state.seed,
        },
        role: existing.role,
        fresh: false,
      });
      return existing;
    }

    // Check maxPlayers
    if (this.membersByUserId.size >= this.info.maxPlayers) {
      this.sendErrorAndClose(ws, 'full', 'World is currently full.');
      return null;
    }

    // Prefer queued save (if platform failed earlier) over older platform save
    const queuedRaw = this.saveQueue.getLatestQueuedSave(this.worldId, userId);
    const chosenRaw = queuedRaw ?? platformSaveRaw;

    let playerData: SavedPlayerData;
    let fresh = false;
    if (chosenRaw) {
      try {
        const parsed = deserializePlayerSave(chosenRaw, this.state.seed);
        playerData = parsed.save.player;
      } catch (err) {
        if (err instanceof FutureSaveVersionError) {
          this.sendErrorAndClose(ws, 'badSaveVersion', 'Game is updating; your save uses a newer version.');
          return null;
        }
        playerData = createDefaultPlayerData();
      }
    } else {
      playerData = createDefaultPlayerData();
      fresh = true;
    }

    if (role === 'owner') {
      this.cachedOwnerPlayerSave = playerData;
    }

    const simId = this.nextSimId++;
    const simPlayer = playerFromSaved(simId, userId, username, playerData, this.state.town);
    this.state.players.set(simId, simPlayer);

    const rt = crypto.randomBytes(16).toString('hex');
    const member: ConnectedMember = {
      simId,
      userId,
      username,
      role,
      socket: ws,
      resumeToken: rt,
      awaySince: null,
      lastSavedAt: 0,
      lastManualSaveAt: 0,
      msgCount: 0,
      msgWindowStart: Date.now(),
    };
    this.membersByUserId.set(userId, member);
    this.membersBySimId.set(simId, member);
    this.resumeMap.set(rt, userId);

    this.send(ws, {
      t: 'welcome',
      you: simId,
      rt,
      world: {
        id: this.worldId,
        name: this.info.name,
        ownerId: this.info.owner.userId,
        seed: this.state.seed,
      },
      role,
      fresh,
    });
    return member;
  }

  resumePlayer(ws: WebSocket, rt: string): ConnectedMember | null {
    const userId = this.resumeMap.get(rt);
    if (!userId) {
      this.sendErrorAndClose(ws, 'relaunch', 'Session expired. Please go back and press Play again.');
      return null;
    }
    const member = this.membersByUserId.get(userId);
    if (!member) {
      this.resumeMap.delete(rt);
      this.sendErrorAndClose(ws, 'relaunch', 'Session expired. Please go back and press Play again.');
      return null;
    }
    if (member.socket && member.socket !== ws) {
      this.sendErrorAndClose(member.socket, 'relaunch', 'Resumed in another tab.');
    }
    member.socket = ws;
    member.awaySince = null;
    const simP = this.state.players.get(member.simId);
    if (simP) {
      simP.away = false;
      simP.invDirty = true;
    }
    this.send(ws, {
      t: 'welcome',
      you: member.simId,
      rt: member.resumeToken,
      world: {
        id: this.worldId,
        name: this.info.name,
        ownerId: this.info.owner.userId,
        seed: this.state.seed,
      },
      role: member.role,
      fresh: false,
    });
    return member;
  }

  handleClientMessage(member: ConnectedMember, msg: ClientMsg) {
    // Rate limit
    const now = Date.now();
    if (now - member.msgWindowStart >= 1000) {
      member.msgWindowStart = now;
      member.msgCount = 0;
    }
    member.msgCount++;
    if (member.msgCount > MAX_MSG_PER_SEC) {
      if (member.socket) this.sendErrorAndClose(member.socket, 'rate', 'Too many messages.');
      return;
    }

    const p = this.state.players.get(member.simId);
    if (!p) return;

    switch (msg.t) {
      case 'ping':
        this.send(member.socket, { t: 'pong', c: Number(msg.c) || 0 });
        return;
      case 'save': {
        if (now - member.lastManualSaveAt < MIN_SAVE_INTERVAL_MS) return;
        member.lastManualSaveAt = now;
        void this.saveMember(member, 'manual', true);
        return;
      }
      case 'chat': {
        if (EMOTE_IDS.includes(msg.e)) {
          p.emote = msg.e;
          p.emoteTimer = 2.5;
        }
        return;
      }
      case 'in': {
        const dx = typeof msg.dx === 'number' && Number.isFinite(msg.dx) ? Math.max(-1, Math.min(1, msg.dx)) : 0;
        const dy = typeof msg.dy === 'number' && Number.isFinite(msg.dy) ? Math.max(-1, Math.min(1, msg.dy)) : 0;
        const a = typeof msg.a === 'number' && Number.isFinite(msg.a) ? msg.a : p.angle;
        p.inputDx = dx;
        p.inputDy = dy;
        p.angle = a;
        p.sprinting = Boolean(msg.sp);
        p.sneaking = Boolean(msg.sn);
        return;
      }
      case 'act': {
        if (msg.k === 'attack') handlePlayerAttack(this.state, p);
        else if (msg.k === 'shove') handlePlayerShove(this.state, p);
        else if (msg.k === 'interact') handlePlayerInteract(this.state, p);
        else if (msg.k === 'flash') {
          const hasFlashlight = p.inventory.some((i) => i.id === 'flashlight');
          if (!hasFlashlight) {
            this.state.events.push({ k: 'toast', pid: p.id, msg: 'Need a Flashlight in your bag!' });
            return;
          }
          p.flashlightOn = !p.flashlightOn;
          p.dirty = true;
        } else if (msg.k === 'respawn') {
          handlePlayerRespawn(this.state, p);
        }
        return;
      }
      case 'lootClose':
        p.loot = undefined;
        return;
      case 'loot':
        handlePlayerLoot(this.state, p, msg);
        return;
      case 'slot': {
        if (Number.isInteger(msg.i) && msg.i >= 0 && msg.i < 4) {
          p.activeSlot = msg.i;
          p.dirty = true;
        }
        return;
      }
      case 'use': {
        handlePlayerUseItem(this.state, p, msg.i);
        return;
      }
      case 'drop': {
        handlePlayerDropItem(this.state, p, msg.i);
        return;
      }
      case 'craft': {
        if (typeof msg.id === 'string') handlePlayerCraft(this.state, p, msg.id);
        return;
      }
      case 'build': {
        if (msg.kind === 'barricade' || msg.kind === 'campfire' || msg.kind === 'trap') {
          handlePlayerBuild(this.state, p, msg.kind);
        }
        return;
      }
      case 'repair': {
        if (typeof msg.id === 'string') handlePlayerRepair(this.state, p, msg.id);
        return;
      }
    }
  }

  handleDisconnect(member: ConnectedMember, ws: WebSocket) {
    if (member.socket !== ws) return;
    member.socket = null;
    member.awaySince = Date.now();
    const p = this.state.players.get(member.simId);
    if (p) {
      p.away = true;
      p.loot = undefined;
      p.inputDx = 0;
      p.inputDy = 0;
      p.sprinting = false;
    }

    // Immediate disconnect save (never wait for grace!)
    void this.saveMember(member, 'disconnect', true).then(() => {
      if (this.onlineCount() === 0 && this.state.dirtyWorld) {
        return this.saveOwnerWorldState('autosave', true);
      }
      return undefined;
    });
  }

  kickRemovedMember(userId: string) {
    const member = this.membersByUserId.get(userId);
    if (!member) return;
    const sock = member.socket;
    this.removeMember(member, true);
    if (sock) this.sendErrorAndClose(sock, 'notMember', 'You were removed from this world.');
  }

  private removeMember(member: ConnectedMember, saveFirst: boolean) {
    if (saveFirst) {
      void this.saveMember(member, 'manual', true);
    }
    this.membersByUserId.delete(member.userId);
    this.membersBySimId.delete(member.simId);
    this.resumeMap.delete(member.resumeToken);
    this.state.players.delete(member.simId);

    if (this.membersByUserId.size === 0) {
      void this.unloadWhenEmpty();
    }
  }

  private async unloadWhenEmpty() {
    if (this.disposed) return;
    if (this.state.dirtyWorld) {
      await this.saveOwnerWorldState('autosave', true);
    }
    if (this.membersByUserId.size === 0) {
      this.onEmpty(this.worldId);
    }
  }

  notifySaved(userId: string, at: number) {
    const m = this.membersByUserId.get(userId);
    if (m?.socket) this.send(m.socket, { t: 'saved', at });
  }

  private buildSavePayload(playerData: SavedPlayerData, includeWorld: boolean) {
    const saveObj = serializePlayerSave(
      playerData,
      includeWorld ? worldToSaved(this.state, Date.now()) : undefined,
    );
    const budget = measureSaveBytes(saveObj);
    if (budget.warn) {
      console.warn(`[world:${this.worldId}] save size warning: ${(budget.bytes / 1024).toFixed(1)} KB`);
    }
    return saveObj as unknown as Record<string, unknown>;
  }

  private async saveMember(member: ConnectedMember, reason: SaveReason, force = false): Promise<void> {
    const simP = this.state.players.get(member.simId);
    if (!simP) return;
    const now = Date.now();
    if (!force && !simP.dirty && !(member.role === 'owner' && this.state.dirtyWorld)) return;
    if (!force && reason !== 'disconnect' && now - member.lastSavedAt < MIN_SAVE_INTERVAL_MS) return;

    const savedPlayer = playerToSaved(simP);
    const isOwner = member.userId === this.info.owner.userId;
    if (isOwner) this.cachedOwnerPlayerSave = savedPlayer;

    const payload = this.buildSavePayload(savedPlayer, isOwner);
    simP.dirty = false;
    member.lastSavedAt = now;
    if (isOwner) {
      this.state.dirtyWorld = false;
      this.lastOwnerSaveAt = now;
    }

    await this.saveQueue.saveNow(this.worldId, member.userId, payload, reason);
  }

  private async saveOwnerWorldState(reason: SaveReason, force = false): Promise<void> {
    const ownerMember = this.membersByUserId.get(this.info.owner.userId);
    if (ownerMember) {
      await this.saveMember(ownerMember, reason, force);
      return;
    }
    const now = Date.now();
    if (!force && !this.state.dirtyWorld) return;
    if (!force && now - this.lastOwnerSaveAt < MIN_SAVE_INTERVAL_MS) return;

    // Owner is offline: save world state into owner's save doc on their behalf
    const payload = this.buildSavePayload(this.cachedOwnerPlayerSave, true);
    this.state.dirtyWorld = false;
    this.lastOwnerSaveAt = now;
    await this.saveQueue.saveNow(this.worldId, this.info.owner.userId, payload, reason);
  }

  private runAutosave() {
    if (this.disposed || this.membersByUserId.size === 0) return;
    for (const m of this.membersByUserId.values()) {
      void this.saveMember(m, 'autosave', false);
    }
    if (!this.membersByUserId.has(this.info.owner.userId) && this.state.dirtyWorld) {
      void this.saveOwnerWorldState('autosave', false);
    }
  }

  collectShutdownSaves(): Array<{ userId: string; data: Record<string, unknown>; reason: SaveReason }> {
    this.closing = true;
    const items: Array<{ userId: string; data: Record<string, unknown>; reason: SaveReason }> = [];
    let ownerIncluded = false;

    for (const m of this.membersByUserId.values()) {
      const simP = this.state.players.get(m.simId);
      if (!simP) continue;
      const savedPlayer = playerToSaved(simP);
      const isOwner = m.userId === this.info.owner.userId;
      if (isOwner) {
        ownerIncluded = true;
        this.cachedOwnerPlayerSave = savedPlayer;
      }
      items.push({
        userId: m.userId,
        data: this.buildSavePayload(savedPlayer, isOwner),
        reason: 'disconnect',
      });
    }

    if (!ownerIncluded && this.state.dirtyWorld) {
      items.push({
        userId: this.info.owner.userId,
        data: this.buildSavePayload(this.cachedOwnerPlayerSave, true),
        reason: 'autosave',
      });
    }

    return items;
  }

  handleWorldClosedOnPlatform() {
    if (this.closedPolicy === 'continue') return;
    if (this.drainTimer) return;

    const drainSec = 15;
    for (const m of this.membersByUserId.values()) {
      this.send(m.socket, { t: 'worldClosing', inSec: drainSec });
    }
    this.drainTimer = setTimeout(() => {
      this.closing = true;
      for (const m of [...this.membersByUserId.values()]) {
        const sock = m.socket;
        this.removeMember(m, true);
        if (sock) this.sendErrorAndClose(sock, 'worldClosed', 'World was closed by the owner.');
      }
    }, drainSec * 1000);
  }

  dispose() {
    this.disposed = true;
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.autosaveTimer) clearInterval(this.autosaveTimer);
    if (this.drainTimer) clearTimeout(this.drainTimer);
    this.tickTimer = null;
    this.autosaveTimer = null;
    this.drainTimer = null;
  }
}

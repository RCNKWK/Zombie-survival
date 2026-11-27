export type SaveReason = 'manual' | 'autosave' | 'disconnect';

export interface WorldInfo {
  id: string;
  name: string;
  status: 'open' | 'closed';
  maxPlayers: number;
  owner: { userId: string; username: string };
}

export interface SaveDoc {
  id: string;
  version: number;
  data: Record<string, unknown>;
  reason: SaveReason;
  createdAt: string;
}

export interface Member {
  userId: string;
  username: string;
  avatar?: string;
  role: 'owner' | 'member';
  online?: boolean;
  save?: SaveDoc | null;
}

export interface SaveInput {
  userId: string;
  data: Record<string, unknown>;
  reason: SaveReason;
  saveKey: string;
  baseVersion?: number;
}

export interface SaveBatchItem {
  userId: string;
  saveKey: string;
  ok: boolean;
  status?: number;
  saveId?: string;
  version?: number;
  replayed?: boolean;
  error?: string;
}

export type WorldErrorKind =
  | 'badToken'
  | 'notMember'
  | 'worldGone'
  | 'worldClosed'
  | 'notConfigured'
  | 'badKey'
  | 'conflict'
  | 'payloadTooLarge'
  | 'rejected'
  | 'rate'
  | 'server'
  | 'unreachable';

export class WorldPlatformError extends Error {
  readonly kind: WorldErrorKind;
  readonly status: number;

  constructor(kind: WorldErrorKind, status: number, message: string) {
    super(message);
    this.name = 'WorldPlatformError';
    this.kind = kind;
    this.status = status;
  }
}

export interface WorldPlatformAdapter {
  /** token -> player + world + latest save. Optional worldIdHint is used only by LocalAdapter in dev. */
  identify(
    token: string,
    worldIdHint?: string,
  ): Promise<{
    player: { userId: string; username: string; avatar?: string };
    world: WorldInfo;
    me: { role: 'owner' | 'member'; save: SaveDoc | null };
  }>;

  /** Member list (owner first), used to poll world status & removed members. */
  getWorld(worldId: string, opts?: { saves?: boolean }): Promise<{ world: WorldInfo; members: Member[] }>;

  /** Latest save of a single member (used to load owner save for world state). */
  getMemberSave(worldId: string, userId: string): Promise<SaveDoc | null>;

  /** Save once. Same saveKey -> replayed: true. autosave/disconnect must not send baseVersion. */
  save(
    worldId: string,
    s: SaveInput,
  ): Promise<{ saveId: string; version: number; replayed: boolean }>;

  /** 1-20 items used on graceful shutdown / simultaneous disconnects. */
  saveBatch(worldId: string, saves: SaveInput[]): Promise<SaveBatchItem[]>;
}

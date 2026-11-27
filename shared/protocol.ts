import type { EmoteId } from './constants.js';
import type { BuildKind, InvItem, ItemId } from './items.js';

export type ErrorCode =
  | 'badToken'
  | 'notMember'
  | 'worldClosed'
  | 'worldGone'
  | 'relaunch'
  | 'full'
  | 'rate'
  | 'badSaveVersion';

export type ClientMsg =
  | { t: 'join'; token: string }
  | { t: 'resume'; rt: string }
  | { t: 'ping'; c: number }
  | { t: 'save' }
  | { t: 'chat'; e: EmoteId }
  | { t: 'in'; dx: number; dy: number; a: number; sp?: boolean; sn?: boolean }
  | { t: 'act'; k: 'attack' | 'shove' | 'interact' | 'flash' | 'respawn' }
  | { t: 'slot'; i: number }
  | { t: 'use'; i: number }
  | { t: 'drop'; i: number }
  | { t: 'build'; kind: BuildKind }
  | { t: 'craft'; id: string }
  | { t: 'repair'; id: string }
  | { t: 'lootClose' }
  | { t: 'loot'; source: string; mode: 'one' | 'stack' | 'all'; item?: ItemId; dur?: number };

export interface NetPlayer {
  id: number;
  n: string;
  x: number;
  y: number;
  a: number;
  hp: number;
  st: number;
  hu: number;
  th: number;
  bl: number;
  pa: number;
  inf: number;
  fl: boolean;
  bt: number;
  sn: boolean;
  sp: boolean;
  sl: number;
  eq: string;
  kl: number;
  ds: number;
  aw: boolean; // away / grace period
  dd: boolean; // dead awaiting respawn
  searching?: boolean;
  sw?: number; // swing timer
  em?: EmoteId;
}

export interface NetZombie {
  id: number;
  k: 'w' | 'r' | 'b'; // walker, runner, brute
  x: number;
  y: number;
  a: number;
  hp: number;
  mhp: number;
  st: 'i' | 'v' | 'c' | 'a' | 'k'; // idle, investigate, chase, attack, knockdown
}

export interface NetBarricade {
  id: string;
  k: BuildKind;
  x: number;
  y: number;
  a: number;
  hp: number;
  mhp: number;
}

export interface NetContainerState {
  id: string;
  lt: boolean;
  cnt: number;
}

export interface NetDroppedLoot {
  id: string;
  x: number;
  y: number;
  cnt: number;
  top?: ItemId;
}

export type SimEvent =
  | { k: 'noise'; x: number; y: number; r: number }
  | { k: 'hit'; x: number; y: number; z?: boolean }
  | { k: 'shot'; x: number; y: number; x2: number; y2: number; sg?: boolean }
  | { k: 'use'; pid: number; item: ItemId }
  | { k: 'swing'; pid: number }
  | { k: 'shove'; pid: number }
  | { k: 'toast'; pid: number; msg: string };

export interface LootView {
  id: string;
  kind: 'container' | 'ground';
  name: string;
  remaining: number;
  duration: number;
  items?: InvItem[]; // Private to the viewer; omitted until search completes.
}

export interface SnapPayload {
  tk: number;
  wt: number;
  dy: number;
  p: NetPlayer[];
  z: NetZombie[];
  b: NetBarricade[];
  c: NetContainerState[];
  d: NetDroppedLoot[];
  loot?: LootView | null;
  inv?: InvItem[]; // sent only to the local player (or when dirty)
  ev: SimEvent[];
}

export type ServerMsg =
  | {
      t: 'welcome';
      you: number;
      rt: string;
      world: { id: string; name: string; ownerId: string; seed: number };
      role: 'owner' | 'member';
      fresh: boolean;
    }
  | ({ t: 'snap' } & SnapPayload)
  | { t: 'saved'; at: number }
  | { t: 'worldClosing'; inSec: number }
  | { t: 'error'; code: ErrorCode; msg: string }
  | { t: 'pong'; c: number };

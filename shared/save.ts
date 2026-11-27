import {
  DAY_MINUTES,
  HOTBAR_SLOTS,
  MAX_BARRICADES,
  MAX_DROPPED_LOOT,
  MAX_INVENTORY_SLOTS,
  SAFE_SPAWN_X,
  SAFE_SPAWN_Y,
  SAVE_MAX_BYTES,
  SAVE_WARN_BYTES,
  WORLD_SIZE,
} from './constants.js';
import { ITEMS, isItemId, type BuildKind, type InvItem } from './items.js';

export const CURRENT_SAVE_VERSION = 2;

export interface SavedPlayerData {
  x: number;
  y: number;
  angle: number;
  hp: number;
  stamina: number;
  hunger: number;
  thirst: number;
  bleeding: number;
  panic: number;
  infected: number;
  battery: number;
  flashlightOn: boolean;
  sneaking: boolean;
  kills: number;
  daysSurvived: number;
  activeSlot: number;
  inventory: InvItem[];
}

export interface SavedContainer {
  looted: boolean;
  restockDay: number;
  items: InvItem[];
}

export interface SavedBarricade {
  id: string;
  kind: BuildKind;
  x: number;
  y: number;
  angle: number;
  hp: number;
  maxHp: number;
  ownerId: string;
}

export interface SavedDroppedLoot {
  id: string;
  x: number;
  y: number;
  items: InvItem[];
  droppedAt: number;
}

export interface SavedWorldData {
  layoutVersion?: number;
  seed: number;
  worldTimeMin: number;
  day: number;
  lastSavedAt: number;
  containers: Record<string, SavedContainer>;
  barricades: SavedBarricade[];
  droppedLoot: SavedDroppedLoot[];
}

export interface PlayerSave {
  v: number;
  player: SavedPlayerData;
  world?: SavedWorldData;
}

export class FutureSaveVersionError extends Error {
  readonly version: number;
  constructor(version: number) {
    super(`Save version v${version} is newer than supported v${CURRENT_SAVE_VERSION}`);
    this.name = 'FutureSaveVersionError';
    this.version = version;
  }
}

export class InvalidSaveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidSaveError';
  }
}

export function round2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function clampFinite(v: unknown, min: number, max: number, fallback: number): { val: number; fixed: boolean } {
  if (typeof v !== 'number' || !Number.isFinite(v)) return { val: fallback, fixed: true };
  if (v < min) return { val: min, fixed: true };
  if (v > max) return { val: max, fixed: true };
  return { val: v, fixed: false };
}

function sanitizeItems(raw: unknown): { items: InvItem[]; fixed: boolean } {
  if (!Array.isArray(raw)) return { items: [], fixed: true };
  let fixed = false;
  const items: InvItem[] = [];
  for (const entry of raw) {
    if (items.length >= MAX_INVENTORY_SLOTS) {
      fixed = true;
      break;
    }
    if (!entry || typeof entry !== 'object') {
      fixed = true;
      continue;
    }
    const obj = entry as Record<string, unknown>;
    if (!isItemId(obj.id)) {
      fixed = true;
      continue;
    }
    const def = ITEMS[obj.id];
    const q = clampFinite(obj.qty, 1, def.maxStack, 1);
    if (q.fixed || !Number.isInteger(q.val)) fixed = true;
    const item: InvItem = { id: obj.id, qty: Math.max(1, Math.min(def.maxStack, Math.floor(q.val))) };
    if (def.maxDur !== undefined) {
      const d = clampFinite(obj.dur, 1, def.maxDur, def.maxDur);
      if (d.fixed) fixed = true;
      item.dur = Math.max(1, Math.min(def.maxDur, Math.round(d.val)));
    }
    items.push(item);
  }
  return { items, fixed };
}

function isBuildKind(v: unknown): v is BuildKind {
  return v === 'barricade' || v === 'campfire' || v === 'trap';
}

export function migrateSaveData(raw: unknown): { data: Record<string, unknown>; migrated: boolean } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new InvalidSaveError('Save root must be a JSON object');
  }
  const obj = raw as Record<string, unknown>;
  const vRaw = obj.v;
  if (typeof vRaw !== 'number' || !Number.isInteger(vRaw) || vRaw < 1) {
    throw new InvalidSaveError('Save missing valid version integer v');
  }
  if (vRaw > CURRENT_SAVE_VERSION) {
    throw new FutureSaveVersionError(vRaw);
  }

  // Deep clone plain JSON data to avoid mutating caller object
  const clone = JSON.parse(JSON.stringify(obj)) as Record<string, unknown>;
  let migrated = false;

  if ((clone.v as number) === 1) {
    const p = (clone.player && typeof clone.player === 'object' ? clone.player : {}) as Record<string, unknown>;
    if (p.panic === undefined) p.panic = 0;
    if (p.infected === undefined) p.infected = 0;
    if (p.battery === undefined) p.battery = 100;
    if (p.flashlightOn === undefined) p.flashlightOn = false;
    if (p.sneaking === undefined) p.sneaking = false;
    clone.player = p;

    if (clone.world && typeof clone.world === 'object') {
      const w = clone.world as Record<string, unknown>;
      if (w.droppedLoot === undefined) w.droppedLoot = [];
      clone.world = w;
    }
    clone.v = 2;
    migrated = true;
  }

  return { data: clone, migrated };
}

export function deserializePlayerSave(
  raw: unknown,
  fallbackSeed = 1337,
  nowMs = Date.now(),
): { save: PlayerSave; repaired: boolean; migrated: boolean } {
  const { data, migrated } = migrateSaveData(raw);
  let repaired = false;

  const pRaw = (data.player && typeof data.player === 'object' ? data.player : {}) as Record<string, unknown>;
  if (!data.player || typeof data.player !== 'object') repaired = true;

  const x = clampFinite(pRaw.x, 1, WORLD_SIZE - 1, SAFE_SPAWN_X);
  const y = clampFinite(pRaw.y, 1, WORLD_SIZE - 1, SAFE_SPAWN_Y);
  const angle = clampFinite(pRaw.angle, -Math.PI * 2, Math.PI * 2, 0);
  const hp = clampFinite(pRaw.hp, 0, 100, 100);
  const stamina = clampFinite(pRaw.stamina, 0, 100, 100);
  const hunger = clampFinite(pRaw.hunger, 0, 100, 100);
  const thirst = clampFinite(pRaw.thirst, 0, 100, 100);
  const bleeding = clampFinite(pRaw.bleeding, 0, 3, 0);
  const panic = clampFinite(pRaw.panic, 0, 100, 0);
  const infected = clampFinite(pRaw.infected, 0, 100, 0);
  const battery = clampFinite(pRaw.battery, 0, 100, 100);
  const kills = clampFinite(pRaw.kills, 0, 1_000_000, 0);
  const daysSurvived = clampFinite(pRaw.daysSurvived, 0, 100_000, 0);
  const activeSlot = clampFinite(pRaw.activeSlot, 0, HOTBAR_SLOTS - 1, 0);
  const inv = sanitizeItems(pRaw.inventory);

  if (
    x.fixed ||
    y.fixed ||
    angle.fixed ||
    hp.fixed ||
    stamina.fixed ||
    hunger.fixed ||
    thirst.fixed ||
    bleeding.fixed ||
    panic.fixed ||
    infected.fixed ||
    battery.fixed ||
    kills.fixed ||
    daysSurvived.fixed ||
    activeSlot.fixed ||
    inv.fixed
  ) {
    repaired = true;
  }

  const player: SavedPlayerData = {
    x: round2(x.val),
    y: round2(y.val),
    angle: round2(angle.val),
    hp: round2(hp.val),
    stamina: round2(stamina.val),
    hunger: round2(hunger.val),
    thirst: round2(thirst.val),
    bleeding: Math.round(bleeding.val),
    panic: round2(panic.val),
    infected: round2(infected.val),
    battery: round2(battery.val),
    flashlightOn: typeof pRaw.flashlightOn === 'boolean' ? pRaw.flashlightOn : false,
    sneaking: typeof pRaw.sneaking === 'boolean' ? pRaw.sneaking : false,
    kills: Math.floor(kills.val),
    daysSurvived: Math.floor(daysSurvived.val),
    activeSlot: Math.floor(activeSlot.val),
    inventory: inv.items,
  };

  let world: SavedWorldData | undefined;
  if (data.world !== undefined) {
    if (!data.world || typeof data.world !== 'object' || Array.isArray(data.world)) {
      repaired = true;
    } else {
      const wRaw = data.world as Record<string, unknown>;
      const seed = clampFinite(wRaw.seed, 1, 0x7fffffff, fallbackSeed);
      const worldTimeMin = clampFinite(wRaw.worldTimeMin, 0, DAY_MINUTES - 0.01, 480);
      const day = clampFinite(wRaw.day, 1, 1_000_000, 1);
      const lastSavedAt = clampFinite(wRaw.lastSavedAt, 0, nowMs + 86_400_000, nowMs);
      if (seed.fixed || worldTimeMin.fixed || day.fixed || lastSavedAt.fixed) repaired = true;

      const containers: Record<string, SavedContainer> = {};
      if (wRaw.containers && typeof wRaw.containers === 'object' && !Array.isArray(wRaw.containers)) {
        for (const [cid, cVal] of Object.entries(wRaw.containers as Record<string, unknown>)) {
          if (!cVal || typeof cVal !== 'object') {
            repaired = true;
            continue;
          }
          const cObj = cVal as Record<string, unknown>;
          const restockDay = clampFinite(cObj.restockDay, 0, 1_000_000, 1);
          const cItems = sanitizeItems(cObj.items);
          if (restockDay.fixed || cItems.fixed) repaired = true;
          containers[cid] = {
            looted: typeof cObj.looted === 'boolean' ? cObj.looted : true,
            restockDay: Math.floor(restockDay.val),
            items: cItems.items,
          };
        }
      } else if (wRaw.containers !== undefined) {
        repaired = true;
      }

      const barricades: SavedBarricade[] = [];
      if (Array.isArray(wRaw.barricades)) {
        for (const bRaw of wRaw.barricades) {
          if (barricades.length >= MAX_BARRICADES) {
            repaired = true;
            break;
          }
          if (!bRaw || typeof bRaw !== 'object') {
            repaired = true;
            continue;
          }
          const bObj = bRaw as Record<string, unknown>;
          if (typeof bObj.id !== 'string' || !isBuildKind(bObj.kind)) {
            repaired = true;
            continue;
          }
          const bx = clampFinite(bObj.x, 1, WORLD_SIZE - 1, SAFE_SPAWN_X);
          const by = clampFinite(bObj.y, 1, WORLD_SIZE - 1, SAFE_SPAWN_Y);
          const ba = clampFinite(bObj.angle, -Math.PI * 2, Math.PI * 2, 0);
          const mhp = clampFinite(bObj.maxHp, 10, 500, 100);
          const bhp = clampFinite(bObj.hp, 1, mhp.val, mhp.val);
          if (bx.fixed || by.fixed || ba.fixed || mhp.fixed || bhp.fixed) repaired = true;
          barricades.push({
            id: bObj.id,
            kind: bObj.kind,
            x: round2(bx.val),
            y: round2(by.val),
            angle: round2(ba.val),
            hp: round2(bhp.val),
            maxHp: round2(mhp.val),
            ownerId: typeof bObj.ownerId === 'string' ? bObj.ownerId : 'unknown',
          });
        }
      } else if (wRaw.barricades !== undefined) {
        repaired = true;
      }

      const droppedLoot: SavedDroppedLoot[] = [];
      if (Array.isArray(wRaw.droppedLoot)) {
        for (const dRaw of wRaw.droppedLoot) {
          if (droppedLoot.length >= MAX_DROPPED_LOOT) {
            repaired = true;
            break;
          }
          if (!dRaw || typeof dRaw !== 'object') {
            repaired = true;
            continue;
          }
          const dObj = dRaw as Record<string, unknown>;
          if (typeof dObj.id !== 'string') {
            repaired = true;
            continue;
          }
          const dx = clampFinite(dObj.x, 1, WORLD_SIZE - 1, SAFE_SPAWN_X);
          const dy = clampFinite(dObj.y, 1, WORLD_SIZE - 1, SAFE_SPAWN_Y);
          const dItems = sanitizeItems(dObj.items);
          const droppedAt = clampFinite(dObj.droppedAt, 0, nowMs + 86_400_000, nowMs);
          if (dItems.items.length === 0) {
            repaired = true;
            continue;
          }
          if (dx.fixed || dy.fixed || dItems.fixed || droppedAt.fixed) repaired = true;
          droppedLoot.push({
            id: dObj.id,
            x: round2(dx.val),
            y: round2(dy.val),
            items: dItems.items,
            droppedAt: Math.floor(droppedAt.val),
          });
        }
      } else if (wRaw.droppedLoot !== undefined) {
        repaired = true;
      }

      world = {
        ...(wRaw.layoutVersion === 2 ? { layoutVersion: 2 } : {}),
        seed: Math.floor(seed.val),
        worldTimeMin: round2(worldTimeMin.val),
        day: Math.floor(day.val),
        lastSavedAt: Math.floor(lastSavedAt.val),
        containers,
        barricades,
        droppedLoot,
      };
    }
  }

  return {
    save: {
      v: CURRENT_SAVE_VERSION,
      player,
      ...(world ? { world } : {}),
    },
    repaired,
    migrated,
  };
}

export function serializePlayerSave(player: SavedPlayerData, world?: SavedWorldData): PlayerSave {
  const cleanPlayer: SavedPlayerData = {
    x: round2(player.x),
    y: round2(player.y),
    angle: round2(player.angle),
    hp: round2(player.hp),
    stamina: round2(player.stamina),
    hunger: round2(player.hunger),
    thirst: round2(player.thirst),
    bleeding: Math.max(0, Math.min(3, Math.round(player.bleeding))),
    panic: round2(player.panic),
    infected: round2(player.infected),
    battery: round2(player.battery),
    flashlightOn: Boolean(player.flashlightOn),
    sneaking: Boolean(player.sneaking),
    kills: Math.max(0, Math.floor(player.kills)),
    daysSurvived: Math.max(0, Math.floor(player.daysSurvived)),
    activeSlot: Math.max(0, Math.min(HOTBAR_SLOTS - 1, Math.floor(player.activeSlot))),
    inventory: player.inventory.map((it) => ({
      id: it.id,
      qty: Math.floor(it.qty),
      ...(it.dur !== undefined ? { dur: Math.round(it.dur) } : {}),
    })),
  };

  if (!world) return { v: CURRENT_SAVE_VERSION, player: cleanPlayer };

  const cleanContainers: Record<string, SavedContainer> = {};
  for (const [k, c] of Object.entries(world.containers)) {
    cleanContainers[k] = {
      looted: Boolean(c.looted),
      restockDay: Math.floor(c.restockDay),
      items: c.items.map((it) => ({
        id: it.id,
        qty: Math.floor(it.qty),
        ...(it.dur !== undefined ? { dur: Math.round(it.dur) } : {}),
      })),
    };
  }

  return {
    v: CURRENT_SAVE_VERSION,
    player: cleanPlayer,
    world: {
      ...(world.layoutVersion === 2 ? { layoutVersion: 2 } : {}),
      seed: Math.floor(world.seed),
      worldTimeMin: round2(world.worldTimeMin),
      day: Math.floor(world.day),
      lastSavedAt: Math.floor(world.lastSavedAt),
      containers: cleanContainers,
      barricades: world.barricades.slice(0, MAX_BARRICADES).map((b) => ({
        id: b.id,
        kind: b.kind,
        x: round2(b.x),
        y: round2(b.y),
        angle: round2(b.angle),
        hp: round2(b.hp),
        maxHp: round2(b.maxHp),
        ownerId: b.ownerId,
      })),
      droppedLoot: world.droppedLoot.slice(0, MAX_DROPPED_LOOT).map((d) => ({
        id: d.id,
        x: round2(d.x),
        y: round2(d.y),
        items: d.items.map((it) => ({
          id: it.id,
          qty: Math.floor(it.qty),
          ...(it.dur !== undefined ? { dur: Math.round(it.dur) } : {}),
        })),
        droppedAt: Math.floor(d.droppedAt),
      })),
    },
  };
}

export function measureSaveBytes(save: PlayerSave): { bytes: number; warn: boolean; overLimit: boolean } {
  const bytes = new TextEncoder().encode(JSON.stringify(save)).length;
  return {
    bytes,
    warn: bytes >= SAVE_WARN_BYTES,
    overLimit: bytes > SAVE_MAX_BYTES,
  };
}

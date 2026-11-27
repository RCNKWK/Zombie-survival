import { canReachLoot, findNearbyLoot, type LootTarget } from './loot.js';
import {
  CONTAINER_RESTOCK_DAYS,
  DAY_MINUTES,
  FLASHLIGHT_RANGE,
  GAME_MINUTES_PER_REAL_SEC,
  HOTBAR_SLOTS,
  INITIAL_GROUND_DROPS,
  INTEREST_RADIUS,
  MAX_BARRICADES,
  MAX_DROPPED_LOOT,
  MAX_ZOMBIES,
  PLAYER_RADIUS,
  PLAYER_SNEAK_SPEED,
  PLAYER_SPRINT_SPEED,
  PLAYER_WALK_SPEED,
  SAFE_SPAWN_X,
  SAFE_SPAWN_Y,
  VISION_RANGE_DAY,
  VISION_RANGE_NIGHT,
  WORLD_SIZE,
  ZOMBIE_RADIUS,
} from './constants.js';
import {
  ITEMS,
  RECIPES,
  addItemToInventory,
  countItemInInventory,
  makeItem,
  removeItemFromInventory,
  isItemId,
  type BuildKind,
  type InvItem,
} from './items.js';
import type {
  ClientMsg,
  LootView,
  NetBarricade,
  NetContainerState,
  NetDroppedLoot,
  NetPlayer,
  NetZombie,
  SimEvent,
  SnapPayload,
} from './protocol.js';
import {
  round2,
  type SavedBarricade,
  type SavedContainer,
  type SavedDroppedLoot,
  type SavedPlayerData,
  type SavedWorldData,
} from './save.js';
import {
  clampWorldPos,
  findBuildingAt,
  generateContainerLoot,
  generateTown,
  hasLineOfSight,
  resolveCircleRect,
  segmentIntersectsRect,
  type Rect,
  type TownLayout,
} from './worldgen.js';

export type ZombieKind = 'w' | 'r' | 'b';

export interface LootSession extends LootTarget {
  remaining: number;
  startX: number;
  startY: number;
  lastHp: number;
}

export interface SimPlayer {
  loot?: LootSession;
  id: number;
  userId: string;
  name: string;
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
  sprinting: boolean;
  kills: number;
  daysSurvived: number;
  activeSlot: number;
  inventory: InvItem[];
  inputDx: number;
  inputDy: number;
  attackCd: number;
  shoveCd: number;
  swingTimer: number;
  footstepTimer: number;
  emote?: 1 | 2 | 3 | 4 | 5 | 6;
  emoteTimer: number;
  away: boolean;
  dead: boolean;
  dirty: boolean;
  invDirty: boolean;
}

export interface SimZombie {
  id: number;
  kind: ZombieKind;
  x: number;
  y: number;
  angle: number;
  hp: number;
  maxHp: number;
  speed: number;
  damage: number;
  state: 'i' | 'v' | 'c' | 'a' | 'k';
  targetX: number;
  targetY: number;
  targetPlayerId: number | null;
  stateTimer: number;
  attackCd: number;
  knockVx: number;
  knockVy: number;
}

export interface SimWorldState {
  seed: number;
  town: TownLayout;
  tick: number;
  worldTimeMin: number;
  day: number;
  lastSavedAt: number;
  players: Map<number, SimPlayer>;
  zombies: Map<number, SimZombie>;
  containers: Map<string, SavedContainer>;
  barricades: Map<string, SavedBarricade>;
  droppedLoot: Map<string, SavedDroppedLoot>;
  events: SimEvent[];
  nextZombieId: number;
  seq: number;
  spawnDirectorTimer: number;
  dirtyWorld: boolean;
}

function normalizeAngle(a: number): number {
  let x = a;
  while (x > Math.PI) x -= Math.PI * 2;
  while (x < -Math.PI) x += Math.PI * 2;
  return x;
}

function buildDynamicObstacleRects(barricades: Map<string, SavedBarricade>): Rect[] {
  const rects: Rect[] = [];
  for (const b of barricades.values()) {
    if (b.kind === 'barricade') {
      rects.push({ x: b.x - 0.85, y: b.y - 0.85, w: 1.7, h: 1.7 });
    }
  }
  return rects;
}

function resolveEntityCollisions(
  x: number,
  y: number,
  radius: number,
  town: TownLayout,
  barricadeRects: Rect[],
): { x: number; y: number } {
  let pos = clampWorldPos(x, y, radius);
  for (let pass = 0; pass < 2; pass++) {
    for (const obs of town.obstacles) {
      pos = resolveCircleRect(pos.x, pos.y, radius, obs);
    }
    for (const br of barricadeRects) {
      pos = resolveCircleRect(pos.x, pos.y, radius, br);
    }
    pos = clampWorldPos(pos.x, pos.y, radius);
  }
  return pos;
}

export function createDefaultPlayerData(rng: () => number = Math.random): SavedPlayerData {
  const angle = rng() * Math.PI * 2;
  const dist = 0.6 + rng() * 1.4;
  return {
    x: round2(SAFE_SPAWN_X + Math.cos(angle) * dist),
    y: round2(SAFE_SPAWN_Y + Math.sin(angle) * dist),
    angle: 0,
    hp: 100,
    stamina: 100,
    hunger: 90,
    thirst: 90,
    bleeding: 0,
    panic: 0,
    infected: 0,
    battery: 100,
    flashlightOn: false,
    sneaking: false,
    kills: 0,
    daysSurvived: 0,
    activeSlot: 0,
    inventory: [],
  };
}

export function playerFromSaved(id: number, userId: string, name: string, saved: SavedPlayerData, town?: TownLayout): SimPlayer {
  let x = saved.x;
  let y = saved.y;
  if (town) {
    const resolved = resolveEntityCollisions(x, y, PLAYER_RADIUS, town, []);
    x = resolved.x;
    y = resolved.y;
  }
  return {
    id,
    userId,
    name,
    x,
    y,
    angle: saved.angle,
    hp: saved.hp,
    stamina: saved.stamina,
    hunger: saved.hunger,
    thirst: saved.thirst,
    bleeding: saved.bleeding,
    panic: saved.panic,
    infected: saved.infected,
    battery: saved.battery,
    flashlightOn: saved.flashlightOn,
    sneaking: saved.sneaking,
    sprinting: false,
    kills: saved.kills,
    daysSurvived: saved.daysSurvived,
    activeSlot: Math.max(0, Math.min(HOTBAR_SLOTS - 1, saved.activeSlot)),
    inventory: saved.inventory.map((i) => ({ ...i })),
    inputDx: 0,
    inputDy: 0,
    attackCd: 0,
    shoveCd: 0,
    swingTimer: 0,
    footstepTimer: 0,
    emoteTimer: 0,
    away: false,
    dead: saved.hp <= 0,
    dirty: false,
    invDirty: true,
  };
}

export function playerToSaved(p: SimPlayer): SavedPlayerData {
  return {
    x: round2(p.x),
    y: round2(p.y),
    angle: round2(p.angle),
    hp: round2(p.hp),
    stamina: round2(p.stamina),
    hunger: round2(p.hunger),
    thirst: round2(p.thirst),
    bleeding: p.bleeding,
    panic: round2(p.panic),
    infected: round2(p.infected),
    battery: round2(p.battery),
    flashlightOn: p.flashlightOn,
    sneaking: p.sneaking,
    kills: p.kills,
    daysSurvived: p.daysSurvived,
    activeSlot: p.activeSlot,
    inventory: p.inventory.map((i) => ({ ...i })),
  };
}

export function worldToSaved(w: SimWorldState, nowMs = Date.now()): SavedWorldData {
  const containers: Record<string, SavedContainer> = {};
  for (const [id, c] of w.containers.entries()) {
    containers[id] = { looted: c.looted, restockDay: c.restockDay, items: c.items.map((i) => ({ ...i })) };
  }
  return {
    layoutVersion: 2,
    seed: w.seed,
    worldTimeMin: round2(w.worldTimeMin),
    day: w.day,
    lastSavedAt: nowMs,
    containers,
    barricades: [...w.barricades.values()].map((b) => ({ ...b })),
    droppedLoot: [...w.droppedLoot.values()].map((d) => ({ ...d, items: d.items.map((i) => ({ ...i })) })),
  };
}

function makeZombie(id: number, kind: ZombieKind, x: number, y: number, angle: number): SimZombie {
  const maxHp = kind === 'b' ? 140 : kind === 'r' ? 50 : 75;
  const speed = kind === 'r' ? 4.35 : kind === 'b' ? 1.85 : 2.35;
  const damage = kind === 'b' ? 24 : kind === 'r' ? 12 : 16;
  return {
    id,
    kind,
    x,
    y,
    angle,
    hp: maxHp,
    maxHp,
    speed,
    damage,
    state: 'i',
    targetX: x,
    targetY: y,
    targetPlayerId: null,
    stateTimer: 1,
    attackCd: 0,
    knockVx: 0,
    knockVy: 0,
  };
}

function spawnTownZombies(world: SimWorldState, count: number, rng: () => number, minSafeDist = 14) {
  const barRects = buildDynamicObstacleRects(world.barricades);
  let attempts = 0;
  while (world.zombies.size < count && attempts < count * 8) {
    attempts++;
    const x = 16 + rng() * (WORLD_SIZE - 32);
    const y = 16 + rng() * (WORLD_SIZE - 32);
    if (Math.hypot(x - SAFE_SPAWN_X, y - SAFE_SPAWN_Y) < minSafeDist) continue;
    // Don't spawn inside Safe House or directly on top of active players
    const b = findBuildingAt(world.town, x, y);
    if (b?.id === 'b_safehouse') continue;
    let tooCloseToPlayer = false;
    for (const p of world.players.values()) {
      if (Math.hypot(p.x - x, p.y - y) < 16) {
        tooCloseToPlayer = true;
        break;
      }
    }
    if (tooCloseToPlayer) continue;

    const resolved = resolveEntityCollisions(x, y, ZOMBIE_RADIUS, world.town, barRects);
    const r = rng();
    const kind: ZombieKind = r < 0.14 ? 'b' : r < 0.36 ? 'r' : 'w';
    const id = world.nextZombieId++;
    world.zombies.set(id, makeZombie(id, kind, resolved.x, resolved.y, rng() * Math.PI * 2));
  }
}

const GROUND_LOOT_TABLE: Array<() => InvItem[]> = [
  () => [makeItem('baseball_bat', 1)],
  () => [makeItem('crowbar', 1)],
  () => [makeItem('axe', 1)],
  () => [makeItem('knife', 1)],
  () => [makeItem('pistol', 1), makeItem('ammo_9mm', 6)],
  () => [makeItem('shotgun', 1), makeItem('ammo_12g', 4)],
  () => [makeItem('flashlight', 1)],
  () => [makeItem('canned_food', 1)],
  () => [makeItem('chips', 2)],
  () => [makeItem('water_bottle', 1)],
  () => [makeItem('soda', 2)],
  () => [makeItem('bandage', 2)],
  () => [makeItem('medkit', 1)],
  () => [makeItem('antibiotics', 1)],
  () => [makeItem('wood_plank', 2), makeItem('nails', 4)],
  () => [makeItem('scrap_metal', 2)],
  () => [makeItem('battery', 1)],
  () => [makeItem('ammo_9mm', 8)],
  () => [makeItem('rag', 2)],
];

export function spawnRandomGroundDrops(world: SimWorldState, targetCount: number, rng: () => number, nowMs = Date.now(), expandedOnly = false) {
  const barRects = buildDynamicObstacleRects(world.barricades);

  // Guaranteed nearby starter drops around Safe House / central street on a fresh world
  if (world.droppedLoot.size === 0 && !expandedOnly) {
    const starterItems: InvItem[][] = [
      [makeItem('baseball_bat', 1)],
      [makeItem('knife', 1)],
      [makeItem('flashlight', 1)],
      [makeItem('water_bottle', 1), makeItem('canned_food', 1)],
      [makeItem('bandage', 2)],
    ];
    for (const bundle of starterItems) {
      const ang = rng() * Math.PI * 2;
      const dist = 3.2 + rng() * 9.5;
      const pos = resolveEntityCollisions(
        SAFE_SPAWN_X + Math.cos(ang) * dist,
        SAFE_SPAWN_Y + Math.sin(ang) * dist,
        0.5,
        world.town,
        barRects,
      );
      dropLootAt(world, pos.x, pos.y, bundle, nowMs);
    }
  }

  let attempts = 0;
  while (world.droppedLoot.size < targetCount && attempts < targetCount * 6) {
    attempts++;
    const x = 18 + rng() * (WORLD_SIZE - 36);
    const y = 18 + rng() * (WORLD_SIZE - 36);
    const pos = resolveEntityCollisions(x, y, 0.5, world.town, barRects);
    if (expandedOnly && pos.x < 240 && pos.y < 240) continue;
    let tooClose = false;
    for (const existing of world.droppedLoot.values()) {
      if (Math.hypot(existing.x - pos.x, existing.y - pos.y) < 4.5) {
        tooClose = true;
        break;
      }
    }
    if (tooClose) continue;
    const pick = GROUND_LOOT_TABLE[Math.floor(rng() * GROUND_LOOT_TABLE.length)]!;
    dropLootAt(world, pos.x, pos.y, pick(), nowMs);
  }
}

export function createWorldState(
  seed: number,
  savedWorld?: SavedWorldData,
  nowMs = Date.now(),
  rng: () => number = Math.random,
): SimWorldState {
  const actualSeed = savedWorld?.seed ?? seed;
  const town = generateTown(actualSeed);

  let worldTimeMin = savedWorld?.worldTimeMin ?? 480; // 08:00 AM
  let day = savedWorld?.day ?? 1;

  // Offline catch-up: advance time moderately (up to 12 in-game hours per real day)
  if (savedWorld && nowMs > savedWorld.lastSavedAt) {
    const elapsedSec = Math.min(3600 * 6, (nowMs - savedWorld.lastSavedAt) / 1000);
    const addMinutes = Math.min(DAY_MINUTES, elapsedSec * (GAME_MINUTES_PER_REAL_SEC * 0.25));
    const total = worldTimeMin + addMinutes;
    day += Math.floor(total / DAY_MINUTES);
    worldTimeMin = total % DAY_MINUTES;
  }

  const containers = new Map<string, SavedContainer>();
  if (savedWorld) {
    for (const [cid, c] of Object.entries(savedWorld.containers)) {
      if (c.looted && c.restockDay <= day && c.items.length === 0) {
        // Restock by letting it regenerate from deterministic cycle
        continue;
      }
      containers.set(cid, { looted: c.looted, restockDay: c.restockDay, items: c.items.map((i) => ({ ...i })) });
    }
  }

  const barricades = new Map<string, SavedBarricade>();
  if (savedWorld) {
    for (const b of savedWorld.barricades) barricades.set(b.id, { ...b });
  }

  const droppedLoot = new Map<string, SavedDroppedLoot>();
  if (savedWorld) {
    for (const d of savedWorld.droppedLoot) droppedLoot.set(d.id, { ...d, items: d.items.map((i) => ({ ...i })) });
  }

  const world: SimWorldState = {
    seed: actualSeed,
    town,
    tick: 0,
    worldTimeMin,
    day,
    lastSavedAt: nowMs,
    players: new Map(),
    zombies: new Map(),
    containers,
    barricades,
    droppedLoot,
    events: [],
    nextZombieId: 1,
    seq: 1,
    spawnDirectorTimer: 3,
    dirtyWorld: false,
  };

  if (!savedWorld) {
    spawnRandomGroundDrops(world, INITIAL_GROUND_DROPS, rng, nowMs);
    world.dirtyWorld = false;
  } else if (savedWorld.layoutVersion !== 2) {
    // Seed new districts once; leave every original item/container untouched.
    spawnRandomGroundDrops(world, Math.min(MAX_DROPPED_LOOT, world.droppedLoot.size + 18), rng, nowMs, true);
    world.dirtyWorld = true;
  }
  spawnTownZombies(world, MAX_ZOMBIES, rng, 15);
  return world;
}

export function isNightTime(worldTimeMin: number): boolean {
  return worldTimeMin >= 1200 || worldTimeMin < 360; // 20:00 -> 06:00
}

function getContainerItems(world: SimWorldState, containerId: string): SavedContainer {
  const existing = world.containers.get(containerId);
  if (existing) {
    if (existing.looted && existing.items.length === 0 && existing.restockDay <= world.day) {
      const def = world.town.containers.find((c) => c.id === containerId);
      const fresh: SavedContainer = {
        looted: false,
        restockDay: world.day + CONTAINER_RESTOCK_DAYS,
        items: def ? generateContainerLoot(world.seed, def, Math.floor(world.day / CONTAINER_RESTOCK_DAYS) + 1) : [],
      };
      world.containers.set(containerId, fresh);
      return fresh;
    }
    return existing;
  }
  const def = world.town.containers.find((c) => c.id === containerId);
  const items = def ? generateContainerLoot(world.seed, def, Math.floor(world.day / CONTAINER_RESTOCK_DAYS) + 1) : [];
  const state: SavedContainer = {
    looted: false,
    restockDay: world.day + CONTAINER_RESTOCK_DAYS,
    items,
  };
  return state;
}

function emitNoise(world: SimWorldState, x: number, y: number, radius: number, sourcePlayerId?: number) {
  world.events.push({ k: 'noise', x: round2(x), y: round2(y), r: round2(radius) });
  for (const z of world.zombies.values()) {
    if (z.state === 'k') continue;
    const dist = Math.hypot(z.x - x, z.y - y);
    if (dist <= radius) {
      if (z.state !== 'c' || (sourcePlayerId !== undefined && z.targetPlayerId === sourcePlayerId)) {
        z.state = 'v';
        z.targetX = x;
        z.targetY = y;
        z.stateTimer = 5.5;
      }
    }
  }
}

export function getEquippedItem(p: SimPlayer): InvItem | undefined {
  return p.inventory[p.activeSlot];
}

export function handlePlayerAttack(world: SimWorldState, p: SimPlayer, rng: () => number = Math.random): boolean {
  p.loot = undefined;
  if (p.dead || p.away || p.attackCd > 0) return false;
  const equipped = getEquippedItem(p);
  const def = equipped ? ITEMS[equipped.id] : undefined;

  // Only the weapon in the active slot can attack.
  if (!equipped || !def || (def.category !== 'melee' && def.category !== 'gun')) {
    return false;
  }

  if (def.category === 'melee') {
    if (p.stamina < 6) {
      world.events.push({ k: 'toast', pid: p.id, msg: 'Too exhausted to swing!' });
      return false;
    }
    p.stamina = Math.max(0, p.stamina - 6);
    p.attackCd = def.cooldownSec ?? 0.45;
    p.swingTimer = 0.25;
    p.dirty = true;
    world.events.push({ k: 'swing', pid: p.id });

    const hitAny = meleeHit(
      world,
      p,
      def.damage ?? 22,
      def.range ?? 2.0,
      def.arcRad ?? 1.2,
      def.knockback ?? 2.5,
      def.noise ?? 8,
    );
    if (hitAny && equipped.dur !== undefined) {
      equipped.dur -= 1;
      if (equipped.dur <= 0) {
        p.inventory.splice(p.activeSlot, 1);
        world.events.push({ k: 'toast', pid: p.id, msg: `${def.name} broke!` });
      }
      p.invDirty = true;
    }
    return true;
  }

  // Firearm
  if (def.category === 'gun' && def.ammoId) {
    if (!removeItemFromInventory(p.inventory, def.ammoId, 1)) {
      world.events.push({ k: 'toast', pid: p.id, msg: `Out of ${ITEMS[def.ammoId].name}!` });
      p.attackCd = 0.25;
      return false;
    }
    p.invDirty = true;
    p.dirty = true;
    p.attackCd = def.cooldownSec ?? 0.35;
    p.swingTimer = 0.16;

    const range = def.range ?? 20;
    const noise = def.noise ?? 26;
    emitNoise(world, p.x, p.y, noise, p.id);

    const isShotgun = equipped.id === 'shotgun';
    const pellets = isShotgun ? 5 : 1;
    const spread = isShotgun ? 0.34 : Math.min(0.18, 0.03 + p.panic * 0.0012);

    for (let i = 0; i < pellets; i++) {
      const shotAngle = p.angle + (rng() - 0.5) * spread;
      const dx = Math.cos(shotAngle);
      const dy = Math.sin(shotAngle);
      let hitDist = range;
      let hitZombie: SimZombie | null = null;

      // Wall raycast step
      for (const z of world.zombies.values()) {
        const vx = z.x - p.x;
        const vy = z.y - p.y;
        const proj = vx * dx + vy * dy;
        if (proj < 0 || proj > hitDist) continue;
        const perp = Math.abs(vx * dy - vy * dx);
        if (perp <= ZOMBIE_RADIUS + 0.22 && hasLineOfSight(world.town, p.x, p.y, z.x, z.y)) {
          hitDist = proj;
          hitZombie = z;
        }
      }

      // Clamp tracer to wall
      let wallDist = hitDist;
      const steps = Math.ceil(hitDist * 2);
      for (let s = 1; s <= steps; s++) {
        const d = (s / steps) * hitDist;
        const tx = p.x + dx * d;
        const ty = p.y + dy * d;
        let blocked = false;
        for (const b of world.town.buildings) {
          for (const w of b.walls) {
            if (segmentIntersectsRect(p.x, p.y, tx, ty, w)) {
              blocked = true;
              break;
            }
          }
          if (blocked) break;
        }
        if (blocked) {
          wallDist = d;
          hitZombie = null;
          break;
        }
      }

      const endX = p.x + dx * wallDist;
      const endY = p.y + dy * wallDist;
      world.events.push({
        k: 'shot',
        x: round2(p.x + dx * 0.5),
        y: round2(p.y + dy * 0.5),
        x2: round2(endX),
        y2: round2(endY),
        ...(isShotgun ? { sg: true } : {}),
      });

      if (hitZombie) {
        const dmg = isShotgun ? (def.damage ?? 85) / pellets : (def.damage ?? 45);
        damageZombie(world, hitZombie, dmg, dx * (def.knockback ?? 2.5), dy * (def.knockback ?? 2.5), p, rng);
      }
    }

    if (equipped.dur !== undefined) {
      equipped.dur -= 1;
      if (equipped.dur <= 0) {
        p.inventory.splice(p.activeSlot, 1);
        world.events.push({ k: 'toast', pid: p.id, msg: `${def.name} jammed & broke!` });
      }
    }
    return true;
  }

  return false;
}

function meleeHit(
  world: SimWorldState,
  p: SimPlayer,
  damage: number,
  range: number,
  arcRad: number,
  knockback: number,
  noise: number,
): boolean {
  let hitAny = false;
  for (const z of [...world.zombies.values()]) {
    const dx = z.x - p.x;
    const dy = z.y - p.y;
    const dist = Math.hypot(dx, dy);
    if (dist > range + ZOMBIE_RADIUS) continue;
    const ang = Math.atan2(dy, dx);
    if (Math.abs(normalizeAngle(ang - p.angle)) > arcRad / 2) continue;
    if (!hasLineOfSight(world.town, p.x, p.y, z.x, z.y)) continue;

    const nx = dist > 0.01 ? dx / dist : Math.cos(p.angle);
    const ny = dist > 0.01 ? dy / dist : Math.sin(p.angle);
    damageZombie(world, z, damage, nx * knockback, ny * knockback, p);
    hitAny = true;
  }
  if (hitAny) emitNoise(world, p.x, p.y, noise, p.id);
  return hitAny;
}

function damageZombie(
  world: SimWorldState,
  z: SimZombie,
  damage: number,
  kx: number,
  ky: number,
  attacker: SimPlayer,
  rng: () => number = Math.random,
) {
  z.hp -= damage;
  z.knockVx += kx * 2.4;
  z.knockVy += ky * 2.4;
  z.state = 'c';
  z.targetPlayerId = attacker.id;
  world.events.push({ k: 'hit', x: round2(z.x), y: round2(z.y), z: true });

  if (z.hp <= 0) {
    world.zombies.delete(z.id);
    attacker.kills += 1;
    attacker.dirty = true;
    // Drop small loot occasionally (rags, ammo, battery, canned food)
    const roll = rng();
    if (roll < 0.35) {
      const items: InvItem[] = [];
      if (roll < 0.16) items.push(makeItem('rag', 1));
      else if (roll < 0.24) items.push(makeItem('ammo_9mm', 3));
      else if (roll < 0.3) items.push(makeItem('battery', 1));
      else items.push(makeItem('chips', 1));
      dropLootAt(world, z.x, z.y, items);
    }
  }
}

export function handlePlayerShove(world: SimWorldState, p: SimPlayer, rng: () => number = Math.random): boolean {
  p.loot = undefined;
  if (p.dead || p.away || p.shoveCd > 0) return false;
  if (p.stamina < 4) return false;
  p.stamina = Math.max(0, p.stamina - 4);
  p.shoveCd = 0.55;
  p.swingTimer = 0.2;
  p.dirty = true;
  world.events.push({ k: 'shove', pid: p.id });

  let pushed = false;
  for (const z of world.zombies.values()) {
    const dx = z.x - p.x;
    const dy = z.y - p.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 2.0) continue;
    const ang = Math.atan2(dy, dx);
    if (Math.abs(normalizeAngle(ang - p.angle)) > 0.85) continue;
    const nx = dist > 0.01 ? dx / dist : Math.cos(p.angle);
    const ny = dist > 0.01 ? dy / dist : Math.sin(p.angle);
    z.knockVx += nx * 8.5;
    z.knockVy += ny * 8.5;
    if (rng() < 0.55) {
      z.state = 'k';
      z.stateTimer = 1.6;
    }
    world.events.push({ k: 'hit', x: round2(z.x), y: round2(z.y), z: true });
    pushed = true;
  }
  if (pushed) emitNoise(world, p.x, p.y, 7, p.id);
  return true;
}

export function dropLootAt(world: SimWorldState, x: number, y: number, items: InvItem[], nowMs = Date.now()) {
  if (items.length === 0) return;
  if (world.droppedLoot.size >= MAX_DROPPED_LOOT) {
    const oldestKey = world.droppedLoot.keys().next().value;
    if (oldestKey) world.droppedLoot.delete(oldestKey);
  }
  let id: string;
  do { id = `d_${world.day}_${world.seq++}`; } while (world.droppedLoot.has(id));
  const bounded = clampWorldPos(x, y, 0.5);
  world.droppedLoot.set(id, {
    id,
    x: round2(bounded.x),
    y: round2(bounded.y),
    items: items.map((i) => ({ ...i })),
    droppedAt: nowMs,
  });
  world.dirtyWorld = true;
}

export function handlePlayerInteract(world: SimWorldState, p: SimPlayer): boolean {
  if (p.dead || p.away) return false;
  if (p.loot) { p.loot = undefined; return true; }
  const target = findNearbyLoot(world.town, world.droppedLoot.values(), p);
  if (!target) return false;
  const existing = target.kind === 'container' ? world.containers.get(target.id) : undefined;
  const searched = existing && !(existing.looted && existing.items.length === 0 && existing.restockDay <= world.day);
  p.loot = {...target, remaining: searched ? 0 : target.duration, startX: p.x, startY: p.y, lastHp: p.hp};
  if (p.loot.remaining > 0) emitNoise(world, p.x, p.y, 3, p.id);
  return true;
}

function validLootSession(world: SimWorldState, p: SimPlayer): boolean {
  const session = p.loot;
  if (!session || p.dead || p.away || p.hp <= 0 || p.hp < session.lastHp - 0.001 ||
      Math.hypot(p.inputDx, p.inputDy) > 0.05 || Math.hypot(p.x - session.startX, p.y - session.startY) > 0.15 ||
      !canReachLoot(world.town, p, session) ||
      (session.kind === 'ground' && !world.droppedLoot.has(session.id))) {
    p.loot = undefined;
    return false;
  }
  const container = world.containers.get(session.id);
  if (session.remaining === 0 && session.kind === 'container' && container?.looted &&
      container.items.length === 0 && container.restockDay <= world.day) {
    p.loot = undefined;
    return false;
  }
  return true;
}

function updateLootSearch(world: SimWorldState, p: SimPlayer, dt: number) {
  if (!validLootSession(world, p)) return;
  const session = p.loot!;
  session.lastHp = p.hp;
  if (session.remaining <= 0) return;
  session.remaining = Math.max(0, session.remaining - dt);
  if (session.remaining < 0.001) {
    session.remaining = 0;
    const state = getContainerItems(world, session.id);
    state.looted = state.items.length === 0;
    world.containers.set(session.id, state);
    world.dirtyWorld = true;
  }
}

function lootView(world: SimWorldState, p?: SimPlayer): LootView | null {
  if (!p || !validLootSession(world, p)) return null;
  const s = p.loot!;
  const items = s.kind === 'ground' ? world.droppedLoot.get(s.id)?.items : world.containers.get(s.id)?.items;
  return {id: s.id, kind: s.kind, name: s.name, duration: s.duration,
    remaining: Math.ceil(s.remaining * 100) / 100,
    ...(s.remaining === 0 ? {items: (items ?? []).map(item => ({...item}))} : {}),
  };
}

export function handlePlayerLoot(world: SimWorldState, p: SimPlayer, request: Extract<ClientMsg, {t: 'loot'}>): boolean {
  if (!validLootSession(world, p) || p.loot!.remaining > 0 || request.source !== p.loot!.id) return false;
  if (!['one', 'stack', 'all'].includes(request.mode)) return false;
  if (request.mode !== 'all' && (!isItemId(request.item) ||
      (request.dur !== undefined && (typeof request.dur !== 'number' || !Number.isFinite(request.dur))))) return false;
  const s = p.loot!;
  const source = s.kind === 'ground' ? world.droppedLoot.get(s.id) : world.containers.get(s.id);
  if (!source) return false;
  let total = 0;
  for (const item of source.items) {
    if (request.mode !== 'all' && (item.id !== request.item || item.dur !== request.dur)) continue;
    const wanted = request.mode === 'one' ? 1 : item.qty;
    const remainder = addItemToInventory(p.inventory, item.id, wanted, item.dur);
    const taken = wanted - remainder;
    item.qty -= taken;
    total += taken;
    if (request.mode !== 'all') break;
  }
  source.items = source.items.filter(item => item.qty > 0);
  if (total === 0) {
    if (source.items.length) world.events.push({k: 'toast', pid: p.id, msg: 'Backpack full, or this item was already taken.'});
    return false;
  }
  if (s.kind === 'ground') {
    if (source.items.length === 0) { world.droppedLoot.delete(s.id); p.loot = undefined; }
  } else {
    const container = source as SavedContainer;
    container.looted = container.items.length === 0;
    if (container.looted) container.restockDay = world.day + CONTAINER_RESTOCK_DAYS;
  }
  autoEquipOnPickup(p);
  p.dirty = true;
  p.invDirty = true;
  world.dirtyWorld = true;
  world.events.push({k: 'toast', pid: p.id, msg: `Picked up: ${total} item${total === 1 ? '' : 's'}`});
  return true;
}

function autoEquipOnPickup(p: SimPlayer) {
  const cur = p.inventory[p.activeSlot];
  const curCat = cur ? ITEMS[cur.id].category : undefined;
  if (cur && (curCat === 'melee' || curCat === 'gun')) return;

  // Prefer newly picked up weapon in hotbar slots 0..3
  for (let i = 0; i < Math.min(HOTBAR_SLOTS, p.inventory.length); i++) {
    const cat = ITEMS[p.inventory[i]!.id].category;
    if (cat === 'melee' || cat === 'gun') {
      p.activeSlot = i;
      return;
    }
  }
  // Otherwise if active slot was empty, point to first non-empty hotbar slot
  if (!cur && p.inventory.length > 0) {
    p.activeSlot = Math.min(p.activeSlot, Math.min(HOTBAR_SLOTS, p.inventory.length) - 1);
  }
}

export function handlePlayerUseItem(world: SimWorldState, p: SimPlayer, slotIdx: number): boolean {
  if (p.dead || p.away) return false;
  if (!Number.isInteger(slotIdx) || slotIdx < 0 || slotIdx >= p.inventory.length) return false;
  const slot = p.inventory[slotIdx]!;
  const def = ITEMS[slot.id];

  if (def.category === 'melee' || def.category === 'gun') {
    if (slotIdx < HOTBAR_SLOTS) {
      p.activeSlot = slotIdx;
    } else {
      // Swap into active hotbar slot
      const prev = p.inventory[p.activeSlot];
      p.inventory[p.activeSlot] = slot;
      if (prev) p.inventory[slotIdx] = prev;
      else p.inventory.splice(slotIdx, 1);
    }
    p.dirty = true;
    p.invDirty = true;
    return true;
  }

  if (slot.id === 'flashlight') {
    p.flashlightOn = !p.flashlightOn;
    p.dirty = true;
    return true;
  }

  if (def.batteryCharge) {
    if (p.battery >= 99) return false;
    p.battery = Math.min(100, p.battery + def.batteryCharge);
    world.events.push({ k: 'use', pid: p.id, item: slot.id });
    consumeOneFromSlot(p.inventory, slotIdx);
    p.dirty = true;
    p.invDirty = true;
    world.events.push({ k: 'toast', pid: p.id, msg: 'Recharged flashlight battery.' });
    return true;
  }

  if (def.hunger || def.thirst || def.heal || def.stopBleed || def.cureInfection) {
    if (def.hunger) p.hunger = Math.max(0, Math.min(100, p.hunger + def.hunger));
    if (def.thirst) p.thirst = Math.max(0, Math.min(100, p.thirst + def.thirst));
    if (def.heal) p.hp = Math.min(100, p.hp + def.heal);
    if (def.stopBleed && p.bleeding > 0) p.bleeding = 0;
    if (def.cureInfection && p.infected > 0) p.infected = 0;
    world.events.push({ k: 'use', pid: p.id, item: slot.id });
    consumeOneFromSlot(p.inventory, slotIdx);
    p.dirty = true;
    p.invDirty = true;
    world.events.push({ k: 'toast', pid: p.id, msg: `Used ${def.name}` });
    return true;
  }

  return false;
}

function consumeOneFromSlot(inv: InvItem[], slotIdx: number) {
  const slot = inv[slotIdx];
  if (!slot) return;
  if (slot.qty <= 1) inv.splice(slotIdx, 1);
  else slot.qty -= 1;
}

export function handlePlayerDropItem(world: SimWorldState, p: SimPlayer, slotIdx: number): boolean {
  if (p.dead || p.away) return false;
  if (!Number.isInteger(slotIdx) || slotIdx < 0 || slotIdx >= p.inventory.length) return false;
  const [removed] = p.inventory.splice(slotIdx, 1);
  if (!removed) return false;
  if (p.activeSlot >= p.inventory.length) p.activeSlot = 0;
  dropLootAt(world, p.x + Math.cos(p.angle) * 0.8, p.y + Math.sin(p.angle) * 0.8, [removed]);
  p.dirty = true;
  p.invDirty = true;
  return true;
}

export function handlePlayerCraft(world: SimWorldState, p: SimPlayer, recipeId: string): boolean {
  if (p.dead || p.away) return false;
  const recipe = RECIPES.find((r) => r.id === recipeId && r.output);
  if (!recipe || !recipe.output) return false;
  for (const req of recipe.inputs) {
    if (countItemInInventory(p.inventory, req.id) < req.qty) {
      world.events.push({ k: 'toast', pid: p.id, msg: 'Missing materials!' });
      return false;
    }
  }
  for (const req of recipe.inputs) removeItemFromInventory(p.inventory, req.id, req.qty);
  const rem = addItemToInventory(p.inventory, recipe.output.id, recipe.output.qty);
  if (rem > 0) dropLootAt(world, p.x, p.y, [makeItem(recipe.output.id, rem)]);
  p.dirty = true;
  p.invDirty = true;
  world.events.push({ k: 'toast', pid: p.id, msg: `Crafted ${ITEMS[recipe.output.id].name}` });
  return true;
}

export function handlePlayerBuild(world: SimWorldState, p: SimPlayer, kind: BuildKind): boolean {
  if (p.dead || p.away) return false;
  if (world.barricades.size >= MAX_BARRICADES) {
    world.events.push({ k: 'toast', pid: p.id, msg: 'Structure limit reached!' });
    return false;
  }
  const recipe = RECIPES.find((r) => r.buildKind === kind);
  if (!recipe) return false;
  for (const req of recipe.inputs) {
    if (countItemInInventory(p.inventory, req.id) < req.qty) {
      world.events.push({ k: 'toast', pid: p.id, msg: `Need ${recipe.inputs.map((i) => `${ITEMS[i.id].name} x${i.qty}`).join(', ')}` });
      return false;
    }
  }

  const bx = round2(p.x + Math.cos(p.angle) * 1.65);
  const by = round2(p.y + Math.sin(p.angle) * 1.65);
  const clamped = clampWorldPos(bx, by, 1.0);
  for (const existing of world.barricades.values()) {
    if (Math.hypot(existing.x - clamped.x, existing.y - clamped.y) < 1.5) {
      world.events.push({ k: 'toast', pid: p.id, msg: 'Too close to another structure!' });
      return false;
    }
  }

  for (const req of recipe.inputs) removeItemFromInventory(p.inventory, req.id, req.qty);
  const maxHp = kind === 'barricade' ? 160 : kind === 'trap' ? 90 : 120;
  const id = `b_${world.day}_${world.seq++}`;
  world.barricades.set(id, {
    id,
    kind,
    x: round2(clamped.x),
    y: round2(clamped.y),
    angle: round2(p.angle),
    hp: maxHp,
    maxHp,
    ownerId: p.userId,
  });
  emitNoise(world, clamped.x, clamped.y, 11, p.id);
  p.dirty = true;
  p.invDirty = true;
  world.dirtyWorld = true;
  world.events.push({ k: 'toast', pid: p.id, msg: `Built ${kind}!` });
  return true;
}

export function handlePlayerRepair(world: SimWorldState, p: SimPlayer, barricadeId: string): boolean {
  if (p.dead || p.away) return false;
  const b = world.barricades.get(barricadeId);
  if (!b || Math.hypot(b.x - p.x, b.y - p.y) > 3.2 || b.hp >= b.maxHp) return false;
  if (countItemInInventory(p.inventory, 'wood_plank') < 1) {
    world.events.push({ k: 'toast', pid: p.id, msg: 'Need 1 Wood Plank to repair!' });
    return false;
  }
  removeItemFromInventory(p.inventory, 'wood_plank', 1);
  b.hp = Math.min(b.maxHp, b.hp + 60);
  p.dirty = true;
  p.invDirty = true;
  world.dirtyWorld = true;
  emitNoise(world, b.x, b.y, 9, p.id);
  return true;
}

export function handlePlayerRespawn(world: SimWorldState, p: SimPlayer, rng: () => number = Math.random): boolean {
  if (!p.dead) return false;
  const fresh = createDefaultPlayerData(rng);
  p.x = fresh.x;
  p.y = fresh.y;
  p.hp = 100;
  p.stamina = 100;
  p.hunger = 80;
  p.thirst = 80;
  p.bleeding = 0;
  p.panic = 0;
  p.infected = 0;
  p.battery = 100;
  p.flashlightOn = false;
  p.dead = false;
  p.inventory = [];
  p.activeSlot = 0;
  p.dirty = true;
  p.invDirty = true;
  return true;
}

export function stepWorld(world: SimWorldState, dt: number, rng: () => number = Math.random) {
  world.tick += 1;

  // Advance day/night clock
  const prevDay = world.day;
  const nextMin = world.worldTimeMin + GAME_MINUTES_PER_REAL_SEC * dt;
  if (nextMin >= DAY_MINUTES) {
    world.day += Math.floor(nextMin / DAY_MINUTES);
    world.worldTimeMin = nextMin % DAY_MINUTES;
    world.dirtyWorld = true;
  } else {
    world.worldTimeMin = nextMin;
  }

  const night = isNightTime(world.worldTimeMin);
  const barRects = buildDynamicObstacleRects(world.barricades);

  // Step players
  for (const p of world.players.values()) {
    if (p.attackCd > 0) p.attackCd = Math.max(0, p.attackCd - dt);
    if (p.shoveCd > 0) p.shoveCd = Math.max(0, p.shoveCd - dt);
    if (p.swingTimer > 0) p.swingTimer = Math.max(0, p.swingTimer - dt);
    if (p.emoteTimer > 0) {
      p.emoteTimer = Math.max(0, p.emoteTimer - dt);
      if (p.emoteTimer === 0) p.emote = undefined;
    }

    if (world.day > prevDay && !p.dead && !p.away) {
      p.daysSurvived += 1;
      p.dirty = true;
    }

    if (p.dead || p.away) continue;

    // Movement
    const mag = Math.hypot(p.inputDx, p.inputDy);
    const moving = mag > 0.05;
    const canSprint = p.sprinting && !p.sneaking && moving && p.stamina > 3;
    if (!canSprint && p.sprinting && p.stamina <= 3) p.sprinting = false;

    if (moving) {
      const nx = p.inputDx / mag;
      const ny = p.inputDy / mag;
      const speed = p.sneaking ? PLAYER_SNEAK_SPEED : canSprint ? PLAYER_SPRINT_SPEED : PLAYER_WALK_SPEED;
      const resolved = resolveEntityCollisions(p.x + nx * speed * dt, p.y + ny * speed * dt, PLAYER_RADIUS, world.town, barRects);
      if (Math.hypot(resolved.x - p.x, resolved.y - p.y) > 0.001) {
        p.x = resolved.x;
        p.y = resolved.y;
        p.dirty = true;
      }

      p.footstepTimer -= dt;
      if (p.footstepTimer <= 0) {
        p.footstepTimer = canSprint ? 0.32 : p.sneaking ? 0.65 : 0.48;
        emitNoise(world, p.x, p.y, canSprint ? 10.5 : p.sneaking ? 2.2 : 5.2, p.id);
      }
    }

    // Stamina
    if (canSprint) {
      p.stamina = Math.max(0, p.stamina - 11 * dt);
      p.dirty = true;
    } else {
      const regen = p.sneaking || !moving ? 14 : 6.5;
      if (p.stamina < 100) {
        p.stamina = Math.min(100, p.stamina + regen * dt);
      }
    }

    // Hunger & Thirst slow survival drain
    const drainMult = canSprint ? 1.5 : 1.0;
    p.hunger = Math.max(0, p.hunger - 0.14 * drainMult * dt);
    p.thirst = Math.max(0, p.thirst - 0.2 * drainMult * dt);

    // Flashlight battery drain
    const hasFlashlight = countItemInInventory(p.inventory, 'flashlight') > 0;
    if (p.flashlightOn) {
      if (!hasFlashlight || p.battery <= 0) {
        p.flashlightOn = false;
      } else {
        p.battery = Math.max(0, p.battery - 0.32 * dt);
        if (p.battery <= 0) p.flashlightOn = false;
      }
    }

    // Bleeding / Starvation / Infection
    let hpDelta = 0;
    if (p.bleeding > 0) hpDelta -= p.bleeding * 0.6 * dt;
    if (p.hunger <= 0) hpDelta -= 0.35 * dt;
    if (p.thirst <= 0) hpDelta -= 0.45 * dt;
    if (p.infected > 0) {
      p.infected = Math.min(100, p.infected + 0.38 * dt);
      if (p.infected > 40) hpDelta -= 0.45 * dt;
    }
    if (hpDelta < 0) {
      p.hp = Math.max(0, p.hp + hpDelta);
      p.dirty = true;
    } else if (p.hunger > 65 && p.thirst > 65 && p.bleeding === 0 && p.infected === 0 && p.hp < 100) {
      // Natural slow recovery when well-fed & near campfire or safe
      let nearCampfire = false;
      for (const b of world.barricades.values()) {
        if (b.kind === 'campfire' && Math.hypot(b.x - p.x, b.y - p.y) < 5) {
          nearCampfire = true;
          break;
        }
      }
      if (nearCampfire) p.hp = Math.min(100, p.hp + 0.7 * dt);
    }

    // Check death
    if (p.hp <= 0 && !p.dead) {
      p.dead = true;
      p.flashlightOn = false;
      if (p.inventory.length > 0) {
        dropLootAt(world, p.x, p.y, p.inventory.splice(0));
      }
      p.dirty = true;
      p.invDirty = true;
      world.events.push({ k: 'toast', pid: p.id, msg: 'You died! Dropped your gear. Press Respawn.' });
    }
  }

  // Step zombies
  const zList = [...world.zombies.values()];
  for (const z of zList) {
    if (z.attackCd > 0) z.attackCd = Math.max(0, z.attackCd - dt);

    // Apply knockback decay
    if (Math.hypot(z.knockVx, z.knockVy) > 0.1) {
      const kPos = resolveEntityCollisions(
        z.x + z.knockVx * dt,
        z.y + z.knockVy * dt,
        ZOMBIE_RADIUS,
        world.town,
        barRects,
      );
      z.x = kPos.x;
      z.y = kPos.y;
      z.knockVx *= Math.pow(0.05, dt);
      z.knockVy *= Math.pow(0.05, dt);
    }

    if (z.state === 'k') {
      z.stateTimer -= dt;
      if (z.stateTimer <= 0) z.state = 'i';
      continue;
    }

    // Check spike traps
    for (const [bid, b] of world.barricades.entries()) {
      if (b.kind === 'trap' && Math.hypot(b.x - z.x, b.y - z.y) < 1.15) {
        z.hp -= 16 * dt;
        b.hp -= 4 * dt;
        world.dirtyWorld = true;
        if (b.hp <= 0) world.barricades.delete(bid);
        if (z.hp <= 0) {
          world.zombies.delete(z.id);
          break;
        }
      }
    }
    if (!world.zombies.has(z.id)) continue;

    // Spot closest visible player
    let seenPlayer: SimPlayer | null = null;
    let bestDist = Infinity;
    for (const p of world.players.values()) {
      if (p.dead || p.away) continue;
      const dist = Math.hypot(p.x - z.x, p.y - z.y);
      let sightRange = night ? 9.5 : 14.5;
      if (p.sneaking) sightRange *= 0.62;
      if (p.flashlightOn && night) sightRange += 5.5;
      if (dist <= sightRange && dist < bestDist && hasLineOfSight(world.town, z.x, z.y, p.x, p.y)) {
        bestDist = dist;
        seenPlayer = p;
      }
    }

    if (seenPlayer) {
      z.state = 'c';
      z.targetPlayerId = seenPlayer.id;
      z.targetX = seenPlayer.x;
      z.targetY = seenPlayer.y;
      z.stateTimer = 4.0;
    } else if (z.state === 'c') {
      z.stateTimer -= dt;
      if (z.stateTimer <= 0) {
        z.state = 'i';
        z.targetPlayerId = null;
      }
    }

    // Update panic for nearby players
    for (const p of world.players.values()) {
      if (p.dead || p.away) continue;
      const d = Math.hypot(p.x - z.x, p.y - z.y);
      if (d < 9 && z.state === 'c') {
        p.panic = Math.min(100, p.panic + 4 * dt);
      }
    }

    // Movement & Attack
    if (z.state === 'c' || z.state === 'v') {
      const dx = z.targetX - z.x;
      const dy = z.targetY - z.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 0.2) {
        z.angle = Math.atan2(dy, dx);
        const stepSpeed = z.state === 'c' ? z.speed : z.speed * 0.68;
        const nx = dx / dist;
        const ny = dy / dist;

        // Check if blocked by a player barricade
        let hitBarricade: SavedBarricade | null = null;
        for (const b of world.barricades.values()) {
          if (b.kind === 'barricade' && Math.hypot(b.x - z.x, b.y - z.y) < 1.55) {
            hitBarricade = b;
            break;
          }
        }

        if (hitBarricade) {
          if (z.attackCd <= 0) {
            z.attackCd = 1.1;
            hitBarricade.hp -= z.damage * 0.75;
            world.dirtyWorld = true;
            emitNoise(world, hitBarricade.x, hitBarricade.y, 12);
            world.events.push({ k: 'hit', x: round2(hitBarricade.x), y: round2(hitBarricade.y) });
            if (hitBarricade.hp <= 0) world.barricades.delete(hitBarricade.id);
          }
        } else if (seenPlayer && dist <= 1.2) {
          z.state = 'a';
          if (z.attackCd <= 0) {
            z.attackCd = 1.05;
            seenPlayer.hp = Math.max(0, seenPlayer.hp - z.damage);
            if (rng() < 0.22 && seenPlayer.bleeding < 3) seenPlayer.bleeding += 1;
            if (rng() < 0.08) seenPlayer.infected = Math.max(seenPlayer.infected, 5);
            seenPlayer.panic = Math.min(100, seenPlayer.panic + 12);
            seenPlayer.dirty = true;
            world.events.push({ k: 'hit', x: round2(seenPlayer.x), y: round2(seenPlayer.y) });
          }
        } else {
          const moved = resolveEntityCollisions(
            z.x + nx * stepSpeed * dt,
            z.y + ny * stepSpeed * dt,
            ZOMBIE_RADIUS,
            world.town,
            barRects,
          );
          z.x = moved.x;
          z.y = moved.y;
        }
      } else if (z.state === 'v') {
        z.stateTimer -= dt;
        if (z.stateTimer <= 0) z.state = 'i';
      }
    } else {
      // Idle / wander
      z.stateTimer -= dt;
      if (z.stateTimer <= 0) {
        z.stateTimer = 2.0 + rng() * 4.0;
        if (rng() < 0.55) {
          z.angle += (rng() - 0.5) * 2.2;
          z.targetX = z.x + Math.cos(z.angle) * (2 + rng() * 4);
          z.targetY = z.y + Math.sin(z.angle) * (2 + rng() * 4);
        } else {
          z.targetX = z.x;
          z.targetY = z.y;
        }
      } else {
        const dx = z.targetX - z.x;
        const dy = z.targetY - z.y;
        const dist = Math.hypot(dx, dy);
        if (dist > 0.3) {
          const moved = resolveEntityCollisions(
            z.x + (dx / dist) * z.speed * 0.35 * dt,
            z.y + (dy / dist) * z.speed * 0.35 * dt,
            ZOMBIE_RADIUS,
            world.town,
            barRects,
          );
          z.x = moved.x;
          z.y = moved.y;
        }
      }
    }
  }

  // Run after damage so a hit on the completion tick still cancels searching.
  for (const p of world.players.values()) updateLootSearch(world, p, dt);

  // Decay player panic slowly when safe
  for (const p of world.players.values()) {
    if (p.panic > 0) p.panic = Math.max(0, p.panic - 3.5 * dt);
  }

  // Horde director respawn
  world.spawnDirectorTimer -= dt;
  if (world.spawnDirectorTimer <= 0) {
    world.spawnDirectorTimer = 5;
    if (world.zombies.size < MAX_ZOMBIES && world.players.size > 0) {
      spawnTownZombies(world, MAX_ZOMBIES, rng, 18);
    }
  }
}

export function buildSnapshotForPlayer(world: SimWorldState, viewerId: number): SnapPayload {
  const viewer = world.players.get(viewerId);
  const vx = viewer?.x ?? SAFE_SPAWN_X;
  const vy = viewer?.y ?? SAFE_SPAWN_Y;
  const night = isNightTime(world.worldTimeMin);
  const visionMax = viewer?.flashlightOn ? Math.max(VISION_RANGE_DAY, FLASHLIGHT_RANGE) : night ? VISION_RANGE_NIGHT + 6 : VISION_RANGE_DAY + 4;

  const pList: NetPlayer[] = [];
  for (const p of world.players.values()) {
    if (p.id !== viewerId && Math.hypot(p.x - vx, p.y - vy) > INTEREST_RADIUS) continue;
    const eq = getEquippedItem(p)?.id ?? '';
    pList.push({
      id: p.id,
      n: p.name,
      x: round2(p.x),
      y: round2(p.y),
      a: round2(p.angle),
      hp: Math.round(p.hp),
      st: Math.round(p.stamina),
      hu: Math.round(p.hunger),
      th: Math.round(p.thirst),
      bl: p.bleeding,
      pa: Math.round(p.panic),
      inf: Math.round(p.infected),
      fl: p.flashlightOn,
      bt: Math.round(p.battery),
      sn: p.sneaking,
      sp: p.sprinting,
      sl: p.activeSlot,
      eq,
      kl: p.kills,
      ds: p.daysSurvived,
      aw: p.away,
      dd: p.dead,
      ...(p.loot && p.loot.remaining > 0 ? {searching: true} : {}),
      ...(p.swingTimer > 0 ? { sw: round2(p.swingTimer) } : {}),
      ...(p.emote ? { em: p.emote } : {}),
    });
  }

  const zList: NetZombie[] = [];
  for (const z of world.zombies.values()) {
    const dist = Math.hypot(z.x - vx, z.y - vy);
    if (dist > visionMax + 6) continue;
    zList.push({
      id: z.id,
      k: z.kind,
      x: round2(z.x),
      y: round2(z.y),
      a: round2(z.angle),
      hp: Math.round(z.hp),
      mhp: z.maxHp,
      st: z.state,
    });
  }

  const bList: NetBarricade[] = [];
  for (const b of world.barricades.values()) {
    if (Math.hypot(b.x - vx, b.y - vy) > INTEREST_RADIUS) continue;
    bList.push({
      id: b.id,
      k: b.kind,
      x: b.x,
      y: b.y,
      a: b.angle,
      hp: Math.round(b.hp),
      mhp: b.maxHp,
    });
  }

  const cList: NetContainerState[] = [];
  for (const [id, c] of world.containers.entries()) {
    cList.push({ id, lt: c.looted, cnt: c.items.length });
  }

  const dList: NetDroppedLoot[] = [];
  for (const d of world.droppedLoot.values()) {
    if (Math.hypot(d.x - vx, d.y - vy) > INTEREST_RADIUS) continue;
    const top = d.items[0]?.id;
    dList.push({ id: d.id, x: d.x, y: d.y, cnt: d.items.length, ...(top ? { top } : {}) });
  }

  const ev = world.events.filter((e) => {
    if (e.k === 'toast') return e.pid === viewerId;
    if (e.k === 'swing' || e.k === 'shove' || e.k === 'use') {
      const actor = world.players.get(e.pid);
      return Boolean(actor && Math.hypot(actor.x - vx, actor.y - vy) <= INTEREST_RADIUS);
    }
    return Math.hypot(e.x - vx, e.y - vy) <= INTEREST_RADIUS;
  });

  const payload: SnapPayload = {
    tk: world.tick,
    wt: round2(world.worldTimeMin),
    dy: world.day,
    p: pList,
    z: zList,
    b: bList,
    c: cList,
    d: dList,
    ev,
    loot: lootView(world, viewer),
  };

  if (viewer && viewer.invDirty) {
    payload.inv = viewer.inventory.map((i) => ({ ...i }));
    viewer.invDirty = false;
  }

  return payload;
}

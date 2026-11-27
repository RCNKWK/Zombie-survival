import { WORLD_SIZE } from './constants.js';
import type { InvItem } from './items.js';

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type BuildingTheme = 'safehouse' | 'medical' | 'market' | 'hardware' | 'police' | 'diner' | 'gas' | 'house' | 'warehouse';

export interface BuildingDef {
  id: string;
  name: string;
  theme: BuildingTheme;
  x: number;
  y: number;
  w: number;
  h: number;
  walls: Rect[];
  doors: Rect[];
  windows: Rect[];
  floorColor: number;
  roofColor: number;
}

export type ContainerKind = 'crate' | 'fridge' | 'med_cabinet' | 'gun_locker' | 'shelf' | 'car_trunk';

export interface ContainerDef {
  id: string;
  kind: ContainerKind;
  theme: BuildingTheme | 'road';
  x: number;
  y: number;
  angle: number;
}

export interface CarDef {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  angle: number;
  color: number;
}

export interface TreeDef {
  id: string;
  x: number;
  y: number;
  radius: number;
  height: number;
}

export interface StreetLightDef {
  id: string;
  x: number;
  y: number;
}

export interface TownLayout {
  seed: number;
  roads: Rect[];
  buildings: BuildingDef[];
  containers: ContainerDef[];
  cars: CarDef[];
  trees: TreeDef[];
  streetlights: StreetLightDef[];
  obstacles: Rect[];
}

interface BuildingBlueprint {
  id: string;
  name: string;
  theme: BuildingTheme;
  x: number;
  y: number;
  w: number;
  h: number;
  doorSide: 'n' | 's' | 'e' | 'w';
  floorColor: number;
  roofColor: number;
  containers: Array<{ kind: ContainerKind; dx: number; dy: number; angle: number }>;
}

const BLUEPRINTS: BuildingBlueprint[] = [
  // Central District (around x=120, y=120)
  {
    id: 'b_safehouse',
    name: 'Safe House',
    theme: 'safehouse',
    x: 104,
    y: 128,
    w: 12,
    h: 11,
    doorSide: 'n',
    floorColor: 0x6b533b,
    roofColor: 0x4b3b2c,
    containers: [
      { kind: 'crate', dx: 2, dy: 2, angle: 0 },
      { kind: 'fridge', dx: 10, dy: 2, angle: 0 },
      { kind: 'shelf', dx: 10, dy: 9, angle: Math.PI },
    ],
  },
  {
    id: 'b_medical',
    name: 'Cortman Clinic',
    theme: 'medical',
    x: 128,
    y: 128,
    w: 18,
    h: 13,
    doorSide: 'w',
    floorColor: 0xbfc7c9,
    roofColor: 0x3b4d54,
    containers: [
      { kind: 'med_cabinet', dx: 15, dy: 2.5, angle: 0 },
      { kind: 'med_cabinet', dx: 15, dy: 10.5, angle: 0 },
      { kind: 'shelf', dx: 4, dy: 2.5, angle: 0 },
    ],
  },
  {
    id: 'b_market',
    name: 'GigaMart',
    theme: 'market',
    x: 88,
    y: 86,
    w: 24,
    h: 18,
    doorSide: 's',
    floorColor: 0x8f8a7f,
    roofColor: 0x394b59,
    containers: [
      { kind: 'fridge', dx: 3, dy: 3, angle: 0 },
      { kind: 'fridge', dx: 8, dy: 3, angle: 0 },
      { kind: 'shelf', dx: 15, dy: 5, angle: 0 },
      { kind: 'shelf', dx: 20, dy: 12, angle: Math.PI },
    ],
  },
  {
    id: 'b_hardware',
    name: 'Knox Hardware',
    theme: 'hardware',
    x: 128,
    y: 86,
    w: 22,
    h: 18,
    doorSide: 's',
    floorColor: 0x736c62,
    roofColor: 0x5c3c2e,
    containers: [
      { kind: 'crate', dx: 3, dy: 3, angle: 0 },
      { kind: 'crate', dx: 18, dy: 3, angle: 0 },
      { kind: 'shelf', dx: 11, dy: 4, angle: 0 },
      { kind: 'crate', dx: 17, dy: 13, angle: 0 },
    ],
  },
  {
    id: 'b_police',
    name: 'Police Outpost',
    theme: 'police',
    x: 86,
    y: 128,
    w: 14,
    h: 15,
    doorSide: 'e',
    floorColor: 0x6b7178,
    roofColor: 0x2d3440,
    containers: [
      { kind: 'gun_locker', dx: 2.5, dy: 3, angle: 0 },
      { kind: 'gun_locker', dx: 2.5, dy: 12, angle: 0 },
      { kind: 'crate', dx: 10.5, dy: 3, angle: 0 },
    ],
  },
  {
    id: 'b_diner',
    name: "Spiffo's Diner",
    theme: 'diner',
    x: 88,
    y: 107,
    w: 18,
    h: 9,
    doorSide: 's',
    floorColor: 0x9c8b78,
    roofColor: 0x6e2c26,
    containers: [
      { kind: 'fridge', dx: 3, dy: 2.2, angle: 0 },
      { kind: 'shelf', dx: 14, dy: 2.2, angle: 0 },
    ],
  },
  {
    id: 'b_gas',
    name: 'Fossoil Station',
    theme: 'gas',
    x: 128,
    y: 107,
    w: 18,
    h: 9,
    doorSide: 's',
    floorColor: 0x7a7772,
    roofColor: 0x2f5243,
    containers: [
      { kind: 'shelf', dx: 3, dy: 2.5, angle: 0 },
      { kind: 'crate', dx: 14.5, dy: 2.5, angle: 0 },
    ],
  },

  // Outer Suburbs & Industrial Zones
  {
    id: 'b_warehouse_nw',
    name: 'West Warehouse',
    theme: 'warehouse',
    x: 34,
    y: 44,
    w: 24,
    h: 16,
    doorSide: 'e',
    floorColor: 0x65686b,
    roofColor: 0x3b444b,
    containers: [
      { kind: 'crate', dx: 3, dy: 3, angle: 0 },
      { kind: 'crate', dx: 3, dy: 12, angle: 0 },
      { kind: 'shelf', dx: 12, dy: 4, angle: 0 },
      { kind: 'crate', dx: 18, dy: 12, angle: 0 },
    ],
  },
  {
    id: 'b_house_ne',
    name: 'Oakwood Residence',
    theme: 'house',
    x: 174,
    y: 44,
    w: 16,
    h: 13,
    doorSide: 's',
    floorColor: 0x7b634a,
    roofColor: 0x523f35,
    containers: [
      { kind: 'fridge', dx: 3, dy: 2.5, angle: 0 },
      { kind: 'shelf', dx: 13, dy: 2.5, angle: 0 },
      { kind: 'crate', dx: 13, dy: 10, angle: 0 },
    ],
  },
  {
    id: 'b_house_sw',
    name: 'Suburban Home',
    theme: 'house',
    x: 38,
    y: 174,
    w: 16,
    h: 13,
    doorSide: 'n',
    floorColor: 0x7e6b54,
    roofColor: 0x3f4c3d,
    containers: [
      { kind: 'fridge', dx: 13, dy: 10, angle: Math.PI },
      { kind: 'med_cabinet', dx: 3, dy: 10, angle: 0 },
      { kind: 'shelf', dx: 3, dy: 3, angle: 0 },
    ],
  },
  {
    id: 'b_fire_se',
    name: 'Rosewood Fire Dept',
    theme: 'hardware',
    x: 174,
    y: 174,
    w: 22,
    h: 16,
    doorSide: 'w',
    floorColor: 0x767470,
    roofColor: 0x752c26,
    containers: [
      { kind: 'crate', dx: 18, dy: 3, angle: 0 },
      { kind: 'gun_locker', dx: 18, dy: 12, angle: 0 },
      { kind: 'med_cabinet', dx: 5, dy: 3, angle: 0 },
    ],
  },
  {
    id: 'b_motel_s',
    name: 'Knox Motel',
    theme: 'house',
    x: 92,
    y: 176,
    w: 22,
    h: 12,
    doorSide: 'n',
    floorColor: 0x877260,
    roofColor: 0x4f3e4b,
    containers: [
      { kind: 'shelf', dx: 4, dy: 9, angle: 0 },
      { kind: 'fridge', dx: 11, dy: 9, angle: 0 },
      { kind: 'med_cabinet', dx: 18, dy: 9, angle: 0 },
    ],
  },
  {
    id: 'b_pharmacy_n',
    name: 'North Pharmacy',
    theme: 'medical',
    x: 128,
    y: 42,
    w: 16,
    h: 12,
    doorSide: 's',
    floorColor: 0xc2cac9,
    roofColor: 0x2e4c52,
    containers: [
      { kind: 'med_cabinet', dx: 3, dy: 3, angle: 0 },
      { kind: 'med_cabinet', dx: 13, dy: 3, angle: 0 },
      { kind: 'shelf', dx: 8, dy: 9, angle: 0 },
    ],
  },
];

function buildWallsWithDoor(x: number, y: number, w: number, h: number, doorSide: 'n' | 's' | 'e' | 'w'): {
  walls: Rect[];
  doors: Rect[];
  windows: Rect[];
} {
  const t = 0.6;
  const doorW = 2.8;
  const walls: Rect[] = [];
  const doors: Rect[] = [];
  const windows: Rect[] = [];

  if (doorSide === 'n') {
    const seg = (w - doorW) / 2;
    walls.push({ x, y, w: seg, h: t }, { x: x + seg + doorW, y, w: seg, h: t });
    doors.push({ x: x + seg, y, w: doorW, h: t });
  } else {
    walls.push({ x, y, w, h: t });
    windows.push({ x: x + w * 0.35, y, w: 2.2, h: t });
  }

  if (doorSide === 's') {
    const seg = (w - doorW) / 2;
    walls.push({ x, y: y + h - t, w: seg, h: t }, { x: x + seg + doorW, y: y + h - t, w: seg, h: t });
    doors.push({ x: x + seg, y: y + h - t, w: doorW, h: t });
  } else {
    walls.push({ x, y: y + h - t, w, h: t });
    windows.push({ x: x + w * 0.35, y: y + h - t, w: 2.2, h: t });
  }

  if (doorSide === 'w') {
    const seg = (h - doorW) / 2;
    walls.push({ x, y: y + t, w: t, h: seg - t }, { x, y: y + seg + doorW, w: t, h: h - seg - doorW - t });
    doors.push({ x, y: y + seg, w: t, h: doorW });
  } else {
    walls.push({ x, y: y + t, w: t, h: h - t * 2 });
    windows.push({ x, y: y + h * 0.4, w: t, h: 2.2 });
  }

  if (doorSide === 'e') {
    const seg = (h - doorW) / 2;
    walls.push(
      { x: x + w - t, y: y + t, w: t, h: seg - t },
      { x: x + w - t, y: y + seg + doorW, w: t, h: h - seg - doorW - t },
    );
    doors.push({ x: x + w - t, y: y + seg, w: t, h: doorW });
  } else {
    walls.push({ x: x + w - t, y: y + t, w: t, h: h - t * 2 });
    windows.push({ x: x + w - t, y: y + h * 0.4, w: t, h: 2.2 });
  }

  return { walls, doors, windows };
}

function generateDistrict(seed: number): TownLayout {
  const rng = mulberry32(seed);
  const roads: Rect[] = [
    // Main central avenues
    { x: 116, y: 12, w: 8, h: 216 },
    { x: 12, y: 116, w: 216, h: 8 },
    // Mid ring roads
    { x: 68, y: 26, w: 7, h: 188 },
    { x: 160, y: 26, w: 7, h: 188 },
    { x: 26, y: 68, w: 188, h: 7 },
    { x: 26, y: 160, w: 188, h: 7 },
    // Outer perimeter highway
    { x: 20, y: 20, w: 6, h: 200 },
    { x: 214, y: 20, w: 6, h: 200 },
    { x: 20, y: 20, w: 200, h: 6 },
    { x: 20, y: 214, w: 200, h: 6 },
  ];

  const buildings: BuildingDef[] = [];
  const containers: ContainerDef[] = [];
  const obstacles: Rect[] = [];

  for (const bp of BLUEPRINTS) {
    const { walls, doors, windows } = buildWallsWithDoor(bp.x, bp.y, bp.w, bp.h, bp.doorSide);
    buildings.push({
      id: bp.id,
      name: bp.name,
      theme: bp.theme,
      x: bp.x,
      y: bp.y,
      w: bp.w,
      h: bp.h,
      walls,
      doors,
      windows,
      floorColor: bp.floorColor,
      roofColor: bp.roofColor,
    });
    obstacles.push(...walls);
    bp.containers.forEach((c, idx) => {
      const cx = bp.x + c.dx;
      const cy = bp.y + c.dy;
      containers.push({
        id: `${bp.id}_c${idx}`,
        kind: c.kind,
        theme: bp.theme,
        x: cx,
        y: cy,
        angle: c.angle,
      });
      obstacles.push({ x: cx - 0.55, y: cy - 0.55, w: 1.1, h: 1.1 });
    });
  }

  const carSpots = [
    { x: 118.2, y: 95, w: 2.4, h: 4.4, angle: 0 },
    { x: 121.5, y: 142, w: 2.4, h: 4.4, angle: Math.PI },
    { x: 94, y: 118.2, w: 4.4, h: 2.4, angle: Math.PI / 2 },
    { x: 142, y: 121.5, w: 4.4, h: 2.4, angle: -Math.PI / 2 },
    { x: 71.5, y: 55, w: 2.4, h: 4.4, angle: 0 },
    { x: 163.5, y: 88, w: 2.4, h: 4.4, angle: Math.PI },
    { x: 71.5, y: 184, w: 2.4, h: 4.4, angle: 0 },
    { x: 163.5, y: 148, w: 2.4, h: 4.4, angle: Math.PI },
    { x: 48, y: 71.5, w: 4.4, h: 2.4, angle: Math.PI / 2 },
    { x: 186, y: 163.5, w: 4.4, h: 2.4, angle: -Math.PI / 2 },
    { x: 23, y: 102, w: 2.4, h: 4.4, angle: 0 },
    { x: 217, y: 138, w: 2.4, h: 4.4, angle: Math.PI },
  ];
  const carColors = [0x8b3a3a, 0x3b5875, 0x5c6652, 0x998448, 0x4e5259, 0x734966];
  const cars: CarDef[] = carSpots.map((spot, idx) => {
    const color = carColors[(idx + Math.floor(rng() * carColors.length)) % carColors.length]!;
    obstacles.push({ x: spot.x - spot.w / 2, y: spot.y - spot.h / 2, w: spot.w, h: spot.h });
    containers.push({
      id: `car_trunk_${idx}`,
      kind: 'car_trunk',
      theme: 'road',
      x: spot.x,
      y: spot.y,
      angle: spot.angle,
    });
    return { id: `car_${idx}`, ...spot, color };
  });

  // Forest perimeter + suburban park trees
  const trees: TreeDef[] = [];
  let treeAttempts = 0;
  while (trees.length < 130 && treeAttempts < 900) {
    treeAttempts++;
    let tx = 0;
    let ty = 0;
    if (trees.length < 95) {
      const side = Math.floor(rng() * 4);
      if (side === 0) {
        tx = 4 + rng() * 13;
        ty = 5 + rng() * 230;
      } else if (side === 1) {
        tx = 223 + rng() * 13;
        ty = 5 + rng() * 230;
      } else if (side === 2) {
        tx = 16 + rng() * 208;
        ty = 4 + rng() * 13;
      } else {
        tx = 16 + rng() * 208;
        ty = 223 + rng() * 13;
      }
    } else {
      // Sparse suburban trees clear of roads and buildings
      tx = 30 + rng() * 180;
      ty = 30 + rng() * 180;
      const onRoad = roads.some((r) => tx >= r.x - 1.5 && tx <= r.x + r.w + 1.5 && ty >= r.y - 1.5 && ty <= r.y + r.h + 1.5);
      const inBuilding = buildings.some((b) => tx >= b.x - 2 && tx <= b.x + b.w + 2 && ty >= b.y - 2 && ty <= b.y + b.h + 2);
      if (onRoad || inBuilding) continue;
    }

    if (trees.some((t) => Math.hypot(t.x - tx, t.y - ty) < 3.6)) continue;
    const radius = 0.55 + rng() * 0.22;
    trees.push({
      id: `tree_${trees.length}`,
      x: Number(tx.toFixed(2)),
      y: Number(ty.toFixed(2)),
      radius,
      height: 3.4 + rng() * 2.0,
    });
    obstacles.push({ x: tx - radius, y: ty - radius, w: radius * 2, h: radius * 2 });
  }

  const streetlights: StreetLightDef[] = [
    { id: 'sl_1', x: 115.2, y: 115.2 },
    { id: 'sl_2', x: 124.8, y: 124.8 },
    { id: 'sl_3', x: 115.2, y: 132 },
    { id: 'sl_4', x: 124.8, y: 98 },
    { id: 'sl_5', x: 98, y: 115.2 },
    { id: 'sl_6', x: 142, y: 124.8 },
    { id: 'sl_7', x: 67.5, y: 67.5 },
    { id: 'sl_8', x: 167.5, y: 67.5 },
    { id: 'sl_9', x: 67.5, y: 167.5 },
    { id: 'sl_10', x: 167.5, y: 167.5 },
    { id: 'sl_11', x: 115.2, y: 67.5 },
    { id: 'sl_12', x: 124.8, y: 167.5 },
    { id: 'sl_13', x: 67.5, y: 115.2 },
    { id: 'sl_14', x: 167.5, y: 124.8 },
  ];

  return { seed, roads, buildings, containers, cars, trees, streetlights, obstacles };
}

/** Keep the original district and IDs intact so existing saves remain valid. */
export function generateTown(seed: number): TownLayout {
  const town = generateDistrict(seed);
  const districts = [
    { x: 240, y: 0, id: 'east', name: 'Eastbank', roof: 0x4a6265 },
    { x: 0, y: 240, id: 'south', name: 'Pinewood', roof: 0x66533e },
    { x: 240, y: 240, id: 'harbor', name: 'Iron Harbor', roof: 0x574e62 },
  ];
  for (const [index, district] of districts.entries()) {
    const source = generateDistrict(seed + (index + 1) * 7919);
    const rect = (r: Rect): Rect => ({ ...r, x: r.x + district.x, y: r.y + district.y });
    const point = <T extends { id: string; x: number; y: number }>(p: T): T =>
      ({ ...p, id: `${district.id}_${p.id}`, x: p.x + district.x, y: p.y + district.y });
    town.roads.push(...source.roads.map(rect));
    town.buildings.push(...source.buildings.map(b => ({
      ...point(b), name: `${district.name} ${b.name}`, roofColor: district.roof,
      walls: b.walls.map(rect), doors: b.doors.map(rect), windows: b.windows.map(rect),
    })));
    town.containers.push(...source.containers.map(point));
    town.cars.push(...source.cars.map(point));
    town.trees.push(...source.trees.map(point));
    town.streetlights.push(...source.streetlights.map(point));
    town.obstacles.push(...source.obstacles.map(rect));
  }
  // Join the avenues across district borders; clear trees from these corridors.
  const links: Rect[] = [
    { x: 228, y: 116, w: 24, h: 8 }, { x: 228, y: 356, w: 24, h: 8 },
    { x: 116, y: 228, w: 8, h: 24 }, { x: 356, y: 228, w: 8, h: 24 },
  ];
  town.roads.push(...links);
  const blockedTrees = town.trees.filter(t => links.some(r =>
    t.x > r.x - 2 && t.x < r.x + r.w + 2 && t.y > r.y - 2 && t.y < r.y + r.h + 2));
  town.trees = town.trees.filter(t => !blockedTrees.includes(t));
  town.obstacles = town.obstacles.filter(r => !blockedTrees.some(t =>
    Math.abs(r.x - (t.x - t.radius)) < 0.02 && Math.abs(r.y - (t.y - t.radius)) < 0.02));
  return town;
}

export function generateContainerLoot(seed: number, container: ContainerDef, cycle: number): InvItem[] {
  let hash = seed ^ (cycle * 7919);
  for (let i = 0; i < container.id.length; i++) {
    hash = Math.imul(hash ^ container.id.charCodeAt(i), 16777619);
  }
  const rng = mulberry32(hash >>> 0);
  const items: InvItem[] = [];

  const roll = (id: InvItem['id'], minQ: number, maxQ: number, dur?: number) => {
    const qty = minQ + Math.floor(rng() * (maxQ - minQ + 1));
    items.push(dur !== undefined ? { id, qty, dur } : { id, qty });
  };

  if (container.kind === 'med_cabinet') {
    roll('bandage', 1, 3);
    if (rng() < 0.7) roll('medkit', 1, 1);
    if (rng() < 0.55) roll('antibiotics', 1, 2);
  } else if (container.kind === 'gun_locker') {
    if (rng() < 0.65) {
      roll('pistol', 1, 1, 90);
      roll('ammo_9mm', 6, 15);
    } else {
      roll('shotgun', 1, 1, 70);
      roll('ammo_12g', 4, 8);
    }
    if (rng() < 0.45) roll('flashlight', 1, 1);
  } else if (container.kind === 'fridge') {
    roll('canned_food', 1, 2);
    roll('water_bottle', 1, 2);
    if (rng() < 0.5) roll('soda', 1, 2);
  } else if (container.kind === 'crate') {
    if (container.theme === 'hardware' || container.theme === 'warehouse') {
      const w = rng();
      if (w < 0.35) roll('axe', 1, 1, 55);
      else if (w < 0.7) roll('crowbar', 1, 1, 75);
      else roll('baseball_bat', 1, 1, 45);
      roll('wood_plank', 2, 4);
      roll('nails', 3, 6);
      if (rng() < 0.7) roll('scrap_metal', 1, 3);
    } else {
      if (rng() < 0.5) roll('baseball_bat', 1, 1, 45);
      else roll('knife', 1, 1, 40);
      roll('wood_plank', 1, 3);
      roll('nails', 2, 4);
      if (rng() < 0.55) roll('flashlight', 1, 1);
    }
  } else if (container.kind === 'car_trunk') {
    if (rng() < 0.5) roll('scrap_metal', 1, 3);
    if (rng() < 0.5) roll('battery', 1, 1);
    if (rng() < 0.4) roll('crowbar', 1, 1, 75);
    if (rng() < 0.5) roll('water_bottle', 1, 1);
    if (rng() < 0.35) roll('ammo_9mm', 3, 8);
  } else {
    if (rng() < 0.65) roll('chips', 1, 2);
    if (rng() < 0.5) roll('soda', 1, 2);
    if (rng() < 0.45) roll('rag', 1, 3);
    if (rng() < 0.35) roll('battery', 1, 1);
    if (container.theme === 'safehouse' && rng() < 0.8) roll('canned_food', 1, 1);
  }

  return items;
}

export function circleIntersectsRect(cx: number, cy: number, r: number, rect: Rect): boolean {
  const closestX = Math.max(rect.x, Math.min(cx, rect.x + rect.w));
  const closestY = Math.max(rect.y, Math.min(cy, rect.y + rect.h));
  const dx = cx - closestX;
  const dy = cy - closestY;
  return dx * dx + dy * dy < r * r;
}

export function resolveCircleRect(cx: number, cy: number, r: number, rect: Rect): { x: number; y: number } {
  const closestX = Math.max(rect.x, Math.min(cx, rect.x + rect.w));
  const closestY = Math.max(rect.y, Math.min(cy, rect.y + rect.h));
  const dx = cx - closestX;
  const dy = cy - closestY;
  const distSq = dx * dx + dy * dy;
  if (distSq >= r * r) return { x: cx, y: cy };

  if (distSq > 1e-8) {
    const dist = Math.sqrt(distSq);
    const push = r - dist;
    return { x: cx + (dx / dist) * push, y: cy + (dy / dist) * push };
  }

  const left = cx - rect.x;
  const right = rect.x + rect.w - cx;
  const top = cy - rect.y;
  const bottom = rect.y + rect.h - cy;
  const minPen = Math.min(left, right, top, bottom);
  if (minPen === left) return { x: rect.x - r, y: cy };
  if (minPen === right) return { x: rect.x + rect.w + r, y: cy };
  if (minPen === top) return { x: cx, y: rect.y - r };
  return { x: cx, y: rect.y + rect.h + r };
}

export function segmentIntersectsRect(x1: number, y1: number, x2: number, y2: number, rect: Rect): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const p = [-dx, dx, -dy, dy];
  const q = [x1 - rect.x, rect.x + rect.w - x1, y1 - rect.y, rect.y + rect.h - y1];
  for (let i = 0; i < 4; i++) {
    const pi = p[i]!;
    const qi = q[i]!;
    if (Math.abs(pi) < 1e-9) {
      if (qi < 0) return false;
    } else {
      const t = qi / pi;
      if (pi < 0) {
        if (t > t1) return false;
        if (t > t0) t0 = t;
      } else {
        if (t < t0) return false;
        if (t < t1) t1 = t;
      }
    }
  }
  return t0 <= t1;
}

export function hasLineOfSight(town: TownLayout, x1: number, y1: number, x2: number, y2: number): boolean {
  for (const b of town.buildings) {
    for (const w of b.walls) {
      if (segmentIntersectsRect(x1, y1, x2, y2, w)) return false;
    }
  }
  return true;
}

export function findBuildingAt(town: TownLayout, x: number, y: number): BuildingDef | null {
  for (const b of town.buildings) {
    if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b;
  }
  return null;
}

export function clampWorldPos(x: number, y: number, r: number): { x: number; y: number } {
  return {
    x: Math.max(r + 0.5, Math.min(WORLD_SIZE - r - 0.5, x)),
    y: Math.max(r + 0.5, Math.min(WORLD_SIZE - r - 0.5, y)),
  };
}

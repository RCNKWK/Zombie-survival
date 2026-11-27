import { MAX_INVENTORY_SLOTS } from './constants.js';

export type ItemCategory = 'melee' | 'gun' | 'ammo' | 'food' | 'drink' | 'medical' | 'material' | 'gear';

export interface ItemDef {
  id: ItemId;
  name: string;
  category: ItemCategory;
  maxStack: number;
  maxDur?: number;
  damage?: number;
  range?: number;
  arcRad?: number;
  cooldownSec?: number;
  knockback?: number;
  noise?: number;
  ammoId?: ItemId;
  hunger?: number;
  thirst?: number;
  heal?: number;
  stopBleed?: boolean;
  cureInfection?: boolean;
  batteryCharge?: number;
}

export type ItemId =
  | 'baseball_bat'
  | 'crowbar'
  | 'axe'
  | 'knife'
  | 'pistol'
  | 'shotgun'
  | 'ammo_9mm'
  | 'ammo_12g'
  | 'canned_food'
  | 'chips'
  | 'water_bottle'
  | 'soda'
  | 'bandage'
  | 'medkit'
  | 'antibiotics'
  | 'wood_plank'
  | 'nails'
  | 'scrap_metal'
  | 'rag'
  | 'battery'
  | 'flashlight';

export interface InvItem {
  id: ItemId;
  qty: number;
  dur?: number;
}

export const ITEMS: Record<ItemId, ItemDef> = {
  baseball_bat: {
    id: 'baseball_bat',
    name: 'Baseball Bat',
    category: 'melee',
    maxStack: 1,
    maxDur: 45,
    damage: 28,
    range: 2.1,
    arcRad: 1.35,
    cooldownSec: 0.45,
    knockback: 3.4,
    noise: 9,
  },
  crowbar: {
    id: 'crowbar',
    name: 'Crowbar',
    category: 'melee',
    maxStack: 1,
    maxDur: 75,
    damage: 24,
    range: 2.0,
    arcRad: 1.15,
    cooldownSec: 0.42,
    knockback: 2.8,
    noise: 8,
  },
  axe: {
    id: 'axe',
    name: 'Fire Axe',
    category: 'melee',
    maxStack: 1,
    maxDur: 55,
    damage: 42,
    range: 2.25,
    arcRad: 1.4,
    cooldownSec: 0.6,
    knockback: 3.8,
    noise: 11,
  },
  knife: {
    id: 'knife',
    name: 'Hunting Knife',
    category: 'melee',
    maxStack: 1,
    maxDur: 40,
    damage: 20,
    range: 1.65,
    arcRad: 0.95,
    cooldownSec: 0.28,
    knockback: 1.3,
    noise: 4,
  },
  pistol: {
    id: 'pistol',
    name: 'M9 Pistol',
    category: 'gun',
    maxStack: 1,
    maxDur: 90,
    damage: 45,
    range: 22,
    cooldownSec: 0.32,
    knockback: 2.2,
    noise: 26,
    ammoId: 'ammo_9mm',
  },
  shotgun: {
    id: 'shotgun',
    name: 'JS-2000 Shotgun',
    category: 'gun',
    maxStack: 1,
    maxDur: 70,
    damage: 85,
    range: 13,
    arcRad: 0.48,
    cooldownSec: 0.85,
    knockback: 5.5,
    noise: 34,
    ammoId: 'ammo_12g',
  },
  ammo_9mm: { id: 'ammo_9mm', name: '9mm Rounds', category: 'ammo', maxStack: 30 },
  ammo_12g: { id: 'ammo_12g', name: '12g Shells', category: 'ammo', maxStack: 16 },
  canned_food: { id: 'canned_food', name: 'Canned Beans', category: 'food', maxStack: 4, hunger: 42, thirst: 8 },
  chips: { id: 'chips', name: 'Crisps', category: 'food', maxStack: 6, hunger: 22, thirst: -4 },
  water_bottle: { id: 'water_bottle', name: 'Water Bottle', category: 'drink', maxStack: 4, thirst: 48 },
  soda: { id: 'soda', name: 'Pop Soda', category: 'drink', maxStack: 6, hunger: 6, thirst: 30 },
  bandage: { id: 'bandage', name: 'Bandage', category: 'medical', maxStack: 6, heal: 16, stopBleed: true },
  medkit: { id: 'medkit', name: 'First Aid Kit', category: 'medical', maxStack: 2, heal: 55, stopBleed: true },
  antibiotics: { id: 'antibiotics', name: 'Antibiotics', category: 'medical', maxStack: 4, heal: 15, cureInfection: true },
  wood_plank: { id: 'wood_plank', name: 'Wood Plank', category: 'material', maxStack: 10 },
  nails: { id: 'nails', name: 'Box of Nails', category: 'material', maxStack: 20 },
  scrap_metal: { id: 'scrap_metal', name: 'Scrap Metal', category: 'material', maxStack: 10 },
  rag: { id: 'rag', name: 'Ripped Sheet', category: 'material', maxStack: 10 },
  battery: { id: 'battery', name: 'Battery', category: 'gear', maxStack: 6, batteryCharge: 65 },
  flashlight: { id: 'flashlight', name: 'Flashlight', category: 'gear', maxStack: 1 },
};

export const ALL_ITEM_IDS = Object.keys(ITEMS) as ItemId[];

export function isItemId(v: unknown): v is ItemId {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(ITEMS, v);
}

export type BuildKind = 'barricade' | 'campfire' | 'trap';

export interface CraftRecipe {
  id: string;
  label: string;
  inputs: Array<{ id: ItemId; qty: number }>;
  output?: { id: ItemId; qty: number };
  buildKind?: BuildKind;
}

export const RECIPES: CraftRecipe[] = [
  {
    id: 'craft_bandage',
    label: 'Craft Bandage',
    inputs: [{ id: 'rag', qty: 2 }],
    output: { id: 'bandage', qty: 1 },
  },
  {
    id: 'build_barricade',
    label: 'Build Barricade',
    inputs: [
      { id: 'wood_plank', qty: 2 },
      { id: 'nails', qty: 2 },
    ],
    buildKind: 'barricade',
  },
  {
    id: 'build_campfire',
    label: 'Build Campfire',
    inputs: [{ id: 'wood_plank', qty: 2 }],
    buildKind: 'campfire',
  },
  {
    id: 'build_trap',
    label: 'Build Spike Trap',
    inputs: [
      { id: 'wood_plank', qty: 1 },
      { id: 'scrap_metal', qty: 2 },
    ],
    buildKind: 'trap',
  },
];

export function makeItem(id: ItemId, qty = 1): InvItem {
  const def = ITEMS[id];
  const item: InvItem = { id, qty: Math.max(1, Math.min(def.maxStack, Math.floor(qty))) };
  if (def.maxDur !== undefined) item.dur = def.maxDur;
  return item;
}

export function addItemToInventory(inv: InvItem[], id: ItemId, qty: number, dur?: number): number {
  const def = ITEMS[id];
  let remaining = Math.max(0, Math.floor(qty));
  if (remaining === 0) return 0;

  // Stack into existing slots if stackable
  if (def.maxStack > 1) {
    for (const slot of inv) {
      if (slot.id === id && slot.qty < def.maxStack) {
        const take = Math.min(remaining, def.maxStack - slot.qty);
        slot.qty += take;
        remaining -= take;
        if (remaining === 0) return 0;
      }
    }
  }

  // Create new slots
  while (remaining > 0 && inv.length < MAX_INVENTORY_SLOTS) {
    const take = Math.min(remaining, def.maxStack);
    const next: InvItem = { id, qty: take };
    if (def.maxDur !== undefined) {
      next.dur = dur !== undefined ? Math.max(1, Math.min(def.maxDur, Math.round(dur))) : def.maxDur;
    }
    inv.push(next);
    remaining -= take;
  }

  return remaining;
}

export function countItemInInventory(inv: InvItem[], id: ItemId): number {
  let total = 0;
  for (const item of inv) {
    if (item.id === id) total += item.qty;
  }
  return total;
}

export function removeItemFromInventory(inv: InvItem[], id: ItemId, qty: number): boolean {
  if (countItemInInventory(inv, id) < qty) return false;
  let need = qty;
  for (let i = inv.length - 1; i >= 0 && need > 0; i--) {
    const slot = inv[i]!;
    if (slot.id !== id) continue;
    if (slot.qty <= need) {
      need -= slot.qty;
      inv.splice(i, 1);
    } else {
      slot.qty -= need;
      need = 0;
    }
  }
  return true;
}

import type { ContainerKind, TownLayout } from './worldgen.js';
import { hasLineOfSight } from './worldgen.js';

export const SEARCH_SECONDS: Record<ContainerKind, number> = {
  crate: 3, fridge: 2.5, med_cabinet: 2, gun_locker: 5, shelf: 3.5, car_trunk: 4,
};
export const CONTAINER_LABELS: Record<ContainerKind, string> = {
  crate: 'Wooden crate', fridge: 'Refrigerator', med_cabinet: 'Medicine cabinet',
  gun_locker: 'Gun locker', shelf: 'Shelves', car_trunk: 'Car trunk',
};
export interface LootTarget {
  id: string;
  kind: 'container' | 'ground';
  name: string;
  x: number;
  y: number;
  duration: number;
}

export function canReachLoot(town: TownLayout, p: {x: number; y: number}, target: {x: number; y: number}): boolean {
  return Math.hypot(target.x - p.x, target.y - p.y) < 2.5 && hasLineOfSight(town, p.x, p.y, target.x, target.y);
}

export function findNearbyLoot(town: TownLayout, drops: Iterable<{id: string; x: number; y: number}>, p: {x: number; y: number}): LootTarget | null {
  let target: LootTarget | null = null;
  let best = 2.5;
  for (const d of drops) {
    const distance = Math.hypot(d.x - p.x, d.y - p.y);
    if (distance < best && canReachLoot(town, p, d)) {
      best = distance;
      target = {...d, kind: 'ground', name: 'Ground items', duration: 0};
    }
  }
  for (const c of town.containers) {
    const distance = Math.hypot(c.x - p.x, c.y - p.y);
    if (distance < best && canReachLoot(town, p, c)) {
      best = distance;
      target = {id: c.id, x: c.x, y: c.y, kind: 'container', name: CONTAINER_LABELS[c.kind], duration: SEARCH_SECONDS[c.kind]};
    }
  }
  return target;
}

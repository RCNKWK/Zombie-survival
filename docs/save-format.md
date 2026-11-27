# Save Format (`shared/save.ts`)

## Overview
- Format version field: `v` (integer). Current version: **`2`**.
- Max JSON size per save: **256 KB** (warning threshold: **150 KB**).
- Coordinates are rounded to 2 decimal places for deterministic serialization and compact size.
- Only the world owner's save includes the `world` object. Non-owner saves have `world: undefined`.

## Schema `v2`
```ts
interface PlayerSaveV2 {
  v: 2;
  player: {
    x: number;
    y: number;
    angle: number;
    hp: number;
    stamina: number;
    hunger: number;
    thirst: number;
    bleeding: number;      // 0..3
    panic: number;         // 0..100
    battery: number;       // 0..100
    flashlightOn: boolean;
    sneaking: boolean;
    kills: number;
    daysSurvived: number;
    activeSlot: number;    // 0..3
    inventory: Array<{ id: string; qty: number; dur?: number }>;
  };
  world?: {
    layoutVersion?: number; // 2 = expanded districts seeded; absent = original world
    seed: number;
    worldTimeMin: number;  // 0..1439.99
    day: number;
    lastSavedAt: number;   // epoch ms
    containers: Record<string, { looted: boolean; restockDay: number; items: Array<{ id: string; qty: number; dur?: number }> }>;
    barricades: Array<{ id: string; kind: 'barricade' | 'campfire' | 'trap'; x: number; y: number; angle: number; hp: number; maxHp: number; ownerId: string }>;
    droppedLoot: Array<{ id: string; x: number; y: number; items: Array<{ id: string; qty: number; dur?: number }>; droppedAt: number }>;
  };
}
```

## Migration History
- **`v1` -> `v2`**: Added `player.panic` (default `0`), `player.battery` (default `100`), `player.flashlightOn` (default `false`), `player.sneaking` (default `false`), and `world.droppedLoot` (default `[]`).
- **Future versions (`v > 2`)**: Rejected on load so an older server never overwrites a newer save.

`layoutVersion: 2` marks the one-time expansion loot upgrade. Older saves retain their original district state and receive loot only in the new districts. This optional field does not change the v2 player format.

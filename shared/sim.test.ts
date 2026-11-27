import test from 'node:test';
import assert from 'node:assert/strict';
import { INITIAL_GROUND_DROPS, TICK_DT, WORLD_SIZE } from './constants.js';
import { countItemInInventory, makeItem } from './items.js';
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
  handlePlayerShove,
  handlePlayerUseItem,
  playerFromSaved,
  playerToSaved,
  stepWorld,
  worldToSaved,
} from './sim.js';
import { deserializePlayerSave, serializePlayerSave } from './save.js';

function makeDeterministicRng(seed = 1234): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

test('player combat, shove, and looting update state deterministically', () => {
  const rng = makeDeterministicRng(42);
  const world = createWorldState(1001, undefined, 1700000000000, rng);
  const p = playerFromSaved(1, 'u1', 'Kai', createDefaultPlayerData(rng), world.town);
  world.players.set(1, p);

  // Place a zombie right in front of player
  const firstZombie = world.zombies.values().next().value;
  assert.ok(firstZombie);
  firstZombie.x = p.x + 1.2;
  firstZombie.y = p.y;
  p.angle = 0;

  const hpBefore = firstZombie.hp;
  const attacked = handlePlayerAttack(world, p, rng);
  assert.equal(attacked, true);
  assert.ok(firstZombie.hp < hpBefore);

  // Shove pushes zombie back
  const shoved = handlePlayerShove(world, p, () => 0.1);
  assert.equal(shoved, true);
  assert.equal(firstZombie.state, 'k');
});

test('gunfire consumes ammo and emits loud noise attracting nearby zombies', () => {
  const rng = makeDeterministicRng(99);
  const world = createWorldState(2002, undefined, 1700000000000, rng);
  const p = playerFromSaved(1, 'u1', 'Kai', createDefaultPlayerData(rng), world.town);
  p.inventory.unshift(makeItem('pistol', 1), makeItem('ammo_9mm', 5));
  p.activeSlot = 0;
  world.players.set(1, p);

  const z = world.zombies.values().next().value!;
  z.x = p.x + 12;
  z.y = p.y;
  z.state = 'i';

  const fired = handlePlayerAttack(world, p, rng);
  assert.equal(fired, true);
  assert.equal(countItemInInventory(p.inventory, 'ammo_9mm'), 4);
  assert.equal(z.state, 'v');
});

test('players start empty and fresh 480x480 world spawns random ground drops for pickup and drop', () => {
  const rng = makeDeterministicRng(21);
  const world = createWorldState(6006, undefined, 1700000000000, rng);
  assert.equal(WORLD_SIZE, 480);
  assert.ok(world.droppedLoot.size >= INITIAL_GROUND_DROPS);

  const starter = createDefaultPlayerData(rng);
  assert.equal(starter.inventory.length, 0);

  const p = playerFromSaved(1, 'u1', 'Kai', starter, world.town);
  world.players.set(1, p);

  // Move next to the first ground drop and pick it up
  const firstDrop = world.droppedLoot.values().next().value!;
  p.x = firstDrop.x;
  p.y = firstDrop.y;
  const expectedTopId = firstDrop.items[0]!.id;

  assert.equal(handlePlayerInteract(world, p), true);
  assert.equal(p.inventory.length, 0);
  assert.equal(handlePlayerLoot(world, p, {t: 'loot', source: firstDrop.id, mode: 'all'}), true);
  assert.ok(p.inventory.length >= 1);
  const snapAfterPickup = buildSnapshotForPlayer(world, 1);
  assert.equal(snapAfterPickup.p[0]?.eq, expectedTopId);

  // Drop the held item back onto the ground
  assert.equal(handlePlayerDropItem(world, p, p.activeSlot), true);
  const snapAfterDrop = buildSnapshotForPlayer(world, 1);
  assert.equal(snapAfterDrop.p[0]?.eq, '');
  assert.ok(snapAfterDrop.d.some((d) => d.top === expectedTopId));
});

test('crafting, building barricade, and medical usage work', () => {
  const rng = makeDeterministicRng(7);
  const world = createWorldState(3003, undefined, 1700000000000, rng);
  const p = playerFromSaved(1, 'u1', 'Kai', createDefaultPlayerData(rng), world.town);
  p.inventory.push(makeItem('rag', 2), makeItem('wood_plank', 2), makeItem('nails', 2));
  p.bleeding = 2;
  p.hp = 60;
  world.players.set(1, p);

  // Craft bandage from 2 rags
  assert.equal(handlePlayerCraft(world, p, 'craft_bandage'), true);
  assert.equal(countItemInInventory(p.inventory, 'rag'), 0);

  // Use bandage to stop bleeding & heal
  const bandageIdx = p.inventory.findIndex((i) => i.id === 'bandage');
  assert.ok(bandageIdx >= 0);
  assert.equal(handlePlayerUseItem(world, p, bandageIdx), true);
  assert.equal(p.bleeding, 0);
  assert.ok(p.hp > 60);

  // Build barricade using starter planks + nails
  assert.equal(handlePlayerBuild(world, p, 'barricade'), true);
  assert.equal(world.barricades.size, 1);
  assert.equal(world.dirtyWorld, true);
});

test('looting a container transfers items and persists across save -> load', () => {
  const rng = makeDeterministicRng(15);
  const world = createWorldState(4004, undefined, 1700000000000, rng);
  const container = world.town.containers[0]!;
  const p = playerFromSaved(1, 'u1', 'Kai', createDefaultPlayerData(rng), world.town);
  world.droppedLoot.clear();
  world.zombies.clear();
  world.spawnDirectorTimer = 1000;
  p.x = container.x + 1.3;
  p.y = container.y;
  world.players.set(1, p);

  assert.equal(handlePlayerInteract(world, p), true);
  for (let i = 0; i < 100; i++) stepWorld(world, TICK_DT, rng);
  assert.equal(handlePlayerLoot(world, p, {t: 'loot', source: container.id, mode: 'all'}), true);
  assert.ok(world.containers.has(container.id));

  // Save and reload world
  const saved = serializePlayerSave(playerToSaved(p), worldToSaved(world, 1700000001000));
  const { save: loaded } = deserializePlayerSave(JSON.parse(JSON.stringify(saved)), 4004, 1700000002000);
  const reloadedWorld = createWorldState(4004, loaded.world, 1700000002000, rng);
  assert.equal(reloadedWorld.containers.get(container.id)?.looted, true);
});

test('simulation ticks advance world time and build interest-managed snapshot', () => {
  const rng = makeDeterministicRng(88);
  const world = createWorldState(5005, undefined, 1700000000000, rng);
  const p = playerFromSaved(1, 'u1', 'Kai', createDefaultPlayerData(rng), world.town);
  world.players.set(1, p);

  const startMin = world.worldTimeMin;
  for (let i = 0; i < 20; i++) {
    stepWorld(world, TICK_DT, rng);
  }
  assert.ok(world.worldTimeMin > startMin);
  const snap = buildSnapshotForPlayer(world, 1);
  assert.equal(snap.p.length, 1);
  assert.ok(Array.isArray(snap.inv));
});

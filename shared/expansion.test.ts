import test from 'node:test';
import assert from 'node:assert/strict';
import { generateTown, mulberry32 } from './worldgen.js';
import { createWorldState, createDefaultPlayerData, playerFromSaved, stepWorld, handlePlayerUseItem, buildSnapshotForPlayer, worldToSaved, dropLootAt } from './sim.js';
import { makeItem } from './items.js';
import { serializePlayerSave, deserializePlayerSave } from './save.js';

test('expanded districts contain buildings and loot in every quadrant with stable original IDs', () => {
  const town = generateTown(1001);
  assert.deepEqual(town, generateTown(1001));
  assert.equal(town.buildings.find(b => b.id === 'b_safehouse')?.x, 104);
  assert.equal(new Set(town.containers.map(c => c.id)).size, town.containers.length);
  for (const [x, y] of [[0, 0], [240, 0], [0, 240], [240, 240]]) {
    assert.ok(town.buildings.filter(b => b.x >= x! && b.x < x! + 240 && b.y >= y! && b.y < y! + 240).length >= 10);
    assert.ok(town.containers.filter(c => c.x >= x! && c.x < x! + 240 && c.y >= y! && c.y < y! + 240).length >= 30);
  }
  const world = createWorldState(1001, undefined, 1000, mulberry32(12));
  assert.ok(world.droppedLoot.size > 0 && world.droppedLoot.size < 52);
});

test('movement reaches expanded area but is stopped by all four invisible boundaries', () => {
  const world = createWorldState(1, undefined, 1000, mulberry32(2));
  world.zombies.clear();
  const p = playerFromSaved(1, 'u', 'Test', createDefaultPlayerData(), world.town);
  world.players.set(1, p);
  for (const [x,y,dx,dy] of [[479,240,1,0], [1,240,-1,0], [240,479,0,1], [240,1,0,-1]]) {
    Object.assign(p, { x,y,inputDx:dx,inputDy:dy });
    for (let i=0;i<20;i++) stepWorld(world, 0.05, mulberry32(i));
    assert.ok(p.x >= 0.92 - 1e-9 && p.x <= 479.08 + 1e-9 && p.y >= 0.92 - 1e-9 && p.y <= 479.08 + 1e-9);
    if (x === 479) assert.ok(p.x > 478);
    if (y === 479) assert.ok(p.y > 478);
  }
});

test('using a consumable publishes its actual item for animation even after consuming the last one', () => {
  const world = createWorldState(1, undefined, 1000, mulberry32(2));
  const p = playerFromSaved(1, 'u', 'Test', createDefaultPlayerData());
  world.players.set(1,p);
  p.thirst = 10;
  p.inventory = [makeItem('water_bottle',1)];
  assert.ok(handlePlayerUseItem(world,p,0));
  assert.equal(p.thirst,58);
  assert.equal(p.inventory.length,0);
  assert.ok(buildSnapshotForPlayer(world,1).ev.some(e => e.k === 'use' && e.pid === 1 && e.item === 'water_bottle'));
});

test('dropping after reload cannot overwrite existing loot and stays inside the boundary', () => {
  const world = createWorldState(1, undefined, 1000, mulberry32(2));
  const saved = worldToSaved(world,1000);
  const reloaded = createWorldState(1,saved,1000,mulberry32(2));
  const first = [...reloaded.droppedLoot.values()][0]!;
  const count = reloaded.droppedLoot.size;
  dropLootAt(reloaded, 490, -10, [makeItem('axe',1)],2000);
  assert.equal(reloaded.droppedLoot.size,count+1);
  assert.deepEqual(reloaded.droppedLoot.get(first.id),first);
  const last = [...reloaded.droppedLoot.values()].at(-1)!;
  assert.ok(last.x < 480 && last.y > 0);
});

test('older worlds gain loot in new districts once, without refilling looted original areas', () => {
  const original = createWorldState(42, undefined, 1000, mulberry32(5));
  const oldSave = worldToSaved(original, 1000);
  delete oldSave.layoutVersion;
  oldSave.droppedLoot = oldSave.droppedLoot.filter(d => d.x < 240 && d.y < 240).slice(0, 10);
  const expanded = createWorldState(42, oldSave, 1000, mulberry32(6));
  assert.ok([...expanded.droppedLoot.values()].filter(d => d.x >= 240 || d.y >= 240).length >= 18);
  assert.equal([...expanded.droppedLoot.values()].filter(d => d.x < 240 && d.y < 240).length, oldSave.droppedLoot.length);
  const encoded = serializePlayerSave(createDefaultPlayerData(), worldToSaved(expanded, 1000));
  const nextSave = deserializePlayerSave(JSON.parse(JSON.stringify(encoded)), 42, 1000).save.world!;
  const reloaded = createWorldState(42, nextSave, 1000, mulberry32(7));
  assert.deepEqual([...reloaded.droppedLoot.values()], [...expanded.droppedLoot.values()]);
});

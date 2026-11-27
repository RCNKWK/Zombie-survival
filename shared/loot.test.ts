import test from 'node:test';
import assert from 'node:assert/strict';
import * as sim from './sim.js';
import { makeItem, countItemInInventory } from './items.js';
import { mulberry32 } from './worldgen.js';
import { deserializePlayerSave, serializePlayerSave } from './save.js';

function setup() {
  const world = sim.createWorldState(1001, undefined, 1000, mulberry32(2));
  world.zombies.clear(); world.droppedLoot.clear(); world.spawnDirectorTimer = 1000;
  const container = world.town.containers.find(c => c.id === 'b_safehouse_c0')!;
  const p = sim.playerFromSaved(1, 'one', 'One', sim.createDefaultPlayerData());
  p.x = container.x + 1.3; p.y = container.y;
  world.players.set(p.id, p);
  return { world, p, container };
}
function wait(world: sim.SimWorldState, seconds = 5) {
  for (let i = 0; i < seconds * 20; i++) sim.stepWorld(world, 0.05, mulberry32(i));
}

test('search takes time, reveals contents only to searcher, and transfers nothing automatically', () => {
  const {world,p} = setup();
  assert.ok(sim.handlePlayerInteract(world,p));
  assert.equal(p.inventory.length,0);
  let loot = sim.buildSnapshotForPlayer(world,1).loot;
  assert.ok(loot && loot.remaining > 0);
  assert.equal(loot.items,undefined);
  assert.equal(sim.buildSnapshotForPlayer(world,2).loot,null);
  wait(world,1);
  assert.equal(sim.buildSnapshotForPlayer(world,1).loot?.items,undefined);
  wait(world);
  loot = sim.buildSnapshotForPlayer(world,1).loot;
  assert.equal(loot?.remaining,0);
  assert.ok(loot.items?.length);
  assert.equal(p.inventory.length,0);
});

test('movement, damage, attack, disconnect and explicit cancel interrupt search', () => {
  for (const action of ['move','damage','attack','away','cancel']) {
    const {world,p} = setup();
    sim.handlePlayerInteract(world,p);
    assert.equal(p.inventory.length,0);
    if (action === 'move') p.inputDx = 1;
    if (action === 'damage') p.hp -= 1;
    if (action === 'attack') sim.handlePlayerAttack(world,p);
    if (action === 'away') p.away = true;
    if (action === 'cancel') sim.handlePlayerInteract(world,p);
    wait(world,0.1);
    assert.equal(sim.buildSnapshotForPlayer(world,1).loot,null,action);
    assert.equal(p.inventory.length,0);
  }
});

test('search cannot reach containers through a wall', () => {
  const {world,p,container} = setup();
  p.x = container.x; p.y = container.y + 1.2;
  world.town.buildings[0]!.walls.push({x:container.x-1,y:container.y+0.5,w:2,h:0.2});
  assert.equal(sim.handlePlayerInteract(world,p),false);
  assert.equal(p.inventory.length,0);
});

test('new worlds primarily place loot in searchable containers rather than on the ground', () => {
  const world = sim.createWorldState(42, undefined, 1000, mulberry32(2));
  assert.ok(world.droppedLoot.size > 0);
  assert.ok(world.droppedLoot.size < world.town.containers.length / 4);
});

test('take rejects early and distant requests, and supports one, stack and all', () => {
  const {world,p,container} = setup();
  sim.handlePlayerInteract(world,p);
  assert.equal(sim.handlePlayerLoot(world,p,{t:'loot',source:container.id,mode:'all'}),false);
  wait(world);
  world.containers.get(container.id)!.items = [makeItem('water_bottle',3),makeItem('bandage',2),makeItem('axe')];
  assert.ok(sim.handlePlayerLoot(world,p,{t:'loot',source:container.id,mode:'one',item:'water_bottle'}));
  assert.equal(countItemInInventory(p.inventory,'water_bottle'),1);
  assert.equal(world.containers.get(container.id)!.items[0]!.qty,2);
  assert.ok(sim.handlePlayerLoot(world,p,{t:'loot',source:container.id,mode:'stack',item:'bandage'}));
  assert.equal(countItemInInventory(p.inventory,'bandage'),2);
  assert.ok(sim.handlePlayerLoot(world,p,{t:'loot',source:container.id,mode:'all'}));
  assert.equal(countItemInInventory(p.inventory,'water_bottle'),3);
  assert.equal(countItemInInventory(p.inventory,'axe'),1);
  assert.equal(world.containers.get(container.id)!.items.length,0);
  world.containers.get(container.id)!.items = [makeItem('water_bottle',1)];
  p.x += 20;
  assert.equal(sim.handlePlayerLoot(world,p,{t:'loot',source:container.id,mode:'all'}),false);
});

test('full backpack preserves remaining loot while topping up existing stacks', () => {
  const {world,p,container} = setup(); sim.handlePlayerInteract(world,p); wait(world);
  p.inventory = [makeItem('water_bottle',3), ...Array.from({length:15},()=>makeItem('axe'))];
  world.containers.get(container.id)!.items = [makeItem('water_bottle',3),makeItem('medkit')];
  assert.ok(sim.handlePlayerLoot(world,p,{t:'loot',source:container.id,mode:'all'}));
  assert.equal(p.inventory.length,16);
  assert.equal(countItemInInventory(p.inventory,'water_bottle'),4);
  assert.deepEqual(world.containers.get(container.id)!.items,[makeItem('water_bottle',2),makeItem('medkit')]);
  assert.equal(sim.handlePlayerLoot(world,p,{t:'loot',source:container.id,mode:'all'}),false);
});

test('two players taking the same item cannot duplicate it or take a different stale row', () => {
  const {world,p,container} = setup(); sim.handlePlayerInteract(world,p); wait(world);
  world.containers.get(container.id)!.items = [makeItem('axe'),makeItem('water_bottle',1)];
  const other = sim.playerFromSaved(2,'two','Two',sim.createDefaultPlayerData());
  other.x=p.x;other.y=p.y;world.players.set(2,other);sim.handlePlayerInteract(world,other);
  const req = {t:'loot',source:container.id,mode:'one',item:'axe',dur:55} as const;
  assert.ok(sim.handlePlayerLoot(world,p,req));
  assert.equal(sim.handlePlayerLoot(world,other,req),false);
  assert.equal(other.inventory.length,0);
  assert.equal(world.containers.get(container.id)!.items[0]?.id,'water_bottle');
  assert.ok(sim.handlePlayerLoot(world,other,{t:'loot',source:container.id,mode:'all'}));
  assert.equal(countItemInInventory(p.inventory,'axe')+countItemInInventory(other.inventory,'axe'),1);
});

test('searched contents and partial takes survive save reload; restocking requires another search', () => {
  const {world,p,container} = setup(); sim.handlePlayerInteract(world,p); wait(world);
  world.containers.get(container.id)!.items = [makeItem('water_bottle',3)];
  sim.handlePlayerLoot(world,p,{t:'loot',source:container.id,mode:'one',item:'water_bottle'});
  const raw=serializePlayerSave(sim.playerToSaved(p),sim.worldToSaved(world,1000));
  const saved=deserializePlayerSave(JSON.parse(JSON.stringify(raw)),1001,1000).save;
  const restored=sim.createWorldState(1001,saved.world,1000,mulberry32(1));
  const player=sim.playerFromSaved(1,'one','One',saved.player);restored.players.set(1,player);
  sim.handlePlayerInteract(restored,player);
  assert.equal(sim.buildSnapshotForPlayer(restored,1).loot?.remaining,0);
  assert.equal(sim.buildSnapshotForPlayer(restored,1).loot?.items?.[0]?.qty,2);
  sim.handlePlayerLoot(restored,player,{t:'loot',source:container.id,mode:'all'});
  player.loot=undefined;
  restored.day=restored.containers.get(container.id)!.restockDay;
  sim.handlePlayerInteract(restored,player);
  assert.ok(sim.buildSnapshotForPlayer(restored,1).loot!.remaining>0);
  assert.equal(sim.buildSnapshotForPlayer(restored,1).loot?.items,undefined);
});

test('ground items use the same selective picker without a search delay', () => {
  const {world,p} = setup();
  sim.dropLootAt(world,p.x,p.y,[makeItem('water_bottle',2),makeItem('axe')],1000);
  sim.handlePlayerInteract(world,p);
  const view=sim.buildSnapshotForPlayer(world,1).loot!;
  assert.equal(view.kind,'ground'); assert.equal(view.remaining,0); assert.equal(p.inventory.length,0);
  assert.ok(sim.handlePlayerLoot(world,p,{t:'loot',source:view.id,mode:'one',item:'water_bottle'}));
  assert.equal(world.droppedLoot.get(view.id)!.items[0]?.qty,1);
});

test('attack input cancels searching even while attack is cooling down', () => {
  const {world,p}=setup();
  p.attackCd=0.3;
  sim.handlePlayerInteract(world,p);
  sim.handlePlayerAttack(world,p);
  assert.equal(sim.buildSnapshotForPlayer(world,p.id).loot,null);
});

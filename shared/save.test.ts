import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  CURRENT_SAVE_VERSION,
  FutureSaveVersionError,
  InvalidSaveError,
  deserializePlayerSave,
  measureSaveBytes,
  serializePlayerSave,
} from './save.js';
import {
  createDefaultPlayerData,
  createWorldState,
  playerFromSaved,
  playerToSaved,
  worldToSaved,
} from './sim.js';
import { SAVE_MAX_BYTES } from './constants.js';

const fixturesDir = path.resolve('shared/fixtures');

test('migrates v1 save fixture to latest version without losing data', () => {
  const raw = JSON.parse(fs.readFileSync(path.join(fixturesDir, 'save-v1.json'), 'utf8'));
  const res = deserializePlayerSave(raw, 1111, 1750000000000);
  assert.equal(res.migrated, true);
  assert.equal(res.save.v, CURRENT_SAVE_VERSION);
  assert.equal(res.save.player.x, 49.5);
  assert.equal(res.save.player.bleeding, 1);
  assert.equal(res.save.player.battery, 100);
  assert.equal(res.save.player.flashlightOn, false);
  assert.equal(res.save.world?.seed, 4242);
  assert.deepEqual(res.save.world?.droppedLoot, []);
  assert.equal(res.save.world?.barricades.length, 1);
});

test('loads v2 save fixture cleanly without repair or migration', () => {
  const raw = JSON.parse(fs.readFileSync(path.join(fixturesDir, 'save-v2.json'), 'utf8'));
  const res = deserializePlayerSave(raw, 1111, 1750000000000);
  assert.equal(res.migrated, false);
  assert.equal(res.repaired, false);
  assert.equal(res.save.player.flashlightOn, true);
  assert.equal(res.save.world?.droppedLoot.length, 1);
});

test('round-trip serialize -> JSON -> deserialize -> identical world & player', () => {
  const world = createWorldState(777, undefined, 1700000000000, () => 0.42);
  const p = playerFromSaved(1, 'u1', 'Kai', createDefaultPlayerData(() => 0.3), world.town);
  p.kills = 12;
  p.bleeding = 2;
  world.players.set(1, p);
  world.barricades.set('b_1_1', {
    id: 'b_1_1',
    kind: 'barricade',
    x: 47.5,
    y: 70.25,
    angle: 0.5,
    hp: 150,
    maxHp: 160,
    ownerId: 'u1',
  });

  const saved1 = serializePlayerSave(playerToSaved(p), worldToSaved(world, 1700000005000));
  const json = JSON.stringify(saved1);
  const parsed = JSON.parse(json);
  const { save: loaded } = deserializePlayerSave(parsed, 777, 1700000005000);

  assert.deepEqual(loaded, saved1);
  const budget = measureSaveBytes(loaded);
  assert.equal(budget.overLimit, false);
  assert.ok(budget.bytes < SAVE_MAX_BYTES);
});

test('rejects future save version without overwriting', () => {
  assert.throws(
    () => deserializePlayerSave({ v: CURRENT_SAVE_VERSION + 1, player: {} }),
    FutureSaveVersionError,
  );
  assert.throws(() => deserializePlayerSave('not-an-object'), InvalidSaveError);
});

test('repairs corrupted fields safely without crashing', () => {
  const corrupted = {
    v: 2,
    player: {
      x: -999,
      y: NaN,
      hp: 9999,
      stamina: -50,
      inventory: [
        { id: 'nonexistent_item', qty: 5 },
        { id: 'bandage', qty: 999 },
        'garbage',
      ],
    },
    world: {
      seed: 123,
      worldTimeMin: 99999,
      day: -5,
      barricades: [{ id: 'bad', kind: 'invalid_kind', x: 10, y: 10 }],
    },
  };
  const res = deserializePlayerSave(corrupted, 555, 1700000000000);
  assert.equal(res.repaired, true);
  assert.equal(res.save.player.x, 1);
  assert.equal(res.save.player.hp, 100);
  assert.equal(res.save.player.stamina, 0);
  assert.equal(res.save.player.inventory.length, 1);
  assert.equal(res.save.player.inventory[0]?.id, 'bandage');
  assert.equal(res.save.player.inventory[0]?.qty, 6);
  assert.equal(res.save.world?.barricades.length, 0);
});

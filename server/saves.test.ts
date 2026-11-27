import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LocalAdapter } from './platform/local.js';
import { SaveQueue } from './saves.js';
import { WorldManager } from './worlds.js';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dz-test-'));
}

test('LocalAdapter preserves special keys and enforces idempotency + 256KB limit', async () => {
  const dir = tmpDir();
  const adapter = new LocalAdapter({ dataDir: path.join(dir, 'worlds') });

  const idRes = await adapter.identify('local:Kai', 'w1');
  assert.equal(idRes.me.role, 'owner');
  assert.equal(idRes.me.save, null);

  const weirdData = {
    v: 2,
    $x: 123,
    'a.b': 'dotted',
    constructor: 'safe-string',
    player: { x: 48, y: 73 },
  };
  const s1 = await adapter.save('w1', {
    userId: idRes.player.userId,
    data: weirdData,
    reason: 'manual',
    saveKey: 'k-1',
  });
  assert.equal(s1.version, 1);
  assert.equal(s1.replayed, false);

  // Same saveKey replays without incrementing version
  const s1Replay = await adapter.save('w1', {
    userId: idRes.player.userId,
    data: weirdData,
    reason: 'manual',
    saveKey: 'k-1',
  });
  assert.equal(s1Replay.version, 1);
  assert.equal(s1Replay.replayed, true);

  const loaded = await adapter.getMemberSave('w1', idRes.player.userId);
  assert.equal(loaded?.data.$x, 123);
  assert.equal(loaded?.data['a.b'], 'dotted');
  assert.equal(loaded?.data.constructor, 'safe-string');

  // > 256 KB rejected with 413
  const huge = { v: 2, big: 'a'.repeat(270 * 1024) };
  await assert.rejects(
    () =>
      adapter.save('w1', {
        userId: idRes.player.userId,
        data: huge,
        reason: 'autosave',
        saveKey: 'k-huge',
      }),
    (err: any) => err.status === 413,
  );

  fs.rmSync(dir, { recursive: true, force: true });
});

test('SaveQueue retries failed saves without duplicating versions and survives restart', async () => {
  const dir = tmpDir();
  const pendingFile = path.join(dir, 'pending-saves.json');
  const rejectedDir = path.join(dir, 'rejected');
  const adapter = new LocalAdapter({ dataDir: path.join(dir, 'worlds'), failRate: 1.0 });

  const idRes = await adapter.identify('local:Kai', 'w2');
  const q1 = new SaveQueue({
    adapter,
    pendingFile,
    rejectedDir,
    retryDelaysMs: [10, 20],
    log: () => {},
  });

  // Failing save stays queued on disk
  const ok1 = await q1.saveNow('w2', idRes.player.userId, { v: 2, player: { x: 10 } }, 'disconnect');
  assert.equal(ok1, false);
  assert.equal(q1.pendingCount(), 1);
  assert.ok(fs.existsSync(pendingFile));

  // Older/concurrent autosave cannot replace a disconnect save at same timestamp
  const queuedBefore = q1.getLatestQueuedSave('w2', idRes.player.userId);
  assert.deepEqual(queuedBefore, { v: 2, player: { x: 10 } });
  q1.dispose();

  // Simulate server restart: new SaveQueue loads pending-saves.json and flushes once platform recovers
  adapter.setFailRate(0);
  const q2 = new SaveQueue({
    adapter,
    pendingFile,
    rejectedDir,
    retryDelaysMs: [10, 20],
    log: () => {},
  });
  assert.equal(q2.pendingCount(), 1);
  const flushed = await q2.flushPending(true);
  assert.equal(flushed, 1);
  assert.equal(q2.pendingCount(), 0);

  const saved = await adapter.getMemberSave('w2', idRes.player.userId);
  assert.equal(saved?.version, 1);
  q2.dispose();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('SaveQueue archives 413 payloadTooLarge instead of retrying forever', async () => {
  const dir = tmpDir();
  const pendingFile = path.join(dir, 'pending-saves.json');
  const rejectedDir = path.join(dir, 'rejected');
  const adapter = new LocalAdapter({ dataDir: path.join(dir, 'worlds') });

  const idRes = await adapter.identify('local:Kai', 'w3');
  const q = new SaveQueue({ adapter, pendingFile, rejectedDir, log: () => {} });
  const ok = await q.saveNow('w3', idRes.player.userId, { v: 2, pad: 'z'.repeat(270 * 1024) }, 'manual');
  assert.equal(ok, false);
  assert.equal(q.pendingCount(), 0);
  assert.equal(fs.readdirSync(rejectedDir).length, 1);

  q.dispose();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('WorldManager graceful shutdown saves active worlds via saveBatch', async () => {
  const dir = tmpDir();
  const adapter = new LocalAdapter({ dataDir: path.join(dir, 'worlds') });
  const q = new SaveQueue({
    adapter,
    pendingFile: path.join(dir, 'pending.json'),
    rejectedDir: path.join(dir, 'rejected'),
    log: () => {},
  });
  const manager = new WorldManager({
    adapter,
    saveQueue: q,
    autosaveMs: 60_000,
    reconnectGraceMs: 20_000,
    worldPollMs: 60_000,
    closedPolicy: 'continue',
  });

  // Simulate world with mock ws
  const sent: any[] = [];
  const fakeWs: any = {
    readyState: 1,
    send: (raw: string) => sent.push(JSON.parse(raw)),
    close: () => {},
  };
  const joined = await manager.handleJoin(fakeWs, 'local:Kai', 'w4');
  assert.ok(joined);
  assert.equal(sent[0]?.t, 'welcome');

  await manager.shutdown();
  assert.equal(manager.worldCount(), 0);
  const ownerSave = await adapter.getMemberSave('w4', 'local_kai');
  assert.ok(ownerSave);
  assert.equal(ownerSave.version, 1);

  fs.rmSync(dir, { recursive: true, force: true });
});

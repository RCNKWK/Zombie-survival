import test from 'node:test';
import assert from 'node:assert/strict';
import { NakaWorldAdapter } from './platform/naka.js';
import { WorldPlatformError } from './platform/adapter.js';

test('NakaWorldAdapter calls /internal/worlds/* with Bearer key and maps responses/errors', async () => {
  const calls: Array<{ url: string; method: string; auth: string | null }> = [];
  const mockFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    calls.push({ url, method: init?.method ?? 'GET', auth: headers.get('authorization') });

    if (url.endsWith('/internal/worlds/identify')) {
      const body = JSON.parse(String(init?.body ?? '{}'));
      if (body.token === 'expired') {
        return new Response(JSON.stringify({ message: 'Token expired' }), { status: 401 });
      }
      if (body.token === 'closed') {
        return new Response(JSON.stringify({ message: 'World closed' }), { status: 409 });
      }
      return new Response(
        JSON.stringify({
          status: true,
          data: {
            player: { userId: 'u1', username: 'Kai' },
            world: { id: 'w1', name: 'Knox', status: 'open', maxPlayers: 8, owner: { userId: 'u1', username: 'Kai' } },
            me: { role: 'owner', save: null },
          },
        }),
        { status: 200 },
      );
    }

    if (url.endsWith('/internal/worlds/w1/saves')) {
      return new Response(
        JSON.stringify({ status: true, data: { saveId: 's1', version: 1, replayed: false } }),
        { status: 200 },
      );
    }

    if (url.endsWith('/internal/worlds/w1/saves/batch')) {
      return new Response(
        JSON.stringify({
          status: true,
          data: { results: [{ userId: 'u1', saveKey: 'k1', ok: true, saveId: 's1', version: 1, replayed: false }] },
        }),
        { status: 200 },
      );
    }

    return new Response(JSON.stringify({ message: 'Not found' }), { status: 404 });
  };

  const naka = new NakaWorldAdapter({
    apiUrl: 'https://platform.example.com/api',
    serverKey: 'gsk_secret_123',
    fetch: mockFetch,
  });

  const idRes = await naka.identify('valid-jwt');
  assert.equal(idRes.player.username, 'Kai');
  assert.equal(calls[0]?.auth, 'Bearer gsk_secret_123');

  await assert.rejects(
    () => naka.identify('expired'),
    (e: unknown) => e instanceof WorldPlatformError && e.kind === 'badToken' && e.status === 401,
  );
  await assert.rejects(
    () => naka.identify('closed'),
    (e: unknown) => e instanceof WorldPlatformError && e.kind === 'worldClosed' && e.status === 409,
  );

  const saveRes = await naka.save('w1', {
    userId: 'u1',
    data: { v: 2 },
    reason: 'autosave',
    saveKey: 'k1',
  });
  assert.equal(saveRes.version, 1);

  const batchRes = await naka.saveBatch('w1', [
    { userId: 'u1', data: { v: 2 }, reason: 'disconnect', saveKey: 'k1' },
  ]);
  assert.equal(batchRes[0]?.ok, true);
});

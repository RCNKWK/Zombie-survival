/**
 * NAKALITE World Platform client helpers (iframe postMessage + #token fragment extraction).
 * Adapted for `world` mode per WORLD-STARTER.md: reads `?world=`, never sends `ended`.
 */

export const embedded: boolean = typeof window !== 'undefined' && window.parent !== window;

export function takeLaunchToken(): string | null {
  const params = new URLSearchParams(location.hash.slice(1));
  const token = params.get('token');
  if (token !== null) {
    history.replaceState(null, '', location.pathname + location.search);
  }
  return token || null;
}

export function worldIdFromUrl(): string | null {
  return new URLSearchParams(location.search).get('world');
}

function parentOrigin(): string {
  try {
    return document.referrer ? new URL(document.referrer).origin : '*';
  } catch {
    return '*';
  }
}

export type WorldPlatformEvent = { type: 'ready' } | { type: 'leave' };

export function toPlatform(event: WorldPlatformEvent): void {
  if (!embedded) return;
  window.parent.postMessage({ source: 'nakalite-game', ...event }, parentOrigin());
}

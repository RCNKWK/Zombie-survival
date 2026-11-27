import { SoundEngine } from './audio.js';
import { InputController } from './input.js';
import { NetClient } from './net.js';
import { embedded, takeLaunchToken, toPlatform, worldIdFromUrl } from './platform.js';
import { GameScene } from './render/scene.js';
import { GameUi } from './ui.js';

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const scene = new GameScene(canvas);
const audio = new SoundEngine();

// Extract launch token & strip #token immediately per security spec
let launchToken = takeLaunchToken();
let worldId = worldIdFromUrl();

// In standalone local dev (not embedded in platform), default smoothly to dev world
if (!embedded && !worldId && !launchToken) {
  worldId = 'dev';
  try {
    if (!sessionStorage.getItem('dz_rt_dev')) {
      launchToken = 'local:Kai';
    }
  } catch {
    launchToken = 'local:Kai';
  }
}
if (!worldId) worldId = 'dev';

let localPlayerId = 0;
let sentReady = false;

const ui = new GameUi({
  onLoot: (request) => net.send(request),
  onCloseLoot: () => net.send({t: 'lootClose'}),
  onSelectSlot: (slot) => net.send({ t: 'slot', i: slot }),
  onUseItem: (slot) => net.send({ t: 'use', i: slot }),
  onDropItem: (slot) => net.send({ t: 'drop', i: slot }),
  onCraft: (id) => net.send({ t: 'craft', id }),
  onBuild: (kind) => net.send({ t: 'build', kind }),
  onToggleFlash: () => {
    audio.click();
    net.send({ t: 'act', k: 'flash' });
  },
  onToggleSneak: () => input.toggleSneak(),
  onManualSave: () => net.send({ t: 'save' }),
  onEmote: (e) => net.send({ t: 'chat', e }),
  onRespawn: () => net.send({ t: 'act', k: 'respawn' }),
  onLeave: () => {
    toPlatform({ type: 'leave' });
    if (!embedded) {
      ui.showLoading('You left the world. Close tab or reload to re-enter.');
      net.dispose();
    }
  },
  onRetry: () => location.reload(),
});

const net = new NetClient(worldId, launchToken, {
  onWelcome: (msg) => {
    localPlayerId = msg.you;
    scene.initTown(msg.world.seed, msg.you);
    ui.hideOverlay();
    if (!sentReady) {
      sentReady = true;
      toPlatform({ type: 'ready' });
    }
    if (msg.fresh) {
      ui.pushToast(`Welcome to ${msg.world.name}! Press [?] for controls.`);
    }
  },
  onSnap: (snap) => {
    scene.applySnapshot(snap, (ev) => {
      if (ev.k === 'toast') {
        ui.pushToast(ev.msg);
        if (ev.msg.startsWith('Found:') || ev.msg.startsWith('Picked up:') || ev.msg.startsWith('Looted:')) audio.loot();
      } else if (ev.k === 'swing' || ev.k === 'shove') {
        audio.swing();
      } else if (ev.k === 'hit') {
        audio.hit(Boolean(ev.z));
      } else if (ev.k === 'shot') {
        audio.shot(Boolean(ev.sg));
      }
    });
    ui.updateFromSnap(snap, localPlayerId, scene.getTown());
  },
  onSaved: (at) => ui.setSavedAt(at),
  onWorldClosing: (inSec) => ui.pushToast(`World is closing in ${inSec}s — saving progress...`),
  onError: (_code, msg) => ui.showFatalError(msg, true),
  onLatency: (ms) => ui.setPing(ms),
  onConnectionState: (state) => {
    if (state === 'connecting') ui.showLoading('Connecting to Deadzone County...');
    else if (state === 'reconnecting') { ui.closeLoot(); ui.pushToast('Connection lost — reconnecting...'); }
  },
});

const input = new InputController(canvas, {
  onCloseLoot: () => ui.closeLoot(),
  onAttack: () => net.send({ t: 'act', k: 'attack' }),
  onShove: () => net.send({ t: 'act', k: 'shove' }),
  onInteract: () => net.send({ t: 'act', k: 'interact' }),
  onDropHeld: () => net.send({ t: 'drop', i: ui.getActiveSlot() }),
  onFlashlight: () => {
    audio.click();
    net.send({ t: 'act', k: 'flash' });
  },
  onSelectSlot: (slot) => net.send({ t: 'slot', i: slot }),
  onToggleBag: () => ui.togglePanel('bag'),
  onToggleBuild: () => ui.togglePanel('build'),
  onToggleEmote: () => ui.togglePanel('emote'),
  onZoom: (delta) => scene.setZoom(delta),
  onFirstGesture: () => audio.unlock(),
  computeAimAngle: (cx, cy) => scene.screenToAimAngle(cx, cy),
});

net.connect();

// Send player input at up to 20Hz when changed (or 4Hz heartbeat) to stay well under rate limit
let lastInSig = '';
let lastInSentAt = 0;
window.setInterval(() => {
  if (!localPlayerId) return;
  const st = input.pollMoveAndAim();
  const sig = `${st.dx.toFixed(2)},${st.dy.toFixed(2)},${st.angle.toFixed(2)},${st.sprint ? 1 : 0},${st.sneak ? 1 : 0}`;
  const now = performance.now();
  if (sig !== lastInSig || now - lastInSentAt >= 250) {
    lastInSig = sig;
    lastInSentAt = now;
    net.send({ t: 'in', dx: st.dx, dy: st.dy, a: st.angle, sp: st.sprint, sn: st.sneak });
  }
}, 50);

// Render loop at display refresh rate
let prevTime = performance.now();
function frame(now: number) {
  const dt = Math.min(0.1, (now - prevTime) / 1000);
  prevTime = now;
  scene.render(dt, now / 1000);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

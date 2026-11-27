import * as THREE from 'three';
import { ITEMS, isItemId } from '../../../shared/items.js';
import {
  FLASHLIGHT_RANGE,
  VISION_HALF_ANGLE,
  VISION_RANGE_DAY,
  VISION_RANGE_NIGHT,
  WORLD_SIZE,
} from '../../../shared/constants.js';
import type { NetBarricade, NetDroppedLoot, NetPlayer, NetZombie, SimEvent, SnapPayload } from '../../../shared/protocol.js';
import { generateTown, hasLineOfSight, type TownLayout } from '../../../shared/worldgen.js';
import {
  createBarricadeMesh,
  createBuildingVisual,
  createCarMesh,
  createContainerMesh,
  createDroppedLootMesh,
  createStreetLightMesh,
  createSurvivorRig,
  createTreeMesh,
  createZombieRig,
  getBuildingGroup,
  setSurvivorWeapon,
  survivorColorForId,
  type BuildingVisual,
  type CharacterRig,
  type ZombieRig,
} from './models.js';

interface InterpPlayer {
  rig: CharacterRig;
  targetX: number;
  targetY: number;
  targetAngle: number;
  curX: number;
  curY: number;
  curAngle: number;
  lastSnap: NetPlayer;
  hitTime: number;
  useTime: number;
  useItem: string;
  shoveTime: number;
}

interface InterpZombie {
  rig: ZombieRig;
  targetX: number;
  targetY: number;
  targetAngle: number;
  curX: number;
  curY: number;
  curAngle: number;
  lastSnap: NetZombie;
  hitTime: number;
}

interface FxRing {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  age: number;
  maxAge: number;
  maxRadius: number;
}

interface FxTracer {
  line: THREE.Line;
  mat: THREE.LineBasicMaterial;
  age: number;
}

function lerpAngle(a: number, b: number, t: number): number {
  let diff = b - a;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}

export class GameScene {
  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly sun: THREE.DirectionalLight;
  private readonly ambient: THREE.HemisphereLight;
  private readonly raycaster = new THREE.Raycaster();
  private readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.8);

  private town: TownLayout | null = null;
  private worldGroup = new THREE.Group();
  private buildingVisuals: BuildingVisual[] = [];
  private containerMeshes = new Map<string, THREE.Group>();
  private streetLights: Array<{ light: THREE.PointLight; bulbMat: THREE.MeshBasicMaterial }> = [];

  private players = new Map<number, InterpPlayer>();
  private zombies = new Map<number, InterpZombie>();
  private barricades = new Map<string, { mesh: THREE.Group; snap: NetBarricade }>();
  private droppedLoot = new Map<string, { mesh: THREE.Group; snap: NetDroppedLoot }>();
  private fxRings: FxRing[] = [];
  private fxTracers: FxTracer[] = [];

  private visionOverlay: THREE.Mesh;
  private visionUniforms: {
    uAngle: { value: number };
    uConeHalf: { value: number };
    uNear: { value: number };
    uFar: { value: number };
    uDark: { value: number };
  };

  private localId = 0;
  private camZoom = 1.0;
  private camX = WORLD_SIZE / 2;
  private camY = WORLD_SIZE / 2;
  private worldTimeMin = 480;

  private labelLayer: HTMLDivElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1b242c);
    this.scene.fog = new THREE.FogExp2(0x1b242c, 0.011);

    this.camera = new THREE.PerspectiveCamera(44, window.innerWidth / window.innerHeight, 0.5, 160);
    this.camera.position.set(this.camX, 17, this.camY + 14);
    this.camera.lookAt(this.camX, 0.5, this.camY);

    this.ambient = new THREE.HemisphereLight(0xd8e5f0, 0x3b4238, 0.85);
    this.scene.add(this.ambient);

    this.sun = new THREE.DirectionalLight(0xfff4de, 1.35);
    this.sun.position.set(22, 34, 18);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.camera.near = 2;
    this.sun.shadow.camera.far = 90;
    const d = 32;
    this.sun.shadow.camera.left = -d;
    this.sun.shadow.camera.right = d;
    this.sun.shadow.camera.top = d;
    this.sun.shadow.camera.bottom = -d;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.scene.add(this.worldGroup);

    // Vision cone overlay shader
    this.visionUniforms = {
      uAngle: { value: 0 },
      uConeHalf: { value: VISION_HALF_ANGLE },
      uNear: { value: 3.4 },
      uFar: { value: VISION_RANGE_DAY },
      uDark: { value: 0.42 },
    };
    const vMat = new THREE.ShaderMaterial({
      uniforms: this.visionUniforms,
      transparent: true,
      depthWrite: false,
      vertexShader: `
        varying vec2 vLocal;
        void main() {
          vLocal = position.xz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uAngle;
        uniform float uConeHalf;
        uniform float uNear;
        uniform float uFar;
        uniform float uDark;
        varying vec2 vLocal;
        void main() {
          float dist = length(vLocal);
          if (dist < uNear) {
            discard;
          }
          float ang = atan(vLocal.y, vLocal.x);
          float diff = abs(mod(ang - uAngle + 3.14159265, 6.2831853) - 3.14159265);
          float inCone = 1.0 - smoothstep(uConeHalf * 0.85, uConeHalf * 1.12, diff);
          float inDist = 1.0 - smoothstep(uFar * 0.78, uFar, dist);
          float vis = max(1.0 - smoothstep(uNear, uNear + 1.5, dist), inCone * inDist);
          float alpha = uDark * (1.0 - vis);
          if (alpha < 0.01) discard;
          gl_FragColor = vec4(0.03, 0.04, 0.06, alpha);
        }
      `,
    });
    const vGeo = new THREE.PlaneGeometry(90, 90);
    vGeo.rotateX(-Math.PI / 2);
    this.visionOverlay = new THREE.Mesh(vGeo, vMat);
    this.visionOverlay.position.y = 0.05;
    this.visionOverlay.renderOrder = 5;
    this.scene.add(this.visionOverlay);

    // Floating HTML labels container
    this.labelLayer = document.createElement('div');
    this.labelLayer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:10;overflow:hidden;';
    document.getElementById('game-root')?.appendChild(this.labelLayer);

    window.addEventListener('resize', this.onResize);
  }

  private onResize = () => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  };

  setZoom(delta: number) {
    this.camZoom = Math.max(0.68, Math.min(1.55, this.camZoom + delta));
  }

  initTown(seed: number, localPlayerId: number) {
    this.localId = localPlayerId;
    if (this.town && this.town.seed === seed) return;

    this.town = generateTown(seed);
    while (this.worldGroup.children.length > 0) {
      this.worldGroup.remove(this.worldGroup.children[0]!);
    }
    this.buildingVisuals = [];
    this.containerMeshes.clear();
    this.streetLights = [];

    // Grass base
    const grass = new THREE.Mesh(
      new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE),
      new THREE.MeshStandardMaterial({ color: 0x3b4d34, roughness: 0.96 }),
    );
    grass.rotation.x = -Math.PI / 2;
    grass.position.set(WORLD_SIZE / 2, 0, WORLD_SIZE / 2);
    grass.receiveShadow = true;
    this.worldGroup.add(grass);

    // Roads
    const roadMat = new THREE.MeshStandardMaterial({ color: 0x34383d, roughness: 0.9 });
    const stripeMat = new THREE.MeshBasicMaterial({ color: 0xc2aa58 });
    for (const r of this.town.roads) {
      const road = new THREE.Mesh(new THREE.PlaneGeometry(r.w, r.h), roadMat);
      road.rotation.x = -Math.PI / 2;
      road.position.set(r.x + r.w / 2, 0.01, r.y + r.h / 2);
      road.receiveShadow = true;
      this.worldGroup.add(road);

      // Dashed center line
      const horiz = r.w > r.h;
      const len = horiz ? r.w : r.h;
      for (let d = 2; d < len - 2; d += 4) {
        const dash = new THREE.Mesh(new THREE.PlaneGeometry(horiz ? 1.8 : 0.16, horiz ? 0.16 : 1.8), stripeMat);
        dash.rotation.x = -Math.PI / 2;
        dash.position.set(horiz ? r.x + d : r.x + r.w / 2, 0.015, horiz ? r.y + r.h / 2 : r.y + d);
        this.worldGroup.add(dash);
      }
    }

    // Buildings
    for (const b of this.town.buildings) {
      const vis = createBuildingVisual(b);
      this.buildingVisuals.push(vis);
      this.worldGroup.add(getBuildingGroup(vis));
    }

    // Containers
    for (const c of this.town.containers) {
      const m = createContainerMesh(c);
      this.containerMeshes.set(c.id, m);
      this.worldGroup.add(m);
    }

    // Cars
    for (const car of this.town.cars) {
      this.worldGroup.add(createCarMesh(car));
    }

    // Trees
    for (const t of this.town.trees) {
      this.worldGroup.add(createTreeMesh(t));
    }

    // Streetlights
    for (const sl of this.town.streetlights) {
      const built = createStreetLightMesh(sl);
      this.streetLights.push({ light: built.light, bulbMat: built.bulbMat });
      this.worldGroup.add(built.group);
    }
  }

  getTown(): TownLayout | null {
    return this.town;
  }

  screenToAimAngle(clientX: number, clientY: number): number | null {
    const local = this.players.get(this.localId);
    if (!local) return null;
    const ndc = new THREE.Vector2(
      (clientX / window.innerWidth) * 2 - 1,
      -(clientY / window.innerHeight) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3();
    if (this.raycaster.ray.intersectPlane(this.groundPlane, hit)) {
      return Math.atan2(hit.z - local.curY, hit.x - local.curX);
    }
    return null;
  }

  applySnapshot(snap: SnapPayload, onAudioEvent: (ev: SimEvent) => void) {
    this.worldTimeMin = snap.wt;

    // Players
    const seenP = new Set<number>();
    for (const p of snap.p) {
      seenP.add(p.id);
      let entry = this.players.get(p.id);
      if (!entry) {
        const isLocal = p.id === this.localId;
        const rig = createSurvivorRig(survivorColorForId(p.id), isLocal);
        const label = document.createElement('div');
        label.style.cssText =
          'position:absolute;transform:translate(-50%,-100%);font-size:11px;font-weight:700;text-shadow:0 1px 3px #000;white-space:nowrap;color:#f3f1ea;';
        this.labelLayer.appendChild(label);
        rig.labelEl = label;

        this.scene.add(rig.root);
        entry = {
          rig,
          targetX: p.x,
          targetY: p.y,
          targetAngle: p.a,
          curX: p.x,
          curY: p.y,
          curAngle: p.a,
          lastSnap: p,
          hitTime: 0, useTime: 0, useItem: '', shoveTime: 0,
        };
        this.players.set(p.id, entry);
        if (isLocal) { this.camX = p.x; this.camY = p.y; }
      } else {
        entry.targetX = p.x;
        entry.targetY = p.y;
        entry.targetAngle = p.a;
        if (p.hp < entry.lastSnap.hp) entry.hitTime = 0.32;
        entry.lastSnap = p;
      }
      if (entry.useTime <= 0) setSurvivorWeapon(entry.rig, p.eq);
      if (entry.rig.flashlight) {
        entry.rig.flashlight.intensity = p.fl && p.bt > 0 ? 4.2 : 0;
      }
      if (entry.rig.labelEl) {
        const emoteMap: Record<number, string> = { 1: ' 👋', 2: ' ⚠️', 3: ' 🏃', 4: ' 🤫', 5: ' 📦', 6: ' 👍' };
        const em = p.em ? emoteMap[p.em] ?? '' : '';
        entry.rig.labelEl.textContent = `${p.n}${p.aw ? ' (away)' : ''}${p.dd ? ' ☠️' : ''}${em}`;
      }
    }
    for (const [id, entry] of this.players.entries()) {
      if (!seenP.has(id)) {
        this.scene.remove(entry.rig.root);
        entry.rig.labelEl?.remove();
        this.players.delete(id);
      }
    }

    // Zombies
    const seenZ = new Set<number>();
    for (const z of snap.z) {
      seenZ.add(z.id);
      let entry = this.zombies.get(z.id);
      if (!entry) {
        const rig = createZombieRig(z.k);
        this.scene.add(rig.root);
        entry = {
          rig,
          targetX: z.x,
          targetY: z.y,
          targetAngle: z.a,
          curX: z.x,
          curY: z.y,
          curAngle: z.a,
          lastSnap: z,
          hitTime: 0,
        };
        this.zombies.set(z.id, entry);
      } else {
        entry.targetX = z.x;
        entry.targetY = z.y;
        entry.targetAngle = z.a;
        if (z.hp < entry.lastSnap.hp) entry.hitTime = 0.3;
        entry.lastSnap = z;
      }
    }
    for (const [id, entry] of this.zombies.entries()) {
      if (!seenZ.has(id)) {
        this.scene.remove(entry.rig.root);
        this.zombies.delete(id);
      }
    }

    // Barricades
    const seenB = new Set<string>();
    for (const b of snap.b) {
      seenB.add(b.id);
      let entry = this.barricades.get(b.id);
      if (!entry) {
        const mesh = createBarricadeMesh(b.k);
        mesh.position.set(b.x, 0, b.y);
        mesh.rotation.y = -b.a;
        this.scene.add(mesh);
        entry = { mesh, snap: b };
        this.barricades.set(b.id, entry);
      } else {
        entry.snap = b;
      }
    }
    for (const [id, entry] of this.barricades.entries()) {
      if (!seenB.has(id)) {
        this.scene.remove(entry.mesh);
        this.barricades.delete(id);
      }
    }

    // Dropped Loot
    const seenD = new Set<string>();
    for (const d of snap.d) {
      seenD.add(d.id);
      const existing = this.droppedLoot.get(d.id);
      if (!existing || existing.snap.top !== d.top || existing.snap.cnt !== d.cnt) {
        if (existing) this.scene.remove(existing.mesh);
        const mesh = createDroppedLootMesh(d.top, d.cnt);
        mesh.position.set(d.x, 0, d.y);
        this.scene.add(mesh);
        this.droppedLoot.set(d.id, { mesh, snap: d });
      }
    }
    for (const [id, entry] of this.droppedLoot.entries()) {
      if (!seenD.has(id)) {
        this.scene.remove(entry.mesh);
        this.droppedLoot.delete(id);
      }
    }

    // Events (noise rings, tracers, audio)
    for (const ev of snap.ev) {
      onAudioEvent(ev);
      if (ev.k === 'use') {
        const actor = this.players.get(ev.pid);
        if (actor) { actor.useTime = 0.85; actor.useItem = ev.item; setSurvivorWeapon(actor.rig, ev.item); }
      } else if (ev.k === 'shove') {
        const actor = this.players.get(ev.pid);
        if (actor) actor.shoveTime = 0.3;
      } else if (ev.k === 'noise') {
        this.spawnNoiseRing(ev.x, ev.y, ev.r);
      } else if (ev.k === 'shot') {
        this.spawnTracer(ev.x, ev.y, ev.x2, ev.y2);
      } else if (ev.k === 'hit') {
        this.spawnNoiseRing(ev.x, ev.y, 1.3, 0xd6453a, 0.28);
      }
    }
  }

  private spawnNoiseRing(x: number, y: number, maxRadius: number, color = 0xdbe6f0, maxAge = 0.55) {
    const geo = new THREE.RingGeometry(0.85, 1.0, 24);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.45 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, 0.08, y);
    this.scene.add(mesh);
    this.fxRings.push({ mesh, mat, age: 0, maxAge, maxRadius });
  }

  private spawnTracer(x1: number, y1: number, x2: number, y2: number) {
    const pts = [new THREE.Vector3(x1, 1.05, y1), new THREE.Vector3(x2, 1.0, y2)];
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({ color: 0xffd570, transparent: true, opacity: 0.95 });
    const line = new THREE.Line(geo, mat);
    this.scene.add(line);
    this.fxTracers.push({ line, mat, age: 0 });
  }

  render(dt: number, timeNow: number) {
    const interpAlpha = Math.min(1, dt * 14);
    const nightFactor = this.computeNightFactor(this.worldTimeMin);
    this.updateLighting(nightFactor);

    // Update players
    for (const entry of this.players.values()) {
      const movedDist = Math.hypot(entry.targetX - entry.curX, entry.targetY - entry.curY);
      entry.curX += (entry.targetX - entry.curX) * interpAlpha;
      entry.curY += (entry.targetY - entry.curY) * interpAlpha;
      entry.curAngle = lerpAngle(entry.curAngle, entry.targetAngle, interpAlpha);

      entry.rig.root.position.set(entry.curX, 0, entry.curY);
      entry.rig.root.rotation.y = -entry.curAngle;

      // Blend locomotion, item actions and hit reaction independently.
      const s = entry.lastSnap;
      entry.hitTime = Math.max(0, entry.hitTime - dt);
      entry.useTime = Math.max(0, entry.useTime - dt);
      entry.shoveTime = Math.max(0, entry.shoveTime - dt);
      if (entry.useTime === 0) setSurvivorWeapon(entry.rig, s.eq);
      const hit = Math.sin(entry.hitTime / 0.32 * Math.PI);
      entry.rig.body.position.x = -hit * 0.18;
      entry.rig.body.rotation.y = hit * 0.18;
      entry.rig.rightArm.position.x = entry.rig.leftArm.position.x = 0.05;
      entry.rig.rightArm.rotation.set(0, 0, 0);
      entry.rig.leftArm.rotation.set(0, 0, 0);
      if (s.dd) {
        entry.rig.body.rotation.z = Math.PI / 2;
        entry.rig.body.position.y = 0.25;
        entry.rig.leftLeg.rotation.z = entry.rig.rightLeg.rotation.z = 0;
      } else {
        const moving = movedDist > 0.01;
        const phase = timeNow * (s.sp ? 16 : s.sn ? 7 : 10);
        const stride = moving ? Math.sin(phase) * (s.sn ? 0.25 : 0.55) : 0;
        entry.rig.body.rotation.z = (s.sn ? -0.15 : s.sp ? -0.1 : 0) + hit * 0.35;
        entry.rig.body.position.y = (s.sn ? -0.18 : 0) + (moving ? Math.abs(Math.sin(phase)) * 0.035 : Math.sin(timeNow * 2) * 0.008);
        entry.rig.leftLeg.rotation.z = stride;
        entry.rig.rightLeg.rotation.z = -stride;
        const category = isItemId(s.eq) ? ITEMS[s.eq].category : undefined;
        const gun = category === 'gun';
        const melee = category === 'melee';
        entry.rig.leftArm.rotation.y = gun ? -0.35 : stride * 0.25;
        if (s.searching) {
          entry.rig.body.rotation.z = -0.2;
          entry.rig.body.position.y -= 0.16;
          entry.rig.rightArm.rotation.z = -0.6 + Math.sin(timeNow * 9) * 0.16;
          entry.rig.leftArm.rotation.z = -0.6 - Math.sin(timeNow * 9) * 0.16;
          entry.rig.rightArm.rotation.y = 0.35;
          entry.rig.leftArm.rotation.y = -0.35;
        } else if (entry.useTime > 0) {
          const lift = Math.sin((1 - entry.useTime / 0.85) * Math.PI);
          const drinking = ['water_bottle', 'soda', 'canned_food', 'chips', 'antibiotics'].includes(entry.useItem);
          entry.rig.rightArm.rotation.z = lift * (drinking ? 1.35 : -0.6);
          entry.rig.rightArm.rotation.y = lift * 0.7;
          entry.rig.leftArm.rotation.y = -lift * 0.65;
        } else if (entry.shoveTime > 0) {
          const push = Math.sin(entry.shoveTime / 0.3 * Math.PI);
          entry.rig.rightArm.position.x += push * 0.25;
          entry.rig.leftArm.position.x += push * 0.25;
          entry.rig.body.rotation.z -= push * 0.18;
        } else if (s.sw && s.sw > 0) {
          const duration = gun ? 0.16 : melee ? 0.25 : 0.22;
          const progress = 1 - Math.min(1, s.sw / duration);
          const pulse = Math.sin(progress * Math.PI);
          if (gun) {
            entry.rig.rightArm.position.x -= pulse * 0.18;
            entry.rig.rightArm.rotation.z = pulse * 0.3;
          } else if (s.eq === 'knife' || !melee) {
            entry.rig.rightArm.position.x += pulse * 0.34;
            entry.rig.body.rotation.y = -pulse * 0.2;
          } else {
            entry.rig.rightArm.rotation.y = -1.15 + progress * 2.3;
            entry.rig.rightArm.rotation.z = pulse * (s.eq === 'axe' ? -0.55 : 0.12);
            entry.rig.body.rotation.y = (-0.3 + progress * 0.6) * pulse;
          }
        }
      }

      if (s.sw) s.sw = Math.max(0, s.sw - dt);

      // Project nameplate to screen
      if (entry.rig.labelEl) {
        const proj = new THREE.Vector3(entry.curX, 1.95, entry.curY).project(this.camera);
        if (proj.z < 1) {
          const sx = (proj.x * 0.5 + 0.5) * window.innerWidth;
          const sy = (-proj.y * 0.5 + 0.5) * window.innerHeight;
          entry.rig.labelEl.style.left = `${sx}px`;
          entry.rig.labelEl.style.top = `${sy}px`;
          entry.rig.labelEl.style.display = 'block';
        } else {
          entry.rig.labelEl.style.display = 'none';
        }
      }
    }

    // Local player camera, roof cutaway, and vision cone
    const local = this.players.get(this.localId);
    if (local) {
      // Follow the already-interpolated player position with a fixed viewing angle.
      // Aim must not move the camera: it creates visible drift and aim feedback.
      this.camX = local.curX;
      this.camY = local.curY;

      this.camera.position.set(this.camX, 17.5 * this.camZoom, this.camY + 13.5 * this.camZoom);
      this.camera.lookAt(this.camX, 0.5, this.camY);

      this.sun.position.set(this.camX + 20, 34, this.camY + 16);
      this.sun.target.position.set(this.camX, 0, this.camY);
      this.sun.target.updateMatrixWorld();

      // Vision cone overlay follows player
      this.visionOverlay.position.set(local.curX, 0.05, local.curY);
      this.visionUniforms.uAngle.value = local.curAngle;
      const farRange = local.lastSnap.fl
        ? FLASHLIGHT_RANGE
        : nightFactor > 0.5
          ? VISION_RANGE_NIGHT
          : VISION_RANGE_DAY;
      this.visionUniforms.uFar.value = farRange;
      this.visionUniforms.uDark.value = 0.36 + nightFactor * 0.44;

      // Building roof fade when inside
      for (const b of this.buildingVisuals) {
        const inside =
          local.curX >= b.def.x - 0.5 &&
          local.curX <= b.def.x + b.def.w + 0.5 &&
          local.curY >= b.def.y - 0.5 &&
          local.curY <= b.def.y + b.def.h + 0.5;
        const targetOpacity = inside ? 0.08 : 1.0;
        for (const mat of b.roofMats) {
          mat.opacity += (targetOpacity - mat.opacity) * Math.min(1, dt * 10);
          mat.depthWrite = mat.opacity > 0.8;
        }
        b.roofGroup.visible = b.roofMats[0]!.opacity > 0.1;
      }
    }

    // Update zombies + line-of-sight stealth visibility
    for (const entry of this.zombies.values()) {
      entry.curX += (entry.targetX - entry.curX) * interpAlpha;
      entry.curY += (entry.targetY - entry.curY) * interpAlpha;
      entry.curAngle = lerpAngle(entry.curAngle, entry.targetAngle, interpAlpha);

      entry.rig.root.position.set(entry.curX, 0, entry.curY);
      entry.rig.root.rotation.y = -entry.curAngle;

      entry.hitTime = Math.max(0, entry.hitTime - dt);
      const flinch = Math.sin(entry.hitTime / 0.3 * Math.PI);
      entry.rig.body.position.x = -flinch * 0.22;
      if (entry.lastSnap.st === 'k') {
        entry.rig.body.rotation.z = Math.PI / 2;
        entry.rig.body.position.y = 0.25;
      } else {
        const attack = entry.lastSnap.st === 'a' ? Math.max(0, Math.sin(timeNow * 12)) : 0;
        entry.rig.body.rotation.z = flinch * 0.4 - attack * 0.22;
        entry.rig.body.position.y = Math.sin(timeNow * 7 + entry.lastSnap.id) * 0.025;
        const speed = entry.lastSnap.k === 'r' ? 14 : 7;
        const sway = Math.sin(timeNow * speed + entry.lastSnap.id) * 0.45;
        entry.rig.leftLeg.rotation.z = sway;
        entry.rig.rightLeg.rotation.z = -sway;
        entry.rig.leftArm.rotation.z = -attack * 0.45;
        entry.rig.rightArm.rotation.z = -attack * 0.45;
        entry.rig.leftArm.rotation.y = sway * 0.25;
        entry.rig.rightArm.rotation.y = -sway * 0.25;
      }

      // Hide zombies hidden behind walls unless within very close awareness radius
      if (local && this.town) {
        const dist = Math.hypot(entry.curX - local.curX, entry.curY - local.curY);
        const los = dist < 2.2 || hasLineOfSight(this.town, local.curX, local.curY, entry.curX, entry.curY);
        entry.rig.root.visible = los;
      }
    }

    // Animate campfire flames
    for (const entry of this.barricades.values()) {
      if (entry.snap.k === 'campfire') {
        const flame = entry.mesh.getObjectByName('flame');
        if (flame) {
          flame.scale.y = 0.85 + Math.sin(timeNow * 14) * 0.25;
        }
      }
    }

    // FX rings
    for (let i = this.fxRings.length - 1; i >= 0; i--) {
      const fx = this.fxRings[i]!;
      fx.age += dt;
      if (fx.age >= fx.maxAge) {
        this.scene.remove(fx.mesh);
        fx.mesh.geometry.dispose();
        fx.mat.dispose();
        this.fxRings.splice(i, 1);
      } else {
        const p = fx.age / fx.maxAge;
        const s = 0.4 + fx.maxRadius * p;
        fx.mesh.scale.set(s, 1, s);
        fx.mat.opacity = 0.45 * (1 - p);
      }
    }

    // FX tracers
    for (let i = this.fxTracers.length - 1; i >= 0; i--) {
      const tr = this.fxTracers[i]!;
      tr.age += dt;
      if (tr.age >= 0.12) {
        this.scene.remove(tr.line);
        tr.line.geometry.dispose();
        tr.mat.dispose();
        this.fxTracers.splice(i, 1);
      } else {
        tr.mat.opacity = 1 - tr.age / 0.12;
      }
    }

    this.renderer.render(this.scene, this.camera);
  }

  private computeNightFactor(worldTimeMin: number): number {
    // 0 = noon daylight, 1 = midnight darkness
    // Dawn 05:00-07:00 (300..420), Dusk 18:30-20:30 (1110..1230)
    if (worldTimeMin >= 420 && worldTimeMin <= 1110) return 0;
    if (worldTimeMin >= 1230 || worldTimeMin <= 300) return 1;
    if (worldTimeMin > 300 && worldTimeMin < 420) return 1 - (worldTimeMin - 300) / 120;
    return (worldTimeMin - 1110) / 120;
  }

  private updateLighting(nightFactor: number) {
    const dayBg = new THREE.Color(0x6c808f);
    const nightBg = new THREE.Color(0x0b1018);
    const bg = dayBg.lerp(nightBg, nightFactor);
    (this.scene.background as THREE.Color).copy(bg);
    if (this.scene.fog instanceof THREE.FogExp2) {
      this.scene.fog.color.copy(bg);
      this.scene.fog.density = 0.008 + nightFactor * 0.014;
    }

    this.sun.intensity = 1.45 * (1 - nightFactor * 0.85);
    this.ambient.intensity = 0.95 * (1 - nightFactor * 0.78);

    for (const sl of this.streetLights) {
      const near = Math.hypot(sl.light.parent!.position.x - this.camX, sl.light.parent!.position.z - this.camY) < 45;
      sl.light.visible = near && nightFactor > 0.35;
      sl.light.intensity = near && nightFactor > 0.35 ? 2.4 * nightFactor : 0;
      sl.bulbMat.color.setHex(nightFactor > 0.35 ? 0xffe090 : 0x5c6066);
    }
  }

  dispose() {
    window.removeEventListener('resize', this.onResize);
    this.renderer.dispose();
  }
}

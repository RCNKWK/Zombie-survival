import * as THREE from 'three';
import type { BuildKind, ItemId } from '../../../shared/items.js';
import type { BuildingDef, CarDef, ContainerDef, StreetLightDef, TreeDef } from '../../../shared/worldgen.js';

// Shared geometries/materials cache for crisp performance
const BOX = new THREE.BoxGeometry(1, 1, 1);
const CYL = new THREE.CylinderGeometry(0.5, 0.5, 1, 10);
const SPH = new THREE.SphereGeometry(0.5, 10, 8);

const SURVIVOR_SHIRTS = [0x3d6b8e, 0x8e4a3d, 0x4b7a52, 0x8a6d3b, 0x6b4f82, 0x3b7a78];

export function survivorColorForId(id: number): number {
  return SURVIVOR_SHIRTS[Math.abs(id) % SURVIVOR_SHIRTS.length]!;
}

export interface CharacterRig {
  root: THREE.Group;
  body: THREE.Group;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  leftLeg: THREE.Mesh;
  rightLeg: THREE.Mesh;
  weaponAnchor: THREE.Group;
  currentWeaponId: string;
  flashlight?: THREE.SpotLight;
  flashlightTarget?: THREE.Object3D;
  labelEl?: HTMLDivElement;
}

const DETAIL_MATERIALS = new Map<number, THREE.MeshStandardMaterial>();
function detail(parent: THREE.Object3D, color: number, scale: [number, number, number], position: [number, number, number], geometry: THREE.BufferGeometry = BOX) {
  let material = DETAIL_MATERIALS.get(color);
  if (!material) {
    material = new THREE.MeshStandardMaterial({ color, roughness: 0.72 });
    DETAIL_MATERIALS.set(color, material);
  }
  const mesh = new THREE.Mesh(geometry, material);
  mesh.scale.set(...scale);
  mesh.position.set(...position);
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}

const ITEM_MODELS = new Map<string, THREE.Group>();
function makeWeaponMesh(weaponId: string): THREE.Group {
  let model = ITEM_MODELS.get(weaponId);
  if (!model) {
    model = buildItemModel(weaponId);
    ITEM_MODELS.set(weaponId, model);
  }
  return model.clone(true);
}

function buildItemModel(weaponId: string): THREE.Group {
  const g = new THREE.Group();
  if (weaponId === 'baseball_bat') {
    const bat = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.03, 0.92, 8),
      new THREE.MeshStandardMaterial({ color: 0xb68652, roughness: 0.7 }),
    );
    bat.rotation.z = -Math.PI / 2;
    bat.position.x = 0.42;
    const grip = new THREE.Mesh(
      new THREE.CylinderGeometry(0.034, 0.032, 0.24, 8),
      new THREE.MeshStandardMaterial({ color: 0x22252a, roughness: 0.9 }),
    );
    grip.rotation.z = -Math.PI / 2;
    grip.position.x = 0.12;
    g.add(bat, grip);
  } else if (weaponId === 'crowbar') {
    const bar = new THREE.Mesh(BOX, new THREE.MeshStandardMaterial({ color: 0xa1332c, metalness: 0.6, roughness: 0.4 }));
    bar.scale.set(0.85, 0.06, 0.06);
    bar.position.x = 0.38;
    const hook = new THREE.Mesh(BOX, new THREE.MeshStandardMaterial({ color: 0xa1332c, metalness: 0.6, roughness: 0.4 }));
    hook.scale.set(0.14, 0.06, 0.16);
    hook.position.set(0.78, 0, 0.05);
    g.add(bar, hook);
  } else if (weaponId === 'axe') {
    const handle = new THREE.Mesh(BOX, new THREE.MeshStandardMaterial({ color: 0x8f5b34, roughness: 0.8 }));
    handle.scale.set(0.9, 0.06, 0.06);
    handle.position.x = 0.4;
    const blade = new THREE.Mesh(BOX, new THREE.MeshStandardMaterial({ color: 0xb8c2cc, metalness: 0.8, roughness: 0.3 }));
    blade.scale.set(0.22, 0.07, 0.28);
    blade.position.set(0.75, 0, 0.09);
    const edge = new THREE.Mesh(BOX, new THREE.MeshStandardMaterial({ color: 0xb3362e, roughness: 0.5 }));
    edge.scale.set(0.12, 0.075, 0.14);
    edge.position.set(0.75, 0, -0.02);
    g.add(handle, blade, edge);
  } else if (weaponId === 'knife') {
    const handle = new THREE.Mesh(BOX, new THREE.MeshStandardMaterial({ color: 0x26292e, roughness: 0.8 }));
    handle.scale.set(0.16, 0.045, 0.055);
    handle.position.x = 0.08;
    const blade = new THREE.Mesh(BOX, new THREE.MeshStandardMaterial({ color: 0xd0d6dc, metalness: 0.85, roughness: 0.25 }));
    blade.scale.set(0.32, 0.028, 0.065);
    blade.position.x = 0.3;
    g.add(handle, blade);
  } else if (weaponId === 'pistol') {
    const slide = new THREE.Mesh(BOX, new THREE.MeshStandardMaterial({ color: 0x262a30, metalness: 0.7, roughness: 0.35 }));
    slide.scale.set(0.36, 0.09, 0.06);
    slide.position.set(0.22, 0.03, 0);
    const grip = new THREE.Mesh(BOX, new THREE.MeshStandardMaterial({ color: 0x1b1d21, roughness: 0.8 }));
    grip.scale.set(0.1, 0.14, 0.06);
    grip.position.set(0.08, -0.04, 0);
    g.add(slide, grip);
  } else if (weaponId === 'shotgun') {
    const barrel = new THREE.Mesh(BOX, new THREE.MeshStandardMaterial({ color: 0x2f333a, metalness: 0.7, roughness: 0.35 }));
    barrel.scale.set(0.92, 0.08, 0.07);
    barrel.position.set(0.42, 0.02, 0);
    const stock = new THREE.Mesh(BOX, new THREE.MeshStandardMaterial({ color: 0x6b4328, roughness: 0.8 }));
    stock.scale.set(0.35, 0.11, 0.07);
    stock.position.set(0.08, -0.02, 0);
    g.add(barrel, stock);
  } else if (weaponId === 'flashlight') {
    const tube = new THREE.Mesh(CYL, new THREE.MeshStandardMaterial({ color: 0x22262b, metalness: 0.5, roughness: 0.4 }));
    tube.rotation.z = -Math.PI / 2;
    tube.scale.set(0.09, 0.34, 0.09);
    tube.position.x = 0.18;
    const head = new THREE.Mesh(CYL, new THREE.MeshStandardMaterial({ color: 0xe6c35c, emissive: 0x554411 }));
    head.rotation.z = -Math.PI / 2;
    head.scale.set(0.13, 0.08, 0.13);
    head.position.x = 0.36;
    g.add(tube, head);
  } else if (weaponId === 'medkit') {
    const box = new THREE.Mesh(BOX, new THREE.MeshStandardMaterial({ color: 0xf0f4f7, roughness: 0.4 }));
    box.scale.set(0.32, 0.22, 0.28);
    box.position.x = 0.18;
    const cross1 = new THREE.Mesh(BOX, new THREE.MeshStandardMaterial({ color: 0xd13232 }));
    cross1.scale.set(0.18, 0.24, 0.06);
    cross1.position.x = 0.18;
    const cross2 = new THREE.Mesh(BOX, new THREE.MeshStandardMaterial({ color: 0xd13232 }));
    cross2.scale.set(0.06, 0.24, 0.18);
    cross2.position.x = 0.18;
    g.add(box, cross1, cross2);
  } else if (weaponId === 'bandage' || weaponId === 'rag') {
    const roll = new THREE.Mesh(CYL, new THREE.MeshStandardMaterial({ color: weaponId === 'bandage' ? 0xf2f0e6 : 0xc9c2b2, roughness: 0.9 }));
    roll.scale.set(0.18, 0.16, 0.18);
    roll.position.x = 0.16;
    g.add(roll);
  } else if (weaponId === 'canned_food' || weaponId === 'soda') {
    const can = new THREE.Mesh(CYL, new THREE.MeshStandardMaterial({ color: weaponId === 'soda' ? 0xd43b3b : 0xb85c38, metalness: 0.35, roughness: 0.45 }));
    can.scale.set(0.16, 0.24, 0.16);
    can.position.x = 0.16;
    g.add(can);
  } else if (weaponId === 'water_bottle') {
    const bottle = new THREE.Mesh(CYL, new THREE.MeshStandardMaterial({ color: 0x4aa8e0, roughness: 0.25 }));
    bottle.scale.set(0.15, 0.3, 0.15);
    bottle.position.x = 0.16;
    const cap = new THREE.Mesh(CYL, new THREE.MeshStandardMaterial({ color: 0xeef3f7 }));
    cap.scale.set(0.08, 0.06, 0.08);
    cap.position.set(0.16, 0.17, 0);
    g.add(bottle, cap);
  } else if (weaponId === 'chips') {
    const bag = new THREE.Mesh(BOX, new THREE.MeshStandardMaterial({ color: 0xe39b2d, roughness: 0.6 }));
    bag.scale.set(0.22, 0.28, 0.1);
    bag.position.x = 0.16;
    g.add(bag);
  } else if (weaponId === 'antibiotics') {
    const vial = new THREE.Mesh(CYL, new THREE.MeshStandardMaterial({ color: 0xe8edf2, roughness: 0.35 }));
    vial.scale.set(0.13, 0.22, 0.13);
    vial.position.x = 0.15;
    const cap = new THREE.Mesh(CYL, new THREE.MeshStandardMaterial({ color: 0x3b72b8 }));
    cap.scale.set(0.14, 0.05, 0.14);
    cap.position.set(0.15, 0.12, 0);
    g.add(vial, cap);
  } else if (weaponId === 'wood_plank') {
    const plank = new THREE.Mesh(BOX, new THREE.MeshStandardMaterial({ color: 0xa67846, roughness: 0.88 }));
    plank.scale.set(0.68, 0.06, 0.18);
    plank.position.x = 0.32;
    g.add(plank);
  } else if (weaponId === 'ammo_9mm' || weaponId === 'ammo_12g' || weaponId === 'nails' || weaponId === 'scrap_metal') {
    const color = weaponId === 'ammo_12g' ? 0xb5322c : weaponId === 'ammo_9mm' ? 0xb89644 : 0x7b838c;
    const box = new THREE.Mesh(BOX, new THREE.MeshStandardMaterial({ color, metalness: 0.35, roughness: 0.5 }));
    box.scale.set(0.22, 0.14, 0.18);
    box.position.x = 0.16;
    g.add(box);
  } else if (weaponId === 'battery') {
    const cell = new THREE.Mesh(CYL, new THREE.MeshStandardMaterial({ color: 0xd9862b, metalness: 0.4, roughness: 0.4 }));
    cell.scale.set(0.1, 0.22, 0.1);
    cell.position.x = 0.15;
    g.add(cell);
  }
  // Small identifying details remain visible on the floor and in the hand.
  if (weaponId === 'water_bottle') {
    detail(g, 0xe7f5ed, [0.155, 0.09, 0.155], [0.16, 0, 0], CYL);
  } else if (weaponId === 'canned_food' || weaponId === 'soda') {
    detail(g, 0xc6cdd0, [0.165, 0.015, 0.165], [0.16, 0.125, 0], CYL);
    detail(g, 0xeee2bc, [0.165, 0.045, 0.165], [0.16, 0, 0], CYL);
  } else if (weaponId === 'chips') {
    detail(g, 0xf9e1a1, [0.14, 0.12, 0.105], [0.16, 0, 0]);
    detail(g, 0x9e4326, [0.23, 0.025, 0.105], [0.16, 0.13, 0]);
  } else if (weaponId === 'pistol' || weaponId === 'shotgun') {
    const muzzle = weaponId === 'pistol' ? 0.41 : 0.89;
    detail(g, 0x090d12, [0.018, 0.06, 0.05], [muzzle, 0.03, 0]);
    detail(g, 0xb5bbc2, [0.035, 0.035, 0.025], [muzzle - 0.06, 0.09, 0]);
    if (weaponId === 'shotgun') detail(g, 0x96623b, [0.25, 0.10, 0.1], [0.51, -0.04, 0]);
  } else if (weaponId === 'battery') {
    detail(g, 0x343b43, [0.105, 0.08, 0.105], [0.15, -0.07, 0], CYL);
    detail(g, 0xdce1e3, [0.045, 0.025, 0.045], [0.15, 0.12, 0], CYL);
  } else if (weaponId === 'nails') {
    for (let i = 0; i < 3; i++) detail(g, 0xe1e6e8, [0.12, 0.012, 0.012], [0.16, 0.08, (i - 1) * 0.045]);
  } else if (weaponId === 'ammo_9mm' || weaponId === 'ammo_12g') {
    for (let i = 0; i < 3; i++) detail(g, 0xe4c16a, [0.03, 0.07, 0.03], [0.1 + i * 0.055, 0.09, 0], CYL);
  } else if (weaponId === 'scrap_metal') {
    detail(g, 0xb1bbc2, [0.34, 0.025, 0.05], [0.14, 0.09, 0]).rotation.y = 0.6;
  } else if (weaponId === 'medkit') {
    detail(g, 0x3c4854, [0.14, 0.05, 0.05], [0.18, 0.14, 0]);
  }
  g.traverse(child => { if (child instanceof THREE.Mesh) child.castShadow = true; });
  return g;
}

export function createSurvivorRig(shirtColor: number, isLocal: boolean): CharacterRig {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const skinMat = new THREE.MeshStandardMaterial({ color: 0xe2b793, roughness: 0.75 });
  const shirtMat = new THREE.MeshStandardMaterial({ color: shirtColor, roughness: 0.7 });
  const pantsMat = new THREE.MeshStandardMaterial({ color: 0x2f3947, roughness: 0.85 });
  const packMat = new THREE.MeshStandardMaterial({ color: 0x525e42, roughness: 0.85 });
  const hairMat = new THREE.MeshStandardMaterial({ color: 0x2a1e17, roughness: 0.9 });

  // Legs
  const leftLeg = new THREE.Mesh(BOX, pantsMat);
  leftLeg.scale.set(0.22, 0.56, 0.22);
  leftLeg.position.set(0, 0.28, -0.13);
  leftLeg.castShadow = true;

  const rightLeg = new THREE.Mesh(BOX, pantsMat);
  rightLeg.scale.set(0.22, 0.56, 0.22);
  rightLeg.position.set(0, 0.28, 0.13);
  rightLeg.castShadow = true;
  body.add(leftLeg, rightLeg);

  // Torso
  const torso = new THREE.Mesh(BOX, shirtMat);
  torso.scale.set(0.34, 0.62, 0.5);
  torso.position.set(0, 0.86, 0);
  torso.castShadow = true;
  body.add(torso);

  // Backpack on back (-X)
  const pack = new THREE.Mesh(BOX, packMat);
  pack.scale.set(0.22, 0.46, 0.38);
  pack.position.set(-0.24, 0.88, 0);
  pack.castShadow = true;
  body.add(pack);

  // Head
  const head = new THREE.Mesh(BOX, skinMat);
  head.scale.set(0.34, 0.34, 0.34);
  head.position.set(0.02, 1.38, 0);
  head.castShadow = true;
  const hair = new THREE.Mesh(BOX, hairMat);
  hair.scale.set(0.36, 0.13, 0.36);
  hair.position.set(0, 1.54, 0);
  body.add(head, hair);

  // Arms
  const leftArm = new THREE.Group();
  leftArm.position.set(0.05, 1.05, -0.31);
  const leftArmMesh = new THREE.Mesh(BOX, shirtMat);
  leftArmMesh.scale.set(0.44, 0.17, 0.17);
  leftArmMesh.position.set(0.18, 0, 0);
  leftArmMesh.castShadow = true;
  leftArm.add(leftArmMesh);

  const rightArm = new THREE.Group();
  rightArm.position.set(0.05, 1.05, 0.31);
  const rightArmMesh = new THREE.Mesh(BOX, shirtMat);
  rightArmMesh.scale.set(0.44, 0.17, 0.17);
  rightArmMesh.position.set(0.18, 0, 0);
  rightArmMesh.castShadow = true;
  rightArm.add(rightArmMesh);

  const weaponAnchor = new THREE.Group();
  weaponAnchor.position.set(0.36, 0, 0);
  rightArm.add(weaponAnchor);
  body.add(leftArm, rightArm);

  // Face, gloves, jacket seams, utility belt and pack straps.
  detail(body, 0xd3a17f, [0.08, 0.09, 0.1], [0.22, 1.36, 0], SPH);
  for (const side of [-1, 1]) {
    detail(body, 0x242a30, [0.018, 0.045, 0.055], [0.195, 1.42, side * 0.095]);
    detail(body, 0xd3a17f, [0.09, 0.12, 0.07], [0.01, 1.37, side * 0.19], SPH);
    detail(body, 0x252f28, [0.045, 0.52, 0.055], [0.19, 0.9, side * 0.18]);
    detail(body, 0x74805a, [0.07, 0.18, 0.14], [0.2, 0.8, side * 0.13]);
  }
  detail(body, 0x252a2d, [0.36, 0.075, 0.51], [0, 0.58, 0]);
  detail(body, 0xb8a276, [0.025, 0.065, 0.085], [0.19, 0.58, 0]);
  detail(body, 0xb5a98b, [0.015, 0.45, 0.016], [0.18, 0.91, 0]);
  detail(body, 0x38442f, [0.08, 0.22, 0.28], [-0.37, 0.85, 0]);
  for (const arm of [leftArm, rightArm]) detail(arm, 0xd3a17f, [0.14, 0.16, 0.16], [0.4, 0, 0], SPH);
  // Child coordinates compensate for the leg's scale, so boots follow each stride.
  for (const leg of [leftLeg, rightLeg]) detail(leg, 0x20282c, [1.4, 0.26, 1.12], [0.18, -0.4, 0]);

  // Local player ring indicator
  if (isLocal) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.45, 0.55, 24),
      new THREE.MeshBasicMaterial({ color: 0xe6b84c, side: THREE.DoubleSide, transparent: true, opacity: 0.65 }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.03;
    root.add(ring);
  }

  // Flashlight spotlight
  const flashlight = new THREE.SpotLight(0xfff1cc, 0, 24, Math.PI / 4.2, 0.45, 1.3);
  flashlight.position.set(0.3, 1.1, 0);
  const flashlightTarget = new THREE.Object3D();
  flashlightTarget.position.set(10, 0.1, 0);
  flashlight.target = flashlightTarget;
  body.add(flashlight, flashlightTarget);

  return {
    root,
    body,
    leftArm,
    rightArm,
    leftLeg,
    rightLeg,
    weaponAnchor,
    currentWeaponId: '',
    flashlight,
    flashlightTarget,
  };
}

export function setSurvivorWeapon(rig: CharacterRig, weaponId: string) {
  if (rig.currentWeaponId === weaponId) return;
  rig.currentWeaponId = weaponId;
  while (rig.weaponAnchor.children.length > 0) {
    rig.weaponAnchor.remove(rig.weaponAnchor.children[0]!);
  }
  if (weaponId) {
    rig.weaponAnchor.add(makeWeaponMesh(weaponId));
  }
}

export interface ZombieRig {
  root: THREE.Group;
  body: THREE.Group;
  leftArm: THREE.Mesh;
  rightArm: THREE.Mesh;
  leftLeg: THREE.Mesh;
  rightLeg: THREE.Mesh;
  kind: 'w' | 'r' | 'b';
}

export function createZombieRig(kind: 'w' | 'r' | 'b'): ZombieRig {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const scale = kind === 'b' ? 1.28 : kind === 'r' ? 0.94 : 1.0;
  body.scale.setScalar(scale);

  const skinColor = kind === 'r' ? 0x8f7a72 : kind === 'b' ? 0x6f846b : 0x7c9674;
  const clothColor = kind === 'r' ? 0x612b28 : kind === 'b' ? 0x323b32 : 0x485662;
  const pantsColor = kind === 'b' ? 0x24282b : 0x333840;

  const skinMat = new THREE.MeshStandardMaterial({ color: skinColor, roughness: 0.85 });
  const clothMat = new THREE.MeshStandardMaterial({ color: clothColor, roughness: 0.9 });
  const pantsMat = new THREE.MeshStandardMaterial({ color: pantsColor, roughness: 0.9 });

  const leftLeg = new THREE.Mesh(BOX, pantsMat);
  leftLeg.scale.set(0.21, 0.54, 0.21);
  leftLeg.position.set(0, 0.27, -0.13);
  leftLeg.castShadow = true;

  const rightLeg = new THREE.Mesh(BOX, pantsMat);
  rightLeg.scale.set(0.21, 0.54, 0.21);
  rightLeg.position.set(0, 0.27, 0.13);
  rightLeg.castShadow = true;
  body.add(leftLeg, rightLeg);

  const torso = new THREE.Mesh(BOX, clothMat);
  torso.scale.set(0.35, 0.62, 0.5);
  torso.position.set(0, 0.85, 0);
  if (kind === 'r') torso.rotation.z = -0.22; // hunched forward
  torso.castShadow = true;
  body.add(torso);

  const head = new THREE.Mesh(BOX, skinMat);
  head.scale.set(0.33, 0.33, 0.33);
  head.position.set(kind === 'r' ? 0.1 : 0.02, 1.35, 0);
  head.castShadow = true;
  body.add(head);

  // Outstretched zombie arms pointing forward (+X)
  const leftArm = new THREE.Mesh(BOX, skinMat);
  leftArm.scale.set(0.52, 0.15, 0.15);
  leftArm.position.set(0.28, 1.02, -0.29);
  leftArm.castShadow = true;

  const rightArm = new THREE.Mesh(BOX, skinMat);
  rightArm.scale.set(0.52, 0.15, 0.15);
  rightArm.position.set(0.28, 1.02, 0.29);
  rightArm.castShadow = true;

  body.add(leftArm, rightArm);

  for (const side of [-1, 1]) {
    detail(body, 0xe7ce7e, [0.025, 0.04, 0.06], [kind === 'r' ? 0.27 : 0.19, 1.4, side * 0.09]);
    detail(body, 0x402621, [0.035, 0.13, 0.08], [0.19, 1.25, side * 0.08]);
    detail(body, 0x5f2825, [0.025, 0.24, 0.08], [0.185, 0.83, side * 0.14]);
  }
  detail(body, 0x292721, [0.19, 0.09, 0.31], [-0.08, 1.53, 0]);
  detail(body, 0x34322b, [0.15, 0.16, 0.12], [-0.15, 1.46, 0.11]);
  for (const leg of [leftLeg, rightLeg]) detail(leg, 0x232624, [1.3, 0.23, 1.12], [0.12, -0.4, 0]);
  detail(body, skinColor, [0.36, 0.13, 0.15], [0, 0.61, -0.16]);

  return { root, body, leftArm, rightArm, leftLeg, rightLeg, kind };
}

export interface BuildingVisual {
  def: BuildingDef;
  roofGroup: THREE.Group;
  roofMats: THREE.MeshStandardMaterial[];
}

export function createBuildingVisual(b: BuildingDef): BuildingVisual {
  const group = new THREE.Group();

  // Floor
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(b.w, b.h),
    new THREE.MeshStandardMaterial({ color: b.floorColor, roughness: 0.92 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(b.x + b.w / 2, 0.02, b.y + b.h / 2);
  floor.receiveShadow = true;
  group.add(floor);

  const wallMat = new THREE.MeshStandardMaterial({ color: 0xc5bfb2, roughness: 0.85 });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x52493f, roughness: 0.8 });

  for (const w of b.walls) {
    const mesh = new THREE.Mesh(BOX, wallMat);
    mesh.scale.set(w.w, 2.7, w.h);
    mesh.position.set(w.x + w.w / 2, 1.35, w.y + w.h / 2);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  // Door frame lintel
  for (const d of b.doors) {
    const lintel = new THREE.Mesh(BOX, trimMat);
    lintel.scale.set(d.w, 0.55, d.h);
    lintel.position.set(d.x + d.w / 2, 2.42, d.y + d.h / 2);
    group.add(lintel);
  }

  // Window highlights
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x6ca2b8,
    roughness: 0.2,
    metalness: 0.1,
    transparent: true,
    opacity: 0.6,
  });
  for (const win of b.windows) {
    const pane = new THREE.Mesh(BOX, glassMat);
    pane.scale.set(win.w + 0.06, 1.0, win.h + 0.06);
    pane.position.set(win.x + win.w / 2, 1.45, win.y + win.h / 2);
    group.add(pane);
  }

  // Roof group (fades when player is inside!)
  const roofGroup = new THREE.Group();
  const roofMat = new THREE.MeshStandardMaterial({
    color: b.roofColor,
    roughness: 0.88,
    transparent: true,
    opacity: 1,
  });
  const roof = new THREE.Mesh(BOX, roofMat);
  roof.scale.set(b.w + 0.4, 0.25, b.h + 0.4);
  roof.position.set(b.x + b.w / 2, 2.82, b.y + b.h / 2);
  roof.castShadow = true;
  roof.receiveShadow = true;
  roofGroup.add(roof);

  // Signboard stripe on roof edge
  const accentColor =
    b.theme === 'medical'
      ? 0xc93b3b
      : b.theme === 'police'
        ? 0x2f5f9e
        : b.theme === 'diner'
          ? 0xd6892f
          : b.theme === 'safehouse'
            ? 0x5c8f4f
            : 0x7c8691;
  const signMat = new THREE.MeshStandardMaterial({ color: accentColor, roughness: 0.6, transparent: true, opacity: 1 });
  const sign = new THREE.Mesh(BOX, signMat);
  sign.scale.set(Math.min(b.w * 0.6, 6), 0.3, 0.45);
  sign.position.set(b.x + b.w / 2, 3.05, b.y + b.h / 2);
  roofGroup.add(sign);

  group.add(roofGroup);
  return { def: b, roofGroup, roofMats: [roofMat, signMat] };
}

export function getBuildingGroup(vis: BuildingVisual): THREE.Group {
  return vis.roofGroup.parent as THREE.Group;
}

export function createContainerMesh(c: ContainerDef): THREE.Group {
  const g = new THREE.Group();
  g.position.set(c.x, 0, c.y);
  g.rotation.y = -c.angle;

  if (c.kind === 'car_trunk') {
    // Invisible interact marker attached over car
    return g;
  }

  if (c.kind === 'fridge') {
    const body = new THREE.Mesh(BOX, new THREE.MeshStandardMaterial({ color: 0xdfe4e8, roughness: 0.4 }));
    body.scale.set(0.95, 1.55, 0.95);
    body.position.y = 0.77;
    body.castShadow = true;
    g.add(body);
  } else if (c.kind === 'med_cabinet') {
    const body = new THREE.Mesh(BOX, new THREE.MeshStandardMaterial({ color: 0xeef2f5, roughness: 0.35 }));
    body.scale.set(0.95, 1.35, 0.75);
    body.position.y = 0.68;
    body.castShadow = true;
    const cross1 = new THREE.Mesh(BOX, new THREE.MeshStandardMaterial({ color: 0xc93636 }));
    cross1.scale.set(0.45, 0.14, 0.78);
    cross1.position.y = 0.85;
    const cross2 = new THREE.Mesh(BOX, new THREE.MeshStandardMaterial({ color: 0xc93636 }));
    cross2.scale.set(0.14, 0.45, 0.78);
    cross2.position.y = 0.85;
    g.add(body, cross1, cross2);
  } else if (c.kind === 'gun_locker') {
    const body = new THREE.Mesh(BOX, new THREE.MeshStandardMaterial({ color: 0x333c47, metalness: 0.5, roughness: 0.45 }));
    body.scale.set(1.0, 1.65, 0.8);
    body.position.y = 0.82;
    body.castShadow = true;
    g.add(body);
  } else if (c.kind === 'shelf') {
    const rack = new THREE.Mesh(BOX, new THREE.MeshStandardMaterial({ color: 0x6d6a62, roughness: 0.7 }));
    rack.scale.set(1.05, 1.35, 0.65);
    rack.position.y = 0.68;
    rack.castShadow = true;
    g.add(rack);
  } else {
    // Crate
    const crate = new THREE.Mesh(BOX, new THREE.MeshStandardMaterial({ color: 0x9c7244, roughness: 0.85 }));
    crate.scale.set(1.0, 0.95, 1.0);
    crate.position.y = 0.48;
    crate.castShadow = true;
    g.add(crate);
  }

  return g;
}

export function createCarMesh(car: CarDef): THREE.Group {
  const g = new THREE.Group();
  g.position.set(car.x, 0, car.y);
  g.rotation.y = -car.angle;

  // Determine length vs width: car.w / car.h in world coords
  const body = new THREE.Mesh(BOX, new THREE.MeshStandardMaterial({ color: car.color, roughness: 0.55, metalness: 0.25 }));
  body.scale.set(car.w * 0.94, 0.72, car.h * 0.94);
  body.position.y = 0.56;
  body.castShadow = true;
  body.receiveShadow = true;

  const cabin = new THREE.Mesh(BOX, new THREE.MeshStandardMaterial({ color: 0x262e36, roughness: 0.35 }));
  cabin.scale.set(car.w * 0.78, 0.54, car.h * 0.5);
  cabin.position.y = 1.15;
  cabin.castShadow = true;

  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x191b1f, roughness: 0.9 });
  const wx = car.w * 0.44;
  const wz = car.h * 0.33;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const w = new THREE.Mesh(CYL, wheelMat);
      w.rotation.z = Math.PI / 2;
      w.scale.set(0.55, 0.22, 0.55);
      w.position.set(sx * wx, 0.28, sz * wz);
      g.add(w);
    }
  }

  g.add(body, cabin);
  return g;
}

export function createTreeMesh(t: TreeDef): THREE.Group {
  const g = new THREE.Group();
  g.position.set(t.x, 0, t.y);

  const trunk = new THREE.Mesh(CYL, new THREE.MeshStandardMaterial({ color: 0x543c29, roughness: 0.92 }));
  trunk.scale.set(t.radius * 0.9, t.height * 0.5, t.radius * 0.9);
  trunk.position.y = t.height * 0.25;
  trunk.castShadow = true;

  const canopy = new THREE.Mesh(
    new THREE.ConeGeometry(t.radius * 3.1, t.height * 0.85, 7),
    new THREE.MeshStandardMaterial({ color: 0x2f5432, roughness: 0.9 }),
  );
  canopy.position.y = t.height * 0.72;
  canopy.castShadow = true;

  g.add(trunk, canopy);
  return g;
}

export function createStreetLightMesh(sl: StreetLightDef): { group: THREE.Group; light: THREE.PointLight; bulbMat: THREE.MeshBasicMaterial } {
  const g = new THREE.Group();
  g.position.set(sl.x, 0, sl.y);

  const pole = new THREE.Mesh(CYL, new THREE.MeshStandardMaterial({ color: 0x3b4046, metalness: 0.6, roughness: 0.5 }));
  pole.scale.set(0.18, 4.5, 0.18);
  pole.position.y = 2.25;
  pole.castShadow = true;

  const bulbMat = new THREE.MeshBasicMaterial({ color: 0xffe4a0 });
  const bulb = new THREE.Mesh(SPH, bulbMat);
  bulb.scale.setScalar(0.32);
  bulb.position.y = 4.55;

  const light = new THREE.PointLight(0xffcf7a, 0, 16, 1.5);
  light.position.y = 4.3;

  g.add(pole, bulb, light);
  return { group: g, light, bulbMat };
}

export function createBarricadeMesh(kind: BuildKind): THREE.Group {
  const g = new THREE.Group();
  if (kind === 'barricade') {
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x9b7042, roughness: 0.88 });
    const postL = new THREE.Mesh(BOX, woodMat);
    postL.scale.set(0.22, 1.25, 0.22);
    postL.position.set(-0.6, 0.62, 0);
    const postR = new THREE.Mesh(BOX, woodMat);
    postR.scale.set(0.22, 1.25, 0.22);
    postR.position.set(0.6, 0.62, 0);
    for (let i = 0; i < 3; i++) {
      const plank = new THREE.Mesh(BOX, woodMat);
      plank.scale.set(1.6, 0.24, 0.12);
      plank.position.set(0, 0.3 + i * 0.35, 0);
      plank.castShadow = true;
      g.add(plank);
    }
    g.add(postL, postR);
  } else if (kind === 'campfire') {
    const logMat = new THREE.MeshStandardMaterial({ color: 0x5c3c24, roughness: 0.9 });
    for (let i = 0; i < 3; i++) {
      const log = new THREE.Mesh(CYL, logMat);
      log.scale.set(0.16, 0.9, 0.16);
      log.rotation.z = Math.PI / 2;
      log.rotation.y = (i * Math.PI) / 3;
      log.position.y = 0.1;
      g.add(log);
    }
    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.28, 0.7, 6),
      new THREE.MeshBasicMaterial({ color: 0xff8a2b }),
    );
    flame.position.y = 0.42;
    flame.name = 'flame';
    const light = new THREE.PointLight(0xff7b29, 2.2, 14, 1.4);
    light.position.y = 0.7;
    g.add(flame, light);
  } else {
    // Spike trap
    const base = new THREE.Mesh(BOX, new THREE.MeshStandardMaterial({ color: 0x6e5338, roughness: 0.9 }));
    base.scale.set(1.4, 0.08, 1.4);
    base.position.y = 0.04;
    g.add(base);
    const spikeMat = new THREE.MeshStandardMaterial({ color: 0xaab4bd, metalness: 0.7, roughness: 0.3 });
    for (const sx of [-0.4, 0, 0.4]) {
      for (const sz of [-0.4, 0, 0.4]) {
        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.45, 5), spikeMat);
        spike.position.set(sx, 0.26, sz);
        g.add(spike);
      }
    }
  }
  return g;
}

export function createDroppedLootMesh(topItemId?: ItemId, count = 1): THREE.Group {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.42, 0.52, 18),
    new THREE.MeshBasicMaterial({ color: 0xffd266, side: THREE.DoubleSide, transparent: true, opacity: 0.78 }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.03;
  g.add(ring);

  if (topItemId) {
    const prop = makeWeaponMesh(topItemId);
    prop.scale.setScalar(1.35);
    prop.position.set(-0.24, 0.22, 0);
    prop.rotation.y = 0.4;
    prop.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) child.castShadow = true;
    });
    g.add(prop);
  }

  if (!topItemId || count > 1) {
    const bag = new THREE.Mesh(BOX, new THREE.MeshStandardMaterial({ color: 0x687353, roughness: 0.8 }));
    bag.scale.set(0.46, 0.22, 0.34);
    bag.position.set(topItemId ? 0.18 : 0, 0.11, topItemId ? 0.16 : 0);
    bag.castShadow = true;
    g.add(bag);
  }

  return g;
}

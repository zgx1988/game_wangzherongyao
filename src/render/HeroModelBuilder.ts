import * as THREE from 'three';
import { HeroId, MinionType, MonsterType, Team } from '../sim/types';

export interface ArticulatedModel {
  root: THREE.Group;
  body: THREE.Group;
  torso: THREE.Group;
  head: THREE.Group;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  leftLeg: THREE.Group;
  rightLeg: THREE.Group;
  capeOrTails?: THREE.Object3D;
  orbitGroup?: THREE.Group;
  enchantGlow?: THREE.Object3D;
  weapon?: THREE.Object3D;
}

function matMetal(color: number, roughness = 0.28, metalness = 0.78): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

function matCloth(color: number, roughness = 0.72): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.08 });
}

function matGlow(color: number, intensity = 1.6): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: intensity,
    roughness: 0.15,
    metalness: 0.1,
  });
}

function matSkin(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: 0xf6d5be, roughness: 0.58, metalness: 0.04 });
}

function enableShadows(obj: THREE.Object3D): void {
  obj.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
}

// Rebuild low-segment primitives with smoother geometry so models read as
// crafted characters instead of blocky placeholder shapes.
function highDetailGeometry(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const p = (geo as THREE.BufferGeometry & { parameters?: Record<string, number | boolean> }).parameters;
  if (!p) return geo;
  const t = geo.type;
  if (t === 'SphereGeometry' && ((p.widthSegments as number) < 20 || (p.heightSegments as number) < 12)) {
    return new THREE.SphereGeometry(
      p.radius as number,
      Math.max((p.widthSegments as number) || 8, 24),
      Math.max((p.heightSegments as number) || 6, 16),
      (p.phiStart as number) || 0,
      (p.phiLength as number) || Math.PI * 2,
      (p.thetaStart as number) || 0,
      (p.thetaLength as number) || Math.PI
    );
  }
  if (t === 'CylinderGeometry' && (p.radialSegments as number) < 16) {
    return new THREE.CylinderGeometry(
      p.radiusTop as number,
      p.radiusBottom as number,
      p.height as number,
      Math.max((p.radialSegments as number) || 8, 20),
      Math.max((p.heightSegments as number) || 1, 1),
      (p.openEnded as boolean) || false,
      (p.thetaStart as number) || 0,
      (p.thetaLength as number) || Math.PI * 2
    );
  }
  if (t === 'ConeGeometry' && (p.radialSegments as number) < 16) {
    return new THREE.ConeGeometry(
      p.radius as number,
      p.height as number,
      Math.max((p.radialSegments as number) || 6, 24),
      Math.max((p.heightSegments as number) || 1, 1),
      (p.openEnded as boolean) || false,
      (p.thetaStart as number) || 0,
      (p.thetaLength as number) || Math.PI * 2
    );
  }
  if (t === 'TorusGeometry' && (p.tubularSegments as number) < 32) {
    return new THREE.TorusGeometry(
      p.radius as number,
      p.tube as number,
      Math.max((p.radialSegments as number) || 8, 12),
      Math.max((p.tubularSegments as number) || 16, 40),
      (p.arc as number) || Math.PI * 2
    );
  }
  return geo;
}

function polishModel(root: THREE.Object3D): void {
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.isMesh) mesh.geometry = highDetailGeometry(mesh.geometry);
  });
}

// Stylized face so the heroes read as characters rather than dolls
function addFacialFeatures(head: THREE.Group): void {
  const face = head.children.find((c) => {
    const m = c as THREE.Mesh;
    const mat = m.material as THREE.MeshStandardMaterial | undefined;
    return m.isMesh && mat?.color && mat.color.getHex() === 0xf6d5be;
  }) as THREE.Mesh | undefined;
  if (!face) return;
  const r = ((face.geometry as THREE.BufferGeometry & { parameters?: { radius?: number } }).parameters?.radius ?? 0.31) as number;
  const fy = face.position.y;
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x1c1b26, roughness: 0.28, metalness: 0.05 });
  const browMat = new THREE.MeshStandardMaterial({ color: 0x2b2116, roughness: 0.62 });
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(r * 0.17, 14, 10), eyeMat);
    eye.scale.set(1, 1.25, 0.55);
    eye.position.set(s * r * 0.34, fy + r * 0.13, r * 0.94);
    head.add(eye);

    const glint = new THREE.Mesh(
      new THREE.SphereGeometry(r * 0.05, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xffffff })
    );
    glint.position.set(s * r * 0.34 + r * 0.055, fy + r * 0.2, r * 0.99);
    head.add(glint);

    const brow = new THREE.Mesh(new THREE.BoxGeometry(r * 0.36, r * 0.075, r * 0.1), browMat);
    brow.position.set(s * r * 0.34, fy + r * 0.4, r * 0.92);
    brow.rotation.z = s * 0.16;
    head.add(brow);
  }
  const noseMat = new THREE.MeshStandardMaterial({ color: 0xe7b79f, roughness: 0.55 });
  const nose = new THREE.Mesh(new THREE.ConeGeometry(r * 0.075, r * 0.2, 10), noseMat);
  nose.rotation.x = Math.PI * 0.5;
  nose.position.set(0, fy - r * 0.03, r * 0.95);
  head.add(nose);
  const mouth = new THREE.Mesh(
    new THREE.BoxGeometry(r * 0.26, r * 0.04, r * 0.07),
    new THREE.MeshStandardMaterial({ color: 0xb35a52, roughness: 0.65 })
  );
  mouth.position.set(0, fy - r * 0.42, r * 0.9);
  head.add(mouth);
}

export function buildHeroModel(heroId: HeroId): ArticulatedModel {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const torso = new THREE.Group();
  torso.position.y = 1.45;
  body.add(torso);

  const head = new THREE.Group();
  head.position.y = 1.05;
  torso.add(head);

  const leftArm = new THREE.Group();
  leftArm.position.set(-0.62, 0.72, 0);
  torso.add(leftArm);

  const rightArm = new THREE.Group();
  rightArm.position.set(0.62, 0.72, 0);
  torso.add(rightArm);

  const leftLeg = new THREE.Group();
  leftLeg.position.set(-0.26, 1.15, 0);
  body.add(leftLeg);

  const rightLeg = new THREE.Group();
  rightLeg.position.set(0.26, 1.15, 0);
  body.add(rightLeg);

  let capeOrTails: THREE.Object3D | undefined;
  let orbitGroup: THREE.Group | undefined;
  let enchantGlow: THREE.Object3D | undefined;
  let weapon: THREE.Object3D | undefined;

  if (heroId === 'arthur') {
    // === 圣光骑士 · 亚历克斯 (Golden-Blue Armored Paladin with Greatsword & Shield) ===
    const gold = matMetal(0xeab308, 0.25, 0.82);
    const steel = matMetal(0xdbeafe, 0.3, 0.72);
    const royalBlue = matCloth(0x1d4ed8, 0.62);
    const holyGlow = matGlow(0xfef08a, 1.8);

    // Armored Cuirass: tapered plate barrel with a raised breastplate
    const chest = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.38, 1.02, 24), gold);
    chest.position.y = 0.42;
    chest.scale.z = 0.8;
    torso.add(chest);
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.06, 12, 28), steel);
    collar.rotation.x = Math.PI / 2;
    collar.position.y = 0.92;
    torso.add(collar);

    const chestPlate = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.56, 0.2), steel);
    chestPlate.position.set(0, 0.5, 0.34);
    chestPlate.rotation.x = -0.05;
    torso.add(chestPlate);
    for (const trimY of [0.78, 0.22]) {
      const trim = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.06, 0.24), gold);
      trim.position.set(0, trimY, 0.34);
      torso.add(trim);
    }

    const chestGem = new THREE.Mesh(new THREE.OctahedronGeometry(0.16, 0), matGlow(0x38bdf8, 2.0));
    chestGem.position.set(0, 0.56, 0.49);
    torso.add(chestGem);

    // Waist tasset skirt with gold faulds
    const waist = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.6, 0.55, 20), royalBlue);
    waist.position.y = -0.18;
    torso.add(waist);
    const belt = new THREE.Mesh(new THREE.TorusGeometry(0.44, 0.075, 12, 28), gold);
    belt.rotation.x = Math.PI / 2;
    belt.position.y = 0.02;
    torso.add(belt);
    for (const [x, rz] of [[-0.3, 0.3], [0, 0], [0.3, -0.3]] as const) {
      const fauld = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.36, 0.07), gold);
      fauld.position.set(x, -0.35, 0.38);
      fauld.rotation.z = rz;
      torso.add(fauld);
    }

    // Massive Layered Pauldrons (Shoulder Armor)
    for (const [arm, sign] of [[leftArm, -1], [rightArm, 1]] as const) {
      const pauldron = new THREE.Mesh(new THREE.SphereGeometry(0.37, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.62), gold);
      pauldron.scale.set(1.14, 1.0, 1.14);
      pauldron.position.set(sign * 0.06, 0.14, 0);
      pauldron.rotation.z = -sign * 0.28;
      arm.add(pauldron);
      const pauldronRim = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.05, 12, 28), steel);
      pauldronRim.rotation.x = Math.PI / 2;
      pauldronRim.position.set(sign * 0.1, 0.02, 0);
      arm.add(pauldronRim);
      const pauldronSpike = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.26, 12), gold);
      pauldronSpike.position.set(sign * 0.3, 0.34, 0);
      pauldronSpike.rotation.z = -sign * 0.5;
      arm.add(pauldronSpike);

      const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.13, 0.48, 20), steel);
      upper.position.y = -0.3;
      arm.add(upper);

      const elbow = new THREE.Mesh(new THREE.SphereGeometry(0.15, 20, 14), gold);
      elbow.position.y = -0.57;
      arm.add(elbow);

      const bracer = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.15, 0.32, 20), gold);
      bracer.position.y = -0.76;
      arm.add(bracer);

      const fist = new THREE.Mesh(new THREE.SphereGeometry(0.14, 18, 12), steel);
      fist.position.set(0, -0.95, 0.03);
      arm.add(fist);
    }

    // Armored Legs & Sabatons
    for (const leg of [leftLeg, rightLeg]) {
      const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.16, 0.56, 20), royalBlue);
      thigh.position.y = -0.3;
      leg.add(thigh);
      const kneeCop = new THREE.Mesh(new THREE.SphereGeometry(0.17, 20, 14), gold);
      kneeCop.scale.z = 0.9;
      kneeCop.position.set(0, -0.62, 0.05);
      leg.add(kneeCop);
      const greave = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.21, 0.58, 20), steel);
      greave.position.y = -0.9;
      leg.add(greave);
      const bootTrim = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.04, 10, 24), gold);
      bootTrim.rotation.x = Math.PI / 2;
      bootTrim.position.y = -0.64;
      leg.add(bootTrim);
      const sabaton = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.16, 0.38), gold);
      sabaton.position.set(0, -1.1, 0.06);
      leg.add(sabaton);
    }

    // Heroic Knight Head + Winged Crown Helm
    const face = new THREE.Mesh(new THREE.SphereGeometry(0.33, 12, 10), matSkin());
    face.position.y = 0.25;
    head.add(face);
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.36, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.58), matCloth(0xfbbf24, 0.5));
    hair.position.set(0, 0.29, -0.04);
    head.add(hair);
    const crown = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.06, 6, 16), gold);
    crown.rotation.x = Math.PI / 2;
    crown.position.y = 0.42;
    head.add(crown);
    for (const s of [-1, 1]) {
      const wing = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.52, 24), gold);
      wing.position.set(s * 0.36, 0.5, -0.05);
      wing.rotation.z = -s * 0.7;
      wing.rotation.x = -0.3;
      head.add(wing);

      const cheek = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.16, 6, 16), gold);
      cheek.scale.set(1, 1, 0.7);
      cheek.position.set(s * 0.29, 0.13, 0.12);
      cheek.rotation.z = -s * 0.18;
      head.add(cheek);
    }
    const chinGuard = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.05, 0.06), gold);
    chinGuard.position.set(0, -0.03, 0.3);
    head.add(chinGuard);

    // Flowing Royal Blue Cape: curved cloth shell with a gold hem
    const capeGroup = new THREE.Group();
    capeGroup.position.set(0, -0.05, 0);
    const capeMat = new THREE.MeshStandardMaterial({
      color: 0x1d4ed8,
      roughness: 0.7,
      metalness: 0.06,
      side: THREE.DoubleSide,
    });
    const cape = new THREE.Mesh(
      new THREE.CylinderGeometry(0.52, 0.86, 1.5, 28, 4, true, Math.PI * 0.6, Math.PI * 0.8),
      capeMat
    );
    capeGroup.add(cape);
    const capeTrim = new THREE.Mesh(
      new THREE.CylinderGeometry(0.86, 0.89, 0.09, 28, 1, true, Math.PI * 0.6, Math.PI * 0.8),
      new THREE.MeshStandardMaterial({ color: 0xeab308, roughness: 0.26, metalness: 0.82, side: THREE.DoubleSide })
    );
    capeTrim.position.y = -0.71;
    capeGroup.add(capeTrim);
    torso.add(capeGroup);
    capeOrTails = capeGroup;

    // Ornate Holy Shield on Left Arm
    const shield = new THREE.Group();
    shield.position.set(-0.22, -0.65, 0.28);
    const shieldPlate = new THREE.Mesh(new THREE.CylinderGeometry(0.58, 0.42, 0.14, 6), gold);
    shieldPlate.rotation.x = Math.PI / 2;
    const shieldCore = new THREE.Mesh(new THREE.OctahedronGeometry(0.24, 0), matGlow(0x60a5fa, 1.5));
    shieldCore.position.z = 0.08;
    shield.add(shieldPlate, shieldCore);
    leftArm.add(shield);

    // Massive Gilded Holy Greatsword in Right Hand
    const sword = new THREE.Group();
    sword.position.set(0, -0.82, 0.25);
    sword.rotation.x = Math.PI * 0.36;
    const hilt = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.5, 8), gold);
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.14, 0.16), gold);
    guard.position.y = 0.24;
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.24, 1.95, 0.07), steel);
    blade.position.y = 1.24;
    const bladeTip = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.45, 4), steel);
    bladeTip.rotation.y = Math.PI / 4;
    bladeTip.position.y = 2.42;
    const runeEdge = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.75, 0.09), holyGlow);
    runeEdge.position.y = 1.22;
    sword.add(hilt, guard, blade, bladeTip, runeEdge);
    rightArm.add(sword);
    weapon = sword;

    // Orbiting S2 Holy Shields (toggled dynamically during S2!)
    orbitGroup = new THREE.Group();
    orbitGroup.position.y = 1.4;
    orbitGroup.visible = false;
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const orbShield = new THREE.Mesh(new THREE.OctahedronGeometry(0.55, 0), holyGlow);
      orbShield.scale.set(0.35, 1.2, 0.9);
      orbShield.position.set(Math.cos(a) * 3.6, 0, Math.sin(a) * 3.6);
      orbShield.rotation.y = -a;
      orbitGroup.add(orbShield);
    }
    root.add(orbitGroup);
  } else if (heroId === 'libai') {
    // === 青莲剑仙 · 沧澜 (Eastern Martial Swordsman in Flowing White-Azure Robes) ===
    const whiteRobe = matCloth(0xf1f5f9, 0.58);
    const azureSilk = matCloth(0x0284c7, 0.48);
    const darkTrim = matCloth(0x0f172a, 0.65);
    const silver = matMetal(0xe2e8f0, 0.2, 0.85);
    const jadeGlow = matGlow(0x38bdf8, 2.0);

    // Martial Tunic & Sash
    const chest = new THREE.Mesh(new THREE.CylinderGeometry(0.43, 0.35, 1.0, 20), whiteRobe);
    chest.position.y = 0.4;
    chest.scale.z = 0.85;
    torso.add(chest);
    const lapel = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.62, 0.14), azureSilk);
    lapel.position.set(0.04, 0.46, 0.3);
    lapel.rotation.z = 0.26;
    torso.add(lapel);
    const lapel2 = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.56, 0.12), whiteRobe);
    lapel2.position.set(-0.06, 0.44, 0.34);
    lapel2.rotation.z = -0.2;
    torso.add(lapel2);
    const waistSash = new THREE.Mesh(new THREE.CylinderGeometry(0.37, 0.37, 0.16, 20), azureSilk);
    waistSash.position.y = 0.02;
    torso.add(waistSash);
    const sashKnot = new THREE.Mesh(new THREE.SphereGeometry(0.1, 14, 10), azureSilk);
    sashKnot.position.set(0.3, 0.02, 0.28);
    torso.add(sashKnot);

    // Flowing Long Coat Tails
    const coat = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.68, 1.05, 8, 1, true), whiteRobe);
    coat.position.y = -0.4;
    torso.add(coat);

    // Waist Wine Gourd (酒葫芦 — iconic Li Bai detail!)
    const gourd = new THREE.Group();
    gourd.position.set(-0.46, -0.05, 0.18);
    const gBot = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 8), matMetal(0xd97706, 0.35, 0.4));
    const gTop = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), matMetal(0xd97706, 0.35, 0.4));
    gTop.position.y = 0.22;
    gourd.add(gBot, gTop);
    torso.add(gourd);

    // Wide Silk Sleeves
    for (const arm of [leftArm, rightArm]) {
      const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.25, 0.82, 8), whiteRobe);
      sleeve.position.y = -0.38;
      arm.add(sleeve);
      const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.26, 0.16, 20), azureSilk);
      cuff.position.y = -0.76;
      arm.add(cuff);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.085, 14, 10), matSkin());
      hand.position.y = -0.87;
      arm.add(hand);
    }

    for (const leg of [leftLeg, rightLeg]) {
      const pant = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.12, 1.1, 8), darkTrim);
      pant.position.y = -0.55;
      leg.add(pant);
    }

    // Handsome Swordsman Head + High Martial Ponytail + Hairpin
    const face = new THREE.Mesh(new THREE.SphereGeometry(0.31, 12, 10), matSkin());
    face.position.y = 0.24;
    head.add(face);
    const hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.33, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.56), darkTrim);
    hairCap.position.set(0, 0.28, -0.03);
    head.add(hairCap);
    const topknot = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.24, 8), darkTrim);
    topknot.position.set(0, 0.62, -0.08);
    head.add(topknot);
    const crownBand = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.03, 6, 12), silver);
    crownBand.rotation.x = Math.PI / 2;
    crownBand.position.set(0, 0.62, -0.08);
    head.add(crownBand);
    const ponytail = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.85, 6), darkTrim);
    ponytail.position.set(0, 0.26, -0.45);
    ponytail.rotation.x = 0.65;
    head.add(ponytail);

    // Floating Azure Silk Scarf!
    const scarf = new THREE.Mesh(new THREE.BoxGeometry(0.32, 1.65, 0.06), azureSilk);
    scarf.position.set(0.12, 0.1, -0.42);
    scarf.rotation.x = 0.35;
    torso.add(scarf);
    capeOrTails = scarf;

    // Azure Jade Spirit Sword (青莲剑)
    const sword = new THREE.Group();
    sword.position.set(0, -0.82, 0.2);
    sword.rotation.x = Math.PI * 0.42;
    const hilt = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.45, 8), silver);
    const guard = new THREE.Mesh(new THREE.OctahedronGeometry(0.18, 0), jadeGlow);
    guard.scale.set(1.8, 0.5, 0.6);
    guard.position.y = 0.24;
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.11, 2.05, 0.04), jadeGlow);
    blade.position.y = 1.28;
    sword.add(hilt, guard, blade);
    rightArm.add(sword);
    weapon = sword;
  } else if (heroId === 'daji') {
    // === 九尾灵狐 · 苏璃 (Crimson-Gold Spirit Fox Mage with Articulated Fluffy Glowing Tails!) ===
    const crimson = matCloth(0xe11d48, 0.55);
    const gold = matMetal(0xfbbf24, 0.25, 0.78);
    const pinkGlow = matGlow(0xf472b6, 1.7);
    const tailFur = new THREE.MeshStandardMaterial({
      color: 0xffe4e6,
      emissive: 0xfb7185,
      emissiveIntensity: 0.45,
      roughness: 0.55,
    });

    // Slender Ornate Mage Dress
    const bodice = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.28, 0.85, 20), crimson);
    bodice.position.y = 0.36;
    torso.add(bodice);
    const goldTrim = new THREE.Mesh(new THREE.TorusGeometry(0.31, 0.05, 12, 28), gold);
    goldTrim.rotation.x = Math.PI / 2;
    goldTrim.position.y = -0.02;
    torso.add(goldTrim);
    const skirt = new THREE.Mesh(new THREE.ConeGeometry(0.68, 0.85, 24), crimson);
    skirt.position.y = -0.4;
    torso.add(skirt);
    const hemTrim = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.045, 12, 32), gold);
    hemTrim.rotation.x = Math.PI / 2;
    hemTrim.position.y = -0.79;
    torso.add(hemTrim);
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.045, 12, 24), gold);
    collar.rotation.x = Math.PI / 2;
    collar.position.y = 0.78;
    torso.add(collar);
    const chestJewel = new THREE.Mesh(new THREE.OctahedronGeometry(0.1, 0), pinkGlow);
    chestJewel.position.set(0, 0.56, 0.3);
    torso.add(chestJewel);

    for (const arm of [leftArm, rightArm]) {
      const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.14, 0.75, 8), matSkin());
      sleeve.position.y = -0.35;
      arm.add(sleeve);
      const bangle = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.03, 12, 24), gold);
      bangle.rotation.x = Math.PI / 2;
      bangle.position.y = -0.62;
      arm.add(bangle);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.09, 14, 10), matSkin());
      hand.position.y = -0.76;
      arm.add(hand);
    }

    for (const leg of [leftLeg, rightLeg]) {
      const l = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.09, 1.08, 8), matSkin());
      l.position.y = -0.54;
      leg.add(l);
      const boot = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.13, 0.45, 8), crimson);
      boot.position.y = -0.88;
      leg.add(boot);
    }

    // Cute Fox Spirit Head + Fox Ears!
    const face = new THREE.Mesh(new THREE.SphereGeometry(0.31, 12, 10), matSkin());
    face.position.y = 0.22;
    head.add(face);
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.34, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.62), matCloth(0x4c0519, 0.5));
    hair.position.set(0, 0.26, -0.04);
    head.add(hair);
    // Iconic twin fox ears!
    for (const s of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.44, 5), matCloth(0xf43f5e, 0.6));
      ear.position.set(s * 0.24, 0.58, 0.02);
      ear.rotation.z = -s * 0.28;
      head.add(ear);
      const innerEar = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.28, 4), matCloth(0xffedd5, 0.7));
      innerEar.position.set(s * 0.24, 0.56, 0.08);
      innerEar.rotation.z = -s * 0.28;
      head.add(innerEar);
    }

    // 5 Lush Fanning Spirit Fox Tails!
    const tailGroup = new THREE.Group();
    tailGroup.position.set(0, 0.1, -0.18);
    for (let t = -2; t <= 2; t++) {
      const a = t * 0.46;
      const tail = new THREE.Group();
      tail.rotation.y = a;
      tail.rotation.x = -0.32 - Math.abs(t) * 0.08;
      const seg1 = new THREE.Mesh(new THREE.SphereGeometry(0.26, 20, 14), tailFur);
      seg1.scale.set(0.95, 2.1, 0.95);
      seg1.position.set(0, 0.58, -0.42);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.62, 20), pinkGlow);
      tip.position.set(0, 1.32, -0.56);
      tip.rotation.x = -0.18;
      tail.add(seg1, tip);
      tailGroup.add(tail);
    }
    torso.add(tailGroup);
    capeOrTails = tailGroup;

    // Floating Foxfire Spirit Orb hovering by Right Hand
    const orb = new THREE.Mesh(new THREE.OctahedronGeometry(0.26, 1), pinkGlow);
    orb.position.set(0.1, -0.82, 0.35);
    rightArm.add(orb);
    weapon = orb;
  } else if (heroId === 'houyi') {
    // === 逐日神射 · 羿风 (Solar Archer with Radiant Golden Longbow & Sun Crown) ===
    const sunGold = matMetal(0xf59e0b, 0.24, 0.8);
    const scarlet = matCloth(0xb91c1c, 0.58);
    const darkArmor = matMetal(0x334155, 0.42, 0.65);
    const solarGlow = matGlow(0xfde047, 2.0);

    const chest = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.36, 0.98, 20), sunGold);
    chest.position.y = 0.4;
    chest.scale.z = 0.82;
    torso.add(chest);
    const sash = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.66, 0.18), scarlet);
    sash.position.set(0, 0.42, 0.31);
    sash.rotation.z = 0.12;
    torso.add(sash);
    const sashTrim = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.07, 0.22), sunGold);
    sashTrim.position.set(0, 0.74, 0.31);
    torso.add(sashTrim);
    const tasset = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.55, 0.6, 20), scarlet);
    tasset.position.y = -0.2;
    torso.add(tasset);
    const archerBelt = new THREE.Mesh(new THREE.TorusGeometry(0.38, 0.06, 12, 28), sunGold);
    archerBelt.rotation.x = Math.PI / 2;
    archerBelt.position.y = 0.02;
    torso.add(archerBelt);

    // Sun Quiver + Golden Halo on Back
    const halo = new THREE.Mesh(new THREE.TorusGeometry(0.68, 0.06, 8, 24), solarGlow);
    halo.position.set(0, 0.62, -0.4);
    torso.add(halo);
    capeOrTails = halo;

    for (const [arm, sign] of [[leftArm, -1], [rightArm, 1]] as const) {
      const sh = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.45, 5), sunGold);
      sh.position.set(sign * 0.1, 0.12, 0);
      sh.rotation.z = -sign * 0.8;
      arm.add(sh);
      const a = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.12, 0.78, 20), darkArmor);
      a.position.y = -0.38;
      arm.add(a);
      const bracer = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.035, 10, 22), sunGold);
      bracer.rotation.x = Math.PI / 2;
      bracer.position.y = -0.7;
      arm.add(bracer);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.1, 14, 10), matSkin());
      hand.position.y = -0.82;
      arm.add(hand);
    }

    for (const leg of [leftLeg, rightLeg]) {
      const l = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.14, 1.12, 8), darkArmor);
      l.position.y = -0.56;
      leg.add(l);
      const shin = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.16, 0.55, 8), sunGold);
      shin.position.y = -0.86;
      leg.add(shin);
    }

    // Archer Head + Radiant Solar Feathered Crown
    const face = new THREE.Mesh(new THREE.SphereGeometry(0.31, 12, 10), matSkin());
    face.position.y = 0.24;
    head.add(face);
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.34, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.58), matCloth(0x92400e, 0.6));
    hair.position.set(0, 0.28, -0.04);
    head.add(hair);
    for (let k = -1; k <= 1; k++) {
      const plume = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.5, 4), solarGlow);
      plume.position.set(k * 0.18, 0.66, 0.08);
      plume.rotation.z = -k * 0.35;
      head.add(plume);
    }

    // Giant Curved Solar Energy Longbow on Left Hand!
    const bow = new THREE.Group();
    bow.position.set(-0.1, -0.68, 0.42);
    const arc = new THREE.Mesh(new THREE.TorusGeometry(0.88, 0.075, 8, 20, Math.PI * 1.15), sunGold);
    arc.rotation.z = -Math.PI * 0.57;
    const energyString = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.65, 6), solarGlow);
    energyString.position.x = -0.18;
    const sunArrow = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.35, 6), solarGlow);
    sunArrow.rotation.x = Math.PI / 2;
    sunArrow.position.z = 0.25;
    bow.add(arc, energyString, sunArrow);
    leftArm.add(bow);
    weapon = bow;
  } else if (heroId === 'lubu') {
    // === 破军战神 · 骁勇 (Imposing Demon General with Twin Plumes & Crescent Halberd 方天画戟!) ===
    const obsidian = matMetal(0x1e1b4b, 0.32, 0.8);
    const crimsonArmor = matMetal(0x991b1b, 0.3, 0.72);
    const gold = matMetal(0xd97706, 0.28, 0.82);
    const demonGlow = matGlow(0xf43f5e, 1.9);

    root.scale.setScalar(1.12); // Towering warlord stature!

    const chest = new THREE.Mesh(new THREE.CylinderGeometry(0.56, 0.44, 1.1, 24), obsidian);
    chest.position.y = 0.44;
    chest.scale.z = 0.82;
    torso.add(chest);
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.62, 0.2), crimsonArmor);
    plate.position.set(0, 0.52, 0.4);
    torso.add(plate);
    const plateTrim = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.07, 0.24), gold);
    plateTrim.position.set(0, 0.87, 0.4);
    torso.add(plateTrim);
    const demonGem = new THREE.Mesh(new THREE.OctahedronGeometry(0.14, 0), demonGlow);
    demonGem.position.set(0, 0.6, 0.52);
    torso.add(demonGem);
    const skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.68, 0.68, 24), crimsonArmor);
    skirt.position.y = -0.22;
    torso.add(skirt);
    const warbelt = new THREE.Mesh(new THREE.TorusGeometry(0.48, 0.07, 12, 28), gold);
    warbelt.rotation.x = Math.PI / 2;
    warbelt.position.y = 0.04;
    torso.add(warbelt);

    for (const [arm, sign] of [[leftArm, -1], [rightArm, 1]] as const) {
      const pauldron = new THREE.Mesh(new THREE.SphereGeometry(0.4, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.6), obsidian);
      pauldron.scale.set(1.15, 1, 1.15);
      pauldron.position.set(sign * 0.1, 0.18, 0);
      pauldron.rotation.z = -sign * 0.24;
      arm.add(pauldron);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.055, 12, 28), gold);
      rim.rotation.x = Math.PI / 2;
      rim.position.set(sign * 0.12, 0.03, 0);
      arm.add(rim);
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.56, 16), crimsonArmor);
      spike.position.set(sign * 0.36, 0.38, 0);
      spike.rotation.z = -sign * 0.65;
      arm.add(spike);
      const a = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.15, 0.62, 20), obsidian);
      a.position.y = -0.36;
      arm.add(a);
      const bracer = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.17, 0.34, 20), crimsonArmor);
      bracer.position.y = -0.75;
      arm.add(bracer);
      const fist = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 12), gold);
      fist.position.y = -0.95;
      arm.add(fist);
    }

    for (const leg of [leftLeg, rightLeg]) {
      const l = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.18, 1.15, 8), obsidian);
      l.position.y = -0.58;
      leg.add(l);
      const knee = new THREE.Mesh(new THREE.OctahedronGeometry(0.18, 0), gold);
      knee.position.set(0, -0.55, 0.16);
      leg.add(knee);
    }

    // Fierce Warlord Head + Iconic Towering Twin Pheasant Plumes (紫金冠双翎!)
    const face = new THREE.Mesh(new THREE.SphereGeometry(0.33, 12, 10), matSkin());
    face.position.y = 0.25;
    head.add(face);
    const helm = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.34, 0.4, 8), gold);
    helm.position.y = 0.52;
    head.add(helm);
    for (const s of [-1, 1]) {
      const plumeCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(s * 0.14, 0.68, -0.05),
        new THREE.Vector3(s * 0.42, 1.35, -0.35),
        new THREE.Vector3(s * 0.65, 1.65, -0.95),
      ]);
      const plume = new THREE.Mesh(new THREE.TubeGeometry(plumeCurve, 10, 0.055, 6, false), demonGlow);
      head.add(plume);
    }

    // Tattered Fiery War Cape
    const cape = new THREE.Mesh(new THREE.BoxGeometry(1.05, 1.68, 0.08), crimsonArmor);
    cape.position.set(0, -0.05, -0.48);
    cape.rotation.x = 0.24;
    torso.add(cape);
    capeOrTails = cape;

    // Massive Sky-Piercer Halberd (方天画戟!)
    const halberd = new THREE.Group();
    halberd.position.set(0, -0.8, 0.25);
    halberd.rotation.x = Math.PI * 0.36;
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 3.1, 8), obsidian);
    shaft.position.y = 0.9;
    const spearTip = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.72, 4), matMetal(0xe2e8f0, 0.18, 0.9));
    spearTip.position.y = 2.75;
    const crescent = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.08, 6, 14, Math.PI), demonGlow);
    crescent.position.set(0.22, 2.25, 0);
    crescent.rotation.z = -Math.PI / 2;
    const crescent2 = new THREE.Mesh(new THREE.TorusGeometry(0.38, 0.07, 6, 14, Math.PI), demonGlow);
    crescent2.position.set(-0.2, 2.25, 0);
    crescent2.rotation.z = Math.PI / 2;
    halberd.add(shaft, spearTip, crescent, crescent2);
    rightArm.add(halberd);
    weapon = halberd;

    // Enchantment Demon Crown Aura (lights up when S1 hits an enemy hero!)
    const aura = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.09, 8, 24), demonGlow);
    aura.rotation.x = Math.PI / 2;
    aura.position.y = 0.2;
    aura.visible = false;
    root.add(aura);
    enchantGlow = aura;
  } else {
    // === 瑶光圣女 · 璃月 (Celestial Jade-Gold Healer Floating on a Glowing Lotus Throne!) ===
    const jade = matCloth(0x14b8a6, 0.5);
    const gold = matMetal(0xfde047, 0.24, 0.8);
    const starGlow = matGlow(0x5eead4, 1.8);

    // Floating Glowing Jade Lotus Cradle / Throne!
    const lotus = new THREE.Group();
    lotus.position.y = 0.75;
    const centerPad = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.65, 0.35, 10), gold);
    lotus.add(centerPad);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const petal = new THREE.Mesh(new THREE.ConeGeometry(0.38, 0.95, 5), jade);
      petal.position.set(Math.cos(a) * 0.9, 0.25, Math.sin(a) * 0.9);
      petal.rotation.z = -Math.cos(a) * 0.75;
      petal.rotation.x = Math.sin(a) * 0.75;
      lotus.add(petal);
    }
    const lotusRing = new THREE.Mesh(new THREE.TorusGeometry(1.18, 0.06, 8, 28), starGlow);
    lotusRing.rotation.x = Math.PI / 2;
    lotusRing.position.y = 0.1;
    lotus.add(lotusRing);
    body.add(lotus);

    // Celestial Maiden seated gracefully inside Lotus
    torso.position.y = 1.55;
    const dress = new THREE.Mesh(new THREE.ConeGeometry(0.55, 0.95, 10), jade);
    dress.position.y = 0.1;
    torso.add(dress);
    const ribbon = new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.055, 6, 20, Math.PI * 1.4), starGlow);
    ribbon.position.set(0, 0.75, -0.22);
    ribbon.rotation.z = -0.6;
    torso.add(ribbon);
    capeOrTails = ribbon;

    for (const arm of [leftArm, rightArm]) {
      const a = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 0.68, 20), jade);
      a.position.y = -0.32;
      arm.add(a);
      const bracelet = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.03, 10, 22), gold);
      bracelet.rotation.x = Math.PI / 2;
      bracelet.position.y = -0.58;
      arm.add(bracelet);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.085, 14, 10), matSkin());
      hand.position.y = -0.7;
      arm.add(hand);
    }

    const face = new THREE.Mesh(new THREE.SphereGeometry(0.32, 12, 10), matSkin());
    face.position.y = 0.22;
    head.add(face);
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.35, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.6), matCloth(0x134e4a, 0.55));
    hair.position.set(0, 0.26, -0.04);
    head.add(hair);
    // Cute Twin Celestial Hair Buns + Jade Ornaments
    for (const s of [-1, 1]) {
      const bun = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 8), matCloth(0x134e4a, 0.55));
      bun.position.set(s * 0.3, 0.52, -0.04);
      head.add(bun);
      const pin = new THREE.Mesh(new THREE.OctahedronGeometry(0.08, 0), gold);
      pin.position.set(s * 0.36, 0.58, 0.02);
      head.add(pin);
    }

    // Floating Celestial Lantern-Harp in front
    const harp = new THREE.Mesh(new THREE.TorusGeometry(0.38, 0.055, 6, 16), gold);
    harp.position.set(0, 0.2, 0.65);
    torso.add(harp);
    weapon = harp;
  }

  addFacialFeatures(head);
  polishModel(root);
  enableShadows(root);
  return {
    root,
    body,
    torso,
    head,
    leftArm,
    rightArm,
    leftLeg,
    rightLeg,
    capeOrTails,
    orbitGroup,
    enchantGlow,
    weapon,
  };
}

export function animateHeroModel(
  model: ArticulatedModel,
  animState: string,
  elapsed: number,
  speedRatio: number,
  opts?: { arthurShields?: boolean; lubuEnchant?: boolean; knockup?: boolean }
): void {
  const t = elapsed;

  if (model.orbitGroup) {
    model.orbitGroup.visible = Boolean(opts?.arthurShields);
    if (model.orbitGroup.visible) {
      model.orbitGroup.rotation.y = t * 5.8;
    }
  }
  if (model.enchantGlow) {
    model.enchantGlow.visible = Boolean(opts?.lubuEnchant);
    if (model.enchantGlow.visible) {
      model.enchantGlow.rotation.z = t * 2.5;
    }
  }

  if (animState === 'dead') {
    model.body.rotation.x = -Math.PI * 0.48;
    model.body.position.y = 0.25;
    return;
  }

  model.body.rotation.x = 0;
  const knockY = opts?.knockup ? 2.4 + Math.sin(t * 16) * 0.3 : 0;

  if (animState === 'run' && speedRatio > 0.1) {
    const stride = Math.sin(t * 11.5);
    model.leftLeg.rotation.x = stride * 0.72;
    model.rightLeg.rotation.x = -stride * 0.72;
    model.leftArm.rotation.x = -stride * 0.55;
    model.rightArm.rotation.x = stride * 0.55;
    model.body.position.y = Math.abs(Math.cos(t * 11.5)) * 0.16 + knockY;
    model.torso.rotation.y = stride * 0.12;
  } else if (animState === 'attack' || animState.startsWith('cast')) {
    const swing = Math.sin(t * 22);
    model.rightArm.rotation.x = -1.35 + swing * 1.15;
    model.leftArm.rotation.x = -0.45 - swing * 0.4;
    model.torso.rotation.y = swing * 0.48;
    model.leftLeg.rotation.x = 0.25;
    model.rightLeg.rotation.x = -0.25;
    model.body.position.y = (animState === 'cast3' ? 0.55 : 0.1) + knockY;
  } else if (animState === 'recall') {
    model.body.position.y = 0.45 + Math.sin(t * 4) * 0.18;
    model.leftArm.rotation.x = -0.9;
    model.rightArm.rotation.x = -0.9;
    model.leftLeg.rotation.x = 0;
    model.rightLeg.rotation.x = 0;
    model.torso.rotation.y = Math.sin(t * 3) * 0.15;
  } else {
    // Graceful idle breathing
    model.leftLeg.rotation.x *= 0.82;
    model.rightLeg.rotation.x *= 0.82;
    model.leftArm.rotation.x = Math.sin(t * 2.4) * 0.07;
    model.rightArm.rotation.x = -Math.sin(t * 2.4) * 0.07;
    model.torso.rotation.y = Math.sin(t * 1.8) * 0.06;
    model.body.position.y = Math.sin(t * 3.0) * 0.07 + knockY;
  }

  if (model.capeOrTails) {
    model.capeOrTails.rotation.z = Math.sin(t * 4.5) * 0.12;
  }
}

export function buildMinionModel(team: Team, type: MinionType): THREE.Group {
  const g = new THREE.Group();
  const teamCol = team === 'blue' ? 0x2563eb : 0xdc2626;
  const accent = team === 'blue' ? 0x60a5fa : 0xfb7185;
  const armorMat = matMetal(teamCol, 0.4, 0.65);
  const goldMat = matMetal(0xd9a441, 0.3, 0.75);
  const glowMat = matGlow(accent, 1.3);

  if (type === 'cannon') {
    // Wheeled Siege Cannon Chariot!
    const cart = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.7, 1.6), matCloth(0x6b4423, 0.8));
    cart.position.y = 0.65;
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.34, 1.5, 8), matMetal(0x334155, 0.35, 0.8));
    barrel.rotation.x = Math.PI * 0.44;
    barrel.position.set(0, 1.18, 0.22);
    const muzzle = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.05, 6, 12), glowMat);
    muzzle.position.set(0, 1.32, 0.94);
    g.add(cart, barrel, muzzle);
    for (const sx of [-0.72, 0.72]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.14, 10), goldMat);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(sx, 0.45, 0);
      g.add(wheel);
    }
  } else if (type === 'vanguard') {
    // Winged Overlord Vanguard Dragon!
    const body = new THREE.Mesh(new THREE.OctahedronGeometry(0.95, 1), matMetal(0x4c1d95, 0.3, 0.7));
    body.position.y = 1.85;
    body.scale.set(0.9, 0.8, 1.4);
    const crest = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.9, 5), glowMat);
    crest.rotation.x = Math.PI * 0.4;
    crest.position.set(0, 2.25, 1.0);
    for (const s of [-1, 1]) {
      const wing = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.1, 0.85), glowMat);
      wing.position.set(s * 1.35, 2.0, 0);
      wing.rotation.z = s * 0.28;
      g.add(wing);
    }
    g.add(body, crest);
  } else {
    const scale = type === 'super' ? 1.48 : 1.0;
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.52, 1.15, 7), armorMat);
    body.position.y = 0.75;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.32, 8, 8), type === 'super' ? goldMat : armorMat);
    head.position.y = 1.5;
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.12, 0.2), glowMat);
    visor.position.set(0, 1.52, 0.26);
    g.add(body, head, visor);

    if (type === 'ranged') {
      const hat = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.65, 6), armorMat);
      hat.position.y = 1.95;
      const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.7, 6), goldMat);
      staff.position.set(0.48, 1.05, 0.25);
      const orb = new THREE.Mesh(new THREE.OctahedronGeometry(0.18, 0), glowMat);
      orb.position.set(0.48, 1.95, 0.25);
      g.add(hat, staff, orb);
    } else {
      const shield = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.85, 0.65), goldMat);
      shield.position.set(-0.52, 0.9, 0.22);
      const spear = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1.9, 6), goldMat);
      spear.position.set(0.5, 1.1, 0.28);
      spear.rotation.x = 0.4;
      g.add(shield, spear);
    }
    g.scale.setScalar(scale);
  }

  polishModel(g);
  enableShadows(g);
  return g;
}

export function buildMonsterModel(type: MonsterType): THREE.Group {
  const g = new THREE.Group();

  if (type === 'red_buff' || type === 'blue_buff') {
    const isRed = type === 'red_buff';
    const rockCol = isRed ? 0x451a1a : 0x172554;
    const coreCol = isRed ? 0xf97316 : 0x38bdf8;
    const rockMat = matMetal(rockCol, 0.78, 0.22);
    const coreMat = matGlow(coreCol, 2.0);

    // Towering Elemental Stone Golem!
    const torso = new THREE.Mesh(new THREE.DodecahedronGeometry(1.35, 0), rockMat);
    torso.position.y = 2.15;
    torso.scale.set(1.15, 1.25, 0.95);
    const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.68, 0), coreMat);
    core.position.set(0, 2.2, 0.85);
    const head = new THREE.Mesh(new THREE.DodecahedronGeometry(0.65, 0), rockMat);
    head.position.set(0, 3.6, 0.25);
    const eye = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.16, 0.2), coreMat);
    eye.position.set(0, 3.65, 0.78);
    g.add(torso, core, head, eye);

    for (const s of [-1, 1]) {
      const shoulder = new THREE.Mesh(new THREE.DodecahedronGeometry(0.72, 0), rockMat);
      shoulder.position.set(s * 1.65, 2.85, 0);
      const fist = new THREE.Mesh(new THREE.DodecahedronGeometry(0.62, 0), rockMat);
      fist.position.set(s * 1.8, 1.3, 0.4);
      const rune = new THREE.Mesh(new THREE.OctahedronGeometry(0.32, 0), coreMat);
      rune.position.set(s * 1.8, 2.05, 0.4);
      g.add(shoulder, fist, rune);
    }
    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.05, 0.08, 8, 28), coreMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.25;
    g.add(ring);
  } else if (type === 'tyrant' || type === 'overlord') {
    const isTyrant = type === 'tyrant';
    const bodyCol = isTyrant ? 0x3b0764 : 0x451a03;
    const glowCol = isTyrant ? 0xc084fc : 0xfbbf24;
    const scaleMat = matMetal(bodyCol, 0.35, 0.65);
    const glowMat = matGlow(glowCol, 2.1);

    // Majestic Boss Dragon (暗影暴君 / 暗影主宰)!
    const torso = new THREE.Mesh(new THREE.DodecahedronGeometry(1.9, 1), scaleMat);
    torso.scale.set(1.05, 0.9, 1.45);
    torso.position.y = 2.6;
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.9, 2.2, 8), scaleMat);
    neck.position.set(0, 4.1, 1.45);
    neck.rotation.x = 0.45;
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.95, 2.1, 6), scaleMat);
    head.rotation.x = Math.PI * 0.52;
    head.position.set(0, 4.95, 2.55);
    const eyes = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.22, 0.3), glowMat);
    eyes.position.set(0, 5.15, 2.75);

    // Towering Dragon Horns & Wings!
    for (const s of [-1, 1]) {
      const horn = new THREE.Mesh(new THREE.ConeGeometry(0.22, 1.65, 5), glowMat);
      horn.position.set(s * 0.65, 5.65, 1.8);
      horn.rotation.set(-0.5, 0, -s * 0.35);
      g.add(horn);

      const wing = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.16, 1.85), scaleMat);
      wing.position.set(s * 2.9, 3.6, 0.1);
      wing.rotation.z = s * 0.35;
      wing.rotation.y = -s * 0.2;
      const wingEdge = new THREE.Mesh(new THREE.BoxGeometry(3.85, 0.12, 0.25), glowMat);
      wingEdge.position.set(s * 2.9, 3.7, 0.95);
      wingEdge.rotation.z = s * 0.35;
      g.add(wing, wingEdge);
    }

    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.72, 3.5, 6), scaleMat);
    tail.rotation.x = -Math.PI * 0.44;
    tail.position.set(0, 2.1, -2.7);
    const halo = new THREE.Mesh(new THREE.TorusGeometry(3.2, 0.12, 8, 32), glowMat);
    halo.rotation.x = Math.PI / 2;
    halo.position.y = 0.25;
    g.add(torso, neck, head, eyes, tail, halo);
  } else {
    // Wolf / Boar / River Spirit
    const col = type === 'river_spirit' ? 0x14b8a6 : type === 'wolf' ? 0x475569 : 0x9a3412;
    const accent = type === 'river_spirit' ? 0x5eead4 : type === 'wolf' ? 0x38bdf8 : 0xfb923c;
    const body = new THREE.Mesh(new THREE.DodecahedronGeometry(1.05, 0), matMetal(col, 0.68, 0.2));
    body.scale.set(0.9, 0.85, 1.35);
    body.position.y = 1.1;
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.1, 6), matMetal(col, 0.6, 0.2));
    head.rotation.x = Math.PI * 0.5;
    head.position.set(0, 1.3, 1.25);
    const crest = new THREE.Mesh(new THREE.OctahedronGeometry(0.42, 0), matGlow(accent, 1.7));
    crest.position.set(0, 1.95, 0.2);
    g.add(body, head, crest);
  }

  polishModel(g);
  enableShadows(g);
  return g;
}

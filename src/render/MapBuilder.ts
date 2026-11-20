import * as THREE from 'three';
import {
  BLUE_FOUNTAIN,
  MAP_BUSHES,
  MAP_SIZE,
  MAP_WALLS,
  RED_FOUNTAIN,
  TURRET_BLUEPRINTS,
} from '../sim/constants';
import { TurretState } from '../sim/types';
import { createCanyonGroundTexture, createGlowTexture, createRuneRingTexture, createStoneTexture } from './Textures';

export interface TurretVisual {
  id: string;
  group: THREE.Group;
  crystal: THREE.Object3D;
  ring: THREE.Object3D;
  ruins: THREE.Object3D;
  intact: THREE.Object3D;
  rangeRing: THREE.Mesh;
  laserLine: THREE.Line;
  alive: boolean;
}

export interface BushVisual {
  id: string;
  x: number;
  z: number;
  rx: number;
  rz: number;
  rot: number;
  group: THREE.Group;
  materials: THREE.MeshStandardMaterial[];
}

export class MapBuilder {
  public group = new THREE.Group();
  public turrets = new Map<string, TurretVisual>();
  public bushes: BushVisual[] = [];
  public waterUniforms = { uTime: { value: 0 } };
  private fountainRings: THREE.Mesh[] = [];
  private fireflies!: THREE.Points;

  constructor() {
    this.buildGround();
    this.buildRiverWater();
    this.buildWallsAndDecor();
    this.buildPerimeterCliffs();
    this.buildFountains();
    this.buildBushes();
    this.buildTurrets();
    this.buildAmbientParticles();
  }

  private buildGround(): void {
    const tex = createCanyonGroundTexture();
    const geo = new THREE.PlaneGeometry(MAP_SIZE, MAP_SIZE);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      roughness: 0.86,
      metalness: 0.04,
    });
    const ground = new THREE.Mesh(geo, mat);
    ground.position.set(MAP_SIZE / 2, 0, MAP_SIZE / 2);
    ground.receiveShadow = true;
    this.group.add(ground);

    // Outer deep canyon floor skirt
    const skirtGeo = new THREE.PlaneGeometry(MAP_SIZE * 2.2, MAP_SIZE * 2.2);
    skirtGeo.rotateX(-Math.PI / 2);
    const skirtMat = new THREE.MeshStandardMaterial({
      color: 0x0c1a24,
      roughness: 1,
    });
    const skirt = new THREE.Mesh(skirtGeo, skirtMat);
    skirt.position.set(MAP_SIZE / 2, -1.5, MAP_SIZE / 2);
    this.group.add(skirt);
  }

  private buildRiverWater(): void {
    // Diagonal shimmering river ribbon along x = z
    const len = 176;
    const width = 14.5;
    const geo = new THREE.PlaneGeometry(width, len, 12, 48);
    geo.rotateX(-Math.PI / 2);
    geo.rotateY(-Math.PI / 4);

    const waterMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: this.waterUniforms.uTime,
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        varying vec2 vUv;
        void main() {
          float edge = smoothstep(0.0, 0.18, vUv.x) * smoothstep(1.0, 0.82, vUv.x);
          float ends = smoothstep(0.0, 0.06, vUv.y) * smoothstep(1.0, 0.94, vUv.y);
          float w1 = sin(vUv.y * 44.0 - uTime * 2.4 + sin(vUv.x * 12.0)) * 0.5 + 0.5;
          float w2 = sin(vUv.y * 78.0 + vUv.x * 18.0 - uTime * 3.2) * 0.5 + 0.5;
          float shimmer = pow(w1 * w2, 3.0);
          vec3 deepCol = vec3(0.08, 0.34, 0.44);
          vec3 shallowCol = vec3(0.18, 0.58, 0.64);
          vec3 col = mix(shallowCol, deepCol, edge) + vec3(0.55, 0.92, 1.0) * shimmer * 0.62;
          // Subtle shoreline foam
          float foam = (1.0 - smoothstep(0.08, 0.22, min(vUv.x, 1.0 - vUv.x))) * 0.32 * w1;
          col += vec3(0.85, 0.98, 1.0) * foam;
          gl_FragColor = vec4(col, edge * ends * 0.78);
        }
      `,
    });

    const river = new THREE.Mesh(geo, waterMat);
    river.position.set(MAP_SIZE / 2, 0.09, MAP_SIZE / 2);
    this.group.add(river);
  }

  private buildWallsAndDecor(): void {
    const stoneTex = createStoneTexture();
    const rockMatBlue = new THREE.MeshStandardMaterial({
      map: stoneTex,
      color: 0x64748b,
      roughness: 0.82,
      metalness: 0.08,
    });
    const rockMatRed = new THREE.MeshStandardMaterial({
      map: stoneTex,
      color: 0x7c6966,
      roughness: 0.82,
      metalness: 0.08,
    });
    const mossMatBlue = new THREE.MeshStandardMaterial({ color: 0x2c6e49, roughness: 0.88 });
    const mossMatRed = new THREE.MeshStandardMaterial({ color: 0x6b6036, roughness: 0.88 });
    const goldMat = new THREE.MeshStandardMaterial({
      color: 0xd4a441,
      metalness: 0.72,
      roughness: 0.28,
    });
    const lanternMat = new THREE.MeshStandardMaterial({
      color: 0xfff3c4,
      emissive: 0xff9f1c,
      emissiveIntensity: 1.5,
      roughness: 0.3,
    });

    for (const w of MAP_WALLS) {
      const isBlueSide = w.x + w.z >= MAP_SIZE;
      const wallGroup = new THREE.Group();
      wallGroup.position.set(w.x, 0, w.z);
      wallGroup.rotation.y = w.rot;

      if (w.kind === 'base_wall') {
        // Ornate Eastern Fortress Wall with gold roof ridge & glowing lanterns
        const main = new THREE.Mesh(new THREE.BoxGeometry(w.w, w.height, w.d), isBlueSide ? rockMatBlue : rockMatRed);
        main.position.y = w.height * 0.5;
        main.castShadow = true;
        main.receiveShadow = true;
        wallGroup.add(main);

        const roof = new THREE.Mesh(
          new THREE.BoxGeometry(w.w + 0.9, 0.55, w.d + 0.9),
          isBlueSide
            ? new THREE.MeshStandardMaterial({ color: 0x1e3a5f, roughness: 0.5, metalness: 0.35 })
            : new THREE.MeshStandardMaterial({ color: 0x5c1f24, roughness: 0.5, metalness: 0.35 })
        );
        roof.position.y = w.height + 0.22;
        roof.castShadow = true;
        wallGroup.add(roof);

        const trim = new THREE.Mesh(new THREE.BoxGeometry(w.w + 1.1, 0.16, 0.35), goldMat);
        trim.position.y = w.height + 0.55;
        wallGroup.add(trim);

        // Two glowing corner pillar lanterns
        for (const sx of [-w.w * 0.45, w.w * 0.45]) {
          const post = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.55, w.height + 1.2, 6), goldMat);
          post.position.set(sx, (w.height + 1.2) * 0.5, 0);
          wallGroup.add(post);

          const lamp = new THREE.Mesh(new THREE.OctahedronGeometry(0.5, 0), lanternMat);
          lamp.position.set(sx, w.height + 1.5, 0);
          wallGroup.add(lamp);
        }
      } else {
        // Sculpted Canyon Rock Cliff with lush mossy cap + stylized Eastern trees!
        const baseMesh = new THREE.Mesh(
          new THREE.BoxGeometry(w.w, w.height * 0.85, w.d),
          isBlueSide ? rockMatBlue : rockMatRed
        );
        baseMesh.position.y = w.height * 0.42;
        baseMesh.castShadow = true;
        baseMesh.receiveShadow = true;
        wallGroup.add(baseMesh);

        // Layered rocky outcrops along length for organic sculpted look
        const segments = Math.max(2, Math.floor(w.w / 3.4));
        for (let s = 0; s < segments; s++) {
          const t = segments === 1 ? 0 : (s / (segments - 1) - 0.5) * (w.w - 2.4);
          const h = w.height * (0.88 + ((s * 37) % 10) * 0.035);
          const rad = Math.min(w.d * 0.65, 2.4);
          const crag = new THREE.Mesh(
            new THREE.DodecahedronGeometry(rad, 0),
            isBlueSide ? rockMatBlue : rockMatRed
          );
          crag.scale.set(1.15, h / (rad * 1.5), 0.92);
          crag.position.set(t, h * 0.48, ((s % 2) - 0.5) * 0.5);
          crag.rotation.set(0.15 * s, 0.5 * s, 0.1);
          crag.castShadow = true;
          crag.receiveShadow = true;
          wallGroup.add(crag);
        }

        // Mossy grass cap on top of rock
        const cap = new THREE.Mesh(
          new THREE.BoxGeometry(w.w * 0.96, 0.45, w.d * 0.96),
          isBlueSide ? mossMatBlue : mossMatRed
        );
        cap.position.y = w.height * 0.86;
        cap.receiveShadow = true;
        wallGroup.add(cap);

        // Stylized Eastern pine / peach blossom tree perched on the cliff!
        const tree = this.createStylizedTree(isBlueSide, (w.x + w.z) % 3 === 0);
        tree.position.set(0, w.height * 0.85, 0);
        wallGroup.add(tree);
      }

      this.group.add(wallGroup);
    }
  }

  private createStylizedTree(isBlueSide: boolean, isBlossom: boolean): THREE.Group {
    const g = new THREE.Group();
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5c3d2e, roughness: 0.9 });
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.42, 3.1, 6), trunkMat);
    trunk.position.y = 1.5;
    trunk.castShadow = true;
    g.add(trunk);

    const leafColor = isBlossom
      ? 0xf472b6
      : isBlueSide
      ? 0x228b5b
      : 0xd97706;
    const leafMat = new THREE.MeshStandardMaterial({
      color: leafColor,
      roughness: 0.72,
      emissive: isBlossom ? 0x500724 : 0x052e16,
      emissiveIntensity: 0.15,
    });

    const tiers = [
      { y: 3.1, r: 2.1, h: 1.5 },
      { y: 4.1, r: 1.6, h: 1.3 },
      { y: 4.9, r: 1.0, h: 1.0 },
    ];
    for (const tier of tiers) {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(tier.r, tier.h, 7), leafMat);
      cone.position.y = tier.y;
      cone.castShadow = true;
      g.add(cone);
    }
    return g;
  }

  private buildPerimeterCliffs(): void {
    const rockMat = new THREE.MeshStandardMaterial({
      map: createStoneTexture(),
      color: 0x3b4958,
      roughness: 0.9,
    });
    const positions: [number, number, number][] = [];
    for (let i = 8; i < MAP_SIZE; i += 14) {
      positions.push([i, -3.5, 4.8], [i, MAP_SIZE + 3.5, 4.8], [-3.5, i, 4.8], [MAP_SIZE + 3.5, i, 4.8]);
    }
    for (const [x, z, r] of positions) {
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), rockMat);
      rock.position.set(x, 1.4, z);
      rock.scale.set(1.3, 0.9 + ((x * 7 + z) % 5) * 0.18, 1.3);
      rock.rotation.y = (x + z) * 0.1;
      this.group.add(rock);
    }
  }

  private buildFountains(): void {
    const runeTex = createRuneRingTexture();
    for (const f of [
      { pos: BLUE_FOUNTAIN, color: 0x38bdf8 },
      { pos: RED_FOUNTAIN, color: 0xf43f5e },
    ]) {
      const ringGeo = new THREE.PlaneGeometry(16, 16);
      ringGeo.rotateX(-Math.PI / 2);
      const ringMat = new THREE.MeshBasicMaterial({
        map: runeTex,
        color: f.color,
        transparent: true,
        opacity: 0.55,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.set(f.pos.x, 0.12, f.pos.z);
      this.group.add(ring);
      this.fountainRings.push(ring);

      // Ornate fountain beacon pillar behind spawn
      const pillar = new THREE.Mesh(
        new THREE.CylinderGeometry(0.9, 1.4, 7.5, 8),
        new THREE.MeshStandardMaterial({ color: 0xd4a441, metalness: 0.65, roughness: 0.3 })
      );
      const sign = f.pos === BLUE_FOUNTAIN ? -1 : 1;
      pillar.position.set(f.pos.x + sign * 4.5, 3.75, f.pos.z - sign * 4.5);
      pillar.castShadow = true;
      this.group.add(pillar);

      const orb = new THREE.Mesh(
        new THREE.OctahedronGeometry(1.3, 1),
        new THREE.MeshStandardMaterial({
          color: f.color,
          emissive: f.color,
          emissiveIntensity: 1.8,
          roughness: 0.15,
        })
      );
      orb.position.set(pillar.position.x, 8.8, pillar.position.z);
      this.group.add(orb);
    }
  }

  private buildBushes(): void {
    for (const b of MAP_BUSHES) {
      const bGroup = new THREE.Group();
      bGroup.position.set(b.x, 0, b.z);
      bGroup.rotation.y = b.rot;

      const isBlueSide = b.x + b.z >= MAP_SIZE;
      const mat1 = new THREE.MeshStandardMaterial({
        color: isBlueSide ? 0x1b7a46 : 0x3b7a38,
        roughness: 0.82,
        transparent: true,
        opacity: 1,
      });
      const mat2 = new THREE.MeshStandardMaterial({
        color: isBlueSide ? 0x2ca862 : 0x5d943c,
        roughness: 0.78,
        transparent: true,
        opacity: 1,
      });

      // Dense cluster of lush stylized reed tufts
      const count = Math.max(10, Math.floor((b.rx * b.rz) * 2.2));
      for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2 + i * 1.7;
        const rad = Math.sqrt((i + 0.5) / count);
        const lx = Math.cos(angle) * b.rx * rad * 0.92;
        const lz = Math.sin(angle) * b.rz * rad * 0.92;
        const h = 1.65 + (i % 4) * 0.28;
        const tuft = new THREE.Mesh(
          new THREE.ConeGeometry(0.68, h, 5),
          i % 2 === 0 ? mat1 : mat2
        );
        tuft.position.set(lx, h * 0.45, lz);
        tuft.rotation.set(((i % 3) - 1) * 0.14, i * 0.8, (((i + 1) % 3) - 1) * 0.14);
        tuft.castShadow = true;
        bGroup.add(tuft);
      }

      this.group.add(bGroup);
      this.bushes.push({
        id: b.id,
        x: b.x,
        z: b.z,
        rx: b.rx,
        rz: b.rz,
        rot: b.rot,
        group: bGroup,
        materials: [mat1, mat2],
      });
    }
  }

  private buildTurrets(): void {
    const stoneTex = createStoneTexture();
    const goldMat = new THREE.MeshStandardMaterial({
      color: 0xeab308,
      metalness: 0.75,
      roughness: 0.25,
    });
    const runeTex = createRuneRingTexture();

    for (const bp of TURRET_BLUEPRINTS) {
      const isBlue = bp.team === 'blue';
      const teamColor = isBlue ? 0x38bdf8 : 0xf43f5e;
      const isCrystal = bp.tier === 'crystal';

      const root = new THREE.Group();
      root.position.set(bp.x, 0, bp.z);

      const intact = new THREE.Group();
      const baseStoneMat = new THREE.MeshStandardMaterial({
        map: stoneTex,
        color: isBlue ? 0xb4c6d9 : 0x9b8686,
        roughness: 0.65,
        metalness: 0.15,
      });
      const crystalMat = new THREE.MeshStandardMaterial({
        color: teamColor,
        emissive: teamColor,
        emissiveIntensity: 1.5,
        roughness: 0.12,
        metalness: 0.2,
      });

      let crystalObj: THREE.Object3D;
      let ringObj: THREE.Object3D;

      if (isCrystal) {
        // Monumental Sacred Nexus Crystal!
        const plinth1 = new THREE.Mesh(new THREE.CylinderGeometry(3.5, 4.2, 1.1, 8), baseStoneMat);
        plinth1.position.y = 0.55;
        plinth1.castShadow = true;
        plinth1.receiveShadow = true;
        intact.add(plinth1);

        const plinth2 = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 3.2, 0.7, 8), goldMat);
        plinth2.position.y = 1.4;
        intact.add(plinth2);

        // 4 curved guardian stone pillars around crystal
        for (let k = 0; k < 4; k++) {
          const a = (k * Math.PI) / 2 + Math.PI / 4;
          const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.75, 4.4, 0.75), baseStoneMat);
          pillar.position.set(Math.cos(a) * 2.8, 2.8, Math.sin(a) * 2.8);
          pillar.rotation.z = Math.cos(a) * 0.22;
          pillar.rotation.x = -Math.sin(a) * 0.22;
          pillar.castShadow = true;
          intact.add(pillar);
        }

        // Giant floating faceted crystal core
        const coreGroup = new THREE.Group();
        coreGroup.position.y = 4.9;
        const core = new THREE.Mesh(new THREE.OctahedronGeometry(1.9, 0), crystalMat);
        core.scale.set(0.85, 1.75, 0.85);
        core.castShadow = true;
        coreGroup.add(core);
        intact.add(coreGroup);
        crystalObj = coreGroup;

        // Orbiting sacred gilded rings
        const ringGroup = new THREE.Group();
        ringGroup.position.y = 4.9;
        const r1 = new THREE.Mesh(new THREE.TorusGeometry(2.9, 0.14, 10, 32), goldMat);
        r1.rotation.x = Math.PI * 0.35;
        const r2 = new THREE.Mesh(new THREE.TorusGeometry(3.4, 0.11, 10, 32), crystalMat);
        r2.rotation.y = Math.PI * 0.3;
        r2.rotation.x = -Math.PI * 0.35;
        ringGroup.add(r1, r2);
        intact.add(ringGroup);
        ringObj = ringGroup;
      } else {
        // Ornate Eastern Pagoda Guardian Turret!
        const plinth = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.6, 1.0, 8), baseStoneMat);
        plinth.position.y = 0.5;
        plinth.castShadow = true;
        plinth.receiveShadow = true;
        intact.add(plinth);

        const shaft = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.65, 4.4, 8), baseStoneMat);
        shaft.position.y = 3.1;
        shaft.castShadow = true;
        intact.add(shaft);

        // Tiered gilded pagoda collars
        for (const ty of [2.4, 4.4, 5.4]) {
          const collar = new THREE.Mesh(new THREE.CylinderGeometry(1.85 - (ty - 2.4) * 0.14, 2.05 - (ty - 2.4) * 0.14, 0.35, 8), goldMat);
          collar.position.y = ty;
          collar.castShadow = true;
          intact.add(collar);
        }

        // 4 glowing team banners / fins
        for (let k = 0; k < 4; k++) {
          const a = (k * Math.PI) / 2;
          const fin = new THREE.Mesh(new THREE.BoxGeometry(0.28, 2.2, 0.7), crystalMat);
          fin.position.set(Math.cos(a) * 1.45, 3.6, Math.sin(a) * 1.45);
          fin.rotation.y = -a;
          intact.add(fin);
        }

        // Floating energy crystal crown
        const core = new THREE.Mesh(new THREE.OctahedronGeometry(1.05, 0), crystalMat);
        core.scale.set(0.85, 1.45, 0.85);
        core.position.y = 7.2;
        core.castShadow = true;
        intact.add(core);
        crystalObj = core;

        const halo = new THREE.Mesh(new THREE.TorusGeometry(1.55, 0.1, 8, 24), goldMat);
        halo.position.y = 7.2;
        halo.rotation.x = Math.PI / 2;
        intact.add(halo);
        ringObj = halo;
      }

      // Crumbled stone ruins (hidden while alive)
      const ruins = new THREE.Group();
      const rubbleBase = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.7, 0.7, 8), baseStoneMat);
      rubbleBase.position.y = 0.35;
      ruins.add(rubbleBase);
      for (let k = 0; k < 5; k++) {
        const chunk = new THREE.Mesh(new THREE.DodecahedronGeometry(0.65, 0), baseStoneMat);
        chunk.position.set(Math.cos(k * 1.3) * 1.3, 0.6, Math.sin(k * 1.3) * 1.3);
        ruins.add(chunk);
      }
      ruins.visible = false;

      // Dynamic Turret Range Indicator Ring on ground (just like HoK!)
      const range = isCrystal ? 16.5 : bp.tier === 'highground' ? 15.2 : 14.5;
      const rangeGeo = new THREE.PlaneGeometry(range * 2, range * 2);
      rangeGeo.rotateX(-Math.PI / 2);
      const rangeMat = new THREE.MeshBasicMaterial({
        map: runeTex,
        color: 0x4ade80,
        transparent: true,
        opacity: 0.0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const rangeRing = new THREE.Mesh(rangeGeo, rangeMat);
      rangeRing.position.y = 0.16;

      // Targeting laser line
      const laserGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, isCrystal ? 5.2 : 7.2, 0),
        new THREE.Vector3(0, 1.5, 0),
      ]);
      const laserMat = new THREE.LineBasicMaterial({
        color: 0xff3b3b,
        transparent: true,
        opacity: 0.85,
      });
      const laserLine = new THREE.Line(laserGeo, laserMat);
      laserLine.visible = false;

      root.add(intact, ruins, rangeRing, laserLine);
      this.group.add(root);

      this.turrets.set(bp.id, {
        id: bp.id,
        group: root,
        crystal: crystalObj,
        ring: ringObj,
        ruins,
        intact,
        rangeRing,
        laserLine,
        alive: true,
      });
    }
  }

  private buildAmbientParticles(): void {
    const count = 160;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = Math.random() * MAP_SIZE;
      positions[i * 3 + 1] = 1.5 + Math.random() * 8;
      positions[i * 3 + 2] = Math.random() * MAP_SIZE;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      size: 0.85,
      map: createGlowTexture(),
      color: 0xffe4a0,
      transparent: true,
      opacity: 0.65,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.fireflies = new THREE.Points(geo, mat);
    this.group.add(this.fireflies);
  }

  public update(
    elapsed: number,
    turretStates: TurretState[],
    playerHero: { id: string; team: string; x: number; z: number } | null,
    getUnitPos: (id: string) => { x: number; z: number } | null
  ): void {
    this.waterUniforms.uTime.value = elapsed;

    // Spin fountain sacred runes
    for (const r of this.fountainRings) {
      r.rotation.z = elapsed * 0.25;
    }

    // Gentle bush wind sway + stealth translucency when player is inside
    for (const b of this.bushes) {
      b.group.rotation.z = Math.sin(elapsed * 2.1 + b.x * 0.2) * 0.035;
      let playerInside = false;
      if (playerHero) {
        const dx = playerHero.x - b.x;
        const dz = playerHero.z - b.z;
        if (dx * dx + dz * dz < (b.rx + b.rz) * (b.rx + b.rz)) {
          playerInside = true;
        }
      }
      const targetOp = playerInside ? 0.42 : 1.0;
      for (const m of b.materials) {
        m.opacity += (targetOp - m.opacity) * 0.14;
      }
    }

    // Update Turrets (floating crystals, range rings, targeting beams)
    for (const ts of turretStates) {
      const vis = this.turrets.get(ts.id);
      if (!vis) continue;

      if (vis.alive !== ts.alive) {
        vis.alive = ts.alive;
        vis.intact.visible = ts.alive;
        vis.ruins.visible = !ts.alive;
        vis.laserLine.visible = false;
        (vis.rangeRing.material as THREE.MeshBasicMaterial).opacity = 0;
      }
      if (!ts.alive) continue;

      // Float & spin crystal core
      const baseH = ts.tier === 'crystal' ? 4.9 : 7.2;
      vis.crystal.position.y = baseH + Math.sin(elapsed * 2.8 + ts.x) * 0.32;
      vis.crystal.rotation.y = elapsed * 1.4;
      vis.ring.rotation.z = -elapsed * 1.1;
      if (ts.tier === 'crystal') vis.ring.rotation.y = elapsed * 0.8;

      // Show authentic HoK turret range circle when player approaches an enemy turret!
      const ringMat = vis.rangeRing.material as THREE.MeshBasicMaterial;
      if (playerHero && ts.team !== playerHero.team) {
        const d = Math.hypot(playerHero.x - ts.x, playerHero.z - ts.z);
        if (d < ts.range + 7) {
          const targetingPlayer = ts.targetId === playerHero.id;
          ringMat.color.setHex(targetingPlayer ? 0xff2e2e : ts.targetId ? 0x4ade80 : 0xfacc15);
          ringMat.opacity = targetingPlayer ? 0.65 + Math.sin(elapsed * 14) * 0.2 : 0.36;
          vis.rangeRing.rotation.z = elapsed * 0.3;
        } else {
          ringMat.opacity = 0;
        }
      } else {
        ringMat.opacity = 0;
      }

      // Show turret laser lock line if targeting a hero!
      if (ts.targetId && playerHero && (ts.targetId === playerHero.id || Math.hypot(playerHero.x - ts.x, playerHero.z - ts.z) < 28)) {
        const pos = getUnitPos(ts.targetId);
        if (pos) {
          const attr = vis.laserLine.geometry.getAttribute('position') as THREE.BufferAttribute;
          attr.setXYZ(1, pos.x - ts.x, 1.8, pos.z - ts.z);
          attr.needsUpdate = true;
          (vis.laserLine.material as THREE.LineBasicMaterial).color.setHex(
            ts.targetId === playerHero.id ? 0xff2222 : ts.team === 'blue' ? 0x38bdf8 : 0xf43f5e
          );
          vis.laserLine.visible = true;
        } else {
          vis.laserLine.visible = false;
        }
      } else {
        vis.laserLine.visible = false;
      }
    }

    // Drift fireflies softly
    const posAttr = this.fireflies.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < posAttr.count; i++) {
      const y = posAttr.getY(i) + Math.sin(elapsed * 1.4 + i) * 0.008;
      posAttr.setY(i, y);
    }
    posAttr.needsUpdate = true;
  }
}

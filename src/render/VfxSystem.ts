import * as THREE from 'three';
import { GameEvent, GroundZoneState, ProjectileState } from '../sim/types';
import { createGlowTexture, createRuneRingTexture } from './Textures';

interface TransientEffect {
  mesh: THREE.Object3D;
  age: number;
  duration: number;
  update: (t: number, dt: number) => void;
}

export class VfxSystem {
  public group = new THREE.Group();
  private effects: TransientEffect[] = [];
  private projectileMeshes = new Map<string, THREE.Group>();
  private zoneMeshes = new Map<string, THREE.Mesh>();

  // Skill aiming telegraph meshes
  private aimGroup = new THREE.Group();
  private aimRangeRing!: THREE.Mesh;
  private aimArrow!: THREE.Mesh;
  private aimAoeCircle!: THREE.Mesh;

  private glowTex = createGlowTexture();
  private runeTex = createRuneRingTexture();

  constructor() {
    this.buildAimIndicators();
  }

  private buildAimIndicators(): void {
    const rangeGeo = new THREE.RingGeometry(0.96, 1.0, 48);
    rangeGeo.rotateX(-Math.PI / 2);
    this.aimRangeRing = new THREE.Mesh(
      rangeGeo,
      new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.48,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    this.aimRangeRing.position.y = 0.18;

    const arrowGeo = new THREE.PlaneGeometry(2.4, 1.0);
    arrowGeo.rotateX(-Math.PI / 2);
    arrowGeo.translate(0, 0, 0.5);
    this.aimArrow = new THREE.Mesh(
      arrowGeo,
      new THREE.MeshBasicMaterial({
        color: 0x60a5fa,
        transparent: true,
        opacity: 0.55,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    this.aimArrow.position.y = 0.2;

    const aoeGeo = new THREE.PlaneGeometry(2, 2);
    aoeGeo.rotateX(-Math.PI / 2);
    this.aimAoeCircle = new THREE.Mesh(
      aoeGeo,
      new THREE.MeshBasicMaterial({
        map: this.runeTex,
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.65,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    this.aimAoeCircle.position.y = 0.21;

    this.aimGroup.add(this.aimRangeRing, this.aimArrow, this.aimAoeCircle);
    this.aimGroup.visible = false;
    this.group.add(this.aimGroup);
  }

  public setAimPreview(
    active: boolean,
    opts?: {
      x: number;
      z: number;
      type: 'direction' | 'aoe' | 'self' | 'dash' | 'lock';
      range: number;
      radius: number;
      dirX: number;
      dirZ: number;
      targetX: number;
      targetZ: number;
    }
  ): void {
    if (!active || !opts) {
      this.aimGroup.visible = false;
      return;
    }
    this.aimGroup.visible = true;
    const clampedRange = Math.min(opts.range, 28);
    this.aimRangeRing.position.set(opts.x, 0.18, opts.z);
    this.aimRangeRing.scale.setScalar(clampedRange);

    if (opts.type === 'direction' || opts.type === 'dash') {
      this.aimArrow.visible = true;
      this.aimAoeCircle.visible = false;
      this.aimArrow.position.set(opts.x, 0.2, opts.z);
      this.aimArrow.scale.set(Math.max(0.8, opts.radius * 0.45), 1, clampedRange);
      this.aimArrow.rotation.y = Math.atan2(opts.dirX, opts.dirZ);
    } else if (opts.type === 'aoe') {
      this.aimArrow.visible = false;
      this.aimAoeCircle.visible = true;
      this.aimAoeCircle.position.set(opts.targetX, 0.21, opts.targetZ);
      this.aimAoeCircle.scale.setScalar(opts.radius);
    } else {
      this.aimArrow.visible = false;
      this.aimAoeCircle.visible = true;
      this.aimAoeCircle.position.set(opts.x, 0.21, opts.z);
      this.aimAoeCircle.scale.setScalar(opts.radius);
    }
  }

  public spawnEventVfx(ev: GameEvent): void {
    if (ev.type !== 'vfx' && ev.type !== 'level_up') return;
    const x = ev.x ?? 80;
    const z = ev.z ?? 80;
    const color = new THREE.Color(ev.color || '#38bdf8');

    if (ev.type === 'level_up') {
      this.spawnPillar(x, z, 2.2, 7.5, 0xfbbf24, 0.75);
      this.spawnShockwave(x, z, 3.8, 0xfbbf24, 0.6);
      return;
    }

    switch (ev.vfxKind) {
      case 'slash':
      case 'slash_true':
      case 'lubu_cleave':
      case 'lubu_cleave_true': {
        const rad = ev.radius || 3.8;
        const arc = new THREE.RingGeometry(rad * 0.45, rad, 24, 1, -Math.PI * 0.45, Math.PI * 0.9);
        arc.rotateX(-Math.PI / 2);
        const mat = new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.9,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        const mesh = new THREE.Mesh(arc, mat);
        mesh.position.set(x, 1.35, z);
        mesh.rotation.y = (ev.angle || 0) - Math.PI / 2;
        this.addEffect(mesh, 0.28, (t) => {
          mesh.scale.setScalar(0.85 + t * 0.35);
          mat.opacity = (1 - t) * 0.9;
        });
        break;
      }

      case 'libai_dash': {
        const tx = ev.targetX ?? x;
        const tz = ev.targetZ ?? z;
        const len = Math.hypot(tx - x, tz - z) || 1;
        const geo = new THREE.PlaneGeometry(1.6, len);
        geo.rotateX(-Math.PI / 2);
        const mat = new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.85,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        const streak = new THREE.Mesh(geo, mat);
        streak.position.set((x + tx) / 2, 1.2, (z + tz) / 2);
        streak.rotation.y = Math.atan2(tx - x, tz - z);
        this.addEffect(streak, 0.38, (t) => {
          mat.opacity = (1 - t) * 0.85;
          streak.scale.x = 1 - t * 0.6;
        });
        this.spawnShockwave(tx, tz, 2.8, color.getHex(), 0.35);
        break;
      }

      case 'libai_ult': {
        const r = ev.radius || 7;
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          const beam = new THREE.Mesh(
            new THREE.BoxGeometry(0.45, 0.16, r * 1.9),
            new THREE.MeshBasicMaterial({
              color: 0x7dd3fc,
              transparent: true,
              opacity: 0.9,
              blending: THREE.AdditiveBlending,
              depthWrite: false,
            })
          );
          beam.position.set(x, 1.3 + (i % 3) * 0.35, z);
          beam.rotation.y = a;
          this.addEffect(beam, 0.78, (t) => {
            beam.rotation.y = a + t * 1.6;
            (beam.material as THREE.MeshBasicMaterial).opacity = Math.sin(t * Math.PI) * 0.92;
          });
        }
        this.spawnShockwave(x, z, r, 0x38bdf8, 0.8);
        break;
      }

      case 'solar_pillar':
      case 'smite': {
        this.spawnPillar(x, z, ev.radius ? ev.radius * 0.6 : 1.6, 13, color.getHex(), 0.5);
        this.spawnShockwave(x, z, ev.radius || 3.5, color.getHex(), 0.45);
        break;
      }

      case 'holy_slam':
      case 'lubu_ult_land':
      case 'phoenix_boom':
      case 'turret_explode': {
        const r = ev.radius || 5.5;
        this.spawnShockwave(x, z, r * 1.25, color.getHex(), 0.65);
        this.spawnPillar(x, z, r * 0.42, 11, color.getHex(), 0.55);
        this.spawnParticleBurst(x, z, 22, color.getHex(), r * 0.9);
        break;
      }

      case 'lubu_ult_warn':
      case 'libai_ring':
      case 'sanctuary':
      case 'heal_pulse': {
        this.spawnShockwave(x, z, ev.radius || 6.5, color.getHex(), 0.65);
        break;
      }

      case 'turret_shot': {
        const tx = ev.targetX ?? x;
        const tz = ev.targetZ ?? z;
        const beam = new THREE.Mesh(
          new THREE.CylinderGeometry(0.09, 0.26, 1, 6),
          new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity: 0.9,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          })
        );
        const from = new THREE.Vector3(x, 6.6, z);
        const to = new THREE.Vector3(tx, 1.4, tz);
        const mid = from.clone().add(to).multiplyScalar(0.5);
        beam.position.copy(mid);
        beam.scale.y = from.distanceTo(to);
        beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
        this.addEffect(beam, 0.2, (t) => {
          (beam.material as THREE.MeshBasicMaterial).opacity = (1 - t) * 0.95;
        });
        this.spawnShockwave(tx, tz, 1.9, color.getHex(), 0.24);
        break;
      }

      case 'fountain_laser':
      case 'soul_siphon': {
        const tx = ev.targetX ?? x;
        const tz = ev.targetZ ?? z;
        const pts = [new THREE.Vector3(x, 2.2, z), new THREE.Vector3(tx, 1.6, tz)];
        const geo = new THREE.BufferGeometry().setFromPoints(pts);
        const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95 });
        const line = new THREE.Line(geo, mat);
        this.addEffect(line, 0.32, (t) => {
          mat.opacity = 1 - t;
        });
        break;
      }

      default: {
        this.spawnShockwave(x, z, ev.radius || 2.8, color.getHex(), 0.42);
        this.spawnParticleBurst(x, z, 10, color.getHex(), 2.8);
        break;
      }
    }
  }

  private spawnShockwave(x: number, z: number, maxRadius: number, colorHex: number, dur: number): void {
    const geo = new THREE.PlaneGeometry(2, 2);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      map: this.runeTex,
      color: colorHex,
      transparent: true,
      opacity: 0.92,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, 0.24, z);
    this.addEffect(mesh, dur, (t) => {
      const s = 0.35 + maxRadius * Math.pow(t, 0.55);
      mesh.scale.setScalar(s);
      mesh.rotation.y = t * 1.4;
      mat.opacity = (1 - t) * 0.92;
    });
  }

  private spawnPillar(x: number, z: number, radius: number, height: number, colorHex: number, dur: number): void {
    const geo = new THREE.CylinderGeometry(radius * 0.6, radius, height, 14, 1, true);
    const mat = new THREE.MeshBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.78,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, height * 0.5, z);
    this.addEffect(mesh, dur, (t) => {
      mesh.scale.set(1 - t * 0.55, 1, 1 - t * 0.55);
      mat.opacity = (1 - t) * 0.78;
    });
  }

  private spawnParticleBurst(x: number, z: number, count: number, colorHex: number, spread: number): void {
    const grp = new THREE.Group();
    grp.position.set(x, 1.3, z);
    const dirs: THREE.Vector3[] = [];
    const mat = new THREE.SpriteMaterial({
      map: this.glowTex,
      color: colorHex,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    for (let i = 0; i < count; i++) {
      const sp = new THREE.Sprite(mat);
      sp.scale.setScalar(0.65 + Math.random() * 0.55);
      const a = Math.random() * Math.PI * 2;
      const spd = (0.4 + Math.random() * 0.8) * spread;
      dirs.push(new THREE.Vector3(Math.cos(a) * spd, 1.5 + Math.random() * 3.5, Math.sin(a) * spd));
      grp.add(sp);
    }
    this.addEffect(grp, 0.52, (t, dt) => {
      grp.children.forEach((c, idx) => {
        const v = dirs[idx];
        c.position.addScaledVector(v, dt * 2.2);
        v.y -= 8.5 * dt;
      });
      mat.opacity = 1 - t;
    });
  }

  private addEffect(mesh: THREE.Object3D, duration: number, update: (t: number, dt: number) => void): void {
    this.group.add(mesh);
    this.effects.push({ mesh, age: 0, duration, update });
  }

  public syncState(
    projectiles: ProjectileState[],
    zones: GroundZoneState[],
    dt: number,
    elapsed: number
  ): void {
    // Update transient effects
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const ef = this.effects[i];
      ef.age += dt;
      const t = Math.min(1, ef.age / ef.duration);
      ef.update(t, dt);
      if (ef.age >= ef.duration) {
        this.group.remove(ef.mesh);
        this.effects.splice(i, 1);
      }
    }

    // Sync Projectiles
    const activeProjIds = new Set<string>();
    for (const p of projectiles) {
      activeProjIds.add(p.id);
      let mesh = this.projectileMeshes.get(p.id);
      if (!mesh) {
        mesh = this.createProjectileMesh(p);
        this.projectileMeshes.set(p.id, mesh);
        this.group.add(mesh);
      }
      mesh.position.set(p.x, p.kind === 'houyi_ult' ? 2.1 : 1.55, p.z);
      if (Math.hypot(p.vx, p.vz) > 0.1) {
        mesh.rotation.y = Math.atan2(p.vx, p.vz);
      }
    }
    for (const [id, mesh] of this.projectileMeshes.entries()) {
      if (!activeProjIds.has(id)) {
        this.group.remove(mesh);
        this.projectileMeshes.delete(id);
      }
    }

    // Sync Ground Zones (Arthur Ult, Libai S2 Ink Lotus Ring, Lubu Ult Arena, Caiwenji Sanctuary)
    const activeZoneIds = new Set<string>();
    for (const z of zones) {
      activeZoneIds.add(z.id);
      let mesh = this.zoneMeshes.get(z.id);
      if (!mesh) {
        const geo = new THREE.PlaneGeometry(z.radius * 2, z.radius * 2);
        geo.rotateX(-Math.PI / 2);
        const mat = new THREE.MeshBasicMaterial({
          map: this.runeTex,
          color: new THREE.Color(z.color),
          transparent: true,
          opacity: 0.72,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        mesh = new THREE.Mesh(geo, mat);
        mesh.position.y = 0.22;
        this.zoneMeshes.set(z.id, mesh);
        this.group.add(mesh);
      }
      mesh.position.set(z.x, 0.22, z.z);
      mesh.rotation.y = elapsed * (z.kind === 'libai_s2' ? -0.9 : 0.7);
      const fade = Math.min(1, z.remaining * 1.5);
      (mesh.material as THREE.MeshBasicMaterial).opacity = 0.65 * fade;
    }
    for (const [id, mesh] of this.zoneMeshes.entries()) {
      if (!activeZoneIds.has(id)) {
        this.group.remove(mesh);
        this.zoneMeshes.delete(id);
      }
    }
  }

  private createProjectileMesh(p: ProjectileState): THREE.Group {
    const g = new THREE.Group();
    const col = new THREE.Color(p.color);
    const mat = new THREE.MeshBasicMaterial({
      color: col,
      blending: THREE.AdditiveBlending,
      transparent: true,
      opacity: 0.95,
    });

    if (p.kind === 'houyi_ult') {
      // Giant Blazing Golden Sunbird Phoenix!!
      const body = new THREE.Mesh(new THREE.ConeGeometry(1.1, 3.6, 6), mat);
      body.rotation.x = Math.PI / 2;
      const wingL = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.14, 1.4), mat);
      wingL.position.set(-1.6, 0, -0.2);
      wingL.rotation.y = 0.35;
      const wingR = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.14, 1.4), mat);
      wingR.position.set(1.6, 0, -0.2);
      wingR.rotation.y = -0.35;
      g.add(body, wingL, wingR);
    } else if (p.kind === 'daji_s1') {
      // Sweeping Crimson Crescent Foxfire Wave!
      const arc = new THREE.Mesh(new THREE.TorusGeometry(2.1, 0.28, 6, 16, Math.PI * 0.85), mat);
      arc.rotation.x = Math.PI / 2;
      arc.rotation.z = -Math.PI * 0.42;
      g.add(arc);
    } else if (p.kind === 'arrow') {
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.8, 6), mat);
      shaft.rotation.x = Math.PI / 2;
      g.add(shaft);
    } else {
      const core = new THREE.Mesh(new THREE.OctahedronGeometry(p.kind === 'turret_orb' ? 0.65 : 0.42, 1), mat);
      g.add(core);
    }

    // Radiant glow halo sprite
    const halo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.glowTex,
        color: col,
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    halo.scale.setScalar(p.kind === 'houyi_ult' ? 7.5 : p.kind === 'turret_orb' ? 3.0 : 2.1);
    g.add(halo);
    return g;
  }
}

import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { HERO_VISION_RANGE, MINION_VISION_RANGE, TURRET_VISION_RANGE } from '../sim/constants';
import { GameEvent, Team, WorldSnapshot } from '../sim/types';
import {
  ArticulatedModel,
  animateHeroModel,
  buildHeroModel,
  buildMinionModel,
  buildMonsterModel,
} from './HeroModelBuilder';
import { MapBuilder } from './MapBuilder';
import { createRuneRingTexture } from './Textures';
import { VfxSystem } from './VfxSystem';

interface FloatingPopup {
  x: number;
  y: number;
  z: number;
  text: string;
  color: string;
  size: number;
  age: number;
  dur: number;
}

export class GameRenderer {
  private container: HTMLElement;
  public renderer: THREE.WebGLRenderer;
  public scene: THREE.Scene;
  public camera: THREE.PerspectiveCamera;
  private overlayCanvas: HTMLCanvasElement;
  private overlayCtx: CanvasRenderingContext2D;

  private sunLight: THREE.DirectionalLight;
  private fillLight: THREE.DirectionalLight;
  public mapBuilder: MapBuilder;
  public vfx: VfxSystem;

  private heroModels = new Map<string, ArticulatedModel>();
  private heroPosLerp = new Map<string, { x: number; z: number; facing: number }>();
  private minionModels = new Map<string, THREE.Group>();
  private monsterModels = new Map<string, THREE.Group>();
  private playerRing: THREE.Mesh;
  private moveMarker: THREE.Mesh;
  private moveMarkerTimer = 0;
  private libaiShadowRing: THREE.Mesh;

  private popups: FloatingPopup[] = [];
  private cameraTarget = new THREE.Vector3(24, 0, 136);
  private manualPanOffset = new THREE.Vector2(0, 0);
  private shakeTime = 0;
  private shakeAmp = 0;
  public flipForRed = false;
  public highQuality = true;
  private cameraZoom = 1;
  private cameraYaw = 0;
  public lockedTargetId: string | null = null;

  private raycaster = new THREE.Raycaster();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  constructor(container: HTMLElement, localTeam: Team) {
    this.container = container;
    this.flipForRed = localTeam === 'red';

    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0c1b29);
    this.scene.fog = new THREE.FogExp2(0x112536, 0.0052);

    this.camera = new THREE.PerspectiveCamera(42, w / h, 1, 260);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(w, h);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.18;

    // Image-based lighting: without it metalness armour renders as flat plastic
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.45;
    pmrem.dispose();

    container.innerHTML = '';
    this.renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;';
    container.appendChild(this.renderer.domElement);

    // 2D Overlay canvas for crisp 60fps HP/MP bars, damage numbers, CC tags
    this.overlayCanvas = document.createElement('canvas');
    this.overlayCanvas.style.cssText =
      'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:2;';
    container.appendChild(this.overlayCanvas);
    this.overlayCtx = this.overlayCanvas.getContext('2d')!;
    this.resizeOverlay(w, h);

    // Warm Golden Sunlight + Cool Sky Hemisphere Lighting
    const hemi = new THREE.HemisphereLight(0xcfe8ff, 0x263d2d, 0.88);
    this.scene.add(hemi);

    this.sunLight = new THREE.DirectionalLight(0xfff1cf, 1.95);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(2048, 2048);
    this.sunLight.shadow.camera.near = 10;
    this.sunLight.shadow.camera.far = 140;
    const d = 38;
    this.sunLight.shadow.camera.left = -d;
    this.sunLight.shadow.camera.right = d;
    this.sunLight.shadow.camera.top = d;
    this.sunLight.shadow.camera.bottom = -d;
    this.sunLight.shadow.bias = -0.0005;
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);

    // Camera-side fill light keeps hero faces and armor readable (no shadows)
    this.fillLight = new THREE.DirectionalLight(0xc7e6ff, 0.62);
    this.fillLight.castShadow = false;
    this.scene.add(this.fillLight);
    this.scene.add(this.fillLight.target);

    // Canyon Map & VFX
    this.mapBuilder = new MapBuilder();
    this.scene.add(this.mapBuilder.group);

    this.vfx = new VfxSystem();
    this.scene.add(this.vfx.group);

    // Player underfoot glowing selection ring
    const ringGeo = new THREE.PlaneGeometry(3.4, 3.4);
    ringGeo.rotateX(-Math.PI / 2);
    this.playerRing = new THREE.Mesh(
      ringGeo,
      new THREE.MeshBasicMaterial({
        map: createRuneRingTexture(),
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.72,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    this.playerRing.position.y = 0.14;
    this.scene.add(this.playerRing);

    // Right-click move target ripple
    const mmGeo = new THREE.RingGeometry(0.65, 1.0, 24);
    mmGeo.rotateX(-Math.PI / 2);
    this.moveMarker = new THREE.Mesh(
      mmGeo,
      new THREE.MeshBasicMaterial({
        color: 0x4ade80,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    this.moveMarker.position.y = 0.16;
    this.scene.add(this.moveMarker);

    // Li Bai S1 shadow beacon
    const shGeo = new THREE.PlaneGeometry(3.2, 3.2);
    shGeo.rotateX(-Math.PI / 2);
    this.libaiShadowRing = new THREE.Mesh(
      shGeo,
      new THREE.MeshBasicMaterial({
        map: createRuneRingTexture(),
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    this.libaiShadowRing.position.y = 0.2;
    this.libaiShadowRing.visible = false;
    this.scene.add(this.libaiShadowRing);

    if (localTeam === 'red') {
      this.cameraTarget.set(136, 0, 24);
    }

    window.addEventListener('resize', this.onResize);
  }

  private resizeOverlay(w: number, h: number): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.overlayCanvas.width = Math.floor(w * dpr);
    this.overlayCanvas.height = Math.floor(h * dpr);
    this.overlayCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  public onResize = () => {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.resizeOverlay(w, h);
  };

  public setQuality(high: boolean): void {
    this.highQuality = high;
    this.renderer.shadowMap.enabled = high;
    this.renderer.setPixelRatio(high ? Math.min(window.devicePixelRatio || 1, 2) : 1);
  }

  public showMoveMarker(x: number, z: number): void {
    this.moveMarker.position.set(x, 0.18, z);
    this.moveMarkerTimer = 0.55;
  }

  public setManualCameraPan(worldX: number, worldZ: number): void {
    this.manualPanOffset.set(worldX, worldZ);
  }

  public clearManualCameraPan(): void {
    this.manualPanOffset.set(0, 0);
  }

  public getZoom(): number {
    return this.cameraZoom;
  }

  public setZoom(value: number): void {
    this.cameraZoom = Math.max(0.55, Math.min(1.8, value));
  }

  public zoomBy(factor: number): void {
    this.setZoom(this.cameraZoom * factor);
  }

  public rotateCamera(delta: number): void {
    this.cameraYaw += delta;
  }

  public resetCameraView(): void {
    this.cameraZoom = 1;
    this.cameraYaw = 0;
  }

  public setLockedTarget(id: string | null): void {
    this.lockedTargetId = id;
  }

  public pickEnemyUnit(
    clientX: number,
    clientY: number,
    snap: WorldSnapshot,
    localTeam: Team
  ): string | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const candidates: { id: string; d: number }[] = [];
    const consider = (id: string, x: number, y: number, z: number, bias: number) => {
      const p = this.project(x, y, z);
      if (!p.visible) return;
      candidates.push({ id, d: Math.hypot(p.sx - px, p.sy - py) - bias });
    };
    for (const h of snap.heroes) {
      if (!h.alive || h.team === localTeam) continue;
      const lp = this.heroPosLerp.get(h.id) || h;
      consider(h.id, lp.x, 2.2, lp.z, 14);
    }
    for (const m of snap.minions) {
      if (m.team === localTeam) continue;
      consider(m.id, m.x, 1.4, m.z, 0);
    }
    for (const mon of snap.monsters) {
      if (!mon.alive) continue;
      consider(mon.id, mon.x, 2.0, mon.z, 4);
    }
    for (const t of snap.turrets) {
      if (!t.alive || t.team === localTeam) continue;
      consider(t.id, t.x, t.tier === 'crystal' ? 5.5 : 4.2, t.z, 6);
    }
    const best = candidates.sort((a, b) => a.d - b.d)[0];
    return best && best.d < 48 ? best.id : null;
  }

  public triggerShake(amp: number, dur: number): void {
    this.shakeAmp = Math.max(this.shakeAmp, amp);
    this.shakeTime = Math.max(this.shakeTime, dur);
  }

  public screenToWorld(clientX: number, clientY: number): { x: number; z: number } | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    const out = new THREE.Vector3();
    if (this.raycaster.ray.intersectPlane(this.groundPlane, out)) {
      return { x: out.x, z: out.z };
    }
    return null;
  }

  public ingestEvents(events: GameEvent[], localHeroId: string): void {
    for (const ev of events) {
      this.vfx.spawnEventVfx(ev);
      if (ev.type === 'damage' && ev.x !== undefined && ev.z !== undefined && ev.value) {
        const col =
          ev.damageType === 'true'
            ? '#ffffff'
            : ev.damageType === 'magic'
            ? '#d8b4fe'
            : ev.crit
            ? '#fb923c'
            : '#fef08a';
        this.popups.push({
          x: ev.x + (Math.random() - 0.5) * 1.1,
          y: 3.1,
          z: ev.z + (Math.random() - 0.5) * 1.1,
          text: ev.crit ? `暴击 ${ev.value}!` : `-${ev.value}`,
          color: col,
          size: ev.crit ? 18 : ev.damageType === 'true' ? 15 : 13,
          age: 0,
          dur: 0.78,
        });
      } else if (ev.type === 'heal' && ev.x !== undefined && ev.z !== undefined && ev.value) {
        this.popups.push({
          x: ev.x + (Math.random() - 0.5) * 0.8,
          y: 3.3,
          z: ev.z,
          text: `+${ev.value}`,
          color: '#4ade80',
          size: 13,
          age: 0,
          dur: 0.75,
        });
      } else if (ev.type === 'gold' && ev.x !== undefined && ev.z !== undefined && ev.value) {
        this.popups.push({
          x: ev.x,
          y: 2.8,
          z: ev.z,
          text: `+${ev.value} 金币`,
          color: '#fbbf24',
          size: 14,
          age: 0,
          dur: 1.0,
        });
      } else if (ev.type === 'vfx' && (ev.vfxKind === 'holy_slam' || ev.vfxKind === 'lubu_ult_land' || ev.vfxKind === 'turret_explode' || ev.vfxKind === 'phoenix_boom')) {
        this.triggerShake(0.65, 0.32);
      } else if (ev.type === 'level_up' && ev.unitId === localHeroId) {
        this.popups.push({
          x: ev.x ?? 80,
          y: 4.0,
          z: ev.z ?? 80,
          text: `升级 Lv.${ev.value}!`,
          color: '#fde047',
          size: 18,
          age: 0,
          dur: 1.25,
        });
      }
    }
  }

  public isEnemyVisible(unit: { x: number; z: number; team?: Team; inBush?: boolean; revealedTimer?: number }, snap: WorldSnapshot, localTeam: Team): boolean {
    if (unit.team === localTeam) return true;
    if (unit.revealedTimer && unit.revealedTimer > 0) return true;

    for (const h of snap.heroes) {
      if (h.alive && h.team === localTeam) {
        const d = Math.hypot(h.x - unit.x, h.z - unit.z);
        if (unit.inBush ? d < 5.5 : d <= HERO_VISION_RANGE) return true;
      }
    }
    if (!unit.inBush) {
      for (const m of snap.minions) {
        if (m.team === localTeam && Math.hypot(m.x - unit.x, m.z - unit.z) <= MINION_VISION_RANGE) return true;
      }
      for (const t of snap.turrets) {
        if (t.alive && t.team === localTeam && Math.hypot(t.x - unit.x, t.z - unit.z) <= TURRET_VISION_RANGE) return true;
      }
    }
    return false;
  }

  public render(snap: WorldSnapshot, localHeroId: string, dt: number, elapsed: number): void {
    const localHero = snap.heroes.find((h) => h.id === localHeroId) || snap.heroes[0];
    const localTeam: Team = localHero?.team || 'blue';

    // 1. Sync & animate all 10 Heroes
    for (const h of snap.heroes) {
      let model = this.heroModels.get(h.id);
      if (!model) {
        model = buildHeroModel(h.heroId);
        this.heroModels.set(h.id, model);
        this.scene.add(model.root);
      }

      let lerped = this.heroPosLerp.get(h.id);
      if (!lerped) {
        lerped = { x: h.x, z: h.z, facing: h.facing };
        this.heroPosLerp.set(h.id, lerped);
      } else {
        const jumpDist = Math.hypot(h.x - lerped.x, h.z - lerped.z);
        const alpha = jumpDist > 8 ? 1 : Math.min(1, dt * 16);
        lerped.x += (h.x - lerped.x) * alpha;
        lerped.z += (h.z - lerped.z) * alpha;
        const diff = Math.atan2(Math.sin(h.facing - lerped.facing), Math.cos(h.facing - lerped.facing));
        lerped.facing += diff * Math.min(1, dt * 18);
      }

      const visible = this.isEnemyVisible(h, snap, localTeam);
      model.root.visible = visible && (h.alive || h.respawnTimer > 0);
      model.root.position.set(lerped.x, 0, lerped.z);
      model.root.rotation.y = lerped.facing;

      const spdRatio = Math.hypot(h.vx, h.vz) / Math.max(1, h.moveSpeed);
      animateHeroModel(model, h.animState, elapsed, spdRatio, {
        arthurShields: h.arthurS2Timer > 0,
        lubuEnchant: h.lubuEnchantTimer > 0,
        knockup: h.knockupTimer > 0,
      });
    }

    // Player underfoot glowing ring & Li Bai shadow beacon
    if (localHero && localHero.alive) {
      const lp = this.heroPosLerp.get(localHero.id) || localHero;
      this.playerRing.visible = true;
      this.playerRing.position.set(lp.x, 0.14, lp.z);
      this.playerRing.rotation.z = elapsed * 0.9;

      if (localHero.heroId === 'libai' && localHero.libaiS1Stage > 0 && localHero.libaiS1Window > 0) {
        this.libaiShadowRing.visible = true;
        this.libaiShadowRing.position.set(localHero.libaiShadowX, 0.2, localHero.libaiShadowZ);
        this.libaiShadowRing.rotation.z = -elapsed * 2.4;
      } else {
        this.libaiShadowRing.visible = false;
      }
    } else {
      this.playerRing.visible = false;
      this.libaiShadowRing.visible = false;
    }

    // Right-click move ripple
    if (this.moveMarkerTimer > 0) {
      this.moveMarkerTimer = Math.max(0, this.moveMarkerTimer - dt);
      const t = 1 - this.moveMarkerTimer / 0.55;
      this.moveMarker.scale.setScalar(0.6 + t * 1.4);
      (this.moveMarker.material as THREE.MeshBasicMaterial).opacity = (1 - t) * 0.8;
    } else {
      (this.moveMarker.material as THREE.MeshBasicMaterial).opacity = 0;
    }

    // 2. Sync Minions
    const activeMinions = new Set<string>();
    for (const m of snap.minions) {
      activeMinions.add(m.id);
      let mesh = this.minionModels.get(m.id);
      if (!mesh) {
        mesh = buildMinionModel(m.team, m.type);
        this.minionModels.set(m.id, mesh);
        this.scene.add(mesh);
      }
      mesh.visible = this.isEnemyVisible(m, snap, localTeam);
      mesh.position.set(m.x, Math.abs(Math.sin(elapsed * 9 + m.x)) * 0.08, m.z);
      mesh.rotation.y = m.facing;
    }
    for (const [id, mesh] of this.minionModels.entries()) {
      if (!activeMinions.has(id)) {
        this.scene.remove(mesh);
        this.minionModels.delete(id);
      }
    }

    // 3. Sync Jungle Monsters
    for (const mon of snap.monsters) {
      let mesh = this.monsterModels.get(mon.id);
      if (!mesh) {
        mesh = buildMonsterModel(mon.type);
        this.monsterModels.set(mon.id, mesh);
        this.scene.add(mesh);
      }
      mesh.visible = mon.alive;
      if (mon.alive) {
        const bob = Math.sin(elapsed * 2.5 + mon.homeX) * 0.1;
        mesh.position.set(mon.x, bob, mon.z);
        mesh.rotation.y = mon.facing;
      }
    }

    // 4. Update Map & VFX
    const unitLookup = (id: string) => {
      const h = snap.heroes.find((x) => x.id === id);
      if (h) return this.heroPosLerp.get(h.id) || h;
      const m = snap.minions.find((x) => x.id === id);
      if (m) return m;
      return null;
    };
    this.mapBuilder.update(
      elapsed,
      snap.turrets,
      localHero ? { id: localHero.id, team: localHero.team, x: localHero.x, z: localHero.z } : null,
      unitLookup
    );
    this.vfx.syncState(snap.projectiles, snap.zones, dt, elapsed);

    // 5. Smooth Honor of Kings Camera Follow
    if (localHero) {
      const lp = this.heroPosLerp.get(localHero.id) || localHero;
      const targetX = this.manualPanOffset.lengthSq() > 0.01 ? this.manualPanOffset.x : lp.x;
      const targetZ = this.manualPanOffset.lengthSq() > 0.01 ? this.manualPanOffset.y : lp.z;
      this.cameraTarget.x += (targetX - this.cameraTarget.x) * Math.min(1, dt * 8.5);
      this.cameraTarget.z += (targetZ - this.cameraTarget.z) * Math.min(1, dt * 8.5);
    }

    let shakeX = 0;
    let shakeZ = 0;
    if (this.shakeTime > 0) {
      this.shakeTime = Math.max(0, this.shakeTime - dt);
      shakeX = (Math.random() - 0.5) * this.shakeAmp;
      shakeZ = (Math.random() - 0.5) * this.shakeAmp;
    }

    const baseAngle = this.flipForRed ? Math.PI : 0;
    const angle = baseAngle + this.cameraYaw;
    const backDist = 22.5 * this.cameraZoom;
    this.camera.position.set(
      this.cameraTarget.x + Math.sin(angle) * backDist + shakeX,
      27.5 * this.cameraZoom,
      this.cameraTarget.z + Math.cos(angle) * backDist + shakeZ
    );
    this.camera.lookAt(this.cameraTarget.x, 0.5, this.cameraTarget.z);

    // Keep shadow frustum centered around active battlefield view!
    this.sunLight.position.set(this.cameraTarget.x + 28, 48, this.cameraTarget.z + 22);
    this.sunLight.target.position.set(this.cameraTarget.x, 0, this.cameraTarget.z);
    this.sunLight.target.updateMatrixWorld();

    this.fillLight.position.set(this.camera.position.x, this.camera.position.y + 8, this.camera.position.z);
    this.fillLight.target.position.set(this.cameraTarget.x, 1.6, this.cameraTarget.z);
    this.fillLight.target.updateMatrixWorld();

    // 6. Render 3D Scene
    this.renderer.render(this.scene, this.camera);

    // 7. Render 2D Overhead Bars & Floating Combat Text
    this.renderOverlay(snap, localHeroId, localTeam, dt);
  }

  private project(x: number, y: number, z: number): { sx: number; sy: number; visible: boolean } {
    const v = new THREE.Vector3(x, y, z);
    v.project(this.camera);
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    return {
      sx: (v.x * 0.5 + 0.5) * w,
      sy: (-v.y * 0.5 + 0.5) * h,
      visible: v.z < 1 && v.x >= -1.2 && v.x <= 1.2 && v.y >= -1.2 && v.y <= 1.2,
    };
  }

  private renderOverlay(snap: WorldSnapshot, localHeroId: string, localTeam: Team, dt: number): void {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    const ctx = this.overlayCtx;
    ctx.clearRect(0, 0, w, h);

    // Turret HP bars
    for (const t of snap.turrets) {
      if (!t.alive) continue;
      if (t.hp >= t.maxHp && t.tier !== 'crystal') continue;
      const p = this.project(t.x, t.tier === 'crystal' ? 7.8 : 9.2, t.z);
      if (!p.visible) continue;
      const bw = t.tier === 'crystal' ? 96 : 66;
      const bh = 8;
      this.drawBar(ctx, p.sx - bw / 2, p.sy, bw, bh, t.hp / t.maxHp, t.team === localTeam ? '#38bdf8' : '#ef4444');
    }

    // Minion HP bars
    for (const m of snap.minions) {
      if (!this.isEnemyVisible(m, snap, localTeam)) continue;
      const p = this.project(m.x, m.type === 'vanguard' ? 3.5 : 2.3, m.z);
      if (!p.visible) continue;
      const bw = m.type === 'cannon' || m.type === 'super' || m.type === 'vanguard' ? 44 : 28;
      this.drawBar(ctx, p.sx - bw / 2, p.sy, bw, 4, m.hp / m.maxHp, m.team === localTeam ? '#60a5fa' : '#f87171');
    }

    // Monster HP bars
    for (const mon of snap.monsters) {
      if (!mon.alive) continue;
      const p = this.project(mon.x, mon.type === 'tyrant' || mon.type === 'overlord' ? 6.4 : 4.2, mon.z);
      if (!p.visible) continue;
      const isBoss = mon.type === 'tyrant' || mon.type === 'overlord';
      if (!isBoss && mon.hp >= mon.maxHp) continue;
      const bw = isBoss ? 102 : 60;
      this.drawBar(ctx, p.sx - bw / 2, p.sy, bw, isBoss ? 8 : 6, mon.hp / mon.maxHp, isBoss ? '#c084fc' : '#f59e0b');
      if (isBoss) {
        ctx.font = 'bold 11px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#fef3c7';
        ctx.fillText(mon.name, p.sx, p.sy - 4);
      }
    }

    // Hero Overhead Honor-of-Kings Style Segmented Bars!
    for (const hero of snap.heroes) {
      if (!hero.alive) continue;
      if (!this.isEnemyVisible(hero, snap, localTeam)) continue;
      const lp = this.heroPosLerp.get(hero.id) || hero;
      const p = this.project(lp.x, 3.85, lp.z);
      if (!p.visible) continue;

      const isSelf = hero.id === localHeroId;
      const isAlly = hero.team === localTeam;
      const bw = 74;
      const bh = 9;
      const bx = p.sx - bw / 2;
      const by = p.sy;

      // Name + Level badge
      ctx.font = 'bold 11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(0,0,0,0.75)';
      ctx.fillText(hero.playerName, p.sx + 1, by - 5);
      ctx.fillStyle = isSelf ? '#fde047' : isAlly ? '#bae6fd' : '#fecdd3';
      ctx.fillText(hero.playerName, p.sx, by - 6);

      // Level pill
      ctx.fillStyle = '#0f172a';
      ctx.strokeStyle = isSelf ? '#facc15' : '#64748b';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(bx - 20, by - 2, 18, 16, 4);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#f8fafc';
      ctx.font = 'bold 10px system-ui, sans-serif';
      ctx.fillText(`${hero.level}`, bx - 11, by + 10);

      // HP Bar background
      ctx.fillStyle = 'rgba(9, 13, 24, 0.88)';
      ctx.fillRect(bx - 1, by - 1, bw + 2, bh + (hero.maxMp > 0 ? 6 : 2));

      const hpPct = Math.max(0, Math.min(1, hero.hp / Math.max(1, hero.maxHp)));
      const hpCol = isSelf ? '#22c55e' : isAlly ? '#38bdf8' : '#ef4444';
      ctx.fillStyle = hpCol;
      ctx.fillRect(bx, by, bw * hpPct, bh);

      // Shield overlay (white-silver bar)
      if (hero.shield > 0) {
        const shPct = Math.min(1 - hpPct, hero.shield / Math.max(1, hero.maxHp));
        ctx.fillStyle = '#e2e8f0';
        ctx.fillRect(bx + bw * hpPct, by, bw * shPct, bh);
      }

      // 1000-HP Tick segments (iconic MOBA detail!)
      const segs = Math.floor(hero.maxHp / 1000);
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      for (let s = 1; s <= segs; s++) {
        const sx = bx + (s * 1000 / hero.maxHp) * bw;
        if (sx < bx + bw - 2) ctx.fillRect(sx, by, 1, bh);
      }

      // MP Bar
      if (hero.maxMp > 0) {
        const mpPct = Math.max(0, Math.min(1, hero.mp / hero.maxMp));
        ctx.fillStyle = '#3b82f6';
        ctx.fillRect(bx, by + bh + 1, bw * mpPct, 3);
      }

      // Status tags (眩晕 / 击飞 / 沉默 / 隐身 / 回城)
      let statusLabel = '';
      let statusColor = '#fbbf24';
      if (hero.knockupTimer > 0) {
        statusLabel = '击飞!';
        statusColor = '#f97316';
      } else if (hero.stunTimer > 0) {
        statusLabel = '眩晕!';
        statusColor = '#facc15';
      } else if (hero.silenceTimer > 0) {
        statusLabel = '沉默';
        statusColor = '#c084fc';
      } else if (hero.recallTimer > 0) {
        statusLabel = `回城中 ${hero.recallTimer.toFixed(1)}s`;
        statusColor = '#38bdf8';
      } else if (isSelf && hero.inBush) {
        statusLabel = '👁 草丛隐身';
        statusColor = '#4ade80';
      }
      if (statusLabel) {
        ctx.font = 'bold 11px system-ui, sans-serif';
        ctx.fillStyle = statusColor;
        ctx.fillText(statusLabel, p.sx, by - 19);
      }
    }

    // Target reticles: turret aggro and player lock-on
    const nowSec = performance.now() / 1000;
    const unitAnchor = (id: string): { x: number; z: number; y: number; r: number } | null => {
      const h = snap.heroes.find((u) => u.id === id && u.alive);
      if (h) {
        const lp = this.heroPosLerp.get(h.id) || h;
        return { x: lp.x, z: lp.z, y: 0.25, r: 1.9 };
      }
      const m = snap.minions.find((u) => u.id === id);
      if (m) return { x: m.x, z: m.z, y: 0.2, r: 1.35 };
      const mon = snap.monsters.find((u) => u.id === id && u.alive);
      if (mon) return { x: mon.x, z: mon.z, y: 0.2, r: mon.radius + 0.5 };
      const t = snap.turrets.find((u) => u.id === id && u.alive);
      if (t) return { x: t.x, z: t.z, y: 0.2, r: 3.4 };
      return null;
    };
    const drawReticle = (sx: number, sy: number, color: string, size: number, spin: number) => {
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.translate(sx, sy);
      ctx.rotate(spin);
      for (let i = 0; i < 4; i++) {
        ctx.rotate(Math.PI / 2);
        ctx.beginPath();
        ctx.moveTo(size, 0);
        ctx.lineTo(size, -size * 0.5);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(size, 0);
        ctx.lineTo(size + size * 0.35, size * 0.35);
        ctx.stroke();
      }
      ctx.restore();
    };

    for (const t of snap.turrets) {
      if (!t.alive || !t.targetId) continue;
      const anchor = unitAnchor(t.targetId);
      if (!anchor) continue;
      const p = this.project(anchor.x, anchor.y, anchor.z);
      if (!p.visible) continue;
      const onPlayer = t.targetId === localHeroId;
      const color = onPlayer ? `rgba(255,60,60,${0.55 + Math.sin(nowSec * 12) * 0.35})` : 'rgba(251,146,60,0.7)';
      drawReticle(p.sx, p.sy, color, 16, nowSec * 1.6);
    }

    if (this.lockedTargetId) {
      const anchor = unitAnchor(this.lockedTargetId);
      if (anchor) {
        const p = this.project(anchor.x, anchor.y, anchor.z);
        if (p.visible) {
          drawReticle(p.sx, p.sy, '#facc15', 22, -nowSec * 1.2);
          const size = 30 * anchor.r;
          ctx.save();
          ctx.strokeStyle = `rgba(250,204,21,${0.45 + Math.sin(nowSec * 6) * 0.2})`;
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.ellipse(p.sx, p.sy, size * 0.42, size * 0.2, 0, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
      }
    }

    // Floating Damage / Heal / Gold Numbers
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const pop = this.popups[i];
      pop.age += dt;
      if (pop.age >= pop.dur) {
        this.popups.splice(i, 1);
        continue;
      }
      const t = pop.age / pop.dur;
      const p = this.project(pop.x, pop.y + t * 2.2, pop.z);
      if (!p.visible) continue;
      ctx.save();
      ctx.globalAlpha = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
      ctx.font = `900 ${pop.size}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      ctx.strokeText(pop.text, p.sx, p.sy);
      ctx.fillStyle = pop.color;
      ctx.fillText(pop.text, p.sx, p.sy);
      ctx.restore();
    }
  }

  private drawBar(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    pct: number,
    color: string
  ): void {
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w * Math.max(0, Math.min(1, pct)), h);
  }

  public dispose(): void {
    window.removeEventListener('resize', this.onResize);
    this.renderer.dispose();
  }
}

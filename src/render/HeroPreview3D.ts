import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { HEROES } from '../sim/heroes';
import { HeroId } from '../sim/types';
import { ArticulatedModel, animateHeroModel, buildHeroModel } from './HeroModelBuilder';
import { createRuneRingTexture } from './Textures';

export class HeroPreview3D {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private pedestalGroup = new THREE.Group();
  private runeRing: THREE.Mesh;
  private currentModel: ArticulatedModel | null = null;
  private currentHeroId: HeroId | null = null;
  private rafId = 0;
  private startTime = performance.now();
  private rotY = 0.25;
  private dragging = false;
  private lastX = 0;
  private accentLight: THREE.PointLight;
  private disposed = false;

  constructor(container: HTMLElement) {
    this.container = container;
    this.scene = new THREE.Scene();

    const w = container.clientWidth || 420;
    const h = container.clientHeight || 420;
    this.camera = new THREE.PerspectiveCamera(34, w / h, 0.1, 60);
    this.camera.position.set(0, 2.55, 6.2);
    this.camera.lookAt(0, 1.55, 0);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(w, h);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.25;
    this.renderer.shadowMap.enabled = true;
    container.innerHTML = '';
    container.appendChild(this.renderer.domElement);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.8;
    pmrem.dispose();

    // Dramatic studio three-point lighting
    const hemi = new THREE.HemisphereLight(0xdbeafe, 0x1e293b, 1.0);
    this.scene.add(hemi);

    const key = new THREE.DirectionalLight(0xfff4d6, 2.2);
    key.position.set(4, 7, 5);
    key.castShadow = true;
    this.scene.add(key);

    const rim = new THREE.DirectionalLight(0x38bdf8, 1.4);
    rim.position.set(-4, 4, -5);
    this.scene.add(rim);

    this.accentLight = new THREE.PointLight(0xfbbf24, 2.2, 12);
    this.accentLight.position.set(0, 1.2, 2.2);
    this.scene.add(this.accentLight);

    // Ornate golden marble pedestal
    const stone = new THREE.Mesh(
      new THREE.CylinderGeometry(1.45, 1.72, 0.34, 16),
      new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.5, roughness: 0.35 })
    );
    stone.position.y = -0.17;
    stone.receiveShadow = true;
    const goldRim = new THREE.Mesh(
      new THREE.TorusGeometry(1.5, 0.055, 8, 32),
      new THREE.MeshStandardMaterial({ color: 0xeab308, metalness: 0.82, roughness: 0.22 })
    );
    goldRim.rotation.x = Math.PI / 2;
    goldRim.position.y = 0.01;

    const ringGeo = new THREE.PlaneGeometry(3.8, 3.8);
    ringGeo.rotateX(-Math.PI / 2);
    this.runeRing = new THREE.Mesh(
      ringGeo,
      new THREE.MeshBasicMaterial({
        map: createRuneRingTexture(),
        color: 0xfbbf24,
        transparent: true,
        opacity: 0.55,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    this.runeRing.position.y = 0.03;

    this.pedestalGroup.add(stone, goldRim, this.runeRing);
    this.scene.add(this.pedestalGroup);

    // Drag to rotate hero turntable
    const el = this.renderer.domElement;
    el.style.cursor = 'grab';
    el.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('resize', this.onResize);

    this.loop();
  }

  private onDown = (e: PointerEvent) => {
    this.dragging = true;
    this.lastX = e.clientX;
    this.renderer.domElement.style.cursor = 'grabbing';
  };

  private onMove = (e: PointerEvent) => {
    if (!this.dragging) return;
    const dx = e.clientX - this.lastX;
    this.lastX = e.clientX;
    this.rotY += dx * 0.012;
  };

  private onUp = () => {
    this.dragging = false;
    if (this.renderer.domElement) this.renderer.domElement.style.cursor = 'grab';
  };

  public onResize = () => {
    if (this.disposed) return;
    const w = this.container.clientWidth || 420;
    const h = this.container.clientHeight || 420;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  };

  public setHero(heroId: HeroId): void {
    if (this.currentHeroId === heroId) return;
    this.currentHeroId = heroId;
    if (this.currentModel) {
      this.scene.remove(this.currentModel.root);
    }
    this.currentModel = buildHeroModel(heroId);
    this.scene.add(this.currentModel.root);

    const def = HEROES[heroId];
    const col = new THREE.Color(def.primaryColor);
    this.accentLight.color.copy(col);
    (this.runeRing.material as THREE.MeshBasicMaterial).color.copy(col);
  }

  private loop = () => {
    if (this.disposed) return;
    this.rafId = requestAnimationFrame(this.loop);
    const elapsed = (performance.now() - this.startTime) * 0.001;
    if (!this.dragging) this.rotY += 0.0045;
    this.runeRing.rotation.z = -elapsed * 0.45;
    if (this.currentModel) {
      this.currentModel.root.rotation.y = this.rotY;
      animateHeroModel(this.currentModel, 'idle', elapsed, 0, {
        arthurShields: this.currentHeroId === 'arthur',
        lubuEnchant: this.currentHeroId === 'lubu',
      });
    }
    this.renderer.render(this.scene, this.camera);
  };

  public dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.rafId);
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('resize', this.onResize);
    this.renderer.dispose();
  }
}

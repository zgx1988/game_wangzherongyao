import * as THREE from 'three';
import {
  BLUE_CRYSTAL,
  BLUE_FOUNTAIN,
  LANE_WAYPOINTS_BLUE,
  MAP_SIZE,
  MONSTER_BLUEPRINTS,
  RED_CRYSTAL,
  RED_FOUNTAIN,
} from '../sim/constants';

let cachedCanyonTex: THREE.CanvasTexture | null = null;
let cachedStoneTex: THREE.CanvasTexture | null = null;
let cachedGlowTex: THREE.CanvasTexture | null = null;
let cachedRuneRingTex: THREE.CanvasTexture | null = null;

function toCanvas(v: number, size: number): number {
  return (v / MAP_SIZE) * size;
}

export function createCanyonGroundTexture(): THREE.CanvasTexture {
  if (cachedCanyonTex) return cachedCanyonTex;

  const S = 2048;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d')!;

  // 1. Base rich stylized MOBA canyon grass gradient (Blue lush emerald -> Red warm autumn-jade)
  const bgGrad = ctx.createLinearGradient(0, S, S, 0);
  bgGrad.addColorStop(0, '#1f4d3b');
  bgGrad.addColorStop(0.45, '#2b6647');
  bgGrad.addColorStop(0.55, '#336a48');
  bgGrad.addColorStop(1, '#4b4b32');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, S, S);

  // 2. Painterly mottled foliage brushstrokes across canyon
  let seed = 4219;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  for (let i = 0; i < 4200; i++) {
    const x = rand() * S;
    const y = rand() * S;
    const r = 14 + rand() * 48;
    const isRedSide = x + (S - y) > S;
    const palette = isRedSide
      ? ['rgba(86,98,52,0.16)', 'rgba(62,84,48,0.18)', 'rgba(116,96,52,0.14)', 'rgba(38,56,36,0.16)']
      : ['rgba(45,112,74,0.18)', 'rgba(58,132,86,0.16)', 'rgba(30,78,56,0.18)', 'rgba(84,148,96,0.12)'];
    ctx.fillStyle = palette[Math.floor(rand() * palette.length)];
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * (0.45 + rand() * 0.4), rand() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }

  // 3. River bed channel along x ≈ z (diagonal from top-left to bottom-right)
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(toCanvas(16, S), toCanvas(16, S));
  ctx.lineTo(toCanvas(144, S), toCanvas(144, S));
  ctx.strokeStyle = '#5c5a46'; // rocky shore
  ctx.lineWidth = toCanvas(22, S);
  ctx.stroke();

  ctx.strokeStyle = '#3b6d6c'; // shallow turquoise bank
  ctx.lineWidth = toCanvas(17.5, S);
  ctx.stroke();

  ctx.strokeStyle = '#1d4c5b'; // deep jade river channel
  ctx.lineWidth = toCanvas(13.5, S);
  ctx.stroke();

  // Overlord (50,50) & Tyrant (110,110) circular stone boss pits
  for (const pit of [
    { x: 50, z: 50, glow: '#f59e0b' },
    { x: 110, z: 110, glow: '#a855f7' },
  ]) {
    const px = toCanvas(pit.x, S);
    const pz = toCanvas(pit.z, S);
    const rad = toCanvas(11.5, S);
    const g = ctx.createRadialGradient(px, pz, rad * 0.2, px, pz, rad);
    g.addColorStop(0, '#2a3742');
    g.addColorStop(0.7, '#3f4b52');
    g.addColorStop(1, 'rgba(63,75,82,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(px, pz, rad, 0, Math.PI * 2);
    ctx.fill();

    // Carved glowing arena rune circle
    ctx.strokeStyle = pit.glow;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(px, pz, rad * 0.62, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(px, pz, rad * 0.45, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  ctx.restore();

  // 4. Three Ornate Stone Lanes (Top, Mid, Bot)
  const drawLanePath = (wps: { x: number; z: number }[]) => {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    wps.forEach((p, idx) => {
      const cx = toCanvas(p.x, S);
      const cz = toCanvas(p.z, S);
      if (idx === 0) ctx.moveTo(cx, cz);
      else ctx.lineTo(cx, cz);
    });

    // Mossy dirt outer border
    ctx.strokeStyle = '#6c5c43';
    ctx.lineWidth = toCanvas(14.2, S);
    ctx.stroke();

    // Golden-stone trim curb
    ctx.strokeStyle = '#a8926a';
    ctx.lineWidth = toCanvas(11.4, S);
    ctx.stroke();

    // Warm carved sandstone road surface
    ctx.strokeStyle = '#c8b48e';
    ctx.lineWidth = toCanvas(9.6, S);
    ctx.stroke();

    // Inner stone inlay highlight line
    ctx.strokeStyle = 'rgba(240, 224, 188, 0.38)';
    ctx.lineWidth = toCanvas(2.4, S);
    ctx.setLineDash([18, 12]);
    ctx.stroke();
    ctx.restore();
  };

  drawLanePath(LANE_WAYPOINTS_BLUE.top);
  drawLanePath(LANE_WAYPOINTS_BLUE.mid);
  drawLanePath(LANE_WAYPOINTS_BLUE.bot);

  // Subtle paved stone slabs texture along roads
  for (let i = 0; i < 2200; i++) {
    const x = rand() * S;
    const y = rand() * S;
    ctx.fillStyle = rand() > 0.5 ? 'rgba(255,245,220,0.06)' : 'rgba(40,30,20,0.06)';
    ctx.fillRect(x, y, 8 + rand() * 14, 4 + rand() * 8);
  }

  // 5. Jungle camp clearings with glowing buff circles
  for (const mon of MONSTER_BLUEPRINTS) {
    if (mon.type === 'tyrant' || mon.type === 'overlord' || mon.type === 'river_spirit') continue;
    const mx = toCanvas(mon.x, S);
    const mz = toCanvas(mon.z, S);
    const r = toCanvas(6.8, S);
    const g = ctx.createRadialGradient(mx, mz, r * 0.15, mx, mz, r);
    g.addColorStop(0, '#786950');
    g.addColorStop(0.65, '#59523c');
    g.addColorStop(1, 'rgba(89,82,60,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(mx, mz, r, 0, Math.PI * 2);
    ctx.fill();

    if (mon.type === 'blue_buff' || mon.type === 'red_buff') {
      ctx.strokeStyle = mon.type === 'blue_buff' ? 'rgba(56,189,248,0.55)' : 'rgba(239,68,68,0.55)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(mx, mz, r * 0.58, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // 6. Sacred Blue Base & Red Base Plazas with Ornamental Filigree
  const drawBasePlaza = (
    crystal: { x: number; z: number },
    fountain: { x: number; z: number },
    primary: string,
    accent: string,
    marble: string
  ) => {
    const cx = toCanvas(crystal.x, S);
    const cz = toCanvas(crystal.z, S);
    const fx = toCanvas(fountain.x, S);
    const fz = toCanvas(fountain.z, S);
    const baseR = toCanvas(26, S);

    // Plaza stone foundation
    const g = ctx.createRadialGradient(cx, cz, baseR * 0.15, cx, cz, baseR);
    g.addColorStop(0, marble);
    g.addColorStop(0.72, '#8d8980');
    g.addColorStop(0.88, '#696259');
    g.addColorStop(1, 'rgba(105,98,89,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cz, baseR, 0, Math.PI * 2);
    ctx.fill();

    // Ornate golden concentric rings around Crystal
    ctx.strokeStyle = accent;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(cx, cz, toCanvas(9.5, S), 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = primary;
    ctx.lineWidth = 4;
    ctx.setLineDash([16, 10]);
    ctx.beginPath();
    ctx.arc(cx, cz, toCanvas(12.2, S), 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // 8 radial sacred spokes
    ctx.strokeStyle = 'rgba(251, 191, 36, 0.45)';
    ctx.lineWidth = 3;
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * toCanvas(4, S), cz + Math.sin(a) * toCanvas(4, S));
      ctx.lineTo(cx + Math.cos(a) * toCanvas(12, S), cz + Math.sin(a) * toCanvas(12, S));
      ctx.stroke();
    }

    // Spawn Fountain Altar
    const fg = ctx.createRadialGradient(fx, fz, 10, fx, fz, toCanvas(10.5, S));
    fg.addColorStop(0, primary);
    fg.addColorStop(0.55, 'rgba(255,255,255,0.22)');
    fg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = fg;
    ctx.beginPath();
    ctx.arc(fx, fz, toCanvas(10.5, S), 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = accent;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(fx, fz, toCanvas(8.2, S), 0, Math.PI * 2);
    ctx.stroke();
  };

  drawBasePlaza(BLUE_CRYSTAL, BLUE_FOUNTAIN, '#38bdf8', '#fbbf24', '#bccad6');
  drawBasePlaza(RED_CRYSTAL, RED_FOUNTAIN, '#f43f5e', '#f59e0b', '#c4b4b0');

  // Mid-lane center medallion at (80, 80)
  const midC = toCanvas(80, S);
  ctx.strokeStyle = 'rgba(251, 191, 36, 0.42)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(midC, midC, toCanvas(7.2, S), 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(midC, midC, toCanvas(5.0, S), 0, Math.PI * 2);
  ctx.stroke();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  cachedCanyonTex = tex;
  return tex;
}

export function createStoneTexture(): THREE.CanvasTexture {
  if (cachedStoneTex) return cachedStoneTex;
  const S = 512;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#737882';
  ctx.fillRect(0, 0, S, S);

  // Carved stone masonry blocks
  const rows = 8;
  const rowH = S / rows;
  for (let r = 0; r < rows; r++) {
    const offset = (r % 2) * 44;
    for (let x = -44; x < S; x += 88) {
      const shade = 104 + Math.floor(Math.sin(r * 7 + x * 0.13) * 18);
      ctx.fillStyle = `rgb(${shade}, ${shade + 2}, ${shade + 8})`;
      ctx.fillRect(x + offset + 3, r * rowH + 3, 82, rowH - 6);
      ctx.strokeStyle = 'rgba(30,35,44,0.6)';
      ctx.lineWidth = 3;
      ctx.strokeRect(x + offset + 2, r * rowH + 2, 84, rowH - 4);
    }
  }
  // Subtle weathering speckles
  for (let i = 0; i < 900; i++) {
    ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)';
    ctx.fillRect((i * 73) % S, (i * 139) % S, 6, 4);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  cachedStoneTex = tex;
  return tex;
}

export function createGlowTexture(): THREE.CanvasTexture {
  if (cachedGlowTex) return cachedGlowTex;
  const S = 128;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(S / 2, S / 2, 2, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.28, 'rgba(255,255,255,0.75)');
  g.addColorStop(0.65, 'rgba(255,255,255,0.18)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  const tex = new THREE.CanvasTexture(canvas);
  cachedGlowTex = tex;
  return tex;
}

export function createRuneRingTexture(): THREE.CanvasTexture {
  if (cachedRuneRingTex) return cachedRuneRingTex;
  const S = 256;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d')!;
  const c = S / 2;

  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(c, c, c - 12, 0, Math.PI * 2);
  ctx.stroke();

  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(c, c, c - 26, 0, Math.PI * 2);
  ctx.stroke();

  // Eastern mystic geometric runes around perimeter
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    ctx.save();
    ctx.translate(c + Math.cos(a) * (c - 19), c + Math.sin(a) * (c - 19));
    ctx.rotate(a + Math.PI / 2);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(-3, -5, 6, 10);
    ctx.restore();
  }

  const tex = new THREE.CanvasTexture(canvas);
  cachedRuneRingTex = tex;
  return tex;
}

import { Lane, MonsterType, Team, TurretTier, Vec2 } from './types';

export const MAP_SIZE = 160;
export const HALF_MAP = MAP_SIZE / 2;

export const BLUE_FOUNTAIN: Vec2 = { x: 11, z: 149 };
export const RED_FOUNTAIN: Vec2 = { x: 149, z: 11 };

export const BLUE_CRYSTAL: Vec2 = { x: 21, z: 139 };
export const RED_CRYSTAL: Vec2 = { x: 139, z: 21 };

export const FOUNTAIN_RADIUS = 10.5;
export const HERO_VISION_RANGE = 23;
export const MINION_VISION_RANGE = 14;
export const TURRET_VISION_RANGE = 19;

export interface WallCollider {
  id: string;
  x: number;
  z: number;
  w: number; // full width along X
  d: number; // full depth along Z
  rot: number; // radians around Y
  height: number;
  kind: 'cliff' | 'base_wall' | 'jungle_rock' | 'pit_wall';
}

export interface BushZone {
  id: string;
  x: number;
  z: number;
  rx: number; // half-width
  rz: number; // half-depth
  rot: number;
}

export interface TurretBlueprint {
  id: string;
  team: Team;
  lane: 'top' | 'mid' | 'bot' | 'base';
  tier: TurretTier;
  x: number;
  z: number;
}

export interface MonsterBlueprint {
  id: string;
  type: MonsterType;
  name: string;
  x: number;
  z: number;
  maxHp: number;
  ad: number;
  armor: number;
  radius: number;
  gold: number;
  xp: number;
  respawnTime: number;
  firstSpawnTime: number;
}

export function mirrorPoint(p: Vec2): Vec2 {
  return { x: MAP_SIZE - p.x, z: MAP_SIZE - p.z };
}

// Lane waypoints from Blue base to Red base
export const LANE_WAYPOINTS_BLUE: Record<'top' | 'mid' | 'bot', Vec2[]> = {
  top: [
    { x: 21, z: 135 },
    { x: 14, z: 116 },
    { x: 14, z: 80 },
    { x: 14, z: 36 },
    { x: 18, z: 18 },
    { x: 38, z: 14 },
    { x: 80, z: 14 },
    { x: 116, z: 14 },
    { x: 139, z: 21 },
  ],
  mid: [
    { x: 24, z: 136 },
    { x: 40, z: 120 },
    { x: 60, z: 100 },
    { x: 80, z: 80 },
    { x: 100, z: 60 },
    { x: 120, z: 40 },
    { x: 136, z: 24 },
  ],
  bot: [
    { x: 25, z: 139 },
    { x: 44, z: 146 },
    { x: 80, z: 146 },
    { x: 124, z: 146 },
    { x: 142, z: 142 },
    { x: 146, z: 122 },
    { x: 146, z: 80 },
    { x: 146, z: 44 },
    { x: 139, z: 21 },
  ],
};

export const LANE_WAYPOINTS_RED: Record<'top' | 'mid' | 'bot', Vec2[]> = {
  top: [...LANE_WAYPOINTS_BLUE.top].reverse(),
  mid: [...LANE_WAYPOINTS_BLUE.mid].reverse(),
  bot: [...LANE_WAYPOINTS_BLUE.bot].reverse(),
};

const BLUE_TURRETS_RAW: Omit<TurretBlueprint, 'team'>[] = [
  // Crystal
  { id: 'blue_crystal', lane: 'base', tier: 'crystal', x: BLUE_CRYSTAL.x, z: BLUE_CRYSTAL.z },
  // Top Lane
  { id: 'blue_top_hg', lane: 'top', tier: 'highground', x: 14, z: 112 },
  { id: 'blue_top_in', lane: 'top', tier: 'inner', x: 14, z: 84 },
  { id: 'blue_top_out', lane: 'top', tier: 'outer', x: 14, z: 54 },
  // Mid Lane
  { id: 'blue_mid_hg', lane: 'mid', tier: 'highground', x: 37, z: 123 },
  { id: 'blue_mid_in', lane: 'mid', tier: 'inner', x: 50, z: 110 },
  { id: 'blue_mid_out', lane: 'mid', tier: 'outer', x: 64, z: 96 },
  // Bot Lane
  { id: 'blue_bot_hg', lane: 'bot', tier: 'highground', x: 48, z: 146 },
  { id: 'blue_bot_in', lane: 'bot', tier: 'inner', x: 76, z: 146 },
  { id: 'blue_bot_out', lane: 'bot', tier: 'outer', x: 106, z: 146 },
];

export const TURRET_BLUEPRINTS: TurretBlueprint[] = [
  ...BLUE_TURRETS_RAW.map((t) => ({ ...t, team: 'blue' as Team })),
  ...BLUE_TURRETS_RAW.map((t) => ({
    ...t,
    id: t.id.replace('blue_', 'red_'),
    team: 'red' as Team,
    x: MAP_SIZE - t.x,
    z: MAP_SIZE - t.z,
  })),
];

// Jungle walls & canyon terrain blocks (symmetrically mirrored)
const HALF_WALLS: Omit<WallCollider, 'id'>[] = [
  // Blue base curved bastion flanks (between top/mid and mid/bot gates)
  { x: 25, z: 116, w: 12, d: 3.4, rot: 0.45, height: 5.0, kind: 'base_wall' },
  { x: 44, z: 135, w: 12, d: 3.4, rot: 1.12, height: 5.0, kind: 'base_wall' },

  // Blue Upper-Left Jungle (Blue Buff zone)
  { x: 31, z: 86, w: 13, d: 4.5, rot: 0.25, height: 4.4, kind: 'jungle_rock' },
  { x: 42, z: 72, w: 11, d: 4.2, rot: -0.65, height: 4.4, kind: 'jungle_rock' },
  { x: 27, z: 60, w: 9, d: 4.0, rot: 1.35, height: 4.2, kind: 'jungle_rock' },

  // Blue Lower-Right Jungle (Red Buff zone)
  { x: 74, z: 129, w: 13, d: 4.5, rot: 1.32, height: 4.4, kind: 'jungle_rock' },
  { x: 88, z: 118, w: 11, d: 4.2, rot: -0.92, height: 4.4, kind: 'jungle_rock' },
  { x: 100, z: 133, w: 9, d: 4.0, rot: 0.22, height: 4.2, kind: 'jungle_rock' },

  // Mid-lane river flank stones
  { x: 56, z: 86, w: 8.5, d: 3.6, rot: -0.78, height: 3.8, kind: 'jungle_rock' },
  { x: 74, z: 104, w: 8.5, d: 3.6, rot: -0.78, height: 3.8, kind: 'jungle_rock' },

  // Overlord pit (top river ~48,48) & Tyrant pit (bottom river ~112,112) back ridges
  { x: 42, z: 42, w: 12, d: 3.6, rot: -0.785, height: 4.8, kind: 'pit_wall' },
];

export const MAP_WALLS: WallCollider[] = [
  ...HALF_WALLS.map((w, i) => ({ ...w, id: `wall_b_${i}` })),
  ...HALF_WALLS.map((w, i) => ({
    ...w,
    id: `wall_r_${i}`,
    x: MAP_SIZE - w.x,
    z: MAP_SIZE - w.z,
    rot: w.rot + Math.PI,
  })),
];

// Iconic Honor of Kings Bushes (草丛) — stealth zones!
const HALF_BUSHES: Omit<BushZone, 'id'>[] = [
  // Mid lane left & right river bushes (famous gank spots!)
  { x: 69, z: 75, rx: 4.2, rz: 2.2, rot: -0.785 },
  { x: 85, z: 91, rx: 4.2, rz: 2.2, rot: -0.785 },
  // Top lane outer bushes (2 classic side bushes)
  { x: 6.5, z: 36, rx: 2.3, rz: 5.5, rot: 0 },
  { x: 25, z: 34, rx: 2.6, rz: 4.0, rot: 0.4 },
  // Bot lane outer bushes
  { x: 124, z: 153.5, rx: 5.5, rz: 2.3, rot: 0 },
  { x: 126, z: 135, rx: 4.0, rz: 2.6, rot: 0.4 },
  // Blue buff & Red buff ambush bushes
  { x: 46, z: 95, rx: 3.6, rz: 2.2, rot: -0.6 },
  { x: 65, z: 114, rx: 3.6, rz: 2.2, rot: -0.6 },
  { x: 34, z: 68, rx: 3.4, rz: 2.2, rot: 0.7 },
  { x: 92, z: 126, rx: 3.4, rz: 2.2, rot: 0.7 },
  // River pit flank bushes
  { x: 58, z: 58, rx: 2.8, rz: 4.4, rot: 0.785 },
];

export const MAP_BUSHES: BushZone[] = [
  ...HALF_BUSHES.map((b, i) => ({ ...b, id: `bush_b_${i}` })),
  ...HALF_BUSHES.map((b, i) => ({
    ...b,
    id: `bush_r_${i}`,
    x: MAP_SIZE - b.x,
    z: MAP_SIZE - b.z,
    rot: b.rot,
  })),
];

// Jungle Monster Camps (Blue side, Red side, River Bosses)
export const MONSTER_BLUEPRINTS: MonsterBlueprint[] = [
  // Blue side jungle
  {
    id: 'blue_buff_b',
    type: 'blue_buff',
    name: '苍蓝石像 (蓝Buff)',
    x: 41,
    z: 84,
    maxHp: 3800,
    ad: 135,
    armor: 140,
    radius: 2.3,
    gold: 115,
    xp: 220,
    respawnTime: 85,
    firstSpawnTime: 18,
  },
  {
    id: 'red_buff_b',
    type: 'red_buff',
    name: '绯红石像 (红Buff)',
    x: 76,
    z: 119,
    maxHp: 3800,
    ad: 150,
    armor: 140,
    radius: 2.3,
    gold: 115,
    xp: 220,
    respawnTime: 85,
    firstSpawnTime: 18,
  },
  {
    id: 'wolf_b',
    type: 'wolf',
    name: '幽影魔狼',
    x: 36,
    z: 101,
    maxHp: 2200,
    ad: 95,
    armor: 100,
    radius: 1.7,
    gold: 75,
    xp: 140,
    respawnTime: 65,
    firstSpawnTime: 18,
  },
  {
    id: 'boar_b',
    type: 'boar',
    name: '烈焰野猪',
    x: 91,
    z: 131,
    maxHp: 2200,
    ad: 95,
    armor: 100,
    radius: 1.7,
    gold: 75,
    xp: 140,
    respawnTime: 65,
    firstSpawnTime: 18,
  },

  // Red side jungle (exact symmetric mirror)
  {
    id: 'blue_buff_r',
    type: 'blue_buff',
    name: '苍蓝石像 (蓝Buff)',
    x: MAP_SIZE - 41,
    z: MAP_SIZE - 84,
    maxHp: 3800,
    ad: 135,
    armor: 140,
    radius: 2.3,
    gold: 115,
    xp: 220,
    respawnTime: 85,
    firstSpawnTime: 18,
  },
  {
    id: 'red_buff_r',
    type: 'red_buff',
    name: '绯红石像 (红Buff)',
    x: MAP_SIZE - 76,
    z: MAP_SIZE - 119,
    maxHp: 3800,
    ad: 150,
    armor: 140,
    radius: 2.3,
    gold: 115,
    xp: 220,
    respawnTime: 85,
    firstSpawnTime: 18,
  },
  {
    id: 'wolf_r',
    type: 'wolf',
    name: '幽影魔狼',
    x: MAP_SIZE - 36,
    z: MAP_SIZE - 101,
    maxHp: 2200,
    ad: 95,
    armor: 100,
    radius: 1.7,
    gold: 75,
    xp: 140,
    respawnTime: 65,
    firstSpawnTime: 18,
  },
  {
    id: 'boar_r',
    type: 'boar',
    name: '烈焰野猪',
    x: MAP_SIZE - 91,
    z: MAP_SIZE - 131,
    maxHp: 2200,
    ad: 95,
    armor: 100,
    radius: 1.7,
    gold: 75,
    xp: 140,
    respawnTime: 65,
    firstSpawnTime: 18,
  },

  // River Objectives
  {
    id: 'river_spirit',
    type: 'river_spirit',
    name: '河道之灵',
    x: 68,
    z: 68,
    maxHp: 2600,
    ad: 50,
    armor: 80,
    radius: 1.6,
    gold: 140,
    xp: 190,
    respawnTime: 90,
    firstSpawnTime: 30,
  },
  {
    id: 'tyrant',
    type: 'tyrant',
    name: '暗影暴君',
    x: 110,
    z: 110,
    maxHp: 9800,
    ad: 245,
    armor: 185,
    radius: 3.3,
    gold: 260,
    xp: 480,
    respawnTime: 150,
    firstSpawnTime: 75,
  },
  {
    id: 'overlord',
    type: 'overlord',
    name: '暗影主宰',
    x: 50,
    z: 50,
    maxHp: 11500,
    ad: 270,
    armor: 200,
    radius: 3.5,
    gold: 300,
    xp: 550,
    respawnTime: 170,
    firstSpawnTime: 120,
  },
];

export const DEFAULT_TEAM_LANES: Lane[] = ['top', 'jungle', 'mid', 'bot', 'bot'];

export const HERO_SPAWN_OFFSETS: Vec2[] = [
  { x: -3.2, z: -2.2 },
  { x: 0, z: -3.5 },
  { x: 3.2, z: -2.2 },
  { x: -2.2, z: 2.5 },
  { x: 2.2, z: 2.5 },
];

export const XP_TABLE: number[] = [
  0, // unused
  210, 320, 440, 580, 740, 920, 1120, 1340, 1580, 1840, 2120, 2420, 2750, 3100, 99999,
];

export const QUICK_CHAT_MESSAGES: string[] = [
  '请求集合！',
  '发起进攻！',
  '开始撤退！',
  '小心草丛！',
  '稳住，我们能赢！',
  '干得漂亮！',
];

// Helper: check if point is inside an oriented box (for walls/bushes)
export function pointInOrientedBox(
  px: number,
  pz: number,
  bx: number,
  bz: number,
  halfW: number,
  halfD: number,
  rot: number
): boolean {
  const dx = px - bx;
  const dz = pz - bz;
  const cos = Math.cos(-rot);
  const sin = Math.sin(-rot);
  const lx = dx * cos - dz * sin;
  const lz = dx * sin + dz * cos;
  return Math.abs(lx) <= halfW && Math.abs(lz) <= halfD;
}

// Helper: push circle out of oriented box wall
export function resolveCircleWall(
  x: number,
  z: number,
  radius: number,
  wall: WallCollider
): { x: number; z: number; collided: boolean } {
  const dx = x - wall.x;
  const dz = z - wall.z;
  const cos = Math.cos(-wall.rot);
  const sin = Math.sin(-wall.rot);
  const lx = dx * cos - dz * sin;
  const lz = dx * sin + dz * cos;

  const hw = wall.w * 0.5;
  const hd = wall.d * 0.5;

  const cx = Math.max(-hw, Math.min(hw, lx));
  const cz = Math.max(-hd, Math.min(hd, lz));

  const ox = lx - cx;
  const oz = lz - cz;
  const distSq = ox * ox + oz * oz;

  if (distSq >= radius * radius) {
    return { x, z, collided: false };
  }

  let pushLx = 0;
  let pushLz = 0;
  if (distSq < 1e-6) {
    // Center is inside box; push out along closest axis
    const penX = hw - Math.abs(lx);
    const penZ = hd - Math.abs(lz);
    if (penX < penZ) {
      pushLx = (lx >= 0 ? 1 : -1) * (penX + radius);
    } else {
      pushLz = (lz >= 0 ? 1 : -1) * (penZ + radius);
    }
  } else {
    const dist = Math.sqrt(distSq);
    const overlap = radius - dist;
    pushLx = (ox / dist) * overlap;
    pushLz = (oz / dist) * overlap;
  }

  const rCos = Math.cos(wall.rot);
  const rSin = Math.sin(wall.rot);
  const wx = pushLx * rCos - pushLz * rSin;
  const wz = pushLx * rSin + pushLz * rCos;

  return { x: x + wx, z: z + wz, collided: true };
}

export function isInRiver(x: number, z: number): boolean {
  // River runs along x ≈ z between (18,18) and (142,142)
  const perpDist = Math.abs(x - z) / Math.SQRT2;
  const along = (x + z) * 0.5;
  return perpDist < 8.5 && along > 22 && along < 138;
}

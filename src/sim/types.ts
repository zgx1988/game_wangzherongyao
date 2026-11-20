export type Team = 'blue' | 'red';
export type Lane = 'top' | 'mid' | 'bot' | 'jungle';
export type HeroId = 'arthur' | 'libai' | 'daji' | 'houyi' | 'lubu' | 'caiwenji';
export type SummonerSkillId = 'flash' | 'smite' | 'heal';
export type AiDifficulty = 'easy' | 'normal' | 'hard';
export type TargetPriority = 'auto' | 'minion' | 'tower';

export type SkillTargetType = 'direction' | 'aoe' | 'self' | 'dash' | 'lock';
export type DamageType = 'physical' | 'magic' | 'true';

export interface Vec2 {
  x: number;
  z: number;
}

export interface SkillDefinition {
  slot: 0 | 1 | 2;
  name: string;
  desc: string;
  cooldowns: number[]; // per skill level
  manaCost: number[];
  range: number;
  radius: number;
  targetType: SkillTargetType;
  maxLevel: number;
  color: string;
  icon: string;
}

export interface HeroDefinition {
  id: HeroId;
  name: string;
  title: string;
  role: '战士' | '刺客' | '法师' | '射手' | '辅助';
  defaultLane: Lane;
  difficulty: number; // 1-3
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  passiveName: string;
  passiveDesc: string;
  baseHp: number;
  hpPerLevel: number;
  baseMp: number;
  mpPerLevel: number;
  baseAd: number;
  adPerLevel: number;
  baseArmor: number;
  armorPerLevel: number;
  baseMr: number;
  mrPerLevel: number;
  moveSpeed: number; // world units per second
  attackRange: number;
  attackInterval: number; // seconds between attacks at base AS
  isRanged: boolean;
  projectileSpeed: number;
  skills: [SkillDefinition, SkillDefinition, SkillDefinition];
  recommendedItems: string[];
}

export interface ItemDefinition {
  id: string;
  name: string;
  category: 'attack' | 'magic' | 'defense' | 'boots' | 'jungle';
  tier: 1 | 2 | 3;
  price: number;
  buildsFrom?: string[];
  icon: string;
  color: string;
  stats: {
    ad?: number;
    ap?: number;
    hp?: number;
    mp?: number;
    armor?: number;
    mr?: number;
    attackSpeed?: number; // e.g. 0.25 = +25%
    critChance?: number;  // 0.2 = 20%
    critDamage?: number;  // 0.4 = +40%
    lifesteal?: number;   // 0.15 = 15%
    spellVamp?: number;   // 0.15 = 15%
    cdr?: number;         // 0.1 = 10%
    moveSpeed?: number;   // flat units/sec
    armorPen?: number;    // flat
    magicPen?: number;    // flat
  };
  passiveDesc?: string;
}

export interface StatusBuff {
  id: string;
  name: string;
  remaining: number;
  duration: number;
  color: string;
  stacks?: number;
}

export interface HeroState {
  id: string; // e.g. 'blue_0' .. 'red_4'
  playerId: string | null; // null if AI bot
  playerName: string;
  isBot: boolean;
  team: Team;
  slotIndex: number; // 0..4
  heroId: HeroId;
  lane: Lane;
  summonerSkill: SummonerSkillId;

  x: number;
  z: number;
  vx: number;
  vz: number;
  facing: number; // radians, 0 = +Z or atan2(vx, vz)
  radius: number;

  alive: boolean;
  respawnTimer: number;
  level: number;
  xp: number;
  xpToNext: number;
  gold: number;
  skillPoints: number;
  skillLevels: [number, number, number];
  skillCooldowns: [number, number, number];
  summonerCooldown: number;
  healSpellCooldown: number; // Built-in HoK 恢复 spell

  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  shield: number;

  ad: number;
  ap: number;
  armor: number;
  mr: number;
  attackSpeed: number;
  critChance: number;
  critDamage: number;
  lifesteal: number;
  spellVamp: number;
  cdr: number;
  moveSpeed: number;
  attackRange: number;
  armorPen: number;
  magicPen: number;

  items: string[];

  // Combat & Action states
  attackCooldown: number;
  animState: 'idle' | 'run' | 'attack' | 'cast1' | 'cast2' | 'cast3' | 'dead' | 'recall';
  animTimer: number;
  recallTimer: number; // > 0 while recalling (4.5s)
  inBush: boolean;
  revealedTimer: number;

  // CC timers
  stunTimer: number;
  silenceTimer: number;
  slowTimer: number;
  slowFactor: number;
  knockupTimer: number;
  untargetableTimer: number;

  // Hero-specific mechanics
  arthurS1Empowered: number;
  arthurS2Timer: number;
  libaiStacks: number;
  libaiS1Stage: number; // 0, 1, 2
  libaiS1Window: number;
  libaiShadowX: number;
  libaiShadowZ: number;
  houyiStacks: number;
  houyiS1Timer: number;
  lubuEnchantTimer: number;
  dajiMrShred: number;
  caiwenjiS1Timer: number;
  caiwenjiS3Timer: number;
  caiwenjiPassiveCd: number;

  // Buff timers
  redBuffTimer: number;
  blueBuffTimer: number;
  tyrantBuffTimer: number;
  overlordBuffTimer: number;
  speedBoostTimer: number;
  speedBoostFactor: number;

  // Stats
  kills: number;
  deaths: number;
  assists: number;
  cs: number;
  damageDealt: number;
  damageTaken: number;
  killStreak: number;
  multiKillCount: number;
  multiKillTimer: number;
  lastDamagedBy: Record<string, number>; // attackerId -> simTime
  buffs: StatusBuff[];
}

export type MinionType = 'melee' | 'ranged' | 'cannon' | 'super' | 'vanguard';

export interface MinionState {
  id: string;
  team: Team;
  lane: 'top' | 'mid' | 'bot';
  type: MinionType;
  x: number;
  z: number;
  facing: number;
  hp: number;
  maxHp: number;
  ad: number;
  armor: number;
  radius: number;
  attackRange: number;
  attackCooldown: number;
  waypointIndex: number;
  animState: 'run' | 'attack';
  animTimer: number;
}

export type TurretTier = 'outer' | 'inner' | 'highground' | 'crystal';

export interface TurretState {
  id: string;
  team: Team;
  lane: 'top' | 'mid' | 'bot' | 'base';
  tier: TurretTier;
  x: number;
  z: number;
  hp: number;
  maxHp: number;
  ad: number;
  armor: number;
  range: number;
  alive: boolean;
  targetId: string | null;
  attackCooldown: number;
  consecutiveHeroHits: number;
  underAttackTimer: number;
}

export type MonsterType = 'red_buff' | 'blue_buff' | 'wolf' | 'boar' | 'river_spirit' | 'tyrant' | 'overlord';

export interface MonsterState {
  id: string;
  type: MonsterType;
  name: string;
  homeX: number;
  homeZ: number;
  x: number;
  z: number;
  facing: number;
  hp: number;
  maxHp: number;
  ad: number;
  armor: number;
  radius: number;
  alive: boolean;
  respawnTimer: number;
  aggroTargetId: string | null;
  attackCooldown: number;
  animState: 'idle' | 'run' | 'attack';
  animTimer: number;
  goldReward: number;
  xpReward: number;
}

export interface ProjectileState {
  id: string;
  ownerId: string;
  team: Team;
  kind:
    | 'arrow'
    | 'magic_orb'
    | 'turret_orb'
    | 'minion_orb'
    | 'daji_s1'
    | 'daji_s2'
    | 'daji_s3'
    | 'houyi_ult'
    | 'caiwenji_s2';
  x: number;
  z: number;
  vx: number;
  vz: number;
  targetId?: string;
  radius: number;
  speed: number;
  damage: number;
  damageType: DamageType;
  maxDist: number;
  traveled: number;
  color: string;
  hitIds: string[];
  bouncesLeft?: number;
  stunDuration?: number;
  pierce?: boolean;
}

export interface GroundZoneState {
  id: string;
  ownerId: string;
  team: Team;
  kind: 'arthur_ult' | 'libai_s2' | 'houyi_s2' | 'lubu_ult' | 'caiwenji_s3';
  x: number;
  z: number;
  radius: number;
  remaining: number;
  duration: number;
  tickTimer: number;
  color: string;
  triggered?: boolean;
}

export interface GameEvent {
  id: number;
  time: number;
  type:
    | 'damage'
    | 'heal'
    | 'kill'
    | 'turret_destroy'
    | 'boss_kill'
    | 'vfx'
    | 'sfx'
    | 'announce'
    | 'chat'
    | 'gold'
    | 'level_up';
  x?: number;
  z?: number;
  targetX?: number;
  targetZ?: number;
  value?: number;
  damageType?: DamageType;
  crit?: boolean;
  text?: string;
  subText?: string;
  color?: string;
  team?: Team;
  heroId?: HeroId;
  victimHeroId?: HeroId;
  vfxKind?: string;
  sfxKind?: string;
  radius?: number;
  angle?: number;
  unitId?: string;
}

export interface PlayerInput {
  moveX: number; // -1..1 world X
  moveZ: number; // -1..1 world Z
  moveTarget?: Vec2 | null; // Optional right-click move target
  basicAttack: boolean;
  targetPriority: TargetPriority;
  castSkill?: {
    slot: 0 | 1 | 2;
    dirX: number;
    dirZ: number;
    targetX: number;
    targetZ: number;
  } | null;
  castSummoner?: {
    dirX: number;
    dirZ: number;
  } | null;
  castHeal?: boolean;
  recall?: boolean;
  upgradeSkill?: 0 | 1 | 2 | null;
  buyItemId?: string | null;
  sellSlot?: number | null;
  quickChat?: string | null;
}

export interface WorldSnapshot {
  tick: number;
  time: number;
  phase: 'countdown' | 'playing' | 'ended';
  winner: Team | null;
  blueKills: number;
  redKills: number;
  heroes: HeroState[];
  minions: MinionState[];
  turrets: TurretState[];
  monsters: MonsterState[];
  projectiles: ProjectileState[];
  zones: GroundZoneState[];
  events: GameEvent[];
}

// LAN Lobby Protocol Types
export interface RoomSlot {
  team: Team;
  slotIndex: number;
  playerId: string | null;
  playerName: string;
  isBot: boolean;
  heroId: HeroId;
  summonerSkill: SummonerSkillId;
  ready: boolean;
}

export interface RoomInfo {
  id: string;
  name: string;
  hostId: string;
  status: 'lobby' | 'playing';
  difficulty: AiDifficulty;
  slots: RoomSlot[];
  humanCount: number;
}

export interface ServerInfo {
  lanUrls: string[];
  port: number;
  rooms: RoomInfo[];
}

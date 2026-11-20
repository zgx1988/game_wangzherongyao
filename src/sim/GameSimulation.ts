import { computeBotInput } from './BotAI';
import {
  BLUE_CRYSTAL,
  BLUE_FOUNTAIN,
  DEFAULT_TEAM_LANES,
  FOUNTAIN_RADIUS,
  HERO_SPAWN_OFFSETS,
  LANE_WAYPOINTS_BLUE,
  LANE_WAYPOINTS_RED,
  MAP_BUSHES,
  MAP_SIZE,
  MAP_WALLS,
  MONSTER_BLUEPRINTS,
  RED_CRYSTAL,
  RED_FOUNTAIN,
  TURRET_BLUEPRINTS,
  XP_TABLE,
  pointInOrientedBox,
  resolveCircleWall,
} from './constants';
import { HEROES, SUMMONER_SKILLS } from './heroes';
import { ITEMS, getNetItemCost } from './items';
import {
  AiDifficulty,
  DamageType,
  GameEvent,
  GroundZoneState,
  HeroId,
  HeroState,
  MinionState,
  MinionType,
  MonsterState,
  PlayerInput,
  ProjectileState,
  RoomSlot,
  SummonerSkillId,
  Team,
  TurretState,
  WorldSnapshot,
} from './types';

function dist(ax: number, az: number, bx: number, bz: number): number {
  return Math.hypot(ax - bx, az - bz);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export interface MatchConfig {
  difficulty: AiDifficulty;
  slots: RoomSlot[];
}

export class GameSimulation {
  public tick = 0;
  public time = 0;
  public phase: 'countdown' | 'playing' | 'ended' = 'countdown';
  public winner: Team | null = null;
  public difficulty: AiDifficulty = 'normal';

  public blueKills = 0;
  public redKills = 0;
  private firstBloodTaken = false;

  public heroes: HeroState[] = [];
  public minions: MinionState[] = [];
  public turrets: TurretState[] = [];
  public monsters: MonsterState[] = [];
  public projectiles: ProjectileState[] = [];
  public zones: GroundZoneState[] = [];

  private pendingEvents: GameEvent[] = [];
  private nextEventId = 1;
  private nextEntityId = 1;

  private inputs = new Map<string, PlayerInput>();
  private waveTimer = 10; // First wave at 10s
  private waveNumber = 0;
  private passiveGoldTimer = 0;
  private announced5s = false;
  private announcedStart = false;
  private overlordWavesBlue = 0;
  private overlordWavesRed = 0;

  // Pending delayed skill triggers (e.g. Lubu ult landing, Libai ult slashes)
  private delayedActions: { time: number; fn: () => void }[] = [];

  constructor(config: MatchConfig) {
    this.difficulty = config.difficulty;
    this.initTurrets();
    this.initMonsters();
    this.initHeroes(config.slots);
    this.emit({
      type: 'announce',
      text: '欢迎来到荣耀峡谷！',
      subText: '5v5 经典竞技即将开始',
      color: '#fbbf24',
      sfxKind: 'announce_welcome',
    });
  }

  private uid(prefix: string): string {
    return `${prefix}_${this.nextEntityId++}`;
  }

  private emit(ev: Omit<GameEvent, 'id' | 'time'>): void {
    this.pendingEvents.push({
      ...ev,
      id: this.nextEventId++,
      time: this.time,
    });
  }

  private initTurrets(): void {
    this.turrets = TURRET_BLUEPRINTS.map((bp) => {
      const hpByTier = {
        outer: 6200,
        inner: 7400,
        highground: 8600,
        crystal: 11500,
      };
      const adByTier = {
        outer: 460,
        inner: 540,
        highground: 630,
        crystal: 720,
      };
      const rangeByTier = {
        outer: 14.5,
        inner: 14.5,
        highground: 15.2,
        crystal: 16.5,
      };
      return {
        id: bp.id,
        team: bp.team,
        lane: bp.lane,
        tier: bp.tier,
        x: bp.x,
        z: bp.z,
        hp: hpByTier[bp.tier],
        maxHp: hpByTier[bp.tier],
        ad: adByTier[bp.tier],
        armor: bp.tier === 'crystal' ? 240 : 180,
        range: rangeByTier[bp.tier],
        alive: true,
        targetId: null,
        attackCooldown: 0,
        consecutiveHeroHits: 0,
        underAttackTimer: 0,
      };
    });
  }

  private initMonsters(): void {
    this.monsters = MONSTER_BLUEPRINTS.map((bp) => ({
      id: bp.id,
      type: bp.type,
      name: bp.name,
      homeX: bp.x,
      homeZ: bp.z,
      x: bp.x,
      z: bp.z,
      facing: bp.x < 80 ? 0.7 : -2.4,
      hp: bp.maxHp,
      maxHp: bp.maxHp,
      ad: bp.ad,
      armor: bp.armor,
      radius: bp.radius,
      alive: false,
      respawnTimer: bp.firstSpawnTime,
      aggroTargetId: null,
      attackCooldown: 0,
      animState: 'idle',
      animTimer: 0,
      goldReward: bp.gold,
      xpReward: bp.xp,
    }));
  }

  private initHeroes(slots: RoomSlot[]): void {
    this.heroes = slots.map((slot) => {
      const def = HEROES[slot.heroId];
      const base = slot.team === 'blue' ? BLUE_FOUNTAIN : RED_FOUNTAIN;
      const off = HERO_SPAWN_OFFSETS[slot.slotIndex % HERO_SPAWN_OFFSETS.length];
      const sign = slot.team === 'blue' ? 1 : -1;
      const x = clamp(base.x + off.x * sign, 6, MAP_SIZE - 6);
      const z = clamp(base.z + off.z * sign, 6, MAP_SIZE - 6);

      const hero: HeroState = {
        id: `${slot.team}_${slot.slotIndex}`,
        playerId: slot.playerId,
        playerName: slot.playerName,
        isBot: slot.isBot,
        team: slot.team,
        slotIndex: slot.slotIndex,
        heroId: slot.heroId,
        lane: DEFAULT_TEAM_LANES[slot.slotIndex % DEFAULT_TEAM_LANES.length],
        summonerSkill: slot.summonerSkill,

        x,
        z,
        vx: 0,
        vz: 0,
        facing: slot.team === 'blue' ? -Math.PI * 0.75 : Math.PI * 0.25,
        radius: 1.15,

        alive: true,
        respawnTimer: 0,
        level: 1,
        xp: 0,
        xpToNext: XP_TABLE[1],
        gold: 360, // Classic HoK starting gold (enough for boots or tier-1 component!)
        skillPoints: 1,
        skillLevels: [0, 0, 0],
        skillCooldowns: [0, 0, 0],
        summonerCooldown: 0,
        healSpellCooldown: 0,

        hp: def.baseHp,
        maxHp: def.baseHp,
        mp: def.baseMp,
        maxMp: def.baseMp,
        shield: 0,

        ad: def.baseAd,
        ap: 0,
        armor: def.baseArmor,
        mr: def.baseMr,
        attackSpeed: 1,
        critChance: 0,
        critDamage: 2.0,
        lifesteal: 0,
        spellVamp: 0,
        cdr: 0,
        moveSpeed: def.moveSpeed,
        attackRange: def.attackRange,
        armorPen: 0,
        magicPen: 0,

        items: [],

        attackCooldown: 0,
        animState: 'idle',
        animTimer: 0,
        recallTimer: 0,
        inBush: false,
        revealedTimer: 0,

        stunTimer: 0,
        silenceTimer: 0,
        slowTimer: 0,
        slowFactor: 0,
        knockupTimer: 0,
        untargetableTimer: 0,

        arthurS1Empowered: 0,
        arthurS2Timer: 0,
        libaiStacks: 0,
        libaiS1Stage: 0,
        libaiS1Window: 0,
        libaiShadowX: x,
        libaiShadowZ: z,
        houyiStacks: 0,
        houyiS1Timer: 0,
        lubuEnchantTimer: 0,
        dajiMrShred: 0,
        caiwenjiS1Timer: 0,
        caiwenjiS3Timer: 0,
        caiwenjiPassiveCd: 0,

        redBuffTimer: 0,
        blueBuffTimer: 0,
        tyrantBuffTimer: 0,
        overlordBuffTimer: 0,
        speedBoostTimer: 0,
        speedBoostFactor: 0,

        kills: 0,
        deaths: 0,
        assists: 0,
        cs: 0,
        damageDealt: 0,
        damageTaken: 0,
        killStreak: 0,
        multiKillCount: 0,
        multiKillTimer: 0,
        lastDamagedBy: {},
        buffs: [],
      };
      this.recalcHeroStats(hero, true);
      return hero;
    });
  }

  public setPlayerInput(heroIdOrPlayerId: string, input: PlayerInput): void {
    this.inputs.set(heroIdOrPlayerId, input);
  }

  public getHeroByPlayerId(playerId: string): HeroState | undefined {
    return this.heroes.find((h) => h.playerId === playerId || h.id === playerId);
  }

  public recalcHeroStats(hero: HeroState, resetVitals = false): void {
    const def = HEROES[hero.heroId];
    const lv = hero.level - 1;
    const oldMaxHp = hero.maxHp || def.baseHp;
    const oldMaxMp = hero.maxMp || def.baseMp;

    let maxHp = def.baseHp + def.hpPerLevel * lv;
    let maxMp = def.baseMp + def.mpPerLevel * lv;
    let ad = def.baseAd + def.adPerLevel * lv;
    let ap = 0;
    let armor = def.baseArmor + def.armorPerLevel * lv;
    let mr = def.baseMr + def.mrPerLevel * lv;
    let attackSpeed = 1 + lv * 0.025;
    let critChance = 0;
    let critDamage = 2.0;
    let lifesteal = 0;
    let spellVamp = 0;
    let cdr = 0;
    let moveSpeed = def.moveSpeed;
    let armorPen = 0;
    let magicPen = 0;

    for (const itemId of hero.items) {
      const it = ITEMS[itemId];
      if (!it) continue;
      const s = it.stats;
      if (s.hp) maxHp += s.hp;
      if (s.mp) maxMp += s.mp;
      if (s.ad) ad += s.ad;
      if (s.ap) ap += s.ap;
      if (s.armor) armor += s.armor;
      if (s.mr) mr += s.mr;
      if (s.attackSpeed) attackSpeed += s.attackSpeed;
      if (s.critChance) critChance += s.critChance;
      if (s.critDamage) critDamage += s.critDamage;
      if (s.lifesteal) lifesteal += s.lifesteal;
      if (s.spellVamp) spellVamp += s.spellVamp;
      if (s.cdr) cdr += s.cdr;
      if (s.moveSpeed) moveSpeed += s.moveSpeed;
      if (s.armorPen) armorPen += s.armorPen;
      if (s.magicPen) magicPen += s.magicPen;
    }

    // Savant's Hat (+30% AP passive)
    if (hero.items.includes('hat_savant')) {
      ap *= 1.3;
    }

    // Buffs & Hero passives
    if (hero.blueBuffTimer > 0) cdr += 0.2;
    if (hero.tyrantBuffTimer > 0) {
      ad += 55 + hero.level * 4;
      ap += 80 + hero.level * 6;
    }
    if (hero.heroId === 'libai') {
      ad += hero.libaiStacks * 22;
    }
    if (hero.heroId === 'houyi') {
      attackSpeed += hero.houyiStacks * 0.12;
    }
    if (hero.caiwenjiS3Timer > 0) {
      armor += 220 + hero.ap * 0.25;
      mr += 220 + hero.ap * 0.25;
    }
    if (hero.dajiMrShred > 0) {
      mr = Math.max(0, mr - hero.dajiMrShred);
    }

    hero.maxHp = Math.round(maxHp);
    hero.maxMp = Math.round(maxMp);
    hero.ad = Math.round(ad);
    hero.ap = Math.round(ap);
    hero.armor = Math.round(armor);
    hero.mr = Math.round(mr);
    hero.attackSpeed = Math.min(3.0, attackSpeed);
    hero.critChance = Math.min(1.0, critChance);
    hero.critDamage = critDamage;
    hero.lifesteal = Math.min(0.6, lifesteal);
    hero.spellVamp = Math.min(0.6, spellVamp);
    hero.cdr = Math.min(0.4, cdr);
    hero.moveSpeed = moveSpeed;
    hero.attackRange = def.attackRange;
    hero.armorPen = armorPen;
    hero.magicPen = magicPen;

    if (resetVitals) {
      hero.hp = hero.maxHp;
      hero.mp = hero.maxMp;
    } else {
      const hpDiff = hero.maxHp - oldMaxHp;
      if (hpDiff > 0) hero.hp = Math.min(hero.maxHp, hero.hp + hpDiff);
      else hero.hp = Math.min(hero.maxHp, hero.hp);
      const mpDiff = hero.maxMp - oldMaxMp;
      if (mpDiff > 0) hero.mp = Math.min(hero.maxMp, hero.mp + mpDiff);
      else hero.mp = Math.min(hero.maxMp, hero.mp);
    }
  }

  public step(dt: number): WorldSnapshot {
    this.tick++;
    if (this.phase === 'ended') {
      return this.buildSnapshot();
    }

    this.time += dt;

    // Match start announcements
    if (!this.announced5s && this.time >= 4.5) {
      this.announced5s = true;
      this.emit({
        type: 'announce',
        text: '敌军还有 5 秒到达战场',
        subText: '请做好战斗准备！',
        color: '#f59e0b',
        sfxKind: 'announce_5s',
      });
    }
    if (!this.announcedStart && this.time >= 9.8) {
      this.announcedStart = true;
      this.phase = 'playing';
      this.emit({
        type: 'announce',
        text: '全军出击！',
        subText: '摧毁敌方水晶夺取胜利',
        color: '#38bdf8',
        sfxKind: 'announce_start',
      });
    }

    // Delayed actions (e.g. Lubu ult landing, Libai 5 slashes)
    for (let i = this.delayedActions.length - 1; i >= 0; i--) {
      if (this.time >= this.delayedActions[i].time) {
        const act = this.delayedActions[i];
        this.delayedActions.splice(i, 1);
        act.fn();
      }
    }

    // Passive gold & XP income (authentic fast Honor of Kings pacing!)
    this.passiveGoldTimer += dt;
    if (this.passiveGoldTimer >= 1.0) {
      this.passiveGoldTimer -= 1.0;
      const goldTick = this.time > 180 ? 8 : 6;
      for (const h of this.heroes) {
        h.gold += goldTick;
        if (h.alive) this.grantXp(h, 14);
      }
    }

    // Spawn minion waves
    this.waveTimer -= dt;
    if (this.waveTimer <= 0) {
      this.waveTimer = 28;
      this.waveNumber++;
      this.spawnMinionWave();
    }

    // Update Heroes
    const botCtx = {
      time: this.time,
      difficulty: this.difficulty,
      heroes: this.heroes,
      minions: this.minions,
      turrets: this.turrets,
      monsters: this.monsters,
    };

    for (const hero of this.heroes) {
      let input = this.inputs.get(hero.id) || (hero.playerId ? this.inputs.get(hero.playerId) : undefined);
      if (hero.isBot) {
        input = computeBotInput(hero, botCtx);
      } else if (!input) {
        input = {
          moveX: 0,
          moveZ: 0,
          basicAttack: false,
          targetPriority: 'auto',
        };
      } else {
        // Consume one-shot actions after reading
        const copy: PlayerInput = { ...input };
        input.castSkill = null;
        input.castSummoner = null;
        input.castHeal = false;
        input.recall = false;
        input.upgradeSkill = null;
        input.buyItemId = null;
        input.sellSlot = null;
        input.quickChat = null;
        input = copy;
      }
      this.updateHero(hero, input, dt);
    }

    this.updateMinions(dt);
    this.updateTurrets(dt);
    this.updateMonsters(dt);
    this.updateProjectiles(dt);
    this.updateGroundZones(dt);

    // Check Crystal Victory
    const blueCrystal = this.turrets.find((t) => t.id === 'blue_crystal');
    const redCrystal = this.turrets.find((t) => t.id === 'red_crystal');
    if (blueCrystal && !blueCrystal.alive) {
      this.endMatch('red');
    } else if (redCrystal && !redCrystal.alive) {
      this.endMatch('blue');
    }

    return this.buildSnapshot();
  }

  private endMatch(winner: Team): void {
    this.phase = 'ended';
    this.winner = winner;
    this.emit({
      type: 'announce',
      text: winner === 'blue' ? '蓝方胜利 · VICTORY' : '红方胜利 · VICTORY',
      subText: '敌方水晶已被摧毁！',
      color: winner === 'blue' ? '#38bdf8' : '#f43f5e',
      team: winner,
      sfxKind: 'victory',
    });
  }

  private spawnMinionWave(): void {
    const lanes: ('top' | 'mid' | 'bot')[] = ['top', 'mid', 'bot'];
    const hpScale = 1 + Math.floor(this.time / 60) * 0.14;
    const adScale = 1 + Math.floor(this.time / 60) * 0.12;

    const spawnForTeam = (team: Team) => {
      const hasVanguard = team === 'blue' ? this.overlordWavesBlue > 0 : this.overlordWavesRed > 0;
      if (team === 'blue' && this.overlordWavesBlue > 0) this.overlordWavesBlue--;
      if (team === 'red' && this.overlordWavesRed > 0) this.overlordWavesRed--;

      for (const lane of lanes) {
        const wps = team === 'blue' ? LANE_WAYPOINTS_BLUE[lane] : LANE_WAYPOINTS_RED[lane];
        const enemyTeam: Team = team === 'blue' ? 'red' : 'blue';
        const enemyHg = this.turrets.find(
          (t) => t.team === enemyTeam && t.lane === lane && t.tier === 'highground'
        );
        const superLane = enemyHg ? !enemyHg.alive : false;

        const types: MinionType[] = hasVanguard
          ? ['vanguard', 'ranged', 'ranged']
          : superLane
          ? ['super', 'melee', 'ranged']
          : this.waveNumber >= 4 && this.waveNumber % 2 === 0
          ? ['melee', 'cannon', 'ranged']
          : ['melee', 'melee', 'ranged'];

        types.forEach((mtype, idx) => {
          const offset = (idx - 1) * 1.9;
          const baseStats: Record<MinionType, { hp: number; ad: number; range: number; r: number; armor: number }> = {
            melee: { hp: 980, ad: 72, range: 2.6, r: 0.9, armor: 50 },
            ranged: { hp: 640, ad: 96, range: 8.2, r: 0.85, armor: 30 },
            cannon: { hp: 1650, ad: 135, range: 9.2, r: 1.15, armor: 85 },
            super: { hp: 2800, ad: 195, range: 3.1, r: 1.35, armor: 130 },
            vanguard: { hp: 3400, ad: 215, range: 6.5, r: 1.5, armor: 145 },
          };
          const st = baseStats[mtype];
          this.minions.push({
            id: this.uid('min'),
            team,
            lane,
            type: mtype,
            x: wps[0].x + offset * 0.7,
            z: wps[0].z - offset * 0.7,
            facing: team === 'blue' ? -Math.PI * 0.75 : Math.PI * 0.25,
            hp: Math.round(st.hp * hpScale),
            maxHp: Math.round(st.hp * hpScale),
            ad: Math.round(st.ad * adScale),
            armor: st.armor,
            radius: st.r,
            attackRange: st.range,
            attackCooldown: 0,
            waypointIndex: 1,
            animState: 'run',
            animTimer: 0,
          });
        });
      }
    };

    spawnForTeam('blue');
    spawnForTeam('red');
  }

  private updateHero(hero: HeroState, input: PlayerInput, dt: number): void {
    // Quick chat broadcast
    if (input.quickChat) {
      const def = HEROES[hero.heroId];
      this.emit({
        type: 'chat',
        team: hero.team,
        heroId: hero.heroId,
        text: `[${def.name}] ${input.quickChat}`,
        color: hero.team === 'blue' ? '#60a5fa' : '#f87171',
        sfxKind: 'ping',
      });
    }

    // Skill upgrades & shopping (can be done alive or dead!)
    if (input.upgradeSkill !== null && input.upgradeSkill !== undefined) {
      this.tryUpgradeSkill(hero, input.upgradeSkill);
    }
    if (input.buyItemId) {
      this.tryBuyItem(hero, input.buyItemId);
    }
    if (input.sellSlot !== null && input.sellSlot !== undefined) {
      this.trySellItem(hero, input.sellSlot);
    }

    // Cooldowns & timers tick even while dead
    for (let i = 0; i < 3; i++) {
      if (hero.skillCooldowns[i] > 0) hero.skillCooldowns[i] = Math.max(0, hero.skillCooldowns[i] - dt);
    }
    if (hero.summonerCooldown > 0) hero.summonerCooldown = Math.max(0, hero.summonerCooldown - dt);
    if (hero.healSpellCooldown > 0) hero.healSpellCooldown = Math.max(0, hero.healSpellCooldown - dt);
    if (hero.multiKillTimer > 0) {
      hero.multiKillTimer -= dt;
      if (hero.multiKillTimer <= 0) hero.multiKillCount = 0;
    }

    if (!hero.alive) {
      hero.respawnTimer -= dt;
      hero.animState = 'dead';
      if (hero.respawnTimer <= 0) {
        const base = hero.team === 'blue' ? BLUE_FOUNTAIN : RED_FOUNTAIN;
        const off = HERO_SPAWN_OFFSETS[hero.slotIndex % HERO_SPAWN_OFFSETS.length];
        const sign = hero.team === 'blue' ? 1 : -1;
        hero.x = clamp(base.x + off.x * sign, 6, MAP_SIZE - 6);
        hero.z = clamp(base.z + off.z * sign, 6, MAP_SIZE - 6);
        hero.alive = true;
        hero.hp = hero.maxHp;
        hero.mp = hero.maxMp;
        hero.shield = 0;
        hero.stunTimer = 0;
        hero.silenceTimer = 0;
        hero.slowTimer = 0;
        hero.knockupTimer = 0;
        hero.recallTimer = 0;
        hero.animState = 'idle';
        this.emit({ type: 'vfx', vfxKind: 'respawn', x: hero.x, z: hero.z, color: '#38bdf8' });
      }
      return;
    }

    // Tick active timers
    if (hero.attackCooldown > 0) hero.attackCooldown = Math.max(0, hero.attackCooldown - dt);
    if (hero.animTimer > 0) hero.animTimer = Math.max(0, hero.animTimer - dt);
    if (hero.stunTimer > 0) hero.stunTimer = Math.max(0, hero.stunTimer - dt);
    if (hero.silenceTimer > 0) hero.silenceTimer = Math.max(0, hero.silenceTimer - dt);
    if (hero.slowTimer > 0) hero.slowTimer = Math.max(0, hero.slowTimer - dt);
    if (hero.knockupTimer > 0) hero.knockupTimer = Math.max(0, hero.knockupTimer - dt);
    if (hero.untargetableTimer > 0) hero.untargetableTimer = Math.max(0, hero.untargetableTimer - dt);
    if (hero.revealedTimer > 0) hero.revealedTimer = Math.max(0, hero.revealedTimer - dt);
    if (hero.speedBoostTimer > 0) hero.speedBoostTimer = Math.max(0, hero.speedBoostTimer - dt);
    if (hero.arthurS1Empowered > 0) hero.arthurS1Empowered = Math.max(0, hero.arthurS1Empowered - dt);
    if (hero.houyiS1Timer > 0) hero.houyiS1Timer = Math.max(0, hero.houyiS1Timer - dt);
    if (hero.lubuEnchantTimer > 0) hero.lubuEnchantTimer = Math.max(0, hero.lubuEnchantTimer - dt);
    if (hero.caiwenjiPassiveCd > 0) hero.caiwenjiPassiveCd = Math.max(0, hero.caiwenjiPassiveCd - dt);

    let statsDirty = false;
    if (hero.redBuffTimer > 0) hero.redBuffTimer = Math.max(0, hero.redBuffTimer - dt);
    if (hero.blueBuffTimer > 0) {
      hero.blueBuffTimer = Math.max(0, hero.blueBuffTimer - dt);
      if (hero.blueBuffTimer <= 0) statsDirty = true;
    }
    if (hero.tyrantBuffTimer > 0) {
      hero.tyrantBuffTimer = Math.max(0, hero.tyrantBuffTimer - dt);
      if (hero.tyrantBuffTimer <= 0) statsDirty = true;
    }
    if (hero.overlordBuffTimer > 0) hero.overlordBuffTimer = Math.max(0, hero.overlordBuffTimer - dt);
    if (hero.dajiMrShred > 0) {
      hero.dajiMrShred = Math.max(0, hero.dajiMrShred - 60 * dt);
      if (hero.dajiMrShred <= 0) statsDirty = true;
    }
    if (hero.libaiS1Window > 0) {
      hero.libaiS1Window -= dt;
      if (hero.libaiS1Window <= 0) {
        hero.libaiS1Stage = 0;
        const sk = HEROES.libai.skills[0];
        const lv = Math.max(1, hero.skillLevels[0]);
        hero.skillCooldowns[0] = sk.cooldowns[lv - 1] * (1 - hero.cdr);
      }
    }

    // Arthur S2 orbiting holy shields tick
    if (hero.arthurS2Timer > 0) {
      const prevHalf = Math.floor(hero.arthurS2Timer * 2);
      hero.arthurS2Timer = Math.max(0, hero.arthurS2Timer - dt);
      const nowHalf = Math.floor(hero.arthurS2Timer * 2);
      if (nowHalf !== prevHalf) {
        const lv = Math.max(1, hero.skillLevels[1]);
        const dmg = 115 + lv * 32 + hero.ad * 0.55;
        this.damageEnemiesInRadius(hero, hero.x, hero.z, 5.4, dmg, 'physical');
      }
    }

    // Sunfire Cape burn passive
    if (hero.items.includes('cape_sunfire') && this.tick % 20 === 0) {
      this.damageEnemiesInRadius(hero, hero.x, hero.z, 4.8, 70 + hero.maxHp * 0.018, 'magic');
    }

    // Cai Wenji S1 healing pulse
    if (hero.caiwenjiS1Timer > 0) {
      const prev = Math.floor(hero.caiwenjiS1Timer * 2);
      hero.caiwenjiS1Timer = Math.max(0, hero.caiwenjiS1Timer - dt);
      if (Math.floor(hero.caiwenjiS1Timer * 2) !== prev) {
        const lv = Math.max(1, hero.skillLevels[0]);
        const healAmt = 110 + lv * 30 + hero.ap * 0.34;
        for (const ally of this.heroes) {
          if (ally.alive && ally.team === hero.team && dist(hero.x, hero.z, ally.x, ally.z) <= 9.5) {
            this.healHero(ally, healAmt);
          }
        }
        this.emit({ type: 'vfx', vfxKind: 'heal_pulse', x: hero.x, z: hero.z, radius: 9.2, color: '#34d399' });
      }
    }

    // Cai Wenji S3 sanctuary pulse
    if (hero.caiwenjiS3Timer > 0) {
      const prev = Math.floor(hero.caiwenjiS3Timer * 2);
      hero.caiwenjiS3Timer = Math.max(0, hero.caiwenjiS3Timer - dt);
      if (hero.caiwenjiS3Timer <= 0) statsDirty = true;
      if (Math.floor(hero.caiwenjiS3Timer * 2) !== prev) {
        const lv = Math.max(1, hero.skillLevels[2]);
        const healAmt = 240 + lv * 85 + hero.ap * 0.58;
        const allies = this.heroes
          .filter((a) => a.alive && a.team === hero.team && dist(hero.x, hero.z, a.x, a.z) <= 10.5)
          .sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp);
        if (allies.length > 0) {
          this.healHero(allies[0], healAmt);
        }
      }
    }

    if (statsDirty) this.recalcHeroStats(hero);

    // Passive HP / MP Regen
    let hpRegen = 10 + hero.level * 1.8;
    let mpRegen = hero.maxMp > 0 ? 9 + hero.level * 1.1 : 0;
    if (hero.heroId === 'arthur') hpRegen += hero.maxHp * 0.011;
    if (hero.blueBuffTimer > 0) mpRegen += hero.maxMp * 0.045;
    if (hero.items.includes('grail_holy')) {
      mpRegen += hero.maxMp * 0.025;
      if (hero.mp >= hero.maxMp * 0.9) hpRegen += hero.maxHp * 0.02;
    }

    // Fountain super-heal & enemy fountain laser
    const ownFountain = hero.team === 'blue' ? BLUE_FOUNTAIN : RED_FOUNTAIN;
    const enemyFountain = hero.team === 'blue' ? RED_FOUNTAIN : BLUE_FOUNTAIN;
    if (dist(hero.x, hero.z, ownFountain.x, ownFountain.z) < FOUNTAIN_RADIUS) {
      hpRegen += hero.maxHp * 0.22;
      mpRegen += hero.maxMp * 0.25;
    } else if (dist(hero.x, hero.z, enemyFountain.x, enemyFountain.z) < FOUNTAIN_RADIUS + 2) {
      if (this.tick % 10 === 0) {
        this.applyDamage(null, hero, 950, 'true', false);
        this.emit({
          type: 'vfx',
          vfxKind: 'fountain_laser',
          x: enemyFountain.x,
          z: enemyFountain.z,
          targetX: hero.x,
          targetZ: hero.z,
          color: hero.team === 'blue' ? '#f43f5e' : '#38bdf8',
        });
      }
    }

    hero.hp = Math.min(hero.maxHp, hero.hp + hpRegen * dt);
    if (hero.maxMp > 0) hero.mp = Math.min(hero.maxMp, hero.mp + mpRegen * dt);
    if (hero.shield > 0) hero.shield = Math.max(0, hero.shield - 45 * dt);

    // Check Bush Stealth
    hero.inBush = MAP_BUSHES.some((b) =>
      pointInOrientedBox(hero.x, hero.z, b.x, b.z, b.rx, b.rz, b.rot)
    );

    // CC lock check
    const isCrowdControlled = hero.stunTimer > 0 || hero.knockupTimer > 0;
    if (isCrowdControlled) {
      hero.vx = 0;
      hero.vz = 0;
      hero.recallTimer = 0;
      this.syncHeroBuffs(hero);
      return;
    }

    // Built-in HoK Restore Spell (恢复)
    if (input.castHeal && hero.healSpellCooldown <= 0) {
      hero.healSpellCooldown = 40;
      this.healHero(hero, hero.maxHp * 0.16);
      if (hero.maxMp > 0) hero.mp = Math.min(hero.maxMp, hero.mp + hero.maxMp * 0.18);
      this.emit({ type: 'vfx', vfxKind: 'heal_self', x: hero.x, z: hero.z, color: '#4ade80', sfxKind: 'heal' });
    }

    // Summoner Skill
    if (input.castSummoner && hero.summonerCooldown <= 0) {
      this.executeSummonerSkill(hero, input.castSummoner.dirX, input.castSummoner.dirZ);
      hero.recallTimer = 0;
    }

    // Recall (回城)
    if (input.recall && hero.recallTimer <= 0) {
      hero.recallTimer = 4.2;
      hero.animState = 'recall';
      this.emit({ type: 'vfx', vfxKind: 'recall_start', x: hero.x, z: hero.z, color: '#38bdf8', sfxKind: 'recall' });
    }

    // Movement vector
    let mx = input.moveX;
    let mz = input.moveZ;
    if (Math.abs(mx) < 0.05 && Math.abs(mz) < 0.05 && input.moveTarget) {
      const dx = input.moveTarget.x - hero.x;
      const dz = input.moveTarget.z - hero.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.7) {
        mx = dx / d;
        mz = dz / d;
      }
    }

    const moveMag = Math.hypot(mx, mz);
    if (moveMag > 0.05) {
      hero.recallTimer = 0;
      const nx = mx / Math.max(1, moveMag);
      const nz = mz / Math.max(1, moveMag);
      let spd = hero.moveSpeed;
      if (hero.speedBoostTimer > 0) spd *= 1 + hero.speedBoostFactor;
      if (hero.slowTimer > 0) spd *= Math.max(0.35, 1 - hero.slowFactor);
      hero.vx = nx * spd;
      hero.vz = nz * spd;
      hero.x += hero.vx * dt;
      hero.z += hero.vz * dt;
      hero.facing = Math.atan2(nx, nz);
      this.resolveHeroCollisions(hero);
      if (hero.animTimer <= 0) hero.animState = 'run';
    } else {
      hero.vx = 0;
      hero.vz = 0;
      if (hero.recallTimer > 0) {
        hero.recallTimer -= dt;
        hero.animState = 'recall';
        if (hero.recallTimer <= 0) {
          hero.x = ownFountain.x;
          hero.z = ownFountain.z;
          hero.animState = 'idle';
          this.emit({ type: 'vfx', vfxKind: 'respawn', x: hero.x, z: hero.z, color: '#38bdf8', sfxKind: 'flash' });
        }
      } else if (hero.animTimer <= 0) {
        hero.animState = 'idle';
      }
    }

    // Cast Active Skill
    if (input.castSkill && hero.silenceTimer <= 0) {
      this.tryCastSkill(hero, input.castSkill);
    }

    // Basic Attack
    if (input.basicAttack && hero.attackCooldown <= 0) {
      this.tryBasicAttack(hero, input.targetPriority);
    }

    this.syncHeroBuffs(hero);
  }

  private syncHeroBuffs(hero: HeroState): void {
    const buffs = [];
    if (hero.redBuffTimer > 0) {
      buffs.push({ id: 'red', name: '红Buff', remaining: hero.redBuffTimer, duration: 70, color: '#ef4444' });
    }
    if (hero.blueBuffTimer > 0) {
      buffs.push({ id: 'blue', name: '蓝Buff', remaining: hero.blueBuffTimer, duration: 70, color: '#3b82f6' });
    }
    if (hero.tyrantBuffTimer > 0) {
      buffs.push({ id: 'tyrant', name: '暴君之力', remaining: hero.tyrantBuffTimer, duration: 90, color: '#a855f7' });
    }
    if (hero.lubuEnchantTimer > 0) {
      buffs.push({ id: 'enchant', name: '真伤附魔', remaining: hero.lubuEnchantTimer, duration: 8, color: '#f43f5e' });
    }
    if (hero.libaiStacks > 0) {
      buffs.push({ id: 'sword', name: '侠客行', remaining: 5, duration: 5, color: '#38bdf8', stacks: hero.libaiStacks });
    }
    if (hero.houyiStacks > 0) {
      buffs.push({ id: 'sun', name: '惩戒射击', remaining: 4, duration: 4, color: '#fbbf24', stacks: hero.houyiStacks });
    }
    hero.buffs = buffs;
  }

  private resolveHeroCollisions(hero: HeroState): void {
    hero.x = clamp(hero.x, 3.5, MAP_SIZE - 3.5);
    hero.z = clamp(hero.z, 3.5, MAP_SIZE - 3.5);

    for (const wall of MAP_WALLS) {
      const res = resolveCircleWall(hero.x, hero.z, hero.radius, wall);
      hero.x = res.x;
      hero.z = res.z;
    }

    // Collide with living turrets
    for (const t of this.turrets) {
      if (!t.alive) continue;
      const minD = hero.radius + (t.tier === 'crystal' ? 3.2 : 2.1);
      const dx = hero.x - t.x;
      const dz = hero.z - t.z;
      const d = Math.hypot(dx, dz);
      if (d < minD && d > 0.001) {
        hero.x = t.x + (dx / d) * minD;
        hero.z = t.z + (dz / d) * minD;
      }
    }

    // Soft hero-to-hero separation
    for (const other of this.heroes) {
      if (other.id === hero.id || !other.alive) continue;
      const minD = hero.radius + other.radius;
      const dx = hero.x - other.x;
      const dz = hero.z - other.z;
      const d = Math.hypot(dx, dz);
      if (d < minD && d > 0.001) {
        const push = (minD - d) * 0.35;
        hero.x += (dx / d) * push;
        hero.z += (dz / d) * push;
      }
    }
  }

  private tryUpgradeSkill(hero: HeroState, slot: 0 | 1 | 2): void {
    if (hero.skillPoints <= 0) return;
    const sk = HEROES[hero.heroId].skills[slot];
    const cur = hero.skillLevels[slot];
    if (cur >= sk.maxLevel) return;
    if (slot === 2) {
      const reqLevel = cur === 0 ? 4 : cur === 1 ? 8 : 12;
      if (hero.level < reqLevel) return;
    } else {
      const maxAllowed = Math.ceil(hero.level / 2);
      if (cur >= maxAllowed && hero.level < 12) return;
    }
    hero.skillLevels[slot]++;
    hero.skillPoints--;
    this.emit({ type: 'sfx', sfxKind: 'skill_up', x: hero.x, z: hero.z, unitId: hero.id });
  }

  private tryBuyItem(hero: HeroState, itemId: string): void {
    const item = ITEMS[itemId];
    if (!item) return;
    const { cost, consumedIndices } = getNetItemCost(itemId, hero.items);
    if (hero.gold < cost) return;
    if (hero.items.length - consumedIndices.length >= 6) return;

    hero.gold -= cost;
    // Remove consumed component indices in descending order
    consumedIndices.sort((a, b) => b - a).forEach((idx) => hero.items.splice(idx, 1));
    hero.items.push(itemId);
    this.recalcHeroStats(hero);
    this.emit({ type: 'sfx', sfxKind: 'buy_item', x: hero.x, z: hero.z, unitId: hero.id });
  }

  private trySellItem(hero: HeroState, slotIndex: number): void {
    if (slotIndex < 0 || slotIndex >= hero.items.length) return;
    const item = ITEMS[hero.items[slotIndex]];
    if (!item) return;
    hero.items.splice(slotIndex, 1);
    hero.gold += Math.round(item.price * 0.65);
    this.recalcHeroStats(hero);
    this.emit({ type: 'sfx', sfxKind: 'coin', x: hero.x, z: hero.z, unitId: hero.id });
  }

  private executeSummonerSkill(hero: HeroState, dirX: number, dirZ: number): void {
    const sk = SUMMONER_SKILLS[hero.summonerSkill];
    hero.summonerCooldown = sk.cooldown;
    hero.revealedTimer = 2.0;

    if (hero.summonerSkill === 'flash') {
      const len = Math.hypot(dirX, dirZ);
      const nx = len > 0.1 ? dirX / len : Math.sin(hero.facing);
      const nz = len > 0.1 ? dirZ / len : Math.cos(hero.facing);
      this.emit({ type: 'vfx', vfxKind: 'flash', x: hero.x, z: hero.z, color: '#ffe066', sfxKind: 'flash' });
      hero.x = clamp(hero.x + nx * 9.5, 4, MAP_SIZE - 4);
      hero.z = clamp(hero.z + nz * 9.5, 4, MAP_SIZE - 4);
      this.resolveHeroCollisions(hero);
      this.emit({ type: 'vfx', vfxKind: 'flash', x: hero.x, z: hero.z, color: '#ffe066' });
    } else if (hero.summonerSkill === 'heal') {
      for (const ally of this.heroes) {
        if (ally.alive && ally.team === hero.team && dist(hero.x, hero.z, ally.x, ally.z) <= 10.5) {
          this.healHero(ally, ally.maxHp * 0.16);
          ally.speedBoostTimer = Math.max(ally.speedBoostTimer, 2.0);
          ally.speedBoostFactor = Math.max(ally.speedBoostFactor, 0.22);
        }
      }
      this.emit({ type: 'vfx', vfxKind: 'heal_pulse', x: hero.x, z: hero.z, radius: 10, color: '#51cf66', sfxKind: 'heal' });
    } else if (hero.summonerSkill === 'smite') {
      // Prioritize nearest alive monster, then enemy hero, then minion
      const monster = this.monsters
        .filter((m) => m.alive && dist(hero.x, hero.z, m.x, m.z) <= 10)
        .sort((a, b) => dist(hero.x, hero.z, a.x, a.z) - dist(hero.x, hero.z, b.x, b.z))[0];
      if (monster) {
        const smiteDmg = 850 + hero.level * 110;
        this.damageMonster(hero, monster, smiteDmg, 'true');
        this.emit({ type: 'vfx', vfxKind: 'smite', x: monster.x, z: monster.z, color: '#fb923c', sfxKind: 'smite' });
        return;
      }
      const enemy = this.heroes
        .filter((e) => e.alive && e.team !== hero.team && e.untargetableTimer <= 0 && dist(hero.x, hero.z, e.x, e.z) <= 10)
        .sort((a, b) => a.hp - b.hp)[0];
      if (enemy) {
        this.applyDamage(hero, enemy, 220 + hero.level * 30, 'true', false);
        this.applySlow(enemy, 0.4, 2.0);
        this.emit({ type: 'vfx', vfxKind: 'smite', x: enemy.x, z: enemy.z, color: '#fb923c', sfxKind: 'smite' });
      }
    }
  }

  private findBasicAttackTarget(
    hero: HeroState,
    priority: 'auto' | 'minion' | 'tower'
  ): { kind: 'hero' | 'minion' | 'turret' | 'monster'; unit: any } | null {
    const range = hero.attackRange + (hero.arthurS1Empowered > 0 ? 3.5 : 0.8);

    const visibleEnemyHero = () =>
      this.heroes
        .filter(
          (e) =>
            e.alive &&
            e.team !== hero.team &&
            e.untargetableTimer <= 0 &&
            dist(hero.x, hero.z, e.x, e.z) <= range + e.radius &&
            (!e.inBush || e.revealedTimer > 0 || dist(hero.x, hero.z, e.x, e.z) < 5)
        )
        .sort((a, b) => a.hp - b.hp)[0];

    const nearestMinion = () =>
      this.minions
        .filter((m) => m.team !== hero.team && dist(hero.x, hero.z, m.x, m.z) <= range + m.radius)
        .sort((a, b) => dist(hero.x, hero.z, a.x, a.z) - dist(hero.x, hero.z, b.x, b.z))[0];

    const nearestMonster = () =>
      this.monsters
        .filter((m) => m.alive && dist(hero.x, hero.z, m.x, m.z) <= range + m.radius)
        .sort((a, b) => dist(hero.x, hero.z, a.x, a.z) - dist(hero.x, hero.z, b.x, b.z))[0];

    const nearestTurret = () =>
      this.turrets
        .filter((t) => t.alive && t.team !== hero.team && dist(hero.x, hero.z, t.x, t.z) <= range + 3.2)
        .sort((a, b) => dist(hero.x, hero.z, a.x, a.z) - dist(hero.x, hero.z, b.x, b.z))[0];

    if (priority === 'tower') {
      const t = nearestTurret();
      if (t) return { kind: 'turret', unit: t };
    }
    if (priority === 'minion') {
      const m = nearestMinion();
      if (m) return { kind: 'minion', unit: m };
      const mon = nearestMonster();
      if (mon) return { kind: 'monster', unit: mon };
    }

    const h = visibleEnemyHero();
    if (h) return { kind: 'hero', unit: h };
    const m = nearestMinion();
    if (m) return { kind: 'minion', unit: m };
    const mon = nearestMonster();
    if (mon) return { kind: 'monster', unit: mon };
    const t = nearestTurret();
    if (t) return { kind: 'turret', unit: t };
    return null;
  }

  private tryBasicAttack(hero: HeroState, priority: 'auto' | 'minion' | 'tower'): void {
    const target = this.findBasicAttackTarget(hero, priority);
    if (!target) return;

    const def = HEROES[hero.heroId];
    hero.recallTimer = 0;
    hero.revealedTimer = 2.0;
    hero.attackCooldown = def.attackInterval / hero.attackSpeed;
    hero.animState = 'attack';
    hero.animTimer = Math.min(0.35, hero.attackCooldown * 0.85);
    hero.facing = Math.atan2(target.unit.x - hero.x, target.unit.z - hero.z);

    // Arthur S1 lunge!
    let extraDmg = 0;
    let silenceTarget = false;
    if (hero.heroId === 'arthur' && hero.arthurS1Empowered > 0) {
      hero.arthurS1Empowered = 0;
      const lv = Math.max(1, hero.skillLevels[0]);
      extraDmg = 180 + lv * 45 + hero.ad * 0.5;
      silenceTarget = true;
      const dx = target.unit.x - hero.x;
      const dz = target.unit.z - hero.z;
      const d = Math.hypot(dx, dz);
      if (d > 2.2) {
        hero.x = target.unit.x - (dx / d) * 1.9;
        hero.z = target.unit.z - (dz / d) * 1.9;
        this.resolveHeroCollisions(hero);
      }
      this.emit({ type: 'vfx', vfxKind: 'arthur_s1_hit', x: target.unit.x, z: target.unit.z, color: '#facc15', sfxKind: 'heavy_slash' });
    }

    // Hero passives on basic attack
    if (hero.heroId === 'libai') {
      hero.libaiStacks = Math.min(4, hero.libaiStacks + 1);
      this.recalcHeroStats(hero);
    }
    if (hero.heroId === 'houyi') {
      hero.houyiStacks = Math.min(3, hero.houyiStacks + 1);
      this.recalcHeroStats(hero);
    }

    const isCrit = Math.random() < hero.critChance;
    const baseDmg = (hero.ad + extraDmg) * (isCrit ? hero.critDamage : 1);
    const dmgType: DamageType = hero.heroId === 'lubu' && hero.lubuEnchantTimer > 0 ? 'true' : 'physical';

    if (def.isRanged) {
      const projKind = hero.heroId === 'houyi' ? 'arrow' : 'magic_orb';
      const arrowCount = hero.heroId === 'houyi' && hero.houyiStacks >= 3 ? 3 : 1;
      const dmgPerArrow = arrowCount === 3 ? baseDmg * 0.45 : baseDmg;

      const fireArrow = (tgt: any, kind: 'hero' | 'minion' | 'turret' | 'monster', dmg: number, delay = 0) => {
        const launch = () => {
          this.projectiles.push({
            id: this.uid('proj'),
            ownerId: hero.id,
            team: hero.team,
            kind: projKind,
            x: hero.x,
            z: hero.z,
            vx: 0,
            vz: 0,
            targetId: tgt.id,
            radius: 0.9,
            speed: def.projectileSpeed,
            damage: dmg,
            damageType: 'physical',
            maxDist: 35,
            traveled: 0,
            color: def.accentColor,
            hitIds: [],
          });
        };
        if (delay > 0) this.delayedActions.push({ time: this.time + delay, fn: launch });
        else launch();
      };

      for (let i = 0; i < arrowCount; i++) {
        fireArrow(target.unit, target.kind, dmgPerArrow, i * 0.06);
      }

      // Houyi S1 split arrows!
      if (hero.heroId === 'houyi' && hero.houyiS1Timer > 0) {
        const extras = [
          ...this.heroes.filter((e) => e.alive && e.team !== hero.team && e.id !== target.unit.id && dist(hero.x, hero.z, e.x, e.z) <= hero.attackRange + 1),
          ...this.minions.filter((m) => m.team !== hero.team && m.id !== target.unit.id && dist(hero.x, hero.z, m.x, m.z) <= hero.attackRange + 1),
        ].slice(0, 2);
        for (const ex of extras) {
          fireArrow(ex, 'hero', baseDmg * 0.55);
        }
      }

      this.emit({
        type: 'sfx',
        sfxKind: hero.heroId === 'houyi' ? 'bow' : 'magic_shoot',
        x: hero.x,
        z: hero.z,
      });
    } else {
      // Melee hit immediately with awesome slash arc!
      this.emit({
        type: 'vfx',
        vfxKind: dmgType === 'true' ? 'slash_true' : 'slash',
        x: hero.x,
        z: hero.z,
        angle: hero.facing,
        radius: hero.attackRange,
        color: dmgType === 'true' ? '#f43f5e' : def.accentColor,
        sfxKind: 'sword_slash',
      });

      this.deliverAttackDamage(hero, target.kind, target.unit, baseDmg, dmgType, isCrit, silenceTarget);
    }
  }

  private deliverAttackDamage(
    attacker: HeroState,
    kind: 'hero' | 'minion' | 'turret' | 'monster',
    unit: any,
    dmg: number,
    dmgType: DamageType,
    isCrit: boolean,
    silence = false
  ): void {
    // Lightning dagger bonus proc
    const bonusLightning = attacker.items.includes('dagger_lightning') && Math.random() < 0.35 ? 145 : 0;

    if (kind === 'hero') {
      const dealt = this.applyDamage(attacker, unit as HeroState, dmg, dmgType, isCrit);
      if (bonusLightning > 0) {
        this.applyDamage(attacker, unit as HeroState, bonusLightning, 'magic', false);
        this.emit({ type: 'vfx', vfxKind: 'lightning', x: unit.x, z: unit.z, color: '#38bdf8' });
      }
      if (silence) (unit as HeroState).silenceTimer = Math.max((unit as HeroState).silenceTimer, 1.0);
      if (attacker.redBuffTimer > 0) {
        this.applySlow(unit as HeroState, 0.22, 2.0);
        this.applyDamage(attacker, unit as HeroState, 45 + attacker.level * 5, 'true', false);
      }
      if (attacker.lifesteal > 0 && dealt > 0) {
        this.healHero(attacker, dealt * attacker.lifesteal);
      }
      if (attacker.heroId === 'lubu' && attacker.lubuEnchantTimer > 0) {
        this.healHero(attacker, 90 + attacker.ad * 0.22);
      }
    } else if (kind === 'minion') {
      this.damageMinion(attacker, unit as MinionState, dmg + bonusLightning, dmgType);
      if (attacker.lifesteal > 0) this.healHero(attacker, dmg * attacker.lifesteal * 0.6);
    } else if (kind === 'monster') {
      const jungleMult = attacker.items.includes('jungle_blade') ? 1.35 : 1;
      this.damageMonster(attacker, unit as MonsterState, (dmg + bonusLightning) * jungleMult, dmgType);
      if (attacker.lifesteal > 0) this.healHero(attacker, dmg * attacker.lifesteal * 0.7);
    } else if (kind === 'turret') {
      this.damageTurret(attacker, unit as TurretState, dmg);
    }
  }

  private tryCastSkill(
    hero: HeroState,
    cast: { slot: 0 | 1 | 2; dirX: number; dirZ: number; targetX: number; targetZ: number }
  ): void {
    const def = HEROES[hero.heroId];
    const sk = def.skills[cast.slot];
    const lv = hero.skillLevels[cast.slot];
    if (lv <= 0) return;

    // Special case: Li Bai S1 multi-stage recast!
    const isLibaiRecast = hero.heroId === 'libai' && cast.slot === 0 && hero.libaiS1Stage > 0 && hero.libaiS1Window > 0;
    if (!isLibaiRecast && hero.skillCooldowns[cast.slot] > 0) return;

    const manaCost = isLibaiRecast ? 0 : sk.manaCost[Math.min(lv - 1, sk.manaCost.length - 1)] || 0;
    if (hero.mp < manaCost) return;

    hero.mp -= manaCost;
    hero.recallTimer = 0;
    hero.revealedTimer = 2.0;

    if (!isLibaiRecast) {
      const baseCd = sk.cooldowns[Math.min(lv - 1, sk.cooldowns.length - 1)];
      if (!(hero.heroId === 'libai' && cast.slot === 0)) {
        hero.skillCooldowns[cast.slot] = baseCd * (1 - hero.cdr);
      }
    }

    hero.animState = cast.slot === 0 ? 'cast1' : cast.slot === 1 ? 'cast2' : 'cast3';
    hero.animTimer = 0.45;

    // Resolve smart aiming direction if direction was near zero
    let dirX = cast.dirX;
    let dirZ = cast.dirZ;
    let targetX = cast.targetX;
    let targetZ = cast.targetZ;

    const nearestEnemy = this.heroes
      .filter(
        (e) =>
          e.alive &&
          e.team !== hero.team &&
          e.untargetableTimer <= 0 &&
          dist(hero.x, hero.z, e.x, e.z) <= Math.min(sk.range + 4, 24) &&
          (!e.inBush || e.revealedTimer > 0)
      )
      .sort((a, b) => dist(hero.x, hero.z, a.x, a.z) - dist(hero.x, hero.z, b.x, b.z))[0];

    if (Math.hypot(dirX, dirZ) < 0.08) {
      if (nearestEnemy) {
        const d = dist(hero.x, hero.z, nearestEnemy.x, nearestEnemy.z) || 1;
        dirX = (nearestEnemy.x - hero.x) / d;
        dirZ = (nearestEnemy.z - hero.z) / d;
        targetX = nearestEnemy.x;
        targetZ = nearestEnemy.z;
      } else {
        dirX = Math.sin(hero.facing);
        dirZ = Math.cos(hero.facing);
        targetX = hero.x + dirX * Math.min(sk.range, 10);
        targetZ = hero.z + dirZ * Math.min(sk.range, 10);
      }
    } else {
      const len = Math.hypot(dirX, dirZ);
      dirX /= len;
      dirZ /= len;
    }

    if (sk.targetType !== 'self') {
      hero.facing = Math.atan2(dirX, dirZ);
    }

    // Clamp AoE target within skill range
    const tDist = dist(hero.x, hero.z, targetX, targetZ);
    if (tDist > sk.range) {
      targetX = hero.x + ((targetX - hero.x) / tDist) * sk.range;
      targetZ = hero.z + ((targetZ - hero.z) / tDist) * sk.range;
    }

    // === DISPATCH EACH HERO'S UNIQUE SKILLS ===
    switch (hero.heroId) {
      case 'arthur':
        this.castArthurSkill(hero, cast.slot, lv, nearestEnemy);
        break;
      case 'libai':
        this.castLibaiSkill(hero, cast.slot, lv, dirX, dirZ);
        break;
      case 'daji':
        this.castDajiSkill(hero, cast.slot, lv, dirX, dirZ, nearestEnemy);
        break;
      case 'houyi':
        this.castHouyiSkill(hero, cast.slot, lv, dirX, dirZ, targetX, targetZ);
        break;
      case 'lubu':
        this.castLubuSkill(hero, cast.slot, lv, dirX, dirZ, targetX, targetZ);
        break;
      case 'caiwenji':
        this.castCaiwenjiSkill(hero, cast.slot, lv, dirX, dirZ);
        break;
    }
  }

  private castArthurSkill(hero: HeroState, slot: 0 | 1 | 2, lv: number, nearestEnemy?: HeroState): void {
    if (slot === 0) {
      hero.speedBoostTimer = 3.0;
      hero.speedBoostFactor = 0.35;
      hero.arthurS1Empowered = 3.5;
      this.emit({ type: 'vfx', vfxKind: 'speed_aura', x: hero.x, z: hero.z, color: '#facc15', sfxKind: 'buff' });
    } else if (slot === 1) {
      hero.arthurS2Timer = 5.0;
      this.emit({ type: 'vfx', vfxKind: 'arthur_shields', x: hero.x, z: hero.z, unitId: hero.id, radius: 5.2, color: '#60a5fa', sfxKind: 'skill_holy' });
    } else {
      const target = nearestEnemy && dist(hero.x, hero.z, nearestEnemy.x, nearestEnemy.z) <= 10.5 ? nearestEnemy : null;
      const landX = target ? target.x : hero.x + Math.sin(hero.facing) * 6;
      const landZ = target ? target.z : hero.z + Math.cos(hero.facing) * 6;
      hero.x = clamp(landX, 4, MAP_SIZE - 4);
      hero.z = clamp(landZ, 4, MAP_SIZE - 4);
      this.resolveHeroCollisions(hero);

      if (target) {
        const pctDmg = target.maxHp * (0.14 + lv * 0.035);
        this.applyDamage(hero, target, pctDmg, 'magic', false);
      }
      this.damageEnemiesInRadius(hero, hero.x, hero.z, 4.6, 220 + lv * 90, 'magic', { knockup: 0.75 });
      this.zones.push({
        id: this.uid('zone'),
        ownerId: hero.id,
        team: hero.team,
        kind: 'arthur_ult',
        x: hero.x,
        z: hero.z,
        radius: 4.5,
        remaining: 3.5,
        duration: 3.5,
        tickTimer: 0.5,
        color: '#fbbf24',
      });
      this.emit({ type: 'vfx', vfxKind: 'holy_slam', x: hero.x, z: hero.z, radius: 4.8, color: '#fbbf24', sfxKind: 'ult_slam' });
    }
  }

  private castLibaiSkill(hero: HeroState, slot: 0 | 1 | 2, lv: number, dirX: number, dirZ: number): void {
    if (slot === 0) {
      if (hero.libaiS1Stage === 0) {
        hero.libaiShadowX = hero.x;
        hero.libaiShadowZ = hero.z;
        hero.libaiS1Stage = 1;
        hero.libaiS1Window = 5.0;
      } else if (hero.libaiS1Stage === 1) {
        hero.libaiS1Stage = 2;
      } else {
        // Stage 2: return to shadow!
        this.emit({ type: 'vfx', vfxKind: 'libai_dash', x: hero.x, z: hero.z, targetX: hero.libaiShadowX, targetZ: hero.libaiShadowZ, color: '#38bdf8', sfxKind: 'dash' });
        hero.x = hero.libaiShadowX;
        hero.z = hero.libaiShadowZ;
        hero.libaiS1Stage = 0;
        hero.libaiS1Window = 0;
        const sk = HEROES.libai.skills[0];
        hero.skillCooldowns[0] = sk.cooldowns[lv - 1] * (1 - hero.cdr);
        return;
      }

      const startX = hero.x;
      const startZ = hero.z;
      const dashDist = 9.0;
      hero.x = clamp(hero.x + dirX * dashDist, 4, MAP_SIZE - 4);
      hero.z = clamp(hero.z + dirZ * dashDist, 4, MAP_SIZE - 4);
      this.resolveHeroCollisions(hero);

      // Damage & stun enemies along dash path
      const dmg = 260 + lv * 55 + hero.ad * 0.95;
      this.damageEnemiesAlongLine(hero, startX, startZ, hero.x, hero.z, 2.8, dmg, 'physical', 0.55);
      hero.libaiStacks = Math.min(4, hero.libaiStacks + 1);
      this.recalcHeroStats(hero);
      this.emit({ type: 'vfx', vfxKind: 'libai_dash', x: startX, z: startZ, targetX: hero.x, targetZ: hero.z, color: '#38bdf8', sfxKind: 'dash' });
    } else if (slot === 1) {
      hero.untargetableTimer = 0.45;
      const dmg = 210 + lv * 45 + hero.ad * 0.75;
      this.damageEnemiesInRadius(hero, hero.x, hero.z, 6.2, dmg, 'physical', { slow: 0.45, slowDur: 1.5 });
      this.zones.push({
        id: this.uid('zone'),
        ownerId: hero.id,
        team: hero.team,
        kind: 'libai_s2',
        x: hero.x,
        z: hero.z,
        radius: 6.2,
        remaining: 3.6,
        duration: 3.6,
        tickTimer: 0.6,
        color: '#38bdf8',
      });
      this.emit({ type: 'vfx', vfxKind: 'libai_ring', x: hero.x, z: hero.z, radius: 6.2, color: '#38bdf8', sfxKind: 'sword_ring' });
    } else {
      // 青莲剑歌 — 5 blazing phantom slashes!
      hero.untargetableTimer = 0.85;
      const fullStackBonus = hero.libaiStacks >= 4 ? 1.35 : 1.0;
      hero.libaiStacks = 0;
      this.recalcHeroStats(hero);
      const cx = hero.x + dirX * 4.8;
      const cz = hero.z + dirZ * 4.8;
      const perHitDmg = (175 + lv * 65 + hero.ad * 0.65) * fullStackBonus;

      this.emit({ type: 'vfx', vfxKind: 'libai_ult', x: cx, z: cz, radius: 7.0, angle: hero.facing, color: '#38bdf8', sfxKind: 'libai_ult' });
      for (let i = 0; i < 5; i++) {
        this.delayedActions.push({
          time: this.time + i * 0.14,
          fn: () => {
            if (!hero.alive) return;
            this.damageEnemiesInRadius(hero, cx, cz, 7.0, perHitDmg, 'physical');
          },
        });
      }
    }
  }

  private castDajiSkill(
    hero: HeroState,
    slot: 0 | 1 | 2,
    lv: number,
    dirX: number,
    dirZ: number,
    nearestEnemy?: HeroState
  ): void {
    if (slot === 0) {
      const dmg = 420 + lv * 85 + hero.ap * 1.12;
      this.projectiles.push({
        id: this.uid('proj'),
        ownerId: hero.id,
        team: hero.team,
        kind: 'daji_s1',
        x: hero.x,
        z: hero.z,
        vx: dirX * 26,
        vz: dirZ * 26,
        radius: 2.6,
        speed: 26,
        damage: dmg,
        damageType: 'magic',
        maxDist: 16.5,
        traveled: 0,
        color: '#fb7185',
        hitIds: [],
        pierce: true,
      });
      this.emit({ type: 'sfx', sfxKind: 'magic_wave', x: hero.x, z: hero.z });
    } else if (slot === 1) {
      const target = nearestEnemy && dist(hero.x, hero.z, nearestEnemy.x, nearestEnemy.z) <= 13.5 ? nearestEnemy : null;
      const dmg = 260 + lv * 50 + hero.ap * 0.68;
      this.projectiles.push({
        id: this.uid('proj'),
        ownerId: hero.id,
        team: hero.team,
        kind: 'daji_s2',
        x: hero.x,
        z: hero.z,
        vx: dirX * 24,
        vz: dirZ * 24,
        targetId: target?.id,
        radius: 1.8,
        speed: 24,
        damage: dmg,
        damageType: 'magic',
        maxDist: 14.5,
        traveled: 0,
        color: '#f472b6',
        hitIds: [],
        stunDuration: 1.5,
      });
      this.emit({ type: 'sfx', sfxKind: 'charm', x: hero.x, z: hero.z });
    } else {
      // 5 Homing Foxfire wisps!
      const perOrbDmg = 285 + lv * 75 + hero.ap * 0.72;
      for (let i = 0; i < 5; i++) {
        this.delayedActions.push({
          time: this.time + i * 0.12,
          fn: () => {
            if (!hero.alive) return;
            const enemies = this.heroes
              .filter(
                (e) =>
                  e.alive &&
                  e.team !== hero.team &&
                  e.untargetableTimer <= 0 &&
                  dist(hero.x, hero.z, e.x, e.z) <= 14
              )
              .sort((a, b) => dist(hero.x, hero.z, a.x, a.z) - dist(hero.x, hero.z, b.x, b.z));
            const tgt =
              enemies[i % Math.max(1, enemies.length)] ||
              this.minions.find((m) => m.team !== hero.team && dist(hero.x, hero.z, m.x, m.z) <= 13);
            if (!tgt) return;
            this.projectiles.push({
              id: this.uid('proj'),
              ownerId: hero.id,
              team: hero.team,
              kind: 'daji_s3',
              x: hero.x,
              z: hero.z,
              vx: 0,
              vz: 0,
              targetId: tgt.id,
              radius: 1.2,
              speed: 28,
              damage: perOrbDmg,
              damageType: 'magic',
              maxDist: 28,
              traveled: 0,
              color: '#fb7185',
              hitIds: [],
            });
            this.emit({ type: 'sfx', sfxKind: 'magic_shoot', x: hero.x, z: hero.z });
          },
        });
      }
    }
  }

  private castHouyiSkill(
    hero: HeroState,
    slot: 0 | 1 | 2,
    lv: number,
    dirX: number,
    dirZ: number,
    targetX: number,
    targetZ: number
  ): void {
    if (slot === 0) {
      hero.houyiS1Timer = 5.0;
      this.emit({ type: 'vfx', vfxKind: 'speed_aura', x: hero.x, z: hero.z, color: '#fbbf24', sfxKind: 'buff' });
    } else if (slot === 1) {
      const dmg = 290 + lv * 55 + hero.ad * 0.55;
      this.zones.push({
        id: this.uid('zone'),
        ownerId: hero.id,
        team: hero.team,
        kind: 'houyi_s2',
        x: targetX,
        z: targetZ,
        radius: 4.5,
        remaining: 0.45,
        duration: 0.45,
        tickTimer: 0.4,
        color: '#f97316',
      });
      this.delayedActions.push({
        time: this.time + 0.35,
        fn: () => {
          this.damageEnemiesInRadius(hero, targetX, targetZ, 4.5, dmg, 'magic', { slow: 0.35, slowDur: 2.0 });
          this.damageEnemiesInRadius(hero, targetX, targetZ, 2.2, dmg * 0.45, 'magic');
          this.emit({ type: 'vfx', vfxKind: 'solar_pillar', x: targetX, z: targetZ, radius: 4.5, color: '#f97316', sfxKind: 'solar_hit' });
        },
      });
    } else {
      // Cross-map Burning Sunbird!
      const dmg = 620 + lv * 180 + hero.ad * 0.9;
      this.projectiles.push({
        id: this.uid('proj'),
        ownerId: hero.id,
        team: hero.team,
        kind: 'houyi_ult',
        x: hero.x + dirX * 1.5,
        z: hero.z + dirZ * 1.5,
        vx: dirX * 32,
        vz: dirZ * 32,
        radius: 2.5,
        speed: 32,
        damage: dmg,
        damageType: 'physical',
        maxDist: 200,
        traveled: 0,
        color: '#f97316',
        hitIds: [],
      });
      this.emit({ type: 'sfx', sfxKind: 'phoenix_ult', x: hero.x, z: hero.z });
    }
  }

  private castLubuSkill(
    hero: HeroState,
    slot: 0 | 1 | 2,
    lv: number,
    dirX: number,
    dirZ: number,
    targetX: number,
    targetZ: number
  ): void {
    if (slot === 0) {
      const enchanted = hero.lubuEnchantTimer > 0;
      const dmg = 420 + lv * 95 + hero.ad * 1.45;
      const dmgType: DamageType = enchanted ? 'true' : 'physical';
      const angle = Math.atan2(dirX, dirZ);

      let hitHero = false;
      for (const e of this.heroes) {
        if (!e.alive || e.team === hero.team || e.untargetableTimer > 0) continue;
        const d = dist(hero.x, hero.z, e.x, e.z);
        if (d <= 7.8) {
          const toA = Math.atan2(e.x - hero.x, e.z - hero.z);
          const diff = Math.abs(Math.atan2(Math.sin(toA - angle), Math.cos(toA - angle)));
          if (diff <= Math.PI * 0.58) {
            this.applyDamage(hero, e, dmg, dmgType, false);
            hitHero = true;
          }
        }
      }
      // Also cleave minions & monsters
      for (const m of this.minions) {
        if (m.team !== hero.team && dist(hero.x, hero.z, m.x, m.z) <= 7.8) {
          this.damageMinion(hero, m, dmg * 0.85, dmgType);
        }
      }
      for (const mon of this.monsters) {
        if (mon.alive && dist(hero.x, hero.z, mon.x, mon.z) <= 8.2) {
          this.damageMonster(hero, mon, dmg * 0.85, dmgType);
        }
      }

      if (hitHero) {
        hero.lubuEnchantTimer = 8.0;
        if (enchanted) this.healHero(hero, hero.maxHp * 0.08 + hero.ad * 0.4);
      }

      this.emit({
        type: 'vfx',
        vfxKind: enchanted ? 'lubu_cleave_true' : 'lubu_cleave',
        x: hero.x,
        z: hero.z,
        angle,
        radius: 7.5,
        color: enchanted ? '#f43f5e' : '#ef4444',
        sfxKind: 'heavy_slash',
      });
    } else if (slot === 1) {
      let hits = 0;
      const cx = hero.x + dirX * 4.5;
      const cz = hero.z + dirZ * 4.5;
      for (const e of this.heroes) {
        if (e.alive && e.team !== hero.team && dist(cx, cz, e.x, e.z) <= 5.8) {
          this.applySlow(e, 0.35, 2.5);
          this.applyDamage(hero, e, 95 + lv * 20, 'physical', false);
          hits++;
        }
      }
      for (const m of this.minions) {
        if (m.team !== hero.team && dist(cx, cz, m.x, m.z) <= 5.8) hits++;
      }
      const shieldGain = Math.min(3, Math.max(1, hits)) * (320 + lv * 90 + hero.maxHp * 0.05);
      hero.shield = Math.min(hero.maxHp * 0.55, hero.shield + shieldGain);
      this.emit({ type: 'vfx', vfxKind: 'soul_siphon', x: cx, z: cz, targetX: hero.x, targetZ: hero.z, color: '#a855f7', sfxKind: 'buff' });
    } else {
      // 魔神降世!
      const lx = clamp(targetX, 5, MAP_SIZE - 5);
      const lz = clamp(targetZ, 5, MAP_SIZE - 5);
      hero.untargetableTimer = 0.72;
      this.zones.push({
        id: this.uid('zone'),
        ownerId: hero.id,
        team: hero.team,
        kind: 'lubu_ult',
        x: lx,
        z: lz,
        radius: 7.4,
        remaining: 5.5,
        duration: 5.5,
        tickTimer: 0.7,
        color: '#e11d48',
      });
      this.emit({ type: 'vfx', vfxKind: 'lubu_ult_warn', x: lx, z: lz, radius: 7.4, color: '#e11d48', sfxKind: 'ult_charge' });

      this.delayedActions.push({
        time: this.time + 0.68,
        fn: () => {
          if (!hero.alive) return;
          hero.x = lx;
          hero.z = lz;
          this.resolveHeroCollisions(hero);
          hero.lubuEnchantTimer = 8.0;
          const dmg = 520 + lv * 170 + hero.ad * 1.6;
          this.damageEnemiesInRadius(hero, lx, lz, 7.4, dmg, 'true', { knockup: 1.0, slow: 0.4, slowDur: 2.0 });
          this.emit({ type: 'vfx', vfxKind: 'lubu_ult_land', x: lx, z: lz, radius: 7.8, color: '#f43f5e', sfxKind: 'ult_slam' });
        },
      });
    }
  }

  private castCaiwenjiSkill(hero: HeroState, slot: 0 | 1 | 2, lv: number, dirX: number, dirZ: number): void {
    if (slot === 0) {
      hero.caiwenjiS1Timer = 4.5;
      hero.speedBoostTimer = 4.5;
      hero.speedBoostFactor = 0.25;
      this.emit({ type: 'vfx', vfxKind: 'heal_pulse', x: hero.x, z: hero.z, radius: 9.5, color: '#34d399', sfxKind: 'heal' });
    } else if (slot === 1) {
      const dmg = 220 + lv * 42 + hero.ap * 0.55;
      this.projectiles.push({
        id: this.uid('proj'),
        ownerId: hero.id,
        team: hero.team,
        kind: 'caiwenji_s2',
        x: hero.x,
        z: hero.z,
        vx: dirX * 22,
        vz: dirZ * 22,
        radius: 1.7,
        speed: 22,
        damage: dmg,
        damageType: 'magic',
        maxDist: 16,
        traveled: 0,
        color: '#2dd4bf',
        hitIds: [],
        bouncesLeft: 5,
        stunDuration: 0.75,
      });
      this.emit({ type: 'sfx', sfxKind: 'charm', x: hero.x, z: hero.z });
    } else {
      hero.caiwenjiS3Timer = 5.0;
      this.recalcHeroStats(hero);
      this.zones.push({
        id: this.uid('zone'),
        ownerId: hero.id,
        team: hero.team,
        kind: 'caiwenji_s3',
        x: hero.x,
        z: hero.z,
        radius: 10.2,
        remaining: 5.0,
        duration: 5.0,
        tickTimer: 0.5,
        color: '#fef08a',
      });
      this.emit({ type: 'vfx', vfxKind: 'sanctuary', x: hero.x, z: hero.z, radius: 10.2, color: '#fef08a', sfxKind: 'skill_holy' });
    }
  }

  private damageEnemiesInRadius(
    attacker: HeroState,
    cx: number,
    cz: number,
    radius: number,
    dmg: number,
    dmgType: DamageType,
    cc?: { stun?: number; knockup?: number; slow?: number; slowDur?: number }
  ): void {
    for (const e of this.heroes) {
      if (!e.alive || e.team === attacker.team || e.untargetableTimer > 0) continue;
      if (dist(cx, cz, e.x, e.z) <= radius + e.radius) {
        this.applyDamage(attacker, e, dmg, dmgType, false);
        if (cc?.stun) this.applyStun(e, cc.stun);
        if (cc?.knockup) e.knockupTimer = Math.max(e.knockupTimer, cc.knockup);
        if (cc?.slow && cc.slowDur) this.applySlow(e, cc.slow, cc.slowDur);
      }
    }
    for (const m of this.minions) {
      if (m.team !== attacker.team && dist(cx, cz, m.x, m.z) <= radius + m.radius) {
        this.damageMinion(attacker, m, dmg, dmgType);
      }
    }
    for (const mon of this.monsters) {
      if (mon.alive && dist(cx, cz, mon.x, mon.z) <= radius + mon.radius) {
        const jMult = attacker.items.includes('jungle_blade') ? 1.35 : 1;
        this.damageMonster(attacker, mon, dmg * jMult, dmgType);
      }
    }
  }

  private damageEnemiesAlongLine(
    attacker: HeroState,
    x1: number,
    z1: number,
    x2: number,
    z2: number,
    width: number,
    dmg: number,
    dmgType: DamageType,
    stunDur = 0
  ): void {
    const segLenSq = (x2 - x1) ** 2 + (z2 - z1) ** 2 || 1;
    const distToSeg = (px: number, pz: number) => {
      const t = clamp(((px - x1) * (x2 - x1) + (pz - z1) * (z2 - z1)) / segLenSq, 0, 1);
      return Math.hypot(px - (x1 + t * (x2 - x1)), pz - (z1 + t * (z2 - z1)));
    };
    for (const e of this.heroes) {
      if (!e.alive || e.team === attacker.team || e.untargetableTimer > 0) continue;
      if (distToSeg(e.x, e.z) <= width + e.radius) {
        this.applyDamage(attacker, e, dmg, dmgType, false);
        if (stunDur > 0) this.applyStun(e, stunDur);
      }
    }
    for (const m of this.minions) {
      if (m.team !== attacker.team && distToSeg(m.x, m.z) <= width + m.radius) {
        this.damageMinion(attacker, m, dmg, dmgType);
      }
    }
    for (const mon of this.monsters) {
      if (mon.alive && distToSeg(mon.x, mon.z) <= width + mon.radius) {
        this.damageMonster(attacker, mon, dmg, dmgType);
      }
    }
  }

  private applyStun(target: HeroState, dur: number): void {
    const tenacity = target.items.includes('boots_resist') ? 0.7 : 1.0;
    target.stunTimer = Math.max(target.stunTimer, dur * tenacity);
    target.recallTimer = 0;
  }

  private applySlow(target: HeroState, factor: number, dur: number): void {
    const tenacity = target.items.includes('boots_resist') ? 0.7 : 1.0;
    target.slowTimer = Math.max(target.slowTimer, dur * tenacity);
    target.slowFactor = Math.max(target.slowFactor, factor);
  }

  private healHero(hero: HeroState, amount: number): void {
    if (!hero.alive || amount <= 0) return;
    const actual = Math.min(hero.maxHp - hero.hp, amount);
    hero.hp += actual;
    if (actual >= 35) {
      this.emit({ type: 'heal', x: hero.x, z: hero.z, value: Math.round(actual), color: '#4ade80' });
    }
  }

  private calcMitigatedDamage(
    rawDmg: number,
    dmgType: DamageType,
    armor: number,
    mr: number,
    armorPen = 0,
    magicPen = 0
  ): number {
    if (dmgType === 'true') return rawDmg;
    const def = dmgType === 'physical' ? Math.max(0, armor - armorPen) : Math.max(0, mr - magicPen);
    // Authentic Honor of Kings damage reduction formula: 602 / (602 + def)
    return rawDmg * (602 / (602 + def));
  }

  private applyDamage(
    attacker: HeroState | null,
    victim: HeroState,
    rawDmg: number,
    dmgType: DamageType,
    isCrit: boolean
  ): number {
    if (!victim.alive || victim.untargetableTimer > 0) return 0;

    // Sword of Despair (破军) +30% damage below 50% HP
    let mult = 1;
    if (attacker && attacker.items.includes('sword_despair') && victim.hp < victim.maxHp * 0.5) {
      mult = 1.3;
    }

    // Daji passive MR shred
    if (attacker && attacker.heroId === 'daji' && dmgType === 'magic') {
      victim.dajiMrShred = Math.min(210, victim.dajiMrShred + 65);
      this.recalcHeroStats(victim);
    }

    const dmg = Math.max(
      1,
      Math.round(
        this.calcMitigatedDamage(
          rawDmg * mult,
          dmgType,
          victim.armor,
          victim.mr,
          attacker?.armorPen || 0,
          attacker?.magicPen || 0
        )
      )
    );

    victim.recallTimer = 0;

    // Cai Wenji passive: speed boost + heal when taking damage
    if (victim.heroId === 'caiwenji' && victim.caiwenjiPassiveCd <= 0) {
      victim.caiwenjiPassiveCd = 10;
      victim.speedBoostTimer = Math.max(victim.speedBoostTimer, 2.0);
      victim.speedBoostFactor = Math.max(victim.speedBoostFactor, 0.5);
      this.healHero(victim, 240 + victim.level * 30 + victim.ap * 0.4);
    }

    // Shield absorption
    let remaining = dmg;
    if (victim.shield > 0) {
      const absorbed = Math.min(victim.shield, remaining);
      victim.shield -= absorbed;
      remaining -= absorbed;
    }

    victim.hp = Math.max(0, victim.hp - remaining);
    victim.damageTaken += dmg;

    if (attacker) {
      attacker.damageDealt += dmg;
      victim.lastDamagedBy[attacker.id] = this.time;

      // Spell Vamp
      if (dmgType === 'magic' && attacker.spellVamp > 0) {
        this.healHero(attacker, dmg * attacker.spellVamp * 0.65);
      }

      // Echo Staff AoE proc
      if (dmgType === 'magic' && attacker.items.includes('staff_echo') && Math.random() < 0.25) {
        this.emit({ type: 'vfx', vfxKind: 'echo_burst', x: victim.x, z: victim.z, radius: 3.8, color: '#c084fc' });
      }

      // Turret Aggro Rule! If attacker damages an ally hero inside enemy turret range, turret switches to attacker!
      for (const t of this.turrets) {
        if (t.alive && t.team === victim.team && dist(attacker.x, attacker.z, t.x, t.z) <= t.range) {
          t.targetId = attacker.id;
        }
      }
    }

    this.emit({
      type: 'damage',
      x: victim.x,
      z: victim.z,
      value: dmg,
      damageType: dmgType,
      crit: isCrit,
      unitId: victim.id,
    });

    if (victim.hp <= 0) {
      this.handleHeroDeath(victim, attacker);
    }
    return dmg;
  }

  private handleHeroDeath(victim: HeroState, killer: HeroState | null): void {
    victim.alive = false;
    victim.deaths++;
    const wasStreak = victim.killStreak;
    victim.killStreak = 0;
    victim.respawnTimer = clamp(8 + victim.level * 1.8 + this.time * 0.015, 8, 38);
    victim.animState = 'dead';
    victim.arthurS2Timer = 0;
    victim.caiwenjiS1Timer = 0;
    victim.caiwenjiS3Timer = 0;

    // Find recent killer if turret/minion finished off victim
    let creditedKiller = killer;
    if (!creditedKiller) {
      let latestTime = -1;
      for (const [id, t] of Object.entries(victim.lastDamagedBy)) {
        if (this.time - t <= 8 && t > latestTime) {
          latestTime = t;
          creditedKiller = this.heroes.find((h) => h.id === id) || null;
        }
      }
    }

    if (victim.team === 'blue') this.redKills++;
    else this.blueKills++;

    let bannerTitle = '击杀敌方英雄！';
    let sfxKind = 'kill';

    if (creditedKiller) {
      creditedKiller.kills++;
      creditedKiller.killStreak++;
      creditedKiller.multiKillCount =
        creditedKiller.multiKillTimer > 0 ? creditedKiller.multiKillCount + 1 : 1;
      creditedKiller.multiKillTimer = 11;

      const bounty = 220 + Math.min(350, wasStreak * 65);
      creditedKiller.gold += bounty;
      this.grantXp(creditedKiller, 260 + victim.level * 45);
      this.emit({ type: 'gold', x: victim.x, z: victim.z, value: bounty });

      // Assists
      for (const [id, t] of Object.entries(victim.lastDamagedBy)) {
        if (id !== creditedKiller.id && this.time - t <= 10) {
          const assister = this.heroes.find((h) => h.id === id);
          if (assister) {
            assister.assists++;
            assister.gold += Math.round(bounty * 0.45);
            this.grantXp(assister, 130 + victim.level * 22);
          }
        }
      }

      if (!this.firstBloodTaken) {
        this.firstBloodTaken = true;
        creditedKiller.gold += 120;
        bannerTitle = 'FIRST BLOOD · 第一滴血！';
        sfxKind = 'first_blood';
      } else if (creditedKiller.multiKillCount === 2) {
        bannerTitle = 'DOUBLE KILL · 二连击破！';
        sfxKind = 'double_kill';
      } else if (creditedKiller.multiKillCount === 3) {
        bannerTitle = 'TRIPLE KILL · 三连决胜！';
        sfxKind = 'triple_kill';
      } else if (creditedKiller.multiKillCount === 4) {
        bannerTitle = 'QUADRA KILL · 四连超凡！';
        sfxKind = 'quadra_kill';
      } else if (creditedKiller.multiKillCount >= 5) {
        bannerTitle = 'PENTA KILL · 五连绝世！';
        sfxKind = 'penta_kill';
      } else if (wasStreak >= 3) {
        bannerTitle = 'SHUT DOWN · 终结连杀！';
        sfxKind = 'shutdown';
      } else if (creditedKiller.killStreak >= 7) {
        bannerTitle = 'LEGENDARY · 天下无双超神！';
        sfxKind = 'legendary';
      } else if (creditedKiller.killStreak >= 5) {
        bannerTitle = 'GODLIKE · 横扫千军！';
        sfxKind = 'godlike';
      } else if (creditedKiller.killStreak >= 3) {
        bannerTitle = 'KILLING SPREE · 锋芒毕露！';
        sfxKind = 'killing_spree';
      }
    }

    const kName = creditedKiller ? `${HEROES[creditedKiller.heroId].name}` : '防御塔';
    const vName = HEROES[victim.heroId].name;

    this.emit({
      type: 'kill',
      x: victim.x,
      z: victim.z,
      text: bannerTitle,
      subText: `${kName} 击败了 ${vName}`,
      team: creditedKiller?.team || (victim.team === 'blue' ? 'red' : 'blue'),
      heroId: creditedKiller?.heroId,
      victimHeroId: victim.heroId,
      color: victim.team === 'red' ? '#38bdf8' : '#f43f5e',
      sfxKind,
    });
    this.emit({ type: 'vfx', vfxKind: 'death_burst', x: victim.x, z: victim.z, color: victim.team === 'blue' ? '#38bdf8' : '#f43f5e' });

    // Check ACE (团灭)
    const teamAlive = this.heroes.some((h) => h.team === victim.team && h.alive);
    if (!teamAlive) {
      this.emit({
        type: 'announce',
        text: 'ACE · 团灭！',
        subText: `${victim.team === 'blue' ? '蓝方' : '红方'}全军覆没！`,
        color: '#fbbf24',
        sfxKind: 'ace',
      });
    }

    victim.lastDamagedBy = {};
  }

  private grantXp(hero: HeroState, amount: number): void {
    if (hero.level >= 15) return;
    hero.xp += amount;
    while (hero.level < 15 && hero.xp >= hero.xpToNext) {
      hero.xp -= hero.xpToNext;
      hero.level++;
      hero.skillPoints++;
      hero.xpToNext = XP_TABLE[hero.level] || 99999;
      this.recalcHeroStats(hero);
      this.emit({
        type: 'level_up',
        x: hero.x,
        z: hero.z,
        value: hero.level,
        unitId: hero.id,
        color: '#fbbf24',
        sfxKind: 'level_up',
      });
    }
  }

  private damageMinion(attacker: HeroState | null, minion: MinionState, rawDmg: number, dmgType: DamageType): void {
    const dmg = Math.max(1, Math.round(this.calcMitigatedDamage(rawDmg, dmgType, minion.armor, 30)));
    minion.hp -= dmg;
    if (attacker) {
      this.emit({ type: 'damage', x: minion.x, z: minion.z, value: dmg, damageType: dmgType, unitId: minion.id });
    }
    if (minion.hp <= 0) {
      const idx = this.minions.indexOf(minion);
      if (idx !== -1) this.minions.splice(idx, 1);

      const goldVal =
        minion.type === 'cannon' ? 110 : minion.type === 'super' ? 120 : minion.type === 'ranged' ? 62 : 72;
      const xpVal = minion.type === 'cannon' ? 210 : 145;
      const enemyTeam: Team = minion.team === 'blue' ? 'red' : 'blue';

      if (attacker) {
        attacker.cs++;
        attacker.gold += goldVal;
        this.grantXp(attacker, Math.round(xpVal * 1.2));
        this.emit({ type: 'gold', x: minion.x, z: minion.z, value: goldVal, sfxKind: 'coin' });
      }
      // Share proximity XP & partial gold to nearby allies (generous HoK soak radius!)
      for (const h of this.heroes) {
        if (h.alive && h.team === enemyTeam && h.id !== attacker?.id && dist(h.x, h.z, minion.x, minion.z) <= 22) {
          h.gold += Math.round(goldVal * 0.72);
          this.grantXp(h, xpVal);
        }
      }
    }
  }

  private damageMonster(attacker: HeroState, monster: MonsterState, rawDmg: number, dmgType: DamageType): void {
    if (!monster.alive) return;
    const dmg = Math.max(1, Math.round(this.calcMitigatedDamage(rawDmg, dmgType, monster.armor, 60)));
    monster.hp -= dmg;
    monster.aggroTargetId = attacker.id;
    this.emit({ type: 'damage', x: monster.x, z: monster.z, value: dmg, damageType: dmgType, unitId: monster.id });

    if (monster.hp <= 0) {
      monster.alive = false;
      monster.hp = 0;
      monster.aggroTargetId = null;
      const bp = MONSTER_BLUEPRINTS.find((b) => b.id === monster.id);
      monster.respawnTimer = bp ? bp.respawnTime : 85;

      attacker.cs++;
      attacker.gold += monster.goldReward;
      this.grantXp(attacker, monster.xpReward);
      this.emit({ type: 'gold', x: monster.x, z: monster.z, value: monster.goldReward, sfxKind: 'coin' });
      this.emit({ type: 'vfx', vfxKind: 'death_burst', x: monster.x, z: monster.z, color: '#fbbf24' });

      if (monster.type === 'red_buff') {
        attacker.redBuffTimer = 70;
        this.emit({ type: 'vfx', vfxKind: 'speed_aura', x: attacker.x, z: attacker.z, color: '#ef4444', sfxKind: 'buff' });
      } else if (monster.type === 'blue_buff') {
        attacker.blueBuffTimer = 70;
        this.recalcHeroStats(attacker);
        this.emit({ type: 'vfx', vfxKind: 'speed_aura', x: attacker.x, z: attacker.z, color: '#3b82f6', sfxKind: 'buff' });
      } else if (monster.type === 'tyrant') {
        for (const ally of this.heroes) {
          if (ally.team === attacker.team) {
            ally.gold += 140;
            this.grantXp(ally, 260);
            ally.tyrantBuffTimer = 90;
            this.recalcHeroStats(ally);
          }
        }
        this.emit({
          type: 'boss_kill',
          team: attacker.team,
          text: `${attacker.team === 'blue' ? '蓝方' : '红方'}击败了暗影暴君！`,
          subText: '全队获得金币、经验与暴君攻击加成！',
          color: '#a855f7',
          sfxKind: 'boss_kill',
        });
      } else if (monster.type === 'overlord') {
        if (attacker.team === 'blue') this.overlordWavesBlue += 3;
        else this.overlordWavesRed += 3;
        for (const ally of this.heroes) {
          if (ally.team === attacker.team) {
            ally.gold += 180;
            this.grantXp(ally, 320);
            ally.overlordBuffTimer = 90;
          }
        }
        this.emit({
          type: 'boss_kill',
          team: attacker.team,
          text: `${attacker.team === 'blue' ? '蓝方' : '红方'}击败了暗影主宰！`,
          subText: '三路将召唤暗影先锋推进敌阵！',
          color: '#f59e0b',
          sfxKind: 'boss_kill',
        });
      }
    }
  }

  private damageTurret(attacker: HeroState | null, turret: TurretState, rawDmg: number): void {
    if (!turret.alive) return;

    // Crystal protection: need at least 1 enemy highground turret down
    if (turret.tier === 'crystal') {
      const hgAlive = this.turrets.filter((t) => t.team === turret.team && t.tier === 'highground' && t.alive);
      if (hgAlive.length === 3) {
        return; // Invulnerable until at least one high-ground turret falls
      }
    }

    // Backdoor protection if no enemy minions near turret
    const enemyTeam: Team = turret.team === 'blue' ? 'red' : 'blue';
    const hasEnemyMinions = this.minions.some(
      (m) => m.team === enemyTeam && dist(m.x, m.z, turret.x, turret.z) <= turret.range + 2
    );
    const mult = hasEnemyMinions ? 1.0 : 0.42;

    const dmg = Math.max(1, Math.round(this.calcMitigatedDamage(rawDmg * mult, 'physical', turret.armor, 180)));
    turret.hp = Math.max(0, turret.hp - dmg);
    turret.underAttackTimer = 3.0;

    if (attacker) {
      this.emit({ type: 'damage', x: turret.x, z: turret.z, value: dmg, damageType: 'physical', unitId: turret.id });
    }

    if (turret.hp <= 0) {
      turret.alive = false;
      turret.targetId = null;

      // Team gold reward
      for (const h of this.heroes) {
        if (h.team === enemyTeam) {
          h.gold += turret.tier === 'highground' ? 160 : 120;
        }
      }
      if (attacker) attacker.gold += 110;

      this.emit({
        type: 'turret_destroy',
        x: turret.x,
        z: turret.z,
        team: enemyTeam,
        text: turret.tier === 'crystal' ? '水晶已被摧毁！' : '防御塔已被摧毁！',
        subText: `${turret.team === 'blue' ? '蓝方' : '红方'}防线告破！`,
        color: enemyTeam === 'blue' ? '#38bdf8' : '#f43f5e',
        sfxKind: 'turret_destroy',
      });
      this.emit({ type: 'vfx', vfxKind: 'turret_explode', x: turret.x, z: turret.z, radius: 6, color: '#f97316' });
    }
  }

  private updateMinions(dt: number): void {
    for (let i = this.minions.length - 1; i >= 0; i--) {
      const m = this.minions[i];
      if (m.attackCooldown > 0) m.attackCooldown = Math.max(0, m.attackCooldown - dt);
      if (m.animTimer > 0) m.animTimer = Math.max(0, m.animTimer - dt);

      // Find target: enemy minion -> enemy hero (close) -> enemy turret
      const enemyMinion = this.minions
        .filter((e) => e.team !== m.team && dist(m.x, m.z, e.x, e.z) <= 10.5)
        .sort((a, b) => dist(m.x, m.z, a.x, a.z) - dist(m.x, m.z, b.x, b.z))[0];

      const enemyHero = !enemyMinion
        ? this.heroes
            .filter(
              (h) =>
                h.alive &&
                h.team !== m.team &&
                h.untargetableTimer <= 0 &&
                !h.inBush &&
                dist(m.x, m.z, h.x, h.z) <= 9.5
            )
            .sort((a, b) => dist(m.x, m.z, a.x, a.z) - dist(m.x, m.z, b.x, b.z))[0]
        : null;

      const enemyTurret = !enemyMinion && !enemyHero
        ? this.turrets
            .filter((t) => t.alive && t.team !== m.team && dist(m.x, m.z, t.x, t.z) <= 13)
            .sort((a, b) => dist(m.x, m.z, a.x, a.z) - dist(m.x, m.z, b.x, b.z))[0]
        : null;

      const target: any = enemyMinion || enemyHero || enemyTurret;
      if (target) {
        const d = dist(m.x, m.z, target.x, target.z);
        const reach = m.attackRange + (target.radius || 2.3);
        m.facing = Math.atan2(target.x - m.x, target.z - m.z);
        if (d <= reach) {
          if (m.attackCooldown <= 0) {
            m.attackCooldown = 1.15;
            m.animState = 'attack';
            m.animTimer = 0.35;
            if (m.attackRange > 4) {
              this.projectiles.push({
                id: this.uid('proj'),
                ownerId: m.id,
                team: m.team,
                kind: 'minion_orb',
                x: m.x,
                z: m.z,
                vx: 0,
                vz: 0,
                targetId: target.id,
                radius: 0.5,
                speed: 22,
                damage: m.ad,
                damageType: 'physical',
                maxDist: 20,
                traveled: 0,
                color: m.team === 'blue' ? '#60a5fa' : '#f87171',
                hitIds: [],
              });
            } else {
              if (enemyMinion) this.damageMinion(null, enemyMinion, m.ad, 'physical');
              else if (enemyHero) this.applyDamage(null, enemyHero, m.ad, 'physical', false);
              else if (enemyTurret) this.damageTurret(null, enemyTurret, m.ad);
            }
          }
          continue;
        } else {
          const spd = 6.2;
          m.x += ((target.x - m.x) / d) * spd * dt;
          m.z += ((target.z - m.z) / d) * spd * dt;
          m.animState = 'run';
          continue;
        }
      }

      // Advance along lane waypoints
      const wps = m.team === 'blue' ? LANE_WAYPOINTS_BLUE[m.lane] : LANE_WAYPOINTS_RED[m.lane];
      const wp = wps[Math.min(m.waypointIndex, wps.length - 1)];
      const dx = wp.x - m.x;
      const dz = wp.z - m.z;
      const d = Math.hypot(dx, dz);
      if (d < 2.2 && m.waypointIndex < wps.length - 1) {
        m.waypointIndex++;
      } else if (d > 0.1) {
        const spd = 6.5;
        m.x += (dx / d) * spd * dt;
        m.z += (dz / d) * spd * dt;
        m.facing = Math.atan2(dx, dz);
        m.animState = 'run';
      }
    }
  }

  private updateTurrets(dt: number): void {
    for (const t of this.turrets) {
      if (!t.alive) continue;
      if (t.attackCooldown > 0) t.attackCooldown = Math.max(0, t.attackCooldown - dt);
      if (t.underAttackTimer > 0) t.underAttackTimer = Math.max(0, t.underAttackTimer - dt);

      // Validate current target
      let target: { kind: 'minion' | 'hero'; unit: any } | null = null;
      if (t.targetId) {
        const h = this.heroes.find((x) => x.id === t.targetId && x.alive && x.untargetableTimer <= 0);
        if (h && dist(t.x, t.z, h.x, h.z) <= t.range) {
          target = { kind: 'hero', unit: h };
        } else {
          const m = this.minions.find((x) => x.id === t.targetId);
          if (m && dist(t.x, t.z, m.x, m.z) <= t.range) {
            target = { kind: 'minion', unit: m };
          }
        }
      }

      // Acquire new target: minions first, then heroes
      if (!target) {
        t.consecutiveHeroHits = 0;
        const m = this.minions
          .filter((x) => x.team !== t.team && dist(t.x, t.z, x.x, x.z) <= t.range)
          .sort((a, b) => dist(t.x, t.z, a.x, a.z) - dist(t.x, t.z, b.x, b.z))[0];
        if (m) {
          target = { kind: 'minion', unit: m };
        } else {
          const h = this.heroes
            .filter(
              (x) =>
                x.alive &&
                x.team !== t.team &&
                x.untargetableTimer <= 0 &&
                dist(t.x, t.z, x.x, x.z) <= t.range
            )
            .sort((a, b) => dist(t.x, t.z, a.x, a.z) - dist(t.x, t.z, b.x, b.z))[0];
          if (h) {
            target = { kind: 'hero', unit: h };
            this.emit({ type: 'sfx', sfxKind: 'turret_lock', x: h.x, z: h.z, unitId: h.id });
          }
        }
      }

      t.targetId = target ? target.unit.id : null;
      if (target && t.attackCooldown <= 0) {
        t.attackCooldown = 1.05;
        let dmg = t.ad;
        if (target.kind === 'hero') {
          t.consecutiveHeroHits = Math.min(5, t.consecutiveHeroHits + 1);
          dmg = t.ad * (1 + (t.consecutiveHeroHits - 1) * 0.35);
        }
        this.projectiles.push({
          id: this.uid('proj'),
          ownerId: t.id,
          team: t.team,
          kind: 'turret_orb',
          x: t.x,
          z: t.z,
          vx: 0,
          vz: 0,
          targetId: target.unit.id,
          radius: 1.1,
          speed: 25,
          damage: dmg,
          damageType: 'physical',
          maxDist: 30,
          traveled: 0,
          color: t.team === 'blue' ? '#38bdf8' : '#f43f5e',
          hitIds: [],
        });
        this.emit({ type: 'sfx', sfxKind: 'turret_fire', x: t.x, z: t.z });
      }
    }
  }

  private updateMonsters(dt: number): void {
    for (const mon of this.monsters) {
      if (!mon.alive) {
        mon.respawnTimer -= dt;
        if (mon.respawnTimer <= 0) {
          mon.alive = true;
          const scale = 1 + Math.floor(this.time / 90) * 0.16;
          const bp = MONSTER_BLUEPRINTS.find((b) => b.id === mon.id)!;
          mon.maxHp = Math.round(bp.maxHp * scale);
          mon.hp = mon.maxHp;
          mon.ad = Math.round(bp.ad * scale);
          mon.x = mon.homeX;
          mon.z = mon.homeZ;
          mon.aggroTargetId = null;
          mon.animState = 'idle';
          if (mon.type === 'tyrant' || mon.type === 'overlord') {
            this.emit({
              type: 'announce',
              text: `${mon.name}已降临峡谷！`,
              subText: '前往河道争夺强力团队增益',
              color: mon.type === 'tyrant' ? '#a855f7' : '#f59e0b',
              sfxKind: 'boss_spawn',
            });
          }
        }
        continue;
      }

      if (mon.attackCooldown > 0) mon.attackCooldown = Math.max(0, mon.attackCooldown - dt);
      if (mon.animTimer > 0) mon.animTimer = Math.max(0, mon.animTimer - dt);

      const distHome = dist(mon.x, mon.z, mon.homeX, mon.homeZ);
      let target = mon.aggroTargetId
        ? this.heroes.find((h) => h.id === mon.aggroTargetId && h.alive && dist(mon.homeX, mon.homeZ, h.x, h.z) <= 13)
        : null;

      if (!target || distHome > 11.5) {
        mon.aggroTargetId = null;
        if (distHome > 0.6) {
          const d = distHome;
          mon.x += ((mon.homeX - mon.x) / d) * 6.5 * dt;
          mon.z += ((mon.homeZ - mon.z) / d) * 6.5 * dt;
          mon.facing = Math.atan2(mon.homeX - mon.x, mon.homeZ - mon.z);
          mon.animState = 'run';
          mon.hp = Math.min(mon.maxHp, mon.hp + mon.maxHp * 0.14 * dt);
        } else {
          mon.animState = 'idle';
        }
        continue;
      }

      const d = dist(mon.x, mon.z, target.x, target.z);
      mon.facing = Math.atan2(target.x - mon.x, target.z - mon.z);
      const reach = mon.radius + target.radius + 1.4;
      if (d <= reach) {
        if (mon.attackCooldown <= 0) {
          mon.attackCooldown = 1.25;
          mon.animState = 'attack';
          mon.animTimer = 0.4;
          this.applyDamage(null, target, mon.ad, 'physical', false);
        }
      } else {
        mon.x += ((target.x - mon.x) / d) * 5.8 * dt;
        mon.z += ((target.z - mon.z) / d) * 5.8 * dt;
        mon.animState = 'run';
      }
    }
  }

  private updateProjectiles(dt: number): void {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      const ownerHero = this.heroes.find((h) => h.id === p.ownerId) || null;

      // Homing projectiles
      if (p.targetId) {
        const tgtHero = this.heroes.find((h) => h.id === p.targetId && h.alive && h.untargetableTimer <= 0);
        const tgtMinion = !tgtHero ? this.minions.find((m) => m.id === p.targetId) : null;
        const tgtMonster = !tgtHero && !tgtMinion ? this.monsters.find((m) => m.id === p.targetId && m.alive) : null;
        const tgtTurret =
          !tgtHero && !tgtMinion && !tgtMonster
            ? this.turrets.find((t) => t.id === p.targetId && t.alive)
            : null;
        const tgt: any = tgtHero || tgtMinion || tgtMonster || tgtTurret;

        if (!tgt) {
          this.projectiles.splice(i, 1);
          continue;
        }

        const dx = tgt.x - p.x;
        const dz = tgt.z - p.z;
        const d = Math.hypot(dx, dz);
        const step = p.speed * dt;
        if (d <= step + (tgt.radius || 1.2)) {
          // Hit!
          if (tgtHero) {
            if (ownerHero) {
              this.deliverAttackDamage(ownerHero, 'hero', tgtHero, p.damage, p.damageType, false);
              if (p.stunDuration) this.applyStun(tgtHero, p.stunDuration);
            } else {
              this.applyDamage(null, tgtHero, p.damage, p.damageType, false);
            }
          } else if (tgtMinion) {
            this.damageMinion(ownerHero, tgtMinion, p.damage, p.damageType);
          } else if (tgtMonster && ownerHero) {
            this.damageMonster(ownerHero, tgtMonster, p.damage, p.damageType);
          } else if (tgtTurret) {
            this.damageTurret(ownerHero, tgtTurret, p.damage);
          }

          this.emit({ type: 'vfx', vfxKind: 'hit_spark', x: tgt.x, z: tgt.z, color: p.color });

          // Cai Wenji S2 bouncing note!
          if (p.kind === 'caiwenji_s2' && (p.bouncesLeft || 0) > 1) {
            p.bouncesLeft!--;
            p.hitIds.push(tgt.id);
            const nextTgt =
              this.heroes.find(
                (e) =>
                  e.alive &&
                  e.team !== p.team &&
                  e.id !== tgt.id &&
                  dist(tgt.x, tgt.z, e.x, e.z) <= 8.5
              ) ||
              this.minions.find(
                (m) => m.team !== p.team && m.id !== tgt.id && dist(tgt.x, tgt.z, m.x, m.z) <= 8.5
              );
            if (nextTgt) {
              p.x = tgt.x;
              p.z = tgt.z;
              p.targetId = nextTgt.id;
              continue;
            }
          }

          this.projectiles.splice(i, 1);
          continue;
        }

        p.vx = (dx / d) * p.speed;
        p.vz = (dz / d) * p.speed;
        p.x += p.vx * dt;
        p.z += p.vz * dt;
        p.traveled += step;
        if (p.traveled > p.maxDist) this.projectiles.splice(i, 1);
        continue;
      }

      // Linear skillshot projectiles
      const step = p.speed * dt;
      p.x += p.vx * dt;
      p.z += p.vz * dt;
      p.traveled += step;

      let remove = p.traveled >= p.maxDist || p.x < 0 || p.x > MAP_SIZE || p.z < 0 || p.z > MAP_SIZE;

      // Check collision with enemy heroes
      for (const e of this.heroes) {
        if (!e.alive || e.team === p.team || e.untargetableTimer > 0 || p.hitIds.includes(e.id)) continue;
        if (dist(p.x, p.z, e.x, e.z) <= p.radius + e.radius) {
          p.hitIds.push(e.id);
          if (p.kind === 'houyi_ult') {
            // Giant Sunbird explosion! Distance-scaled stun!
            const stun = clamp(0.85 + p.traveled * 0.035, 0.85, 2.5);
            this.applyDamage(ownerHero, e, p.damage, 'physical', false);
            this.applyStun(e, stun);
            if (ownerHero) {
              this.damageEnemiesInRadius(ownerHero, e.x, e.z, 5.2, p.damage * 0.45, 'physical', { slow: 0.35, slowDur: 2 });
            }
            this.emit({ type: 'vfx', vfxKind: 'phoenix_boom', x: e.x, z: e.z, radius: 5.5, color: '#f97316', sfxKind: 'ult_slam' });
            remove = true;
            break;
          } else {
            this.applyDamage(ownerHero, e, p.damage, p.damageType, false);
            if (p.stunDuration) this.applyStun(e, p.stunDuration);
            this.emit({ type: 'vfx', vfxKind: 'hit_spark', x: e.x, z: e.z, color: p.color });

            // Cai Wenji S2 initial skillshot converts to bouncing homing note on first hit!
            if (p.kind === 'caiwenji_s2' && (p.bouncesLeft || 0) > 1) {
              p.bouncesLeft!--;
              const nextTgt =
                this.heroes.find((o) => o.alive && o.team !== p.team && o.id !== e.id && dist(e.x, e.z, o.x, o.z) <= 8.5) ||
                this.minions.find((m) => m.team !== p.team && dist(e.x, e.z, m.x, m.z) <= 8.5);
              if (nextTgt) {
                p.targetId = nextTgt.id;
                break;
              }
            }
            if (!p.pierce) {
              remove = true;
              break;
            }
          }
        }
      }

      // Linear skillshots hitting minions/monsters (except Houyi global ult which only hits heroes!)
      if (!remove && p.kind !== 'houyi_ult') {
        for (const m of this.minions) {
          if (m.team !== p.team && !p.hitIds.includes(m.id) && dist(p.x, p.z, m.x, m.z) <= p.radius + m.radius) {
            p.hitIds.push(m.id);
            this.damageMinion(ownerHero, m, p.damage, p.damageType);
            if (!p.pierce) {
              remove = true;
              break;
            }
          }
        }
      }
      if (!remove && p.kind !== 'houyi_ult' && ownerHero) {
        for (const mon of this.monsters) {
          if (mon.alive && !p.hitIds.includes(mon.id) && dist(p.x, p.z, mon.x, mon.z) <= p.radius + mon.radius) {
            p.hitIds.push(mon.id);
            this.damageMonster(ownerHero, mon, p.damage, p.damageType);
            if (!p.pierce) {
              remove = true;
              break;
            }
          }
        }
      }

      if (remove) this.projectiles.splice(i, 1);
    }
  }

  private updateGroundZones(dt: number): void {
    for (let i = this.zones.length - 1; i >= 0; i--) {
      const z = this.zones[i];
      z.remaining -= dt;
      z.tickTimer -= dt;

      const owner = this.heroes.find((h) => h.id === z.ownerId);

      // Cai Wenji S3 follows her!
      if (z.kind === 'caiwenji_s3' && owner && owner.alive) {
        z.x = owner.x;
        z.z = owner.z;
      }

      if (z.tickTimer <= 0 && owner) {
        if (z.kind === 'arthur_ult') {
          z.tickTimer = 0.5;
          this.damageEnemiesInRadius(owner, z.x, z.z, z.radius, 85 + owner.level * 12, 'magic');
        } else if (z.kind === 'libai_s2') {
          z.tickTimer = 0.5;
          for (const e of this.heroes) {
            if (!e.alive || e.team === z.team) continue;
            const d = dist(z.x, z.z, e.x, e.z);
            if (Math.abs(d - z.radius) < 1.3) {
              this.applyDamage(owner, e, 130 + owner.ad * 0.4, 'physical', false);
              this.applySlow(e, 0.55, 1.2);
            }
          }
        } else if (z.kind === 'lubu_ult') {
          z.tickTimer = 0.5;
          for (const e of this.heroes) {
            if (!e.alive || e.team === z.team) continue;
            const d = dist(z.x, z.z, e.x, e.z);
            if (Math.abs(d - z.radius) < 1.2) {
              this.applySlow(e, 0.45, 1.2);
            }
          }
        }
      }

      if (z.remaining <= 0) {
        this.zones.splice(i, 1);
      }
    }
  }

  public buildSnapshot(): WorldSnapshot {
    const events = this.pendingEvents;
    this.pendingEvents = [];
    return {
      tick: this.tick,
      time: this.time,
      phase: this.phase,
      winner: this.winner,
      blueKills: this.blueKills,
      redKills: this.redKills,
      heroes: this.heroes.map((h) => ({ ...h, skillLevels: [...h.skillLevels] as [number, number, number], skillCooldowns: [...h.skillCooldowns] as [number, number, number], items: [...h.items], buffs: [...h.buffs] })),
      minions: this.minions.map((m) => ({ ...m })),
      turrets: this.turrets.map((t) => ({ ...t })),
      monsters: this.monsters.map((m) => ({ ...m })),
      projectiles: this.projectiles.map((p) => ({ ...p })),
      zones: this.zones.map((z) => ({ ...z })),
      events,
    };
  }
}

// Helper to create a clean 5v5 solo match slot layout
export function createSoloMatchSlots(
  playerName: string,
  playerHeroId: HeroId,
  playerSummoner: SummonerSkillId,
  playerTeam: Team = 'blue'
): RoomSlot[] {
  const botNames = [
    '剑意凌霜', '寒江孤影', '长安月色', '赤壁烽火', '破晓星辰',
    '云梦泽客', '青龙偃月', '玄武镇岳', '朱雀焚天', '白虎啸风',
  ];

  const buildTeam = (team: Team, hasHuman: boolean): RoomSlot[] => {
    // Authentic 5-role composition: [Top, Jungle, Mid, Bot ADC, Bot Support]
    const defaultLineup: HeroId[] = ['arthur', 'libai', 'daji', 'houyi', 'caiwenji'];
    const humanPreferredSlot: Record<HeroId, number> = {
      arthur: 0,
      lubu: 0,
      libai: 1,
      daji: 2,
      houyi: 3,
      caiwenji: 4,
    };
    const lineup = [...defaultLineup];
    const hSlot = hasHuman ? humanPreferredSlot[playerHeroId] : -1;
    if (hasHuman) {
      lineup[hSlot] = playerHeroId;
    } else if (team === 'red') {
      lineup[0] = 'lubu'; // Give Red team Lu Bu vs Blue Arthur for variety!
    }

    const nameOffset = team === 'blue' ? 0 : 5;
    return lineup.map((hId, i) => {
      const isPlayer = hasHuman && i === hSlot;
      return {
        team,
        slotIndex: i,
        playerId: isPlayer ? 'local_player' : null,
        playerName: isPlayer ? playerName : botNames[nameOffset + i],
        isBot: !isPlayer,
        heroId: hId,
        summonerSkill: isPlayer ? playerSummoner : i === 1 ? 'smite' : i === 4 ? 'heal' : 'flash',
        ready: true,
      };
    });
  };

  return [
    ...buildTeam('blue', playerTeam === 'blue'),
    ...buildTeam('red', playerTeam === 'red'),
  ];
}

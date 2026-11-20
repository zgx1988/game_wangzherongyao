import {
  BLUE_CRYSTAL,
  BLUE_FOUNTAIN,
  LANE_WAYPOINTS_BLUE,
  LANE_WAYPOINTS_RED,
  RED_CRYSTAL,
  RED_FOUNTAIN,
} from './constants';
import { HEROES } from './heroes';
import { getQuickBuySuggestions } from './items';
import {
  AiDifficulty,
  HeroState,
  MinionState,
  MonsterState,
  PlayerInput,
  TurretState,
  Vec2,
} from './types';

function dist(ax: number, az: number, bx: number, bz: number): number {
  return Math.hypot(ax - bx, az - bz);
}

export interface BotContext {
  time: number;
  difficulty: AiDifficulty;
  heroes: HeroState[];
  minions: MinionState[];
  turrets: TurretState[];
  monsters: MonsterState[];
}

export function computeBotInput(bot: HeroState, ctx: BotContext): PlayerInput {
  const input: PlayerInput = {
    moveX: 0,
    moveZ: 0,
    basicAttack: false,
    targetPriority: 'auto',
    castSkill: null,
    castSummoner: null,
    castHeal: false,
    recall: false,
    upgradeSkill: null,
    buyItemId: null,
  };

  if (!bot.alive) return input;

  const def = HEROES[bot.heroId];
  const ownFountain = bot.team === 'blue' ? BLUE_FOUNTAIN : RED_FOUNTAIN;
  const enemyCrystal = bot.team === 'blue' ? RED_CRYSTAL : BLUE_CRYSTAL;
  const ownCrystal = bot.team === 'blue' ? BLUE_CRYSTAL : RED_CRYSTAL;

  // 1. Auto-upgrade skill points (priority: Ult > S1 > S2)
  if (bot.skillPoints > 0) {
    const canUlt =
      (bot.level >= 4 && bot.skillLevels[2] === 0) ||
      (bot.level >= 8 && bot.skillLevels[2] === 1) ||
      (bot.level >= 12 && bot.skillLevels[2] === 2);
    if (canUlt) {
      input.upgradeSkill = 2;
    } else if (bot.skillLevels[0] <= bot.skillLevels[1] && bot.skillLevels[0] < 6) {
      input.upgradeSkill = 0;
    } else if (bot.skillLevels[1] < 6) {
      input.upgradeSkill = 1;
    } else if (bot.skillLevels[0] < 6) {
      input.upgradeSkill = 0;
    }
  }

  // 2. Auto-buy recommended items
  const quickBuys = getQuickBuySuggestions(def.recommendedItems, bot.items, bot.gold);
  if (quickBuys.length > 0) {
    input.buyItemId = quickBuys[0].item.id;
  }

  const hpPct = bot.hp / Math.max(1, bot.maxHp);

  // Use built-in restore spell if hurt
  if (hpPct < 0.65 && bot.healSpellCooldown <= 0) {
    input.castHeal = true;
  }

  // Wait in fountain until healed if already near fountain
  if (dist(bot.x, bot.z, ownFountain.x, ownFountain.z) < 11 && hpPct < 0.88) {
    return input;
  }

  // If currently recalling and no nearby enemy threat, keep recalling
  const nearbyEnemies = ctx.heroes.filter(
    (h) => h.alive && h.team !== bot.team && dist(bot.x, bot.z, h.x, h.z) < 22 && (!h.inBush || dist(bot.x, bot.z, h.x, h.z) < 5)
  );
  if (bot.recallTimer > 0 && nearbyEnemies.length === 0) {
    return input;
  }

  // 3. Check enemy turret danger (don't dive without allied minions tanking!)
  const enemyTurrets = ctx.turrets.filter((t) => t.alive && t.team !== bot.team);
  let threatenedByTurret: TurretState | null = null;
  for (const t of enemyTurrets) {
    const d = dist(bot.x, bot.z, t.x, t.z);
    if (d < t.range + 2.5) {
      const alliedMinionsInTower = ctx.minions.filter(
        (m) => m.team === bot.team && dist(m.x, m.z, t.x, t.z) < t.range - 0.5
      );
      if (t.targetId === bot.id || alliedMinionsInTower.length === 0) {
        threatenedByTurret = t;
        break;
      }
    }
  }

  if (threatenedByTurret) {
    // Immediately back out of turret range toward own fountain
    const awayX = ownFountain.x - bot.x;
    const awayZ = ownFountain.z - bot.z;
    const len = Math.hypot(awayX, awayZ) || 1;
    input.moveX = awayX / len;
    input.moveZ = awayZ / len;
    return input;
  }

  // 4. Low HP Retreat & Recall logic
  const retreatThreshold = ctx.difficulty === 'easy' ? 0.18 : ctx.difficulty === 'normal' ? 0.25 : 0.30;
  if (hpPct < retreatThreshold) {
    if (bot.summonerSkill === 'heal' && bot.summonerCooldown <= 0) {
      input.castSummoner = { dirX: 0, dirZ: 0 };
    }
    if (nearbyEnemies.length === 0 && dist(bot.x, bot.z, ownFountain.x, ownFountain.z) > 28) {
      input.recall = true;
      return input;
    }
    const rx = ownFountain.x - bot.x;
    const rz = ownFountain.z - bot.z;
    const rLen = Math.hypot(rx, rz) || 1;
    input.moveX = rx / rLen;
    input.moveZ = rz / rLen;
    // Flash away if very low and chased
    if (
      hpPct < 0.16 &&
      nearbyEnemies.length > 0 &&
      bot.summonerSkill === 'flash' &&
      bot.summonerCooldown <= 0 &&
      ctx.difficulty !== 'easy'
    ) {
      input.castSummoner = { dirX: input.moveX, dirZ: input.moveZ };
    }
    return input;
  }

  // 5. Support Logic (Cai Wenji / 璃月): heal nearby hurt teammates!
  if (bot.heroId === 'caiwenji') {
    const hurtAllies = ctx.heroes.filter(
      (h) => h.alive && h.team === bot.team && h.id !== bot.id && dist(bot.x, bot.z, h.x, h.z) < 12 && h.hp / h.maxHp < 0.72
    );
    if (hurtAllies.length > 0) {
      if (bot.skillLevels[0] > 0 && bot.skillCooldowns[0] <= 0 && bot.mp >= 65) {
        input.castSkill = { slot: 0, dirX: 0, dirZ: 0, targetX: bot.x, targetZ: bot.z };
      } else if (
        hurtAllies.some((a) => a.hp / a.maxHp < 0.45) &&
        bot.skillLevels[2] > 0 &&
        bot.skillCooldowns[2] <= 0 &&
        bot.mp >= 100
      ) {
        input.castSkill = { slot: 2, dirX: 0, dirZ: 0, targetX: bot.x, targetZ: bot.z };
      }
    }
  }

  // 6. Combat with visible nearby enemy heroes
  const nearestEnemyHero = nearbyEnemies.sort(
    (a, b) => dist(bot.x, bot.z, a.x, a.z) - dist(bot.x, bot.z, b.x, b.z)
  )[0];

  const skillChance = ctx.difficulty === 'easy' ? 0.12 : ctx.difficulty === 'normal' ? 0.38 : 0.75;

  if (nearestEnemyHero) {
    const d = dist(bot.x, bot.z, nearestEnemyHero.x, nearestEnemyHero.z);
    const dx = nearestEnemyHero.x - bot.x;
    const dz = nearestEnemyHero.z - bot.z;
    const inv = 1 / (d || 1);
    const dirX = dx * inv;
    const dirZ = dz * inv;

    // Don't chase into enemy turret unless enemy is nearly dead
    const insideEnemyTower = enemyTurrets.some(
      (t) => dist(nearestEnemyHero.x, nearestEnemyHero.z, t.x, t.z) < t.range + 1
    );
    const alliedMinionsAtTower = enemyTurrets.some(
      (t) =>
        dist(nearestEnemyHero.x, nearestEnemyHero.z, t.x, t.z) < t.range + 1 &&
        ctx.minions.some((m) => m.team === bot.team && dist(m.x, m.z, t.x, t.z) < t.range)
    );

    if (!insideEnemyTower || alliedMinionsAtTower || nearestEnemyHero.hp / nearestEnemyHero.maxHp < 0.2) {
      // Cast skills!
      if (!input.castSkill && Math.random() < skillChance) {
        const trySlots: (0 | 1 | 2)[] = [2, 1, 0];
        // Daji opens with S2 charm -> S1 -> S3
        if (bot.heroId === 'daji') trySlots.splice(0, 3, 1, 2, 0);
        // Arthur opens with S1 -> S2 -> S3 (when target < 60% HP)
        if (bot.heroId === 'arthur') trySlots.splice(0, 3, 0, 1, 2);

        for (const slot of trySlots) {
          const sk = def.skills[slot];
          const lv = bot.skillLevels[slot];
          if (lv <= 0 || bot.skillCooldowns[slot] > 0) continue;
          const mana = sk.manaCost[Math.min(lv - 1, sk.manaCost.length - 1)] || 0;
          if (bot.mp < mana) continue;
          if (slot === 2 && bot.heroId === 'arthur' && nearestEnemyHero.hp / nearestEnemyHero.maxHp > 0.65) {
            continue;
          }
          if (d <= Math.min(sk.range, 22)) {
            input.castSkill = {
              slot,
              dirX,
              dirZ,
              targetX: nearestEnemyHero.x,
              targetZ: nearestEnemyHero.z,
            };
            break;
          }
        }
      }

      // Movement & kiting for ranged vs melee
      const desiredRange = def.isRanged ? def.attackRange * 0.84 : def.attackRange * 0.78;
      if (d > desiredRange + 0.8) {
        input.moveX = dirX;
        input.moveZ = dirZ;
      } else if (def.isRanged && d < desiredRange * 0.62) {
        // Kite backward slightly!
        input.moveX = -dirX;
        input.moveZ = -dirZ;
      }
      if (d <= def.attackRange + 2.5) {
        input.basicAttack = true;
      }
      return input;
    }
  }

  // 7. Jungler behavior (clear jungle camps early, gank/push mid-late)
  if (bot.lane === 'jungle' && ctx.time < 240) {
    const aliveCamps = ctx.monsters
      .filter((m) => {
        if (!m.alive) return false;
        if (m.type === 'tyrant' || m.type === 'overlord') return bot.level >= 6 && hpPct > 0.7;
        // Prefer own side jungle
        const ownHalf = bot.team === 'blue' ? m.homeX + m.homeZ >= 150 : m.homeX + m.homeZ <= 170;
        return ownHalf || m.type === 'river_spirit';
      })
      .sort((a, b) => dist(bot.x, bot.z, a.x, a.z) - dist(bot.x, bot.z, b.x, b.z));

    if (aliveCamps.length > 0) {
      const camp = aliveCamps[0];
      const d = dist(bot.x, bot.z, camp.x, camp.z);
      const dx = camp.x - bot.x;
      const dz = camp.z - bot.z;
      const inv = 1 / (d || 1);
      if (d > def.attackRange * 0.85) {
        input.moveX = dx * inv;
        input.moveZ = dz * inv;
      } else {
        input.basicAttack = true;
        if (bot.summonerSkill === 'smite' && bot.summonerCooldown <= 0 && camp.hp < 1200) {
          input.castSummoner = { dirX: dx * inv, dirZ: dz * inv };
        }
        if (bot.skillLevels[0] > 0 && bot.skillCooldowns[0] <= 0 && bot.mp >= 55 && Math.random() < 0.25) {
          input.castSkill = { slot: 0, dirX: dx * inv, dirZ: dz * inv, targetX: camp.x, targetZ: camp.z };
        } else if (bot.skillLevels[1] > 0 && bot.skillCooldowns[1] <= 0 && bot.mp >= 65 && Math.random() < 0.25) {
          input.castSkill = { slot: 1, dirX: dx * inv, dirZ: dz * inv, targetX: camp.x, targetZ: camp.z };
        }
      }
      return input;
    }
  }

  // 8. Defend own Crystal if enemies are attacking it
  const crystalThreats = ctx.heroes.filter(
    (h) => h.alive && h.team !== bot.team && dist(h.x, h.z, ownCrystal.x, ownCrystal.z) < 28
  );
  if (crystalThreats.length > 0) {
    const target = crystalThreats[0];
    const d = dist(bot.x, bot.z, target.x, target.z);
    input.moveX = (target.x - bot.x) / (d || 1);
    input.moveZ = (target.z - bot.z) / (d || 1);
    if (d <= def.attackRange + 2) input.basicAttack = true;
    return input;
  }

  // 9. Attack nearby enemy minions or safe enemy turrets
  const nearbyMinion = ctx.minions
    .filter((m) => m.team !== bot.team && dist(bot.x, bot.z, m.x, m.z) < 16)
    .sort((a, b) => dist(bot.x, bot.z, a.x, a.z) - dist(bot.x, bot.z, b.x, b.z))[0];

  if (nearbyMinion) {
    const d = dist(bot.x, bot.z, nearbyMinion.x, nearbyMinion.z);
    const inTower = enemyTurrets.some((t) => dist(nearbyMinion.x, nearbyMinion.z, t.x, t.z) < t.range);
    const safeMinion = !inTower || ctx.minions.some((m) => m.team === bot.team && dist(m.x, m.z, nearbyMinion.x, nearbyMinion.z) < 10);
    if (safeMinion) {
      if (d > def.attackRange * 0.88) {
        input.moveX = (nearbyMinion.x - bot.x) / (d || 1);
        input.moveZ = (nearbyMinion.z - bot.z) / (d || 1);
      } else {
        input.basicAttack = true;
        input.targetPriority = 'minion';
      }
      return input;
    }
  }

  // Push enemy turret if allied minions are tanking it!
  const pushableTower = enemyTurrets
    .filter((t) => {
      const d = dist(bot.x, bot.z, t.x, t.z);
      const minionsTanking = ctx.minions.some(
        (m) => m.team === bot.team && dist(m.x, m.z, t.x, t.z) < t.range - 0.5
      );
      return d < 20 && minionsTanking;
    })
    .sort((a, b) => dist(bot.x, bot.z, a.x, a.z) - dist(bot.x, bot.z, b.x, b.z))[0];

  if (pushableTower) {
    const d = dist(bot.x, bot.z, pushableTower.x, pushableTower.z);
    if (d > def.attackRange + 1.5) {
      input.moveX = (pushableTower.x - bot.x) / (d || 1);
      input.moveZ = (pushableTower.z - bot.z) / (d || 1);
    } else {
      input.basicAttack = true;
      input.targetPriority = 'tower';
    }
    return input;
  }

  // 10. Advance along assigned lane (group Mid late-game!)
  let assignedLane: 'top' | 'mid' | 'bot' =
    bot.lane === 'jungle' ? 'mid' : bot.lane;
  if (ctx.time > 300) {
    assignedLane = 'mid';
  }

  // Support follows bot-lane ADC if alive & nearby
  if (bot.heroId === 'caiwenji') {
    const adc = ctx.heroes.find(
      (h) => h.alive && h.team === bot.team && h.id !== bot.id && (h.heroId === 'houyi' || h.lane === 'bot')
    );
    if (adc && dist(bot.x, bot.z, adc.x, adc.z) > 6 && dist(adc.x, adc.z, ownFountain.x, ownFountain.z) > 15) {
      const d = dist(bot.x, bot.z, adc.x, adc.z);
      input.moveX = (adc.x - bot.x) / (d || 1);
      input.moveZ = (adc.z - bot.z) / (d || 1);
      return input;
    }
  }

  const waypoints: Vec2[] =
    bot.team === 'blue' ? LANE_WAYPOINTS_BLUE[assignedLane] : LANE_WAYPOINTS_RED[assignedLane];

  // Find furthest allied minion in this lane or next waypoint ahead
  let bestWpIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < waypoints.length; i++) {
    const d = dist(bot.x, bot.z, waypoints[i].x, waypoints[i].z);
    if (d < bestDist) {
      bestDist = d;
      bestWpIdx = i;
    }
  }
  const targetWp = waypoints[Math.min(bestWpIdx + 1, waypoints.length - 1)] || enemyCrystal;

  // Don't walk blindly into an enemy turret without minions
  const nextEnemyTower = enemyTurrets.find(
    (t) => (t.lane === assignedLane || t.lane === 'base') && dist(bot.x, bot.z, t.x, t.z) < t.range + 5
  );
  if (nextEnemyTower) {
    const hasAlliedMinions = ctx.minions.some(
      (m) => m.team === bot.team && dist(m.x, m.z, nextEnemyTower.x, nextEnemyTower.z) < nextEnemyTower.range
    );
    if (!hasAlliedMinions) {
      // Wait just outside tower range for minion wave!
      const holdX = bot.x - nextEnemyTower.x;
      const holdZ = bot.z - nextEnemyTower.z;
      const hLen = Math.hypot(holdX, holdZ) || 1;
      if (dist(bot.x, bot.z, nextEnemyTower.x, nextEnemyTower.z) < nextEnemyTower.range + 3.5) {
        input.moveX = holdX / hLen;
        input.moveZ = holdZ / hLen;
      }
      return input;
    }
  }

  const dx = targetWp.x - bot.x;
  const dz = targetWp.z - bot.z;
  const d = Math.hypot(dx, dz) || 1;
  input.moveX = dx / d;
  input.moveZ = dz / d;
  return input;
}

import { ItemDefinition } from './types';

export const ITEMS: Record<string, ItemDefinition> = {
  // === TIER 1 BASIC COMPONENTS ===
  iron_sword: {
    id: 'iron_sword',
    name: '铁剑',
    category: 'attack',
    tier: 1,
    price: 250,
    icon: '🗡️',
    color: '#94a3b8',
    stats: { ad: 25 },
  },
  dagger_basic: {
    id: 'dagger_basic',
    name: '匕首',
    category: 'attack',
    tier: 1,
    price: 290,
    icon: '🔪',
    color: '#fbbf24',
    stats: { attackSpeed: 0.12 },
  },
  spell_tome: {
    id: 'spell_tome',
    name: '咒术典籍',
    category: 'magic',
    tier: 1,
    price: 300,
    icon: '📘',
    color: '#818cf8',
    stats: { ap: 45 },
  },
  ruby_crystal: {
    id: 'ruby_crystal',
    name: '红玛瑙',
    category: 'defense',
    tier: 1,
    price: 300,
    icon: '❤️',
    color: '#f87171',
    stats: { hp: 350 },
  },
  cloth_armor: {
    id: 'cloth_armor',
    name: '布甲',
    category: 'defense',
    tier: 1,
    price: 220,
    icon: '🛡️',
    color: '#cbd5e1',
    stats: { armor: 90 },
  },
  boots_basic: {
    id: 'boots_basic',
    name: '神速之靴',
    category: 'boots',
    tier: 1,
    price: 250,
    icon: '👢',
    color: '#d4a373',
    stats: { moveSpeed: 0.7 },
  },

  // === BOOTS (TIER 2) ===
  boots_resist: {
    id: 'boots_resist',
    name: '抵抗之靴',
    category: 'boots',
    tier: 2,
    price: 710,
    buildsFrom: ['boots_basic'],
    icon: '🥾',
    color: '#60a5fa',
    stats: { moveSpeed: 1.45, mr: 110 },
    passiveDesc: '韧性：减少受控时间30%',
  },
  boots_speed: {
    id: 'boots_speed',
    name: '急速战靴',
    category: 'boots',
    tier: 2,
    price: 710,
    buildsFrom: ['boots_basic', 'dagger_basic'],
    icon: '⚡',
    color: '#f59e0b',
    stats: { moveSpeed: 1.45, attackSpeed: 0.25 },
  },
  boots_cdr: {
    id: 'boots_cdr',
    name: '冷静之靴',
    category: 'boots',
    tier: 2,
    price: 710,
    buildsFrom: ['boots_basic'],
    icon: '🔮',
    color: '#a78bfa',
    stats: { moveSpeed: 1.45, cdr: 0.15 },
  },

  // === JUNGLE ===
  jungle_blade: {
    id: 'jungle_blade',
    name: '追击刀锋',
    category: 'jungle',
    tier: 3,
    price: 1680,
    buildsFrom: ['iron_sword', 'dagger_basic'],
    icon: '⚔️',
    color: '#ef4444',
    stats: { ad: 85, attackSpeed: 0.2, cdr: 0.1, moveSpeed: 0.65, armorPen: 60 },
    passiveDesc: '狩猎：对野怪伤害提升35%',
  },

  // === ATTACK TIER 3 ===
  axe_cleaver: {
    id: 'axe_cleaver',
    name: '暗影战斧',
    category: 'attack',
    tier: 3,
    price: 2090,
    buildsFrom: ['iron_sword', 'ruby_crystal'],
    icon: '🪓',
    color: '#a855f7',
    stats: { ad: 90, hp: 550, cdr: 0.15, armorPen: 140 },
    passiveDesc: '切割：大幅物理穿透',
  },
  blade_infinity: {
    id: 'blade_infinity',
    name: '无尽战刃',
    category: 'attack',
    tier: 3,
    price: 2140,
    buildsFrom: ['iron_sword', 'iron_sword'],
    icon: '🗡️',
    color: '#f59e0b',
    stats: { ad: 120, critChance: 0.25, critDamage: 0.45 },
    passiveDesc: '无尽：大幅提升暴击伤害',
  },
  dagger_lightning: {
    id: 'dagger_lightning',
    name: '闪电匕首',
    category: 'attack',
    tier: 3,
    price: 1840,
    buildsFrom: ['dagger_basic', 'dagger_basic'],
    icon: '⚡',
    color: '#38bdf8',
    stats: { attackSpeed: 0.35, critChance: 0.15, moveSpeed: 0.75 },
    passiveDesc: '电弧：普攻附带雷霆连击伤害',
  },
  blade_vamp: {
    id: 'blade_vamp',
    name: '泣血之刃',
    category: 'attack',
    tier: 3,
    price: 1800,
    buildsFrom: ['iron_sword'],
    icon: '🩸',
    color: '#dc2626',
    stats: { ad: 100, lifesteal: 0.25, hp: 350 },
    passiveDesc: '嗜血：普攻附带强力生命汲取',
  },
  sword_despair: {
    id: 'sword_despair',
    name: '破军',
    category: 'attack',
    tier: 3,
    price: 2680,
    buildsFrom: ['iron_sword', 'iron_sword'],
    icon: '🔥',
    color: '#e11d48',
    stats: { ad: 185 },
    passiveDesc: '破军：对生命低于50%的敌人伤害提升30%',
  },
  bow_pierce: {
    id: 'bow_pierce',
    name: '破晓',
    category: 'attack',
    tier: 3,
    price: 2780,
    buildsFrom: ['dagger_basic', 'iron_sword'],
    icon: '🏹',
    color: '#facc15',
    stats: { ad: 75, attackSpeed: 0.35, critChance: 0.15, armorPen: 220 },
    passiveDesc: '破甲：穿透重甲敌军',
  },
  sword_shadow: {
    id: 'sword_shadow',
    name: '影刃',
    category: 'attack',
    tier: 3,
    price: 1950,
    buildsFrom: ['dagger_basic', 'dagger_basic'],
    icon: '🌪️',
    color: '#ec4899',
    stats: { ad: 45, attackSpeed: 0.4, critChance: 0.25, moveSpeed: 0.6 },
  },

  // === MAGIC TIER 3 ===
  staff_echo: {
    id: 'staff_echo',
    name: '回响之杖',
    category: 'magic',
    tier: 3,
    price: 2100,
    buildsFrom: ['spell_tome', 'spell_tome'],
    icon: '🪄',
    color: '#c084fc',
    stats: { ap: 240, moveSpeed: 0.65 },
    passiveDesc: '回响：技能命中触发范围法爆',
  },
  hat_savant: {
    id: 'hat_savant',
    name: '博学者之怒',
    category: 'magic',
    tier: 3,
    price: 2300,
    buildsFrom: ['spell_tome', 'spell_tome'],
    icon: '🎩',
    color: '#a855f7',
    stats: { ap: 320 },
    passiveDesc: '毁灭：大幅增强所有法术威力',
  },
  book_vamp: {
    id: 'book_vamp',
    name: '噬神之书',
    category: 'magic',
    tier: 3,
    price: 2090,
    buildsFrom: ['spell_tome', 'ruby_crystal'],
    icon: '📕',
    color: '#f43f5e',
    stats: { ap: 190, hp: 850, cdr: 0.1, spellVamp: 0.25 },
  },
  staff_void: {
    id: 'staff_void',
    name: '虚无法杖',
    category: 'magic',
    tier: 3,
    price: 2110,
    buildsFrom: ['spell_tome', 'ruby_crystal'],
    icon: '🔮',
    color: '#6366f1',
    stats: { ap: 240, hp: 400, magicPen: 185 },
  },
  tome_sage: {
    id: 'tome_sage',
    name: '贤者之书',
    category: 'magic',
    tier: 3,
    price: 2790,
    buildsFrom: ['spell_tome', 'spell_tome'],
    icon: '📜',
    color: '#fbbf24',
    stats: { ap: 410, hp: 600, cdr: 0.1 },
  },
  grail_holy: {
    id: 'grail_holy',
    name: '圣杯',
    category: 'magic',
    tier: 3,
    price: 1850,
    buildsFrom: ['spell_tome'],
    icon: '🏆',
    color: '#34d399',
    stats: { ap: 180, cdr: 0.15, mp: 350, hp: 500 },
    passiveDesc: '法力源泉：持续快速回复法力与生命',
  },

  // === DEFENSE TIER 3 ===
  ice_gauntlet: {
    id: 'ice_gauntlet',
    name: '极寒风暴',
    category: 'defense',
    tier: 3,
    price: 2100,
    buildsFrom: ['cloth_armor', 'ruby_crystal'],
    icon: '❄️',
    color: '#38bdf8',
    stats: { armor: 360, cdr: 0.2, mp: 400, hp: 400 },
    passiveDesc: '冰心：高额物防与20%冷却缩减',
  },
  cape_sunfire: {
    id: 'cape_sunfire',
    name: '红莲斗篷',
    category: 'defense',
    tier: 3,
    price: 1830,
    buildsFrom: ['ruby_crystal', 'cloth_armor'],
    icon: '🔥',
    color: '#fb923c',
    stats: { hp: 1100, armor: 240 },
    passiveDesc: '献祭：每秒灼烧周围敌军',
  },
  armor_witch: {
    id: 'armor_witch',
    name: '魔女斗篷',
    category: 'defense',
    tier: 3,
    price: 2080,
    buildsFrom: ['ruby_crystal'],
    icon: '🧥',
    color: '#818cf8',
    stats: { hp: 1050, mr: 280 },
    passiveDesc: '迷雾：大幅抵抗法术爆发伤害',
  },
};

export const ITEM_LIST: ItemDefinition[] = Object.values(ITEMS);

// Compute net purchase cost considering owned build components
export function getNetItemCost(
  itemId: string,
  ownedItems: string[]
): { cost: number; consumedIndices: number[] } {
  const item = ITEMS[itemId];
  if (!item) return { cost: Infinity, consumedIndices: [] };
  if (!item.buildsFrom || item.buildsFrom.length === 0) {
    return { cost: item.price, consumedIndices: [] };
  }

  let discount = 0;
  const consumedIndices: number[] = [];
  const used = new Set<number>();

  for (const compId of item.buildsFrom) {
    const idx = ownedItems.findIndex((id, i) => id === compId && !used.has(i));
    if (idx !== -1 && ITEMS[compId]) {
      used.add(idx);
      consumedIndices.push(idx);
      discount += ITEMS[compId].price;
    }
  }

  return { cost: Math.max(0, item.price - discount), consumedIndices };
}

// Get next 1-2 quick-buy items from hero's recommended build
export function getQuickBuySuggestions(
  recommendedIds: string[],
  ownedItems: string[],
  gold: number
): { item: ItemDefinition; cost: number }[] {
  const remainingTarget: string[] = [];
  const ownedCounts = new Map<string, number>();
  for (const id of ownedItems) ownedCounts.set(id, (ownedCounts.get(id) || 0) + 1);

  for (const recId of recommendedIds) {
    const c = ownedCounts.get(recId) || 0;
    if (c > 0) {
      ownedCounts.set(recId, c - 1);
    } else {
      remainingTarget.push(recId);
    }
  }

  const results: { item: ItemDefinition; cost: number }[] = [];
  const seen = new Set<string>();

  for (const targetId of remainingTarget.slice(0, 2)) {
    const target = ITEMS[targetId];
    if (!target) continue;
    const { cost, consumedIndices } = getNetItemCost(targetId, ownedItems);
    const hasSpace = ownedItems.length - consumedIndices.length < 6;
    if (hasSpace && gold >= cost && !seen.has(targetId)) {
      results.push({ item: target, cost });
      seen.add(targetId);
      continue;
    }

    // Otherwise check affordable build components
    if (target.buildsFrom && ownedItems.length < 6) {
      for (const compId of target.buildsFrom) {
        const comp = ITEMS[compId];
        if (comp && !ownedItems.includes(compId) && gold >= comp.price && !seen.has(compId)) {
          results.push({ item: comp, cost: comp.price });
          seen.add(compId);
          break;
        }
      }
    }
  }

  return results.slice(0, 2);
}

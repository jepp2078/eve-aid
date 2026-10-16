import { ship } from './ships';
import type { AbilitySlot, Orbit, ShipId } from './types';

/** When a `reminder` effect should be surfaced to the player during a battle. */
export type EffectTiming =
  | 'start'
  | 'roll'
  | 'targeted'
  | 'kill'
  | 'roundEnd'
  | 'combatEnd'
  | 'destroyed'
  | 'outOfCombat';

export type ShipEffect =
  | { kind: 'critAim'; perCrit: number }
  | { kind: 'critDamage'; perCrit: number; perCritVsLarge: number }
  | { kind: 'critDamageOnce'; amount: number }
  | { kind: 'aimBonus'; amount: number }
  | { kind: 'damageVsOtherOrbit'; amount: number }
  | { kind: 'killBonus'; aim: number; damage: number }
  | { kind: 'killZeroDif' }
  | { kind: 'enemyDifInOrbit'; amount: number }
  | { kind: 'enemyAimFromOrbit'; amount: number }
  | { kind: 'enemyRetreatDif'; amount: number }
  | { kind: 'noEnemyRetreatRound1' }
  | { kind: 'stats'; atk: number; sup: number; red: number }
  | { kind: 'difWhenTargetedFrom'; orbits: Orbit[]; amount: number }
  | { kind: 'healSelfRoundEnd'; amount: number }
  | { kind: 'supToAllOrbits' }
  | { kind: 'suppressEnemySupportsInOrbit' }
  | { kind: 'stayUntilRoundEnd' }
  | { kind: 'evasive'; atk: number; sup: number; dif: number }
  | { kind: 'curse' }
  | { kind: 'reminder'; timing: EffectTiming };

export interface ShipEffectEntry {
  /** Which ship in an orbit the ability applies to: the orbit leader, a supporting ship, or any ship. */
  role: 'leader' | 'support' | 'any';
  effect: ShipEffect;
}

type SlotEffects = Partial<Record<AbilitySlot, ShipEffect>>;

const reminder = (timing: EffectTiming): ShipEffect => ({ kind: 'reminder', timing });

// Effects shared by every ship of a role group; per-ship slots are merged in below.
const EXPLORER: SlotEffects = {
  basic: reminder('outOfCombat'),
  first: { kind: 'evasive', atk: -2, sup: -1, dif: 2 },
};
const INTERCEPTOR: SlotEffects = {
  first: reminder('outOfCombat'),
  second: { kind: 'enemyDifInOrbit', amount: -1 },
};
const DESTROYER: SlotEffects = { second: { kind: 'noEnemyRetreatRound1' } };
const HEAVY_ASSAULT: SlotEffects = { basic: { kind: 'critAim', perCrit: 1 } };
const RECON: SlotEffects = { second: reminder('roll') };
const FLEET_COMMANDER: SlotEffects = { basic: reminder('roll'), first: reminder('roll') };
const BLACK_OPS: SlotEffects = {
  basic: { kind: 'critDamage', perCrit: 1, perCritVsLarge: 2 },
  first: reminder('outOfCombat'),
};
const MARAUDER: SlotEffects = {
  basic: { kind: 'critDamage', perCrit: 1, perCritVsLarge: 1 },
  second: { kind: 'stats', atk: 1, sup: 1, red: 1 },
};

const EFFECTS: Record<ShipId, SlotEffects> = {
  // Explorers
  anathema: EXPLORER,
  buzzard: EXPLORER,
  helios: EXPLORER,
  cheetah: EXPLORER,
  // Interceptors
  malediction: INTERCEPTOR,
  crow: INTERCEPTOR,
  ares: INTERCEPTOR,
  stiletto: INTERCEPTOR,
  // Destroyers
  heretic: { ...DESTROYER, first: reminder('roll') },
  flycatcher: { ...DESTROYER, first: reminder('kill') },
  eris: { ...DESTROYER, first: reminder('roll') },
  sabre: { ...DESTROYER, first: { kind: 'critDamageOnce', amount: 1 } },
  // Heavy Assault Cruisers
  zealot: { ...HEAVY_ASSAULT, first: { kind: 'killBonus', aim: 1, damage: 1 } },
  cerberus: { ...HEAVY_ASSAULT, first: { kind: 'damageVsOtherOrbit', amount: 1 } },
  ishtar: { ...HEAVY_ASSAULT, first: { kind: 'aimBonus', amount: 1 } },
  vagabond: { ...HEAVY_ASSAULT, first: reminder('roll') },
  // Recons
  curse: { ...RECON, first: { kind: 'curse' } },
  rook: { ...RECON, first: { kind: 'enemyAimFromOrbit', amount: -1 } },
  lachesis: { ...RECON, first: { kind: 'enemyRetreatDif', amount: -2 } },
  huginn: { ...RECON, first: { kind: 'enemyDifInOrbit', amount: -1 } },
  // Fleet Commanders
  absolution: { ...FLEET_COMMANDER, second: { kind: 'stats', atk: 0, sup: 0, red: 1 } },
  nighthawk: {
    ...FLEET_COMMANDER,
    second: { kind: 'difWhenTargetedFrom', orbits: ['small', 'medium'], amount: 1 },
  },
  astarte: { ...FLEET_COMMANDER, second: { kind: 'healSelfRoundEnd', amount: 1 } },
  sleipnir: { ...FLEET_COMMANDER, second: reminder('targeted') },
  // Black Ops
  redeemer: { ...BLACK_OPS, second: { kind: 'suppressEnemySupportsInOrbit' } },
  widow: { ...BLACK_OPS, second: reminder('combatEnd') },
  sin: { ...BLACK_OPS, second: reminder('roundEnd') },
  panther: { ...BLACK_OPS, second: reminder('destroyed') },
  // Marauders
  paladin: { ...MARAUDER, first: { kind: 'supToAllOrbits' } },
  golem: { ...MARAUDER, first: { kind: 'enemyDifInOrbit', amount: -1 } },
  kronos: { ...MARAUDER, first: { kind: 'stayUntilRoundEnd' } },
  vargur: { ...MARAUDER, first: { kind: 'killZeroDif' } },
};

function roleOf(text: string): ShipEffectEntry['role'] {
  if (text.includes('Leader:') || text.startsWith('[Critical Damage]')) return 'leader';
  if (text.includes('Support:')) return 'support';
  return 'any';
}

/**
 * The structured effect of a ship's ability in `slot`, or null when the ship has no ability there.
 * The role comes from the ability text; the effect from the table above.
 */
export function effectFor(shipId: ShipId, slot: AbilitySlot): ShipEffectEntry | null {
  const ability = ship(shipId).abilities.find((a) => a.slot === slot);
  if (!ability) return null;
  const effect = EFFECTS[shipId]?.[slot];
  if (!effect) throw new Error(`No effect defined for ${shipId} (${slot})`);
  return { role: roleOf(ability.text), effect };
}

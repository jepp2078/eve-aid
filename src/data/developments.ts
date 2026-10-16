import rawDevelopments from './developments.json';
import type { DevId, DevTier } from './types';

export type DevCategory = 'combat' | 'conquest' | 'diplomacy' | 'economy' | 'spaceships' | 'structures';
export type DevKeyword = 'use' | 'use_in_combat' | 'use_at_any_time' | null;

export interface Development {
  id: DevId;
  name: string;
  category: DevCategory;
  cost: number;
  /** Card text with inline tokens such as [ISK] or [D1] and "\n" paragraph breaks; the UI renders the tokens. */
  text: string;
  prerequisite: DevId | null;
  /** Researching this card adds a development card to the researcher's hand. */
  addsCard: boolean;
  keyword: DevKeyword;
  /** Ship ability tier unlocked by this card (the six Systems cards only). */
  tier: DevTier | null;
}

interface RawDevelopment {
  name: string;
  category: string;
  cost: number;
  text: string;
  addsDevelopmentCard: boolean;
  prerequisite: string | null;
  keyword: string | null;
}

/** Lowercase, non-alphanumerics to `-`, collapse repeats, trim leading/trailing `-`. */
function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const SYSTEM_TIERS: Record<string, DevTier> = {
  'offensive-systems-t1': 'O1',
  'offensive-systems-t2': 'O2',
  'defensive-systems-t1': 'D1',
  'defensive-systems-t2': 'D2',
  'utility-systems-t1': 'U1',
  'utility-systems-t2': 'U2',
};

export const DEVELOPMENTS: Development[] = (rawDevelopments as RawDevelopment[]).map((r) => {
  const id = slug(r.name);
  return {
    id,
    name: r.name,
    category: r.category as DevCategory,
    cost: r.cost,
    text: r.text,
    prerequisite: r.prerequisite === null ? null : slug(r.prerequisite),
    addsCard: r.addsDevelopmentCard,
    keyword: r.keyword as DevKeyword,
    tier: SYSTEM_TIERS[id] ?? null,
  };
});

const BY_ID: Map<DevId, Development> = new Map(DEVELOPMENTS.map((d) => [d.id, d]));

export function dev(id: DevId): Development {
  const found = BY_ID.get(id);
  if (!found) throw new Error(`Unknown development: ${id}`);
  return found;
}

/** Constant ids for the rules engine; every value is the slug of a card name in developments.json. */
export const DEV = {
  // combat
  defensiveTactic: 'defensive-tactic',
  offensiveTactic: 'offensive-tactic',
  guerillaWarfare: 'guerilla-warfare',
  strategicReposition: 'strategic-reposition',
  vanguardShip: 'vanguard-ship',
  coordinatedAttack: 'coordinated-attack',
  sequentialJump: 'sequential-jump',
  // conquest
  starMap: 'star-map',
  underdog: 'underdog',
  technologicalBreakthrough: 'technological-breakthrough',
  invader: 'invader',
  pacifist: 'pacifist',
  dirtyPolitics: 'dirty-politics',
  fleetSupremacy: 'fleet-supremacy',
  spaceWarlord: 'space-warlord',
  // diplomacy
  lobbyist: 'lobbyist',
  intelligenceNetwork: 'intelligence-network',
  researchSpy: 'research-spy',
  civilianResistance: 'civilian-resistance',
  spaceshipInsurance: 'spaceship-insurance',
  // economy
  mineralMarket: 'mineral-market',
  manufacturingHub: 'manufacturing-hub',
  tradeContracts: 'trade-contracts',
  asteroidMining: 'asteroid-mining',
  extractingCrew: 'extracting-crew',
  galacticTrustFund: 'galactic-trust-fund',
  massProduction: 'mass-production',
  // spaceships
  mediumHull: 'medium-hull',
  largeHull: 'large-hull',
  defensiveSystemsT1: 'defensive-systems-t1',
  offensiveSystemsT1: 'offensive-systems-t1',
  utilitySystemsT1: 'utility-systems-t1',
  defensiveSystemsT2: 'defensive-systems-t2',
  offensiveSystemsT2: 'offensive-systems-t2',
  utilitySystemsT2: 'utility-systems-t2',
  warpDriveEfficiency: 'warp-drive-efficiency',
  // structures
  assemblyLine: 'assembly-line',
  materialsEfficiency: 'materials-efficiency',
  researchLab: 'upgraded-eng-complex-research-lab',
  shipyard: 'upgraded-eng-complex-shipyard',
  upgradedCitadel: 'upgraded-citadel',
  upgradedRefinery: 'upgraded-refinery',
  deployableInfrastructure: 'deployable-infrastructure',
  upgradedCustomsOffice: 'upgraded-customs-office',
} as const satisfies Record<string, DevId>;

export type DevKey = keyof typeof DEV;

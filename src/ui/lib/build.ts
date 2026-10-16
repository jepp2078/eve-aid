/**
 * The Build sheet's model: a draft of ships (counts by name), structures (type, home, slot discount) and home belt
 * unlocks; the build points it uses; ship options sorted affordable-first with hull/model locks and shortfalls; and
 * cost lines that show how each number is made (slot discounts, Materials Efficiency, Mass Production).
 */
import {
  MASS_PRODUCTION_ISK, MATERIALS_EFFICIENCY_ISK, SHIP_COST, STRUCTURE_COST, STRUCTURE_SUPPLY, UNLOCK_BELT_COST, type ShipCost,
} from '../../data/costs';
import { DEV } from '../../data/developments';
import { SHIPS, shipsOf, type Ship } from '../../data/ships';
import { MINERALS, type Mineral, type ResourceKey, type Resources, type ShipId, type Size, type StructureType } from '../../data/types';
import { buildPoints } from '../../engine/economy';
import type { BuildItem, GameState, PlayerPublic } from '../../engine/types';
import { cubeCost } from './actions';
import { isRecord } from './drafts';
import { RESOURCE_LABEL, STRUCTURE_LABEL } from './labels';
import { costParts } from './ops';

export interface Discount {
  bp: number;
  isk: number;
  pyrite: boolean;
}
export interface StructureDraft {
  structure: StructureType;
  /** Citadels only: built in a home system. */
  home: boolean;
  /** What the structure slot prints (BP, ISK, pyrite waived). */
  discount: Discount;
}
export interface BuildDraft {
  ships: Record<ShipId, number>;
  structures: StructureDraft[];
  belts: Mineral[];
}

export const EMPTY_BUILD: BuildDraft = { ships: {}, structures: [], belts: [] };
export const STRUCTURES: StructureType[] = ['engineering', 'citadel', 'customs', 'refinery'];
export const NO_DISCOUNT: Discount = { bp: 0, isk: 0, pyrite: false };

const SIZE_ORDER: Size[] = ['small', 'medium', 'large'];
const RES_ORDER: ResourceKey[] = ['isk', 'pyrite', 'mexallon', 'tritanium', 'morphite', 'planetary', 'moon', 'component'];
const SHIP_BY_ID = new Map(SHIPS.map((s) => [s.id, s]));

const has = (p: PlayerPublic, dev: string): boolean => p.completed.includes(dev);

export function newStructure(structure: StructureType = 'customs'): StructureDraft {
  return { structure, home: false, discount: { ...NO_DISCOUNT } };
}

/** Build points per Build action: 6, plus 2 with the Assembly Line (the engine's own `buildPoints`). */
export const buildBudget: (p: PlayerPublic) => number = buildPoints;

/** Models of a structure type still in the box (13 per type across all players). */
export function structuresLeft(game: GameState, s: StructureType): number {
  const built = Object.values(game.players).reduce((n, q) => n + (q?.structures[s] ?? 0), 0);
  return Math.max(0, STRUCTURE_SUPPLY - built);
}

export interface StructureCost {
  bp: number;
  isk: number;
  pyrite: number;
  /** How each number is made: "BP 5 − 2 slot = 3", "ISK 6 − 1 Materials Efficiency = 5", "Pyrite waived by the slot". */
  lines: string[];
}

/** A structure's price after the slot discount and Materials Efficiency (`ignoreBp`: Deployable Infrastructure). */
export function structureCost(s: StructureDraft, opts: { materialsEfficiency: boolean; ignoreBp?: boolean }): StructureCost {
  const base = STRUCTURE_COST[s.structure];
  const d = s.discount;
  const bp = opts.ignoreBp ? 0 : Math.max(0, base.bp - d.bp);
  const me = opts.materialsEfficiency ? MATERIALS_EFFICIENCY_ISK : 0;
  const isk = Math.max(0, base.isk - d.isk - me);
  const pyrite = d.pyrite ? 0 : base.pay.pyrite;
  const bpLine = opts.ignoreBp ? 'No BP (Deployable Infrastructure)' : d.bp > 0 ? `BP ${base.bp} − ${d.bp} slot = ${bp}` : `BP ${bp}`;
  const iskParts = [`${base.isk}`, ...(d.isk > 0 ? [`${d.isk} slot`] : []), ...(me > 0 ? [`${me} Materials Efficiency`] : [])];
  const iskLine = iskParts.length > 1 ? `ISK ${iskParts.join(' − ')} = ${isk}` : `ISK ${isk}`;
  const pyriteLine = d.pyrite ? 'Pyrite waived by the slot' : `Pyrite ${pyrite}`;
  return { bp, isk, pyrite, lines: [bpLine, iskLine, pyriteLine] };
}

/** Ships of the draft that exist, with their counts, in data order. */
function draftShips(d: BuildDraft): { ship: Ship; count: number }[] {
  return SHIPS.filter((s) => (d.ships[s.id] ?? 0) > 0).map((ship) => ({ ship, count: d.ships[ship.id]! }));
}

/** The `build` command's items: each ship as often as counted, then structures, then belt unlocks. */
export function buildItems(d: BuildDraft): BuildItem[] {
  return [
    ...draftShips(d).flatMap(({ ship, count }) => Array.from({ length: count }, (): BuildItem => ({ kind: 'ship', ship: ship.id }))),
    ...d.structures.map((s): BuildItem => ({ kind: 'structure', structure: s.structure, home: s.home, discount: { ...s.discount } })),
    ...d.belts.map((mineral): BuildItem => ({ kind: 'unlockBelt', mineral })),
  ];
}

/** Build points the draft needs. */
export function bpUsed(d: BuildDraft): number {
  const ships = draftShips(d).reduce((n, { ship, count }) => n + SHIP_COST[ship.size].bp * count, 0);
  const structures = d.structures.reduce((n, s) => n + Math.max(0, STRUCTURE_COST[s.structure].bp - s.discount.bp), 0);
  return ships + structures + d.belts.length * UNLOCK_BELT_COST.bp;
}

export interface ShipOption {
  ship: Ship;
  owned: number;
  /** Models still in the box. */
  left: number;
  /** Why it can't be built at all ("Needs Medium Hull", "All 3 on the board"), or null. */
  locked: string | null;
  cost: ShipCost;
  /** What is missing for one ship, e.g. ["+2 ISK", "+1 Tritanium"] (the cube's price counts). */
  short: string[];
  affordable: boolean;
}

function hullLock(p: PlayerPublic, size: Size): string | null {
  if (size === 'medium' && !has(p, DEV.mediumHull)) return 'Needs Medium Hull';
  if (size === 'large' && !has(p, DEV.largeHull)) return 'Needs Large Hull';
  return null;
}

/** My faction's ships: affordable first, then buildable but short, then locked or sold out; small → large, A–Z. */
export function shipOptions(p: PlayerPublic, budget: number, cubePrice: number): ShipOption[] {
  const opts = shipsOf(p.faction).map((ship): ShipOption => {
    const owned = p.ships[ship.id] ?? 0;
    const left = Math.max(0, ship.qty - owned);
    const locked = hullLock(p, ship.size) ?? (left === 0 ? `All ${ship.qty} on the board` : null);
    const cost = SHIP_COST[ship.size];
    const need: Partial<Resources> = { ...cost.pay, isk: cost.isk + cubePrice };
    const short = RES_ORDER.filter((k) => (need[k] ?? 0) > p.res[k]).map((k) => `+${(need[k] ?? 0) - p.res[k]} ${RESOURCE_LABEL[k]}`);
    return { ship, owned, left, locked, cost, short, affordable: locked === null && short.length === 0 && cost.bp <= budget };
  });
  const group = (o: ShipOption) => (o.affordable ? 0 : o.locked === null ? 1 : 2);
  return opts.sort(
    (a, b) =>
      group(a) - group(b) || SIZE_ORDER.indexOf(a.ship.size) - SIZE_ORDER.indexOf(b.ship.size) || a.ship.name.localeCompare(b.ship.name),
  );
}

/** "1 BP · 4 ISK · 1 Tritanium": one ship's price. */
export function shipCostText(ship: Ship): string {
  const c = SHIP_COST[ship.size];
  return [`${c.bp} BP`, `${c.isk} ISK`, ...costParts(c.pay)].join(' · ');
}

/** The draft's cost, item by item, then the cube and the total. */
export function costLines(p: PlayerPublic, d: BuildDraft, cubesUsed: number): string[] {
  const lines: string[] = [];
  let isk = 0;
  const mass = has(p, DEV.massProduction);
  for (const { ship, count } of draftShips(d)) {
    const c = SHIP_COST[ship.size];
    const each = Array.from({ length: count }, (_, i) => (i > 0 && mass ? Math.max(0, c.isk - MASS_PRODUCTION_ISK) : c.isk));
    const sum = each.reduce((a, b) => a + b, 0);
    isk += sum;
    const iskText = count > 1 ? `ISK ${each.join(' + ')} = ${sum}${mass ? ' (Mass Production)' : ''}` : `ISK ${sum}`;
    const pay = RES_ORDER.filter((k) => (c.pay[k] ?? 0) > 0).map((k) => `${RESOURCE_LABEL[k]} ${(c.pay[k] ?? 0) * count}`);
    lines.push(`${ship.name}${count > 1 ? ` ×${count}` : ''}: ${[`BP ${c.bp * count}`, iskText, ...pay].join(' · ')}`);
  }
  const me = has(p, DEV.materialsEfficiency);
  for (const s of d.structures) {
    const c = structureCost(s, { materialsEfficiency: me });
    isk += c.isk;
    lines.push(`${STRUCTURE_LABEL[s.structure]}${s.home ? ' at home' : ''}: ${c.lines.join(' · ')}`);
  }
  for (const m of d.belts) {
    isk += UNLOCK_BELT_COST.isk;
    lines.push(`Unlock ${m} belt: BP ${UNLOCK_BELT_COST.bp} · ISK ${UNLOCK_BELT_COST.isk}`);
  }
  const cube = cubeCost(cubesUsed);
  if (cube > 0) {
    isk += cube;
    lines.push(`Cube ${cubesUsed + 1}: ISK ${cube}`);
  }
  if (lines.length > 0) lines.push(`Total: BP ${bpUsed(d)}/${buildBudget(p)} · ISK ${isk}`);
  return lines;
}

/** "Build Heretic", "Build 3 ships + Citadel + belt", "Unlock mexallon belt": the Confirm button's verb phrase. */
export function buildHead(d: BuildDraft): string {
  const ships = draftShips(d);
  const n = ships.reduce((a, s) => a + s.count, 0);
  const parts: string[] = [];
  if (n === 1) parts.push(ships[0]!.ship.name);
  else if (n > 1) parts.push(`${n} ships`);
  if (d.structures.length === 1) parts.push(STRUCTURE_LABEL[d.structures[0]!.structure]);
  else if (d.structures.length > 1) parts.push(`${d.structures.length} structures`);
  if (parts.length === 0 && d.belts.length === 1) return `Unlock ${d.belts[0]} belt`;
  if (parts.length === 0 && d.belts.length > 1) return `Unlock ${d.belts.length} belts`;
  if (d.belts.length > 0) parts.push(d.belts.length === 1 ? 'belt' : `${d.belts.length} belts`);
  return parts.length === 0 ? 'Build' : `Build ${parts.join(' + ')}`;
}

const whole = (x: unknown, max: number): number | null => (typeof x === 'number' && Number.isInteger(x) && x >= 0 && x <= max ? x : null);

function structureDraft(raw: unknown): StructureDraft | null {
  if (!isRecord(raw)) return null;
  const s = raw.structure;
  if (typeof s !== 'string' || !(STRUCTURES as string[]).includes(s)) return null;
  const d = isRecord(raw.discount) ? raw.discount : {};
  const structure = s as StructureType;
  return {
    structure,
    home: structure === 'citadel' && raw.home === true,
    discount: { bp: whole(d.bp, 5) ?? 0, isk: whole(d.isk, 9) ?? 0, pyrite: d.pyrite === true },
  };
}

/** A stored build draft with unknown ships, structures and minerals dropped; null for a non-object. */
export function sanitizeBuild(raw: unknown): BuildDraft | null {
  if (!isRecord(raw)) return null;
  const ships: Record<ShipId, number> = {};
  if (isRecord(raw.ships)) {
    for (const [id, n] of Object.entries(raw.ships)) {
      const count = whole(n, 5);
      if (SHIP_BY_ID.has(id) && count !== null && count > 0) ships[id] = count;
    }
  }
  const structures = Array.isArray(raw.structures) ? raw.structures.map(structureDraft).filter((s): s is StructureDraft => s !== null) : [];
  const belts = Array.isArray(raw.belts) ? raw.belts.filter((m): m is Mineral => typeof m === 'string' && (MINERALS as string[]).includes(m)).slice(0, 2) : [];
  return { ships, structures, belts };
}

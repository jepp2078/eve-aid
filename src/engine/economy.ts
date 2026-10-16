/**
 * The economy actions (spec 6.2): Trade, Manufacture and Build.
 *
 * Trade and Manufacture take 1 to 3 operations applied in order, each validated at that point against what the
 * earlier ones left behind. `applyTradeOp` / `applyManufactureOp` apply one operation and are shared with the
 * developments that grant an extra operation (Trade Contracts, Manufacturing Hub). Build takes a list of ships,
 * structures and belt unlocks that must fit in the player's build points.
 *
 * Commands are checked for shape (op counts, item/mineral combinations, ship ids, structure types) before
 * `beginAction` takes the cube, so a malformed command is refused before anything is paid. Handlers mutate the
 * cloned game `apply` hands them and reject with `fail()`; `apply` discards the clone, so a command is all or nothing.
 */
import {
  ASSEMBLY_LINE_BP, BASE_BP, MANUFACTURE, MANUFACTURE_YIELD, MASS_PRODUCTION_ISK, MATERIALS_EFFICIENCY_ISK, SHIP_COST,
  STRUCTURE_COST, STRUCTURE_SUPPLY, TRADE, UNLOCK_BELT_COST, type TradePrice,
} from '../data/costs';
import { DEV } from '../data/developments';
import { ship as shipData, type Ship } from '../data/ships';
import { BASIC_MINERALS, MINERALS, type Mineral, type ResourceKey, type Resources, type ShipId, type StructureType } from '../data/types';
import type { BuildItem, Command, Ctx, GameState, ManufactureOp, PlayerPrivate, PlayerPublic, TradeOp } from './types';
import { andList, beginAction } from './turns';
import { addRes, checkCount, factionName, fail, gainVP, hasDev, needActor, needPriv, spend, withArticle, type Out } from './util';

type ActionCmd<A extends Extract<Command, { type: 'action' }>['action']> = Extract<Command, { type: 'action'; action: A }>;
type Discount = { bp: number; isk: number; pyrite: boolean };

/** Operations per Trade or Manufacture action. */
const MAX_OPS = 3;
/** Research tokens one research manufacture makes. */
const RESEARCH_PER_OP = MANUFACTURE_YIELD.research;

/** Structure names in log lines and messages. */
export const STRUCTURE_NAME: Record<StructureType, string> = {
  engineering: 'Engineering Complex', citadel: 'Citadel', customs: 'Customs Office', refinery: 'Refinery',
};
const RES_LABEL: Record<ResourceKey, string> = {
  isk: 'ISK', pyrite: 'pyrite', mexallon: 'mexallon', tritanium: 'tritanium', morphite: 'morphite',
  planetary: 'planetary', moon: 'moon', component: 'component',
};

/** "2 mexallon", "1 planetary and 1 moon": the non-zero parts of a cost, for log lines. */
function costText(cost: Partial<Resources>): string {
  const parts = (Object.keys(RES_LABEL) as ResourceKey[]).filter((k) => (cost[k] ?? 0) > 0).map((k) => `${cost[k]} ${RES_LABEL[k]}`);
  return parts.length === 0 ? 'nothing' : andList(parts);
}

/** The operation list of a Trade or Manufacture command: 1 to 3 entries. */
function needOps(ops: unknown): unknown[] {
  if (!Array.isArray(ops) || ops.length === 0) fail('no_ops', 'Choose at least one operation');
  if (ops.length > MAX_OPS) fail('too_many_ops', `A trade or manufacture action has at most ${MAX_OPS} operations`);
  return ops;
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null;
}

// ---------------------------------------------------------------------------------------------------------------
// trade

interface TradePlan {
  dir: 'buy' | 'sell';
  /** What changes hands and how many (3 for a triple trade). */
  res: ResourceKey;
  count: number;
  price: TradePrice;
  label: string;
}

/** Checks the shape of one trade operation (without looking at any player). */
function planTrade(op: unknown): TradePlan {
  if (!isObject(op)) fail('bad_op', 'That trade is not valid');
  const { dir, item, mineral } = op as unknown as TradeOp;
  if (dir !== 'buy' && dir !== 'sell') fail('bad_op', 'A trade must buy or sell');
  if (typeof item !== 'string' || !Object.hasOwn(TRADE, item)) fail('bad_op', 'Unknown trade item');
  if (item === 'triple') {
    if (typeof mineral !== 'string' || !BASIC_MINERALS.includes(mineral)) {
      fail('bad_op', 'A triple trade needs the mineral: pyrite, mexallon or tritanium');
    }
    return { dir, res: mineral, count: 3, price: TRADE.triple, label: `3 ${mineral}` };
  }
  if (mineral !== null) fail('bad_op', 'Only a triple trade names a mineral');
  const label = item === 'planetary' || item === 'moon' ? `${item} material` : item;
  return { dir, res: item, count: 1, price: TRADE[item], label: `1 ${label}` };
}

/**
 * Buys or sells one item at the market price (spec 4). Fails `bad_op` for a malformed operation and `insufficient`
 * for what the player lacks. A purchase may take minerals above 12 (manual p. 10): the player then discards down to 12
 * through the blocking minerals overlay (`discardMinerals`). Selling ISK above the cap loses the excess (addRes writes the line).
 */
export function applyTradeOp(_g: GameState, p: PlayerPublic, op: TradeOp, out: Out): void {
  const t = planTrade(op);
  const who = factionName(p.faction);
  if (t.dir === 'sell') {
    spend(p, { [t.res]: t.count });
    out.lines.push(`${who} sold ${t.label} for ${t.price.sell} ISK`);
    addRes(p, 'isk', t.price.sell, out);
    return;
  }
  spend(p, { isk: t.price.buy });
  addRes(p, t.res, t.count, out);
  out.lines.push(`${who} bought ${t.label} for ${t.price.buy} ISK`);
}

export function tradeAction(g: GameState, cmd: ActionCmd<'trade'>, ctx: Ctx, out: Out): void {
  const f = needActor(g, ctx);
  const ops = needOps(cmd.ops);
  ops.forEach(planTrade);
  const p = beginAction(g, f, 'trade', out);
  for (const op of ops) applyTradeOp(g, p, op as TradeOp, out);
}

// ---------------------------------------------------------------------------------------------------------------
// manufacture

/** Checks the shape of one manufacture operation and returns what it costs. */
function planManufacture(op: unknown): { output: ManufactureOp['output']; cost: Partial<Resources> } {
  if (!isObject(op)) fail('bad_op', 'That manufacture is not valid');
  const { output, pay } = op as unknown as ManufactureOp;
  if (typeof output !== 'string' || !Object.hasOwn(MANUFACTURE, output)) fail('bad_op', 'Unknown manufacture output');
  if (pay !== 'basic' && pay !== 'morphite') fail('bad_op', 'Pay with basic minerals or with morphite');
  const cost = MANUFACTURE[output][pay];
  if (!cost) fail('bad_op', `${output} cannot be manufactured with ${pay === 'morphite' ? 'morphite' : 'basic minerals'}`);
  return { output, cost };
}

/**
 * Manufactures one output. Research adds 2 to `priv.pendingResearch` (so the private doc is needed); a VP goes
 * through `gainVP`; a card is a notice to the player. Fails `bad_op` for a malformed operation or a payment option
 * the recipe does not have, and `insufficient` for what the player lacks.
 */
export function applyManufactureOp(g: GameState, p: PlayerPublic, op: ManufactureOp, out: Out, priv: PlayerPrivate | null): void {
  const { output, cost } = planManufacture(op);
  if (output === 'research') needPriv(priv); // before paying, so a missing private doc costs nothing
  spend(p, cost);
  const who = factionName(p.faction);
  const paid = `(paid ${costText(cost)})`;
  switch (output) {
    case 'component':
    case 'moon':
    case 'planetary':
      addRes(p, output, 1, out);
      out.lines.push(`${who} manufactured 1 ${output === 'component' ? 'component' : `${output} material`} ${paid}`);
      break;
    case 'research':
      needPriv(priv).pendingResearch += RESEARCH_PER_OP;
      out.lines.push(`${who} manufactured ${RESEARCH_PER_OP} research ${paid}`);
      break;
    case 'vp':
      out.lines.push(`${who} manufactured 1 VP ${paid}`);
      gainVP(g, p.faction, 1, out);
      break;
    case 'card':
      out.notices.push({ to: p.faction, text: 'Draw an Event or Mission card', kind: 'todo' });
      out.lines.push(`${who} manufactured a card ${paid}`);
      break;
  }
}

export function manufactureAction(g: GameState, cmd: ActionCmd<'manufacture'>, ctx: Ctx, out: Out, priv: PlayerPrivate | null): void {
  const f = needActor(g, ctx);
  const pv = needPriv(priv);
  const ops = needOps(cmd.ops);
  ops.forEach(planManufacture);
  const p = beginAction(g, f, 'manufacture', out);
  for (const op of ops) applyManufactureOp(g, p, op as ManufactureOp, out, pv);
}

// ---------------------------------------------------------------------------------------------------------------
// build

/** Build points per Build action: 6, plus 2 with the Assembly Line. */
export function buildPoints(p: PlayerPublic): number {
  return BASE_BP + (hasDev(p, DEV.assemblyLine) ? ASSEMBLY_LINE_BP : 0);
}

/** The shape of a structure build; any structure may go in a home system (manual pp. 10, 23), but `home` only counts a Citadel. */
function checkStructure(s: unknown, home: unknown, discount: unknown): { s: StructureType; home: boolean; d: Discount } {
  if (typeof s !== 'string' || !Object.hasOwn(STRUCTURE_COST, s)) fail('bad_structure', 'Unknown structure type');
  if (typeof home !== 'boolean') fail('bad_op', 'Say whether the structure is in a home system');
  if (!isObject(discount)) fail('bad_op', 'The slot discount is missing');
  const d = discount as unknown as Discount;
  checkCount(d.bp, 'The BP discount');
  checkCount(d.isk, 'The ISK discount');
  if (typeof d.pyrite !== 'boolean') fail('bad_op', 'Say whether the slot waives the pyrite');
  return { s: s as StructureType, home, d };
}

const structureBp = (s: StructureType, d: Discount): number => Math.max(0, STRUCTURE_COST[s].bp - d.bp);

/**
 * Builds one structure: pays pyrite (unless the slot waives it) and ISK (base, less the slot discount, less 1 with
 * Materials Efficiency), and counts it (a home Citadel also counts in `homeCitadels`). Each type has 13 models across
 * all players (`no_supply`). Returns the build points it uses: 5 less the slot discount, or 0 with `ignoreBp`
 * (Deployable Infrastructure). Checking the points against the budget is the caller's job.
 */
export function buildStructure(
  g: GameState, p: PlayerPublic, s: StructureType, home: boolean, discount: Discount, ignoreBp: boolean, out: Out,
): number {
  const c = checkStructure(s, home, discount);
  const built = Object.values(g.players).reduce((sum, q) => sum + (q?.structures[c.s] ?? 0), 0);
  if (built >= STRUCTURE_SUPPLY) fail('no_supply', `All ${STRUCTURE_SUPPLY} ${STRUCTURE_NAME[c.s]} models are already built`);
  const base = STRUCTURE_COST[c.s];
  const isk = Math.max(0, base.isk - c.d.isk - (hasDev(p, DEV.materialsEfficiency) ? MATERIALS_EFFICIENCY_ISK : 0));
  const pyrite = c.d.pyrite ? 0 : base.pay.pyrite;
  spend(p, { isk, pyrite });
  p.structures[c.s] += 1;
  if (c.home && c.s === 'citadel') p.homeCitadels += 1;
  out.lines.push(`${factionName(p.faction)} built ${withArticle(STRUCTURE_NAME[c.s])}${c.home ? ' at home' : ''} (paid ${costText({ isk, pyrite })})`);
  return ignoreBp ? 0 : structureBp(c.s, c.d);
}

/** `ship()` throws on an unknown id; report that as a rule error. */
function shipOrFail(id: unknown): Ship {
  try {
    return shipData(id as ShipId);
  } catch {
    return fail('bad_ship', 'Unknown ship');
  }
}

/** Checks the shape of one build item. */
function checkItem(raw: unknown): BuildItem {
  if (!isObject(raw)) fail('bad_item', 'That build item is not valid');
  const item = raw as unknown as BuildItem;
  switch (item.kind) {
    case 'ship':
      shipOrFail(item.ship);
      return item;
    case 'structure':
      checkStructure(item.structure, item.home, item.discount);
      return item;
    case 'unlockBelt':
      if (!MINERALS.includes(item.mineral)) fail('bad_mineral', 'Choose the colour of the belt to unlock');
      return item;
    default:
      return fail('bad_item', 'Build a ship, a structure or unlock a home belt');
  }
}

/** Build points of an already-checked item. */
function itemBp(item: BuildItem): number {
  switch (item.kind) {
    case 'ship':
      return SHIP_COST[shipOrFail(item.ship).size].bp;
    case 'structure':
      return structureBp(item.structure, item.discount);
    case 'unlockBelt':
      return UNLOCK_BELT_COST.bp;
  }
}

/** `sameInBuild`: ships of this name built earlier in the same Build action (for Mass Production). */
function buildShip(p: PlayerPublic, id: ShipId, sameInBuild: number, out: Out): void {
  const s = shipOrFail(id);
  if (s.faction !== p.faction) fail('wrong_faction', `${s.name} is ${withArticle(factionName(s.faction))} ship; you can only build ${factionName(p.faction)} ships`);
  if (s.size === 'medium' && !hasDev(p, DEV.mediumHull)) fail('hull_locked', 'Medium ships need the Medium Hull development');
  if (s.size === 'large' && !hasDev(p, DEV.largeHull)) fail('hull_locked', 'Large ships need the Large Hull development');
  const owned = Object.hasOwn(p.ships, s.id) ? (p.ships[s.id] as number) : 0;
  if (owned >= s.qty) fail('no_models', `All ${s.qty} ${s.name} models are already on the board`);
  const cost = SHIP_COST[s.size];
  const discounted = sameInBuild > 0 && hasDev(p, DEV.massProduction);
  const isk = discounted ? Math.max(0, cost.isk - MASS_PRODUCTION_ISK) : cost.isk;
  spend(p, { ...cost.pay, isk });
  p.ships[s.id] = owned + 1;
  out.lines.push(`${factionName(p.faction)} built ${withArticle(s.name)} (paid ${costText({ ...cost.pay, isk })}${discounted ? ', Mass Production' : ''})`);
}

function unlockBelt(p: PlayerPublic, m: Mineral, out: Out): void {
  if (p.lockedHomeBelts < 1) fail('no_locked_belt', 'No locked home asteroid belt is left to unlock');
  spend(p, { isk: UNLOCK_BELT_COST.isk });
  p.lockedHomeBelts -= 1;
  p.belts[m] += 1;
  out.lines.push(`${factionName(p.faction)} unlocked a home ${m} belt (paid ${UNLOCK_BELT_COST.isk} ISK)`);
}

export function buildAction(g: GameState, cmd: ActionCmd<'build'>, ctx: Ctx, out: Out): void {
  const f = needActor(g, ctx);
  if (!Array.isArray(cmd.items) || cmd.items.length === 0) fail('no_items', 'Choose at least one thing to build');
  const items = cmd.items.map(checkItem);
  const p = beginAction(g, f, 'build', out);

  const budget = buildPoints(p);
  const used = items.reduce((sum, item) => sum + itemBp(item), 0);
  if (used > budget) fail('no_bp', `That needs ${used} build points but you have ${budget}`);

  const shipsBuilt = new Map<ShipId, number>();
  for (const item of items) {
    switch (item.kind) {
      case 'ship': {
        const before = shipsBuilt.get(item.ship) ?? 0;
        buildShip(p, item.ship, before, out);
        shipsBuilt.set(item.ship, before + 1);
        break;
      }
      case 'structure':
        buildStructure(g, p, item.structure, item.home, item.discount, false, out);
        break;
      case 'unlockBelt':
        unlockBelt(p, item.mineral, out);
        break;
    }
  }
  out.lines.push(`${factionName(f)} used ${used} of ${budget} build points`);
}

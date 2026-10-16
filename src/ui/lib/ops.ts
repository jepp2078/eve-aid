/**
 * Trade and Manufacture operations, and Move's discovery rewards: labels with prices and recipes, row edits that
 * keep an operation well-formed, the uncapped ISK change of a trade, and sanitisers for drafts restored from
 * sessionStorage.
 */
import { MANUFACTURE, MANUFACTURE_YIELD, TRADE, type ManufactureOutput, type ManufacturePay } from '../../data/costs';
import { BASIC_MINERALS, MINERALS, type BasicMineral, type Mineral, type ResourceKey, type Resources, type StructureType } from '../../data/types';
import type { DiscoveryReward, ManufactureOp, SystemContents, TradeItem, TradeOp } from '../../engine/types';
import { isRecord } from './drafts';
import { andList, RESOURCE_LABEL, signed, STRUCTURE_LABEL } from './labels';

/** Operations per Trade or Manufacture action. */
export const MAX_OPS = 3;

export const TRADE_ITEMS: TradeItem[] = ['component', 'planetary', 'moon', 'morphite', 'pyrite', 'mexallon', 'tritanium', 'triple'];

export const TRADE_ITEM_LABEL: Record<TradeItem, string> = {
  component: 'Component',
  planetary: 'Planetary',
  moon: 'Moon',
  morphite: 'Morphite',
  pyrite: 'Pyrite',
  mexallon: 'Mexallon',
  tritanium: 'Tritanium',
  triple: '3 of a mineral',
};

const isBasic = (x: unknown): x is BasicMineral => typeof x === 'string' && (BASIC_MINERALS as string[]).includes(x);

/** ISK this operation adds (sell) or costs (buy, negative). */
export function tradeOpIsk(op: TradeOp): number {
  const price = TRADE[op.item];
  return op.dir === 'sell' ? price.sell : -price.buy;
}

/** "Sell 1 Component · +6 ISK", "Buy 3 Mexallon · −8 ISK". */
export function tradeOpText(op: TradeOp): string {
  const what = op.item === 'triple' ? `3 ${RESOURCE_LABEL[op.mineral ?? 'pyrite']}` : `1 ${TRADE_ITEM_LABEL[op.item]}`;
  return `${op.dir === 'sell' ? 'Sell' : 'Buy'} ${what} · ${signed(tradeOpIsk(op))} ISK`;
}

/** The trade's ISK change before the 49 cap: sales − purchases − the cube's price. */
export function tradeIskNet(ops: readonly TradeOp[], cubeCost: number): number {
  return ops.reduce((n, op) => n + tradeOpIsk(op), 0) - cubeCost;
}

export function newTradeOp(): TradeOp {
  return { dir: 'sell', item: 'pyrite', mineral: null };
}

/** Changes the item, keeping `mineral` only (and always) for a triple trade. */
export function setTradeItem(op: TradeOp, item: TradeItem): TradeOp {
  return { ...op, item, mineral: item === 'triple' ? (op.mineral ?? 'pyrite') : null };
}

function tradeOp(raw: unknown): TradeOp | null {
  if (!isRecord(raw)) return null;
  const { dir, item, mineral } = raw;
  if (dir !== 'buy' && dir !== 'sell') return null;
  if (typeof item !== 'string' || !(TRADE_ITEMS as string[]).includes(item)) return null;
  if (item === 'triple') return isBasic(mineral) ? { dir, item, mineral } : null;
  return mineral === null ? { dir, item: item as TradeItem, mineral: null } : null;
}

/** A stored list of 1–3 trade operations, or null when anything is off. */
export function sanitizeTradeOps(raw: unknown): TradeOp[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_OPS) return null;
  const ops = raw.map(tradeOp);
  return ops.every((o): o is TradeOp => o !== null) ? ops : null;
}

/* ------------------------------------------------------------------ manufacture */

export const MANUFACTURE_OUTPUTS: ManufactureOutput[] = ['component', 'moon', 'planetary', 'research', 'vp', 'card'];

export const OUTPUT_LABEL: Record<ManufactureOutput, string> = {
  component: 'Component',
  moon: 'Moon',
  planetary: 'Planetary',
  research: 'Research',
  vp: 'VP',
  card: 'Event or Mission card',
};

/** The payments a recipe accepts (basic minerals, and morphite for research and cards). */
export function payOptions(output: ManufactureOutput): ManufacturePay[] {
  return (['basic', 'morphite'] as const).filter((p) => MANUFACTURE[output][p] !== undefined);
}

export function manufactureCost(op: ManufactureOp): Partial<Resources> {
  return MANUFACTURE[op.output][op.pay] ?? {};
}

const COST_ORDER: ResourceKey[] = ['pyrite', 'mexallon', 'tritanium', 'morphite', 'planetary', 'moon', 'component', 'isk'];

/** "2 Mexallon", "1 Pyrite + 1 Mexallon": the non-zero parts of a cost. */
export function costParts(cost: Partial<Resources>): string[] {
  return COST_ORDER.filter((k) => (cost[k] ?? 0) > 0).map((k) => `${cost[k]} ${RESOURCE_LABEL[k]}`);
}

/** "2 Mexallon → 1 Component". */
export function manufactureOpText(op: ManufactureOp): string {
  return `${costParts(manufactureCost(op)).join(' + ')} → ${MANUFACTURE_YIELD[op.output]} ${OUTPUT_LABEL[op.output]}`;
}

export function newManufactureOp(): ManufactureOp {
  return { output: 'component', pay: 'basic' };
}

/** Changes the output, keeping the payment when the new recipe accepts it. */
export function setManufactureOutput(op: ManufactureOp, output: ManufactureOutput): ManufactureOp {
  return { output, pay: payOptions(output).includes(op.pay) ? op.pay : 'basic' };
}

function manufactureOp(raw: unknown): ManufactureOp | null {
  if (!isRecord(raw)) return null;
  const { output, pay } = raw;
  if (typeof output !== 'string' || !(MANUFACTURE_OUTPUTS as string[]).includes(output)) return null;
  if (pay !== 'basic' && pay !== 'morphite') return null;
  const o = output as ManufactureOutput;
  return payOptions(o).includes(pay) ? { output: o, pay } : null;
}

export function sanitizeManufactureOps(raw: unknown): ManufactureOp[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_OPS) return null;
  const ops = raw.map(manufactureOp);
  return ops.every((o): o is ManufactureOp => o !== null) ? ops : null;
}

/* ------------------------------------------------------------------ what a system holds */

/** Belts per mineral (a double belt counts 2) and structures by type: what a claimed system holds, or what is occupied. */
export interface ContentsDraft {
  belts: Record<Mineral, number>;
  structures: Record<StructureType, number>;
}

export const STRUCTURE_TYPES: StructureType[] = ['engineering', 'citadel', 'customs', 'refinery'];

export const EMPTY_CONTENTS: ContentsDraft = {
  belts: { pyrite: 0, mexallon: 0, tritanium: 0, morphite: 0 },
  structures: { engineering: 0, citadel: 0, customs: 0, refinery: 0 },
};

export const hasContents = (d: ContentsDraft): boolean => MINERALS.some((m) => d.belts[m] > 0) || STRUCTURE_TYPES.some((s) => d.structures[s] > 0);

/** The command's `contents`: only the non-zero entries, or undefined for nothing (the quick path sends no field). */
export function contentsOf(d: ContentsDraft): SystemContents | undefined {
  if (!hasContents(d)) return undefined;
  return {
    belts: Object.fromEntries(MINERALS.filter((m) => d.belts[m] > 0).map((m) => [m, d.belts[m]])),
    structures: Object.fromEntries(STRUCTURE_TYPES.filter((s) => d.structures[s] > 0).map((s) => [s, d.structures[s]])),
  };
}

/** "2 Pyrite belts, 1 Customs Office": what a draft holds, or '' for nothing. */
export function contentsLabel(d: ContentsDraft): string {
  const belts = MINERALS.filter((m) => d.belts[m] > 0).map((m) => `${d.belts[m]} ${RESOURCE_LABEL[m]} ${d.belts[m] === 1 ? 'belt' : 'belts'}`);
  const structures = STRUCTURE_TYPES.filter((s) => d.structures[s] > 0).map((s) => `${d.structures[s]} ${STRUCTURE_LABEL[s]}`);
  return [...belts, ...structures].join(', ');
}

/** Whole numbers 0..99 per key; anything else becomes 0. A missing or malformed value is "nothing". */
export function sanitizeContents(raw: unknown): ContentsDraft {
  const d: ContentsDraft = { belts: { ...EMPTY_CONTENTS.belts }, structures: { ...EMPTY_CONTENTS.structures } };
  if (!isRecord(raw)) return d;
  const whole = (v: unknown): number => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 99 ? v : 0);
  if (isRecord(raw.belts)) for (const m of MINERALS) d.belts[m] = whole(raw.belts[m]);
  if (isRecord(raw.structures)) for (const s of STRUCTURE_TYPES) d.structures[s] = whole(raw.structures[s]);
  return d;
}

/* ------------------------------------------------------------------ discovery */

/** How many of each discovery token reward the player drew (minerals per colour). */
export interface DiscoveryDraft {
  pyrite: number;
  mexallon: number;
  tritanium: number;
  research: number;
  control: number;
  moon: number;
  planetary: number;
  component: number;
  card: number;
  isk: number;
}

export const DISCOVERY_KEYS = ['pyrite', 'mexallon', 'tritanium', 'research', 'control', 'moon', 'planetary', 'component', 'card', 'isk'] as const;

export const EMPTY_DISCOVERY: DiscoveryDraft = {
  pyrite: 0, mexallon: 0, tritanium: 0, research: 0, control: 0, moon: 0, planetary: 0, component: 0, card: 0, isk: 0,
};

/** The `discover` command's rewards: one minerals entry, amounts for the rest, repeated entries for control/card (`belts`: what the gained systems hold). */
export function discoveryRewards(d: DiscoveryDraft, belts: ContentsDraft = EMPTY_CONTENTS): DiscoveryReward[] {
  const out: DiscoveryReward[] = [];
  const minerals = BASIC_MINERALS.flatMap((m) => Array.from({ length: d[m] }, () => m));
  if (minerals.length > 0) out.push({ kind: 'minerals', minerals });
  if (d.research > 0) out.push({ kind: 'research', amount: d.research });
  // The belts of the systems gained ride on the first control reward (discovery tokens sit in unclaimed systems).
  for (let i = 0; i < d.control; i++) out.push(i === 0 && hasContents(belts) ? { kind: 'control', contents: contentsOf(belts) } : { kind: 'control' });
  for (const k of ['moon', 'planetary', 'component'] as const) if (d[k] > 0) out.push({ kind: k, amount: d[k] });
  for (let i = 0; i < d.card; i++) out.push({ kind: 'card' });
  if (d.isk > 0) out.push({ kind: 'isk', amount: d.isk });
  return out;
}

/** "2 Pyrite, 4 ISK and a card": what a discovery draft records. */
export function discoveryText(d: DiscoveryDraft): string {
  const parts: string[] = [];
  for (const m of BASIC_MINERALS) if (d[m] > 0) parts.push(`${d[m]} ${RESOURCE_LABEL[m]}`);
  if (d.research > 0) parts.push(`${d.research} research`);
  if (d.control > 0) parts.push(d.control === 1 ? 'a system' : `${d.control} systems`);
  for (const k of ['moon', 'planetary', 'component'] as const) if (d[k] > 0) parts.push(`${d[k]} ${RESOURCE_LABEL[k]}`);
  if (d.card > 0) parts.push(d.card === 1 ? 'a card' : `${d.card} cards`);
  if (d.isk > 0) parts.push(`${d.isk} ISK`);
  return andList(parts);
}

/** Whole numbers 0..99 per key; anything else becomes 0. Null for a non-object. */
export function sanitizeDiscovery(raw: unknown): DiscoveryDraft | null {
  if (!isRecord(raw)) return null;
  const d = { ...EMPTY_DISCOVERY };
  for (const k of DISCOVERY_KEYS) {
    const v = raw[k];
    if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 99) d[k] = v;
  }
  return d;
}

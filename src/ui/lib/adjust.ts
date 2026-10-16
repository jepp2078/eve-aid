/**
 * Manual adjustments: the pencil sheet (resource and VP changes with a reason: Event, Mission or Correction; only
 * Correction skips Lobbyist), its light-game twin (VP, systems and the central system only, the fields a light game
 * adjusts) and the Board counts corrections (systems, central, structures, belts, ships), each sent as one `adjust`
 * command. Drafts hold changes (deltas), never absolute values, so another phone's change to the same counter is not
 * overwritten.
 */
import { SHIPS } from '../../data/ships';
import { MINERALS, type Mineral, type ResourceKey, type ShipId, type StructureType } from '../../data/types';
import type { AdjustDelta, Command } from '../../engine/types';
import { isRecord } from './drafts';

export type AdjustReason = 'event' | 'mission' | 'correction';

export const REASONS: { id: AdjustReason; label: string }[] = [
  { id: 'event', label: 'Event' },
  { id: 'mission', label: 'Mission' },
  { id: 'correction', label: 'Correction' },
];

export const RES_KEYS: ResourceKey[] = ['isk', 'pyrite', 'mexallon', 'tritanium', 'morphite', 'planetary', 'moon', 'component'];
const STRUCTURE_KEYS: StructureType[] = ['engineering', 'citadel', 'customs', 'refinery'];
const SHIP_IDS = new Set(SHIPS.map((s) => s.id));

export interface AdjustDraft {
  res: Record<ResourceKey, number>;
  vp: number;
  reason: AdjustReason | null;
}

export const EMPTY_ADJUST: AdjustDraft = {
  res: { isk: 0, pyrite: 0, mexallon: 0, tritanium: 0, morphite: 0, planetary: 0, moon: 0, component: 0 },
  vp: 0,
  reason: null,
};

/** An `adjust` delta that changes nothing (the builders fill in their fields). */
export function baseDelta(): AdjustDelta {
  return { res: {}, vp: 0, systems: 0, homeCitadels: 0, lockedHomeBelts: 0, structures: {}, belts: {}, ships: {}, central: null };
}

/** The pencil sheet's command, or null until something changes and a reason is picked. */
export function adjustCommand(d: AdjustDraft): Command | null {
  if (d.reason === null) return null;
  const delta = baseDelta();
  for (const k of RES_KEYS) if (d.res[k] !== 0) delta.res[k] = d.res[k];
  delta.vp = d.vp;
  if (Object.keys(delta.res).length === 0 && d.vp === 0) return null;
  const reason = REASONS.find((r) => r.id === d.reason)!.label;
  return { type: 'adjust', delta, correction: d.reason === 'correction', reason };
}

const int = (x: unknown): number => (typeof x === 'number' && Number.isInteger(x) && Math.abs(x) <= 99 ? x : 0);

export function sanitizeAdjust(raw: unknown): AdjustDraft | null {
  if (!isRecord(raw)) return null;
  const res = { ...EMPTY_ADJUST.res };
  if (isRecord(raw.res)) for (const k of RES_KEYS) res[k] = int(raw.res[k]);
  const reason = REASONS.some((r) => r.id === raw.reason) ? (raw.reason as AdjustReason) : null;
  return { res, vp: int(raw.vp), reason };
}

/* ------------------------------------------------------------- light games */

/** The pencil sheet in a light game: VP, systems and the central system, the only fields a light game adjusts. */
export interface LightAdjustDraft {
  vp: number;
  systems: number;
  /** null: unchanged. */
  central: boolean | null;
  reason: AdjustReason | null;
}

export const EMPTY_LIGHT_ADJUST: LightAdjustDraft = { vp: 0, systems: 0, central: null, reason: null };

/**
 * The light pencil sheet's command, or null until something changes and a reason is picked. Only VP, systems and the
 * central system are read, so nothing else can reach a light game's `adjust` (which refuses it).
 */
export function lightAdjustCommand(d: LightAdjustDraft): Command | null {
  if (d.reason === null || (d.vp === 0 && d.systems === 0 && d.central === null)) return null;
  const delta = baseDelta();
  delta.vp = d.vp;
  delta.systems = d.systems;
  delta.central = d.central;
  const reason = REASONS.find((r) => r.id === d.reason)!.label;
  return { type: 'adjust', delta, correction: d.reason === 'correction', reason };
}

export function sanitizeLightAdjust(raw: unknown): LightAdjustDraft | null {
  if (!isRecord(raw)) return null;
  const reason = REASONS.some((r) => r.id === raw.reason) ? (raw.reason as AdjustReason) : null;
  const central = raw.central === true || raw.central === false ? raw.central : null;
  return { vp: int(raw.vp), systems: int(raw.systems), central, reason };
}

/* ------------------------------------------------------------- board counts */

export interface CountsDraft {
  systems: number;
  homeCitadels: number;
  lockedHomeBelts: number;
  structures: Record<StructureType, number>;
  belts: Record<Mineral, number>;
  ships: Record<ShipId, number>;
  /** null: unchanged. */
  central: boolean | null;
}

export function emptyCounts(): CountsDraft {
  return {
    systems: 0,
    homeCitadels: 0,
    lockedHomeBelts: 0,
    structures: { engineering: 0, citadel: 0, customs: 0, refinery: 0 },
    belts: { pyrite: 0, mexallon: 0, tritanium: 0, morphite: 0 },
    ships: {},
    central: null,
  };
}

/** How many counters the draft changes (for "Save 3 corrections"). */
export function countsEdits(d: CountsDraft): number {
  const nonZero = (xs: number[]) => xs.filter((x) => x !== 0).length;
  return (
    nonZero([d.systems, d.homeCitadels, d.lockedHomeBelts]) +
    nonZero(Object.values(d.structures)) +
    nonZero(Object.values(d.belts)) +
    nonZero(Object.values(d.ships)) +
    (d.central === null ? 0 : 1)
  );
}

/** One `adjust` correction with every edited count, or null when nothing changes. */
export function countsCommand(d: CountsDraft): Command | null {
  if (countsEdits(d) === 0) return null;
  const delta = baseDelta();
  delta.systems = d.systems;
  delta.homeCitadels = d.homeCitadels;
  delta.lockedHomeBelts = d.lockedHomeBelts;
  for (const s of STRUCTURE_KEYS) if (d.structures[s] !== 0) delta.structures[s] = d.structures[s];
  for (const m of MINERALS) if (d.belts[m] !== 0) delta.belts[m] = d.belts[m];
  for (const [id, n] of Object.entries(d.ships)) if (n !== 0) delta.ships[id] = n;
  delta.central = d.central;
  return { type: 'adjust', delta, correction: true, reason: 'Board counts' };
}

export function sanitizeCounts(raw: unknown): CountsDraft | null {
  if (!isRecord(raw)) return null;
  const d = emptyCounts();
  d.systems = int(raw.systems);
  d.homeCitadels = int(raw.homeCitadels);
  d.lockedHomeBelts = int(raw.lockedHomeBelts);
  if (isRecord(raw.structures)) for (const s of STRUCTURE_KEYS) d.structures[s] = int(raw.structures[s]);
  if (isRecord(raw.belts)) for (const m of MINERALS) d.belts[m] = int(raw.belts[m]);
  if (isRecord(raw.ships)) for (const [id, n] of Object.entries(raw.ships)) if (SHIP_IDS.has(id) && int(n) !== 0) d.ships[id] = int(n);
  d.central = raw.central === true || raw.central === false ? raw.central : null;
  return d;
}

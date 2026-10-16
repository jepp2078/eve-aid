/**
 * The dice pad's model: the player taps the faces they rolled — never the blanks — and the pad keeps
 * the counts within the pool: per colour (the orbit's dice of that colour, the medium orbit's die of either colour,
 * and extra dice added for card effects) and in total. "Undo last tap" steps back through every pad change (Clear
 * included); the counts become the engine's `DiceEntry`.
 *
 * The draft is local to the attacker's device (sessionStorage), named by the attack it belongs to (`rollDraftName`),
 * so live updates and reloads keep it and another attack never sees it.
 */
import type { BlackFace, Orbit, WhiteFace } from '../../data/types';
import type { DicePool } from '../../engine/combat/abilities';
import type { CombatState, DiceEntry } from '../../engine/types';
import { isRecord } from './drafts';

export type DieColor = 'white' | 'black';
/** A face the player enters (blank never is). */
export type PadFace = Exclude<WhiteFace | BlackFace, 'blank'>;

/** The faces each die colour can show, in pad order: aim, 2× aim, aim+damage, damage, 2× damage, crit. */
export const PAD_FACES: { white: Exclude<WhiteFace, 'blank'>[]; black: Exclude<BlackFace, 'blank'>[] } = {
  white: ['aim', 'aim2', 'damage', 'crit'],
  black: ['aim', 'aimDamage', 'damage', 'damage2', 'crit'],
};

/** Highest count the long-press strip offers (0–10: the pool cap). */
export const STRIP_MAX = 10;
/** Pad changes "Undo last tap" can step back through. */
const HISTORY_KEPT = 50;

export type PadCounts = { white: Partial<Record<PadFace, number>>; black: Partial<Record<PadFace, number>> };

export interface PadDraft {
  /** Faces entered per colour (only faces with a count above 0). */
  counts: PadCounts;
  /** Dice added to the pool for card effects (Eris, Recons, strategy cards), per colour. */
  extra: { white: number; black: number };
  /** The ± adjusters for effects the app does not automate. */
  adjust: { aim: number; damage: number; crit: number };
  /** Earlier `counts`, newest last, for "Undo last tap". */
  history: PadCounts[];
}

export const EMPTY_PAD: PadDraft = { counts: { white: {}, black: {} }, extra: { white: 0, black: 0 }, adjust: { aim: 0, damage: 0, crit: 0 }, history: [] };

/** The die colours an orbit rolls: small white, large black, medium both. */
export function padColours(orbit: Orbit): DieColor[] {
  return orbit === 'small' ? ['white'] : orbit === 'large' ? ['black'] : ['white', 'black'];
}

export interface PadLimits {
  white: number;
  black: number;
  total: number;
}

/** Most dice per colour (that colour's dice, the die of either colour, the extra dice) and in total. */
export function padLimits(pool: DicePool, extra: PadDraft['extra']): PadLimits {
  return {
    white: pool.white + pool.choice + extra.white,
    black: pool.black + pool.choice + extra.black,
    total: pool.total + extra.white + extra.black,
  };
}

const sum = (faces: Partial<Record<PadFace, number>>): number => Object.values(faces).reduce((n, v) => n + (v ?? 0), 0);

/** Dice entered per colour and in total. */
export function entered(counts: PadCounts): { white: number; black: number; total: number } {
  const white = sum(counts.white);
  const black = sum(counts.black);
  return { white, black, total: white + black };
}

/** The largest count `face` of a `die` may be set to within the limits (at most `STRIP_MAX`, never below 0). */
export function faceMax(counts: PadCounts, limits: PadLimits, die: DieColor, face: PadFace): number {
  const e = entered(counts);
  const now = counts[die][face] ?? 0;
  return Math.max(0, Math.min(STRIP_MAX, now + Math.min(limits[die] - e[die], limits.total - e.total)));
}

function withHistory(d: PadDraft, counts: PadCounts): PadDraft {
  return { ...d, counts, history: [...d.history, d.counts].slice(-HISTORY_KEPT) };
}

/** Sets a face's count (clamped to 0..faceMax); the same draft when nothing changes. */
export function setFace(d: PadDraft, limits: PadLimits, die: DieColor, face: PadFace, n: number): PadDraft {
  const now = d.counts[die][face] ?? 0;
  const next = Math.max(0, Math.min(Math.max(now, faceMax(d.counts, limits, die, face)), Math.trunc(n)));
  if (next === now) return d;
  const faces = { ...d.counts[die] };
  if (next === 0) delete faces[face];
  else faces[face] = next;
  return withHistory(d, { ...d.counts, [die]: faces });
}

/** A tap: one more of this face, if the pool has room. */
export function tapFace(d: PadDraft, limits: PadLimits, die: DieColor, face: PadFace): PadDraft {
  if (faceMax(d.counts, limits, die, face) <= (d.counts[die][face] ?? 0)) return d;
  return setFace(d, limits, die, face, (d.counts[die][face] ?? 0) + 1);
}

/** Steps back one pad change. */
export function undoTap(d: PadDraft): PadDraft {
  const prev = d.history[d.history.length - 1];
  if (prev === undefined) return d;
  return { ...d, counts: prev, history: d.history.slice(0, -1) };
}

/** Removes every entered face (undoable). */
export function clearPad(d: PadDraft): PadDraft {
  if (entered(d.counts).total === 0) return d;
  return withHistory(d, { white: {}, black: {} });
}

/** One more (or fewer) extra die of a colour, never below 0. */
export function addExtra(d: PadDraft, die: DieColor, delta: number): PadDraft {
  const next = Math.max(0, d.extra[die] + delta);
  if (next === d.extra[die]) return d;
  return { ...d, extra: { ...d.extra, [die]: next } };
}

export interface PadMeter {
  entered: number;
  total: number;
  blank: number;
  /** "6 of 8 dice entered · 2 blank" */
  text: string;
}

export function padMeter(counts: PadCounts, limits: PadLimits): PadMeter {
  const n = entered(counts).total;
  const blank = Math.max(0, limits.total - n);
  return { entered: n, total: limits.total, blank, text: `${n} of ${limits.total} dice entered · ${blank} blank` };
}

/**
 * The attack panel's one polite live region (the meter, tally and verdict each update on every tap; announcing all
 * of them would talk over the player): the meter and the verdict (or the engine's refusal), or the problem when the
 * dice don't fit the pool.
 */
export function padSummary(meter: PadMeter, issue: string | null, status: string | null): string {
  if (issue !== null) return `Too many dice: ${issue}`;
  return status === null ? meter.text : `${meter.text}. ${status}`;
}

/** Why the entered dice can't be the roll (more than the pool after a live change), or null. */
export function padIssue(counts: PadCounts, limits: PadLimits): string | null {
  const e = entered(counts);
  if (e.total > limits.total) return `${e.total} dice entered, but the pool has ${limits.total}: remove ${e.total - limits.total}`;
  for (const die of ['white', 'black'] as const) {
    if (e[die] > limits[die]) return `${e[die]} ${die} dice entered, but the pool has ${limits[die]}: remove ${e[die] - limits[die]}`;
  }
  return null;
}

/**
 * The roll instruction in words, with one bracket for the notes: "2 white, 2 black (+1 of your choice)",
 * "4 black (1 extra)", "3 white, 3 black (+1 of your choice, 2 extra)", "1 of your choice", "no dice".
 */
export function rollWords(pool: DicePool, extra: PadDraft['extra']): string {
  const white = pool.white + extra.white;
  const black = pool.black + extra.black;
  const parts: string[] = [];
  const notes: string[] = [];
  if (white > 0) parts.push(`${white} white`);
  if (black > 0) parts.push(`${black} black`);
  if (pool.choice > 0) {
    if (parts.length === 0) parts.push(`${pool.choice} of your choice`);
    else notes.push(`+${pool.choice} of your choice`);
  }
  if (parts.length === 0) return 'no dice';
  const added = extra.white + extra.black;
  if (added > 0) notes.push(`${added} extra`);
  return notes.length === 0 ? parts.join(', ') : `${parts.join(', ')} (${notes.join(', ')})`;
}

/** "Resolve (2 blank)": the primary button names the dice the player did not tap. */
export function resolveLabel(blank: number): string {
  return blank === 0 ? 'Resolve (no blanks)' : `Resolve (${blank} blank)`;
}

/** The engine's DiceEntry: every face of both colours, blanks 0 (they add nothing). */
export function padDice(counts: PadCounts): DiceEntry {
  const w = counts.white;
  const b = counts.black;
  return {
    white: { blank: 0, aim: w.aim ?? 0, aim2: w.aim2 ?? 0, damage: w.damage ?? 0, crit: w.crit ?? 0 },
    black: { blank: 0, aim: b.aim ?? 0, aimDamage: b.aimDamage ?? 0, damage: b.damage ?? 0, damage2: b.damage2 ?? 0, crit: b.crit ?? 0 },
  };
}

const whole = (x: unknown, min: number): number | null => (typeof x === 'number' && Number.isInteger(x) && x >= min ? x : null);

function sanitizeCounts(raw: unknown): PadCounts | null {
  if (!isRecord(raw)) return null;
  const out: PadCounts = { white: {}, black: {} };
  for (const die of ['white', 'black'] as const) {
    const faces = raw[die];
    if (!isRecord(faces)) continue;
    for (const face of PAD_FACES[die]) {
      const n = whole(faces[face], 1);
      if (n !== null) out[die][face] = n;
    }
  }
  return out;
}

/** A stored pad draft, or null when it is none; bad parts fall back to empty. */
export function sanitizePad(raw: unknown): PadDraft | null {
  if (!isRecord(raw)) return null;
  const extra = isRecord(raw.extra) ? raw.extra : {};
  const adjust = isRecord(raw.adjust) ? raw.adjust : {};
  const int = (x: unknown): number => (typeof x === 'number' && Number.isInteger(x) ? x : 0);
  return {
    counts: sanitizeCounts(raw.counts) ?? EMPTY_PAD.counts,
    extra: { white: whole(extra.white, 0) ?? 0, black: whole(extra.black, 0) ?? 0 },
    adjust: { aim: int(adjust.aim), damage: int(adjust.damage), crit: int(adjust.crit) },
    history: Array.isArray(raw.history) ? raw.history.flatMap((h) => sanitizeCounts(h) ?? []).slice(-HISTORY_KEPT) : [],
  };
}

/**
 * The pad draft's name: attacker, defender, round, attack step and target; null while no target is chosen. Not the
 * fleets' hash (`combatKey`): ships added mid-attack (Panther, the tools) must not wipe the attacker's taps. A
 * cancelled combat's pad cannot leak into the next one: every stage draft is dropped once no combat runs.
 */
export function rollDraftName(c: CombatState): string | null {
  if (c.stage !== 'attack' || c.step === null || c.attack === null || c.attack.target === null) return null;
  return `combat-roll:${c.attacker}-${c.defender}:r${c.round}:${c.step.orbit}-${c.step.side}:${c.attack.target}`;
}

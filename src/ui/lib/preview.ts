/**
 * Live previews for action sheets: run the engine's `apply` locally on the current game and my private doc with
 * the draft command (it clones its inputs, so nothing live changes), then diff my player before and after.
 * The sheet footer shows the changes ("ISK 12→5", "Minerals 11→12/12", "+6 ISK → 49 (2 lost)") or the rule error,
 * and the Confirm button names the consequence ("Build Heretic · −4 ISK · −1 Trit").
 */
import { ISK_CAP, MAX_CUBES, MINERAL_CAP } from '../../data/costs';
import { SHIPS } from '../../data/ships';
import { MINERALS, type FactionId, type ResourceKey, type StructureType } from '../../data/types';
import { apply } from '../../engine/apply';
import { isError, type ApplyResult, type Command, type GameState, type PlayerPrivate, type PlayerPublic, type RuleError } from '../../engine/types';
import { centralWords, RESOURCE_LABEL, signed, STRUCTURE_LABEL } from './labels';

export type ResKey = ResourceKey | 'vp';

export type Change =
  | { kind: 'res'; key: ResKey; before: number; after: number }
  /** Total minerals (morphite included) against the 12 cap. */
  | { kind: 'minerals'; before: number; after: number; cap: number }
  /** ISK that would rise above the cap: `net` is the uncapped change, `lost` what the cap swallows. */
  | { kind: 'iskCap'; net: number; after: number; lost: number }
  | { kind: 'count'; id: string; label: string; before: number; after: number; max: number | null }
  | { kind: 'flag'; id: string; label: string; on: boolean };

export interface PreviewOk {
  ok: true;
  changes: Change[];
  result: ApplyResult;
  iskLost: number;
  /** Minerals above 12 after the command (the player will have to discard them). */
  mineralsOver: number;
}
export interface PreviewError {
  ok: false;
  error: RuleError;
}
export type Preview = PreviewOk | PreviewError;

export interface PreviewInput {
  game: GameState;
  priv: PlayerPrivate | null;
  faction: FactionId;
  uid: string;
  now: number;
}

/** Short names for Confirm labels ("−1 Trit"). */
export const SHORT_LABEL: Record<ResKey, string> = {
  isk: 'ISK',
  vp: 'VP',
  pyrite: 'Pyr',
  mexallon: 'Mex',
  tritanium: 'Trit',
  morphite: 'Morph',
  planetary: 'Planetary',
  moon: 'Moon',
  component: 'Comp',
};

const MATERIAL_KEYS: ResourceKey[] = ['planetary', 'moon', 'component'];
const STRUCTURE_KEYS: StructureType[] = ['engineering', 'citadel', 'customs', 'refinery'];
const SHIP_NAME = new Map(SHIPS.map((s) => [s.id, s.name]));

function failure(code: string, message: string): PreviewError {
  return { ok: false, error: { error: true, code, message } };
}

export function mineralSum(p: PlayerPublic): number {
  return MINERALS.reduce((n, m) => n + p.res[m], 0);
}

/**
 * ISK the cap swallows, from the identity after = before + net − lost. `net` is the command's uncapped ISK change
 * (sales minus purchases minus the cube, a discovery's ISK, an adjustment); null when unknown (then 0).
 */
export function iskLost(before: number, after: number, net: number | null): number {
  return net === null ? 0 : Math.max(0, before + net - after);
}

/** What changed for one player (and their private doc), in a fixed reading order; `seats` names the central flag. */
export function diffPlayer(
  b: PlayerPublic,
  a: PlayerPublic,
  privBefore: PlayerPrivate | null,
  privAfter: PlayerPrivate | null,
  seats = 0,
): Change[] {
  const out: Change[] = [];
  const res = (key: ResKey, before: number, after: number) => {
    if (before !== after) out.push({ kind: 'res', key, before, after });
  };
  const count = (id: string, label: string, before: number, after: number, max: number | null = null) => {
    if (before !== after) out.push({ kind: 'count', id, label, before, after, max });
  };

  res('isk', b.res.isk, a.res.isk);
  res('vp', b.vp, a.vp);
  for (const m of MINERALS) res(m, b.res[m], a.res[m]);
  if (MINERALS.some((m) => b.res[m] !== a.res[m])) {
    out.push({ kind: 'minerals', before: mineralSum(b), after: mineralSum(a), cap: MINERAL_CAP });
  }
  for (const m of MATERIAL_KEYS) res(m, b.res[m], a.res[m]);
  if (privBefore !== null && privAfter !== null) count('research', 'Research to place', privBefore.pendingResearch, privAfter.pendingResearch);
  count('systems', 'Systems', b.systems, a.systems);
  if (b.central !== a.central) out.push({ kind: 'flag', id: 'central', label: centralWords(seats).name, on: a.central });
  for (const s of STRUCTURE_KEYS) count(`structure:${s}`, STRUCTURE_LABEL[s], b.structures[s], a.structures[s]);
  count('homeCitadels', 'Home citadels', b.homeCitadels, a.homeCitadels);
  for (const m of MINERALS) count(`belt:${m}`, `${RESOURCE_LABEL[m]} belts`, b.belts[m], a.belts[m]);
  count('lockedHomeBelts', 'Locked home belts', b.lockedHomeBelts, a.lockedHomeBelts);
  const ids = [...new Set([...Object.keys(b.ships), ...Object.keys(a.ships)])];
  for (const id of ids) count(`ship:${id}`, SHIP_NAME.get(id) ?? id, b.ships[id] ?? 0, a.ships[id] ?? 0);
  count('cubes', 'Cubes', b.cubesUsed, a.cubesUsed, MAX_CUBES);
  return out;
}

/**
 * Runs `cmd` as `faction` on a private copy of the game. `iskNet` (the command's uncapped ISK change, when the
 * sheet knows it) lets the preview say how much ISK the 49 cap would swallow.
 */
export function previewCommand(input: PreviewInput, cmd: Command, iskNet: number | null = null): Preview {
  let r: ApplyResult | RuleError;
  try {
    r = apply(input.game, cmd, { actor: input.faction, uid: input.uid, priv: input.priv, now: input.now });
  } catch {
    return failure('preview_failed', "This can't be previewed");
  }
  if (isError(r)) return { ok: false, error: r };
  const before = input.game.players[input.faction];
  const after = r.game.players[input.faction];
  if (before === undefined || after === undefined) return failure('not_seated', 'You are not seated in this game');
  const privAfter = r.privOwner === input.faction ? r.priv : input.priv;
  const changes = diffPlayer(before, after, input.priv, privAfter, input.game.seats.length);
  const lost = iskLost(before.res.isk, after.res.isk, iskNet);
  if (lost > 0 && iskNet !== null) {
    const capped: Change = { kind: 'iskCap', net: iskNet, after: after.res.isk, lost };
    const at = changes.findIndex((c) => c.kind === 'res' && c.key === 'isk');
    if (at >= 0) changes[at] = capped;
    else changes.unshift(capped);
  }
  return { ok: true, changes, result: r, iskLost: lost, mineralsOver: Math.max(0, mineralSum(after) - MINERAL_CAP) };
}

const resName = (k: ResKey): string => (k === 'vp' ? 'VP' : RESOURCE_LABEL[k]);

/** "ISK 12→5", "Minerals 11→12/12", "+6 ISK → 49 (2 lost)", "Systems 3→4", "Central system: yours". */
export function changeText(c: Change): string {
  switch (c.kind) {
    case 'res':
      return `${resName(c.key)} ${c.before}→${c.after}`;
    case 'minerals':
      return c.before === c.after ? `Minerals ${c.after}/${c.cap}` : `Minerals ${c.before}→${c.after}/${c.cap}`;
    case 'iskCap':
      return `${signed(c.net)} ISK → ${c.after} (${c.lost} lost)`;
    case 'count':
      return c.max === null ? `${c.label} ${c.before}→${c.after}` : `${c.label} ${c.before}→${c.after}/${c.max}`;
    case 'flag':
      return `${c.label}: ${c.on ? 'yours' : 'given up'}`;
  }
}

/** Whether the change breaks or brushes a cap (shown in warn style with an icon and words). */
export function isCapWarning(c: Change): boolean {
  return c.kind === 'iskCap' || (c.kind === 'minerals' && c.after > c.cap) || (c.kind === 'res' && c.key === 'isk' && c.after >= ISK_CAP && c.after > c.before);
}

/** Keeps a number with its unit when a label wraps ("−6 ISK" never splits). */
const NBSP = '\u00a0';

/** The deltas worth naming on a Confirm button, as "+4 ISK", "−1 Trit", "+1 system", "+2 research". */
function deltaWords(c: Change): string | null {
  switch (c.kind) {
    case 'res':
      return `${signed(c.after - c.before)}${NBSP}${SHORT_LABEL[c.key]}`;
    case 'iskCap':
      return `${signed(c.net - c.lost)}${NBSP}ISK`; // what actually arrives
    case 'count': {
      const d = c.after - c.before;
      if (c.id === 'systems') return `${signed(d)}${NBSP}${Math.abs(d) === 1 ? 'system' : 'systems'}`;
      if (c.id === 'research') return `${signed(d)}${NBSP}research`;
      return null;
    }
    default:
      return null;
  }
}

/**
 * "Build Heretic · −4 ISK · −1 Trit": the action plus its first `max` resource deltas, and "+2 more" when there are
 * more of them (the preview above the button lists them all).
 */
export function consequence(head: string, changes: readonly Change[], max = 3): string {
  const words = changes.map(deltaWords).filter((w): w is string => w !== null);
  const more = words.length - max;
  return [head, ...words.slice(0, max), ...(more > 0 ? [`+${more}${NBSP}more`] : [])].join(' · ');
}

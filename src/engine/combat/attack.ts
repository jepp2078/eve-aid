/**
 * One attack: the side whose step it is picks a target, enters the faces it rolled, and the
 * engine applies the abilities, the lock-on, damage and kills; after a kill the remaining aims and damage may go on
 * to further ships in the destroyed ship's orbit (overflow).
 *
 * Roll totals: each face's aim/damage/crit (`FACE_VALUE`, a crit is also 1 damage) plus the adjusters (a crit
 * adjustment is a crit that also deals 1 damage), each at least 0. Then the attacking orbit leader's abilities: crit
 * effects (HAC +aim per crit, Black Ops/Marauder +damage per crit, Sabre +1 once), Ishtar +1 aim, Cerberus +1 damage
 * against another orbit; and each distinct enemy `enemyAimFromOrbit` in the attacking orbit (Rook -1 aim).
 * Locked when aims ≥ the target's effective DIF from the attacking orbit; damage tokens = damage − effective RED
 * (at most the HP left); destroyed when the damage reaches HP.
 * Overflow after a kill: aims − DIF and damage − RED − HP left, + the leader's `killBonus` once per attack; with
 * `killZeroDif` (Vargur) the next targets' DIF counts as 0.
 */
import { BLACK_FACES, FACE_VALUE, WHITE_FACES } from '../../data/dice';
import { ship as shipData } from '../../data/ships';
import type { BlackFace, FactionId, Orbit, WhiteFace } from '../../data/types';
import type { AttackResult, Command, CombatShip, CombatState, Ctx, DiceEntry, GameState, Side } from '../types';
import { factionName, fail, needActor, type Out } from '../util';
import { distinctNames, effDif, effectsOfKind, effStats, leaderOf, opponent, shipEffects } from './abilities';
import { advanceStep, isTargetable, markDestroyed, shipLabel } from './flow';
import { needCombat, needSide, needStage } from './setup';

type Cmd<T extends Command['type']> = Extract<Command, { type: T }>;
type Attack = NonNullable<CombatState['attack']>;
type Step = NonNullable<CombatState['step']>;

/** Aims and damage left after a kill, and whether the next targets' DIF counts as 0. */
export type Overflow = NonNullable<Attack['overflow']>;
export interface Adjust {
  aim: number;
  damage: number;
  crit: number;
}
/** An attack's result plus the overflow it leaves (null unless it destroyed its target). */
export type ResolvedAttack = AttackResult & { overflow: Overflow | null };

/** How many attack results the combat keeps (newest last). */
export const RESULTS_KEPT = 12;

const WHITE = [...new Set(WHITE_FACES)];
const BLACK = [...new Set(BLACK_FACES)];
const signed = (n: number): string => (n > 0 ? `+${n}` : String(n));
const plural = (n: number, one: string): string => `${n} ${n === 1 ? one : `${one}s`}`;

interface Strike {
  aims: number;
  damage: number;
  crits: number;
  notes: string[];
  /** This strike counts the target's DIF as 0 (an overflow after a Vargur kill), and so does the overflow it leaves. */
  ignoreDif: boolean;
  /** When this strike kills: extra overflow aims/damage (Zealot), an overflow that ignores DIF (Vargur), their notes. */
  onKill: { aim: number; damage: number; ignoreDif: boolean; notes: string[] };
}

const NO_KILL_EFFECTS: Strike['onKill'] = { aim: 0, damage: 0, ignoreDif: false, notes: [] };

/** Lock-on, damage and kill of one strike on `t` (pure). */
function strike(g: GameState, c: CombatState, side: Side, orbit: Orbit, t: CombatShip, s: Strike): ResolvedAttack {
  const dif = s.ignoreDif ? 0 : effDif(g, c, t, orbit);
  const red = effStats(g, c, t).red;
  const hpLeft = Math.max(0, shipData(t.ship).hp - t.damage);
  const locked = s.aims >= dif;
  const beyond = locked ? Math.max(0, s.damage - red) : 0;
  const killed = locked && hpLeft > 0 && beyond >= hpLeft;
  const notes = [...s.notes];
  let overflow: Overflow | null = null;
  if (killed) {
    const k = s.onKill;
    overflow = { aims: s.aims - dif + k.aim, damage: s.damage - red - hpLeft + k.damage, zeroDif: s.ignoreDif || k.ignoreDif };
    notes.push(...k.notes);
  }
  return {
    side, orbit, target: t.uid, aims: s.aims, damage: s.damage, crits: s.crits, dif, red, locked,
    dealt: Math.min(beyond, hpLeft), destroyed: killed ? [t.uid] : [], notes, overflow,
  };
}

/**
 * The result of `side`'s attack from `orbit` on `target` (a uid) with these dice and adjusters (pure; see the file
 * comment). Usable as a live preview; `combatRoll` applies it.
 */
export function resolveRoll(
  g: GameState, c: CombatState, side: Side, orbit: Orbit, target: string, dice: DiceEntry, adjust: Adjust,
): ResolvedAttack {
  const t = c.ships.find((s) => s.uid === target);
  if (t === undefined) fail('bad_target', 'Choose a ship in this battle');
  let aims = 0;
  let damage = 0;
  let crits = 0;
  for (const faces of [dice.white, dice.black] as Record<string, number>[]) {
    for (const [face, n] of Object.entries(faces)) {
      if (!Object.hasOwn(FACE_VALUE, face)) continue;
      const v = FACE_VALUE[face as WhiteFace | BlackFace];
      aims += v.aim * n;
      damage += v.damage * n;
      crits += v.crit * n;
    }
  }
  const notes: string[] = [];
  const adjusted = (['aim', 'damage', 'crit'] as const).filter((k) => adjust[k] !== 0).map((k) => `${signed(adjust[k])} ${k}`);
  if (adjusted.length > 0) notes.push(`Adjusted: ${adjusted.join(', ')}`);
  // A negative crit adjustment removes at most the crits rolled (each with its 1 damage).
  const critAdjust = Math.max(adjust.crit, -crits);
  aims = Math.max(0, aims + adjust.aim);
  damage = Math.max(0, damage + adjust.damage + critAdjust);
  crits += critAdjust;

  const onKill: Strike['onKill'] = { aim: 0, damage: 0, ignoreDif: false, notes: [] };
  const leader = leaderOf(c, side, orbit);
  if (leader !== null) {
    const name = shipData(leader.ship).name;
    const large = shipData(t.ship).size === 'large';
    if (crits > 0) {
      for (const { entry } of shipEffects(g, c, leader, 'critAim')) {
        const n = entry.effect.perCrit * crits;
        aims += n;
        notes.push(`${name}: +${n} aim (${plural(crits, 'crit')})`);
      }
      for (const { entry } of shipEffects(g, c, leader, 'critDamage')) {
        const n = (large ? entry.effect.perCritVsLarge : entry.effect.perCrit) * crits;
        damage += n;
        notes.push(`${name}: +${n} damage (${plural(crits, 'crit')}${large ? ' against a large ship' : ''})`);
      }
      for (const { entry } of shipEffects(g, c, leader, 'critDamageOnce')) {
        damage += entry.effect.amount;
        notes.push(`${name}: +${entry.effect.amount} damage (crit)`);
      }
    }
    for (const { entry } of shipEffects(g, c, leader, 'aimBonus')) {
      aims += entry.effect.amount;
      notes.push(`${name}: ${signed(entry.effect.amount)} aim`);
    }
    if (t.orbit !== orbit) {
      for (const { entry } of shipEffects(g, c, leader, 'damageVsOtherOrbit')) {
        damage += entry.effect.amount;
        notes.push(`${name}: ${signed(entry.effect.amount)} damage (target in another orbit)`);
      }
    }
    for (const { entry } of shipEffects(g, c, leader, 'killBonus')) {
      onKill.aim += entry.effect.aim;
      onKill.damage += entry.effect.damage;
      onKill.notes.push(`${name}: +${entry.effect.aim} aim and +${entry.effect.damage} damage after the kill`);
    }
    if (shipEffects(g, c, leader, 'killZeroDif').length > 0) {
      onKill.ignoreDif = true;
      onKill.notes.push(`${name}: overflow ignores DIF`);
    }
  }
  const debuffs = effectsOfKind(g, c, opponent(side), 'enemyAimFromOrbit').filter((e) => e.ship.orbit === orbit);
  for (const e of distinctNames(debuffs)) {
    aims += e.entry.effect.amount;
    notes.push(`${shipData(e.ship.ship).name}: ${signed(e.entry.effect.amount)} aim`);
  }
  return strike(g, c, side, orbit, t, { aims: Math.max(0, aims), damage: Math.max(0, damage), crits, notes, ignoreDif: false, onKill });
}

/** The overflow `o` applied to `t` (pure): no crits, no kill bonus again (once per attack); DIF 0 when `o.zeroDif`. */
function resolveOverflow(g: GameState, c: CombatState, step: Step, t: CombatShip, o: Overflow): ResolvedAttack {
  return strike(g, c, step.side, step.orbit, t, {
    aims: o.aims, damage: o.damage, crits: 0, notes: [o.zeroDif ? 'Overflow (DIF counts as 0)' : 'Overflow'],
    ignoreDif: o.zeroDif, onKill: NO_KILL_EFFECTS,
  });
}

/**
 * Uids of the ships the pending overflow can go to: enemies of the attacking side in the destroyed ship's orbit
 * (`attack.target`), still in the battle, whose effective DIF (0 with `zeroDif`) is within the remaining aims and whose
 * effective RED is below the remaining damage. Empty when no overflow is pending. A Vanguard Ship orbit's supports can
 * take it: Vanguard Ship only stops them being an attack's target (official errata: excess damages "ships", not
 * "targets").
 */
export function overflowCandidates(g: GameState, c: CombatState): string[] {
  const { attack, step } = c;
  if (attack === null || step === null || attack.overflow === null || attack.target === null) return [];
  const o = attack.overflow;
  const dead = c.ships.find((s) => s.uid === attack.target);
  if (dead === undefined) return [];
  return c.ships
    .filter(
      (s) =>
        s.side !== step.side && s.orbit === dead.orbit && !s.removed && !s.destroyed &&
        (o.zeroDif ? 0 : effDif(g, c, s, step.orbit)) <= o.aims && o.damage > effStats(g, c, s).red,
    )
    .map((s) => s.uid);
}

// ---------------------------------------------------------------------------------------------------------------
// handlers

/** The attack in progress, which must be the actor's step. */
function needStep(g: GameState, ctx: Ctx): { f: FactionId; c: CombatState; side: Side; step: Step; attack: Attack } {
  const f = needActor(g, ctx);
  const c = needCombat(g);
  const side = needSide(c, f);
  needStage(c, 'attack');
  const { step, attack } = c;
  if (step === null || attack === null) fail('wrong_stage', 'No attack is in progress');
  if (step.side !== side) fail('not_your_step', `It is ${factionName(c.sides[step.side].faction)}'s ${step.orbit}-orbit attack`);
  return { f, c, side, step, attack };
}

/** An enemy ship `side` may target now; `bad_target` / `untargetable`. */
function checkTarget(c: CombatState, side: Side, uid: unknown): CombatShip {
  const t = typeof uid === 'string' ? c.ships.find((s) => s.uid === uid) : undefined;
  if (t === undefined || t.side === side || t.removed || t.destroyed) fail('bad_target', 'Target an enemy ship that is still in the battle');
  if (!isTargetable(c, t)) fail('untargetable', `${shipLabel(c, t)} supports the ${t.orbit} orbit, which a Vanguard Ship protects`);
  return t;
}

function faceCounts<F extends string>(raw: unknown, allowed: F[], colour: string): Record<F, number> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) fail('bad_dice', `Enter the ${colour} dice as counts per face`);
  for (const [face, n] of Object.entries(raw)) {
    if (!(allowed as string[]).includes(face)) fail('bad_dice', `A ${colour} die has no "${face}" face`);
    if (!Number.isInteger(n) || (n as number) < 0) fail('bad_dice', 'Dice counts must be whole numbers of 0 or more');
  }
  const counts = raw as Record<string, number>;
  return Object.fromEntries(allowed.map((face) => [face, Object.hasOwn(counts, face) ? counts[face] : 0])) as Record<F, number>;
}

function checkDice(raw: unknown): DiceEntry {
  if (typeof raw !== 'object' || raw === null) fail('bad_dice', 'Enter the dice you rolled');
  const { white, black } = raw as Record<string, unknown>;
  return { white: faceCounts(white, WHITE, 'white'), black: faceCounts(black, BLACK, 'black') };
}

function checkAdjust(raw: unknown): Adjust {
  if (typeof raw !== 'object' || raw === null) fail('bad_amount', 'The adjustments are missing');
  const a = raw as Record<string, unknown>;
  const whole = (k: keyof Adjust): number => {
    const n = a[k] ?? 0;
    if (!Number.isInteger(n)) fail('bad_amount', `The ${k} adjustment must be a whole number`);
    return n as number;
  };
  return { aim: whole('aim'), damage: whole('damage'), crit: whole('crit') };
}

/** Applies a strike to its target, records the result and counts a kill. */
function land(c: CombatState, t: CombatShip, r: ResolvedAttack): void {
  const result: AttackResult = {
    side: r.side, orbit: r.orbit, target: r.target, aims: r.aims, damage: r.damage, crits: r.crits, dif: r.dif, red: r.red,
    locked: r.locked, dealt: r.dealt, destroyed: r.destroyed, notes: r.notes,
  };
  t.damage += r.dealt;
  if (r.destroyed.length > 0) markDestroyed(c, t, true);
  c.results.push(result);
  if (c.results.length > RESULTS_KEPT) c.results.splice(0, c.results.length - RESULTS_KEPT);
}

/** "destroyed Caldari's Crow (3 damage against RED 0)" and the like. */
function effect(c: CombatState, t: CombatShip, r: AttackResult): string {
  const vs = `(${r.damage} damage against RED ${r.red})`;
  if (r.destroyed.length > 0) return `destroyed ${shipLabel(c, t)} ${vs}`;
  if (r.dealt === 0) return `hit ${shipLabel(c, t)} but did no damage ${vs}`;
  return `hit ${shipLabel(c, t)} for ${r.dealt} damage ${vs}`;
}

/** After a strike: keep the overflow pending while it can reach a ship, else move on to the next step. */
function afterStrike(g: GameState, c: CombatState, attack: Attack, r: ResolvedAttack, out: Out): void {
  attack.overflow = r.overflow;
  if (r.overflow !== null && overflowCandidates(g, c).length > 0) return;
  attack.overflow = null;
  advanceStep(g, c, out);
}

/** The side whose step it is picks (or changes) its target: an enemy ship still in the battle and targetable. */
export function combatTarget(g: GameState, cmd: Cmd<'combatTarget'>, ctx: Ctx, out: Out): void {
  const { f, c, side, attack } = needStep(g, ctx);
  if (attack.overflow !== null) fail('overflow_pending', 'Choose where the remaining damage goes first');
  const t = checkTarget(c, side, cmd.target);
  attack.target = t.uid;
  out.lines.push(`${factionName(f)} targets ${shipLabel(c, t)} (${t.orbit} orbit)`);
}

/** The side whose step it is enters its roll; the attack on its target is resolved (see `resolveRoll`). */
export function combatRoll(g: GameState, cmd: Cmd<'combatRoll'>, ctx: Ctx, out: Out): void {
  const { f, c, side, step, attack } = needStep(g, ctx);
  if (attack.overflow !== null) fail('overflow_pending', 'Choose where the remaining damage goes first');
  if (attack.target === null) fail('no_target', 'Choose a target first');
  const t = checkTarget(c, side, attack.target);
  const dice = checkDice(cmd.dice);
  const adjust = checkAdjust(cmd.adjust);
  const r = resolveRoll(g, c, side, step.orbit, t.uid, dice, adjust);
  land(c, t, r);
  const who = `${factionName(f)}'s ${step.orbit}-orbit attack`;
  out.lines.push(
    r.locked ? `${who} ${effect(c, t, r)}` : `${who} on ${shipLabel(c, t)} missed (${plural(r.aims, 'aim')} against DIF ${r.dif})`,
  );
  afterStrike(g, c, attack, r, out);
}

/** The attacking side sends the remaining aims and damage to a candidate (`overflowCandidates`), or stops (null). */
export function combatOverflow(g: GameState, cmd: Cmd<'combatOverflow'>, ctx: Ctx, out: Out): void {
  const { f, c, step, attack } = needStep(g, ctx);
  const o = attack.overflow;
  if (o === null) fail('no_overflow', 'There is no remaining damage to assign');
  if (cmd.target === null || cmd.target === undefined) {
    out.lines.push(`${factionName(f)} lets the remaining damage go`);
    attack.overflow = null;
    advanceStep(g, c, out);
    return;
  }
  if (typeof cmd.target !== 'string' || !overflowCandidates(g, c).includes(cmd.target)) {
    fail('bad_target', 'The remaining aims and damage cannot reach that ship');
  }
  const t = c.ships.find((s) => s.uid === cmd.target) as CombatShip;
  const r = resolveOverflow(g, c, step, t, o);
  land(c, t, r);
  out.lines.push(`Overflow: ${factionName(f)}'s attack ${effect(c, t, r)}`);
  attack.target = t.uid;
  afterStrike(g, c, attack, r, out);
}

/** The side whose step it is skips its attack (e.g. nothing worth targeting after a manual change). */
export function combatContinue(g: GameState, _cmd: Cmd<'combatContinue'>, ctx: Ctx, out: Out): void {
  const { f, c, step, attack } = needStep(g, ctx);
  if (attack.overflow !== null) fail('overflow_pending', 'Choose where the remaining damage goes, or let it go');
  out.lines.push(`${factionName(f)} skips its ${step.orbit}-orbit attack`);
  advanceStep(g, c, out);
}

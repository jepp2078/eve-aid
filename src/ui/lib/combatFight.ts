/**
 * Read models for the fighting part of a combat:
 *   - the attack: target rows with their DIF from the attacking orbit, the live tally of a draft roll and the verdict,
 *     breakdown and one-line summary of a resolved one (all from the engine's `resolveRoll` / `AttackResult`);
 *   - the reminders that apply to this attack, to the targeted ship, and to a lost ship (Panther);
 *   - what a retreat does, and each side's losses so far;
 *   - the end: strength by ship size plus bonuses (equal to the engine's), why the winner won, the rewards and what
 *     "Fleet cannot escape" adds;
 *   - the re-align draft (tap-tap like the fleet assignment) and the manual tools' small-ship picker.
 *
 * Every number comes from the engine; these functions only arrange and word it.
 */
import { ship as shipData, shipsOf as factionShips, type Ship } from '../../data/ships';
import { ORBITS, type FactionId, type Orbit, type ShipId } from '../../data/types';
import type { EffectTiming } from '../../data/shipEffects';
import {
  distinctNames,
  effDif,
  effectsOfKind,
  effStats,
  leaderOf,
  opponent,
  reminders,
  RETREAT_DIF,
  type ActiveOf,
} from '../../engine/combat/abilities';
import { overflowCandidates, type ResolvedAttack } from '../../engine/combat/attack';
import { attackerEarnsVP, computeOutcome, losses, strengthBreakdown, survivors, verdict as engineVerdict, type StrengthPart } from '../../engine/combat/end';
import { isTargetable, needsRealign } from '../../engine/combat/flow';
import { isOrbit, nameList, ROLES, sideOf } from '../../engine/combat/setup';
import type { AttackResult, Command, CombatOutcome, CombatShip, CombatState, GameState, Side } from '../../engine/types';
import { isRecord } from './drafts';
import { factionName, signed } from './labels';

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
const nameOf = (s: CombatShip): string => shipData(s.ship).name;
const hpLeft = (s: CombatShip): number => Math.max(0, shipData(s.ship).hp - s.damage);

/* ------------------------------------------------------------------ targets */

export interface TargetRow {
  s: CombatShip;
  /** Effective DIF against an attack from the attacking orbit. */
  dif: number;
  red: number;
  hp: number;
  hpLeft: number;
  destroyed: boolean;
  /** The engine lets an attack target it (not destroyed, not a Vanguard-protected support). */
  targetable: boolean;
}

/** The enemy ships still on the board, small → large and leader first, as `side` attacking from `orbit` sees them. */
export function targetRows(g: GameState, c: CombatState, side: Side, orbit: Orbit): TargetRow[] {
  return c.ships
    .filter((s) => s.side !== side && !s.removed)
    .sort((a, b) => ORBITS.indexOf(a.orbit) - ORBITS.indexOf(b.orbit) || (a.role === b.role ? 0 : a.role === 'leader' ? -1 : 1))
    .map((s) => ({
      s,
      dif: effDif(g, c, s, orbit),
      red: effStats(g, c, s).red,
      hp: shipData(s.ship).hp,
      hpLeft: hpLeft(s),
      destroyed: s.destroyed,
      targetable: isTargetable(c, s),
    }));
}

export interface OverflowRow {
  s: CombatShip;
  /** Effective DIF for the carried aims (0 when the overflow ignores DIF). */
  dif: number;
  red: number;
  hp: number;
  hpLeft: number;
  /** The carried aims and damage can go to it (an engine overflow candidate). */
  reach: boolean;
  /** Why it is out of reach, or null. */
  why: string | null;
}

/** The enemy ships still fighting in the destroyed ship's orbit while an overflow is pending, leader first. */
export function overflowRows(g: GameState, c: CombatState): OverflowRow[] {
  const o = c.attack?.overflow ?? null;
  const step = c.step;
  const dead = c.ships.find((s) => s.uid === c.attack?.target);
  if (o === null || step === null || dead === undefined) return [];
  const reach = new Set(overflowCandidates(g, c));
  return c.ships
    .filter((s) => s.side !== step.side && s.orbit === dead.orbit && !s.removed && !s.destroyed)
    .sort((a, b) => (a.role === b.role ? 0 : a.role === 'leader' ? -1 : 1))
    .map((s) => {
      const dif = o.zeroDif ? 0 : effDif(g, c, s, step.orbit);
      const red = effStats(g, c, s).red;
      let why: string | null = null;
      if (!reach.has(s.uid)) {
        if (!isTargetable(c, s)) why = 'Protected by Vanguard Ship';
        else if (dif > o.aims) why = `DIF ${dif} is more than ${plural(o.aims, 'aim')}`;
        else why = `RED ${red} stops ${o.damage} damage`;
      }
      return { s, dif, red, hp: shipData(s.ship).hp, hpLeft: hpLeft(s), reach: reach.has(s.uid), why };
    });
}

/* ------------------------------------------------------------------ the live tally */

export interface Tally {
  /** "Aims 3 / DIF 2" */
  aims: string;
  locked: boolean;
  /** "Damage 4 − RED 1 = 3 → Rifter HP 3 · DESTROYED", "Damage 2 · no lock, no damage" */
  damage: string;
  destroyed: boolean;
  /** "Carry over: 2 aims, 1 damage · 1 ship in reach", while a kill leaves damage to carry; else null. */
  carry: string | null;
  /** The adjustments and automatic effects, each with its source ("Zealot: +1 aim (1 crit)"). */
  effects: string[];
}

/**
 * The tally of a draft roll (`resolveRoll` on the pad's dice) against `target` as it is now. `reach`: how many ships
 * the carried aims and damage could go to (from the engine's overflow candidates after the roll), when known.
 */
export function tally(r: ResolvedAttack, target: CombatShip, reach: number | null): Tally {
  const name = nameOf(target);
  const beyond = Math.max(0, r.damage - r.red);
  let damage: string;
  if (!r.locked) damage = `Damage ${r.damage} · no lock, no damage`;
  else if (beyond === 0) damage = `Damage ${r.damage} − RED ${r.red} = 0 → no damage`;
  else {
    const what = r.destroyed.length > 0 ? 'DESTROYED' : `${r.dealt} damage`;
    damage = `Damage ${r.damage} − RED ${r.red} = ${beyond} → ${name} HP ${hpLeft(target)} · ${what}`;
  }
  let carry: string | null = null;
  if (r.overflow !== null && r.overflow.damage > 0) {
    const o = r.overflow;
    const where = reach === null ? '' : reach === 0 ? ' · no ship in reach' : ` · ${plural(reach, 'ship')} in reach`;
    carry = `Carry over: ${plural(o.aims, 'aim')}, ${o.damage} damage${o.zeroDif ? ' (DIF counts as 0)' : ''}${where}`;
  }
  return { aims: `Aims ${r.aims} / DIF ${r.dif}`, locked: r.locked, damage, destroyed: r.destroyed.length > 0, carry, effects: r.notes };
}

/* ------------------------------------------------------------------ results */

export type VerdictTone = 'miss' | 'blocked' | 'hit' | 'kill';

/** "MISSED (2/3 aims)", "LOCKED · 3 DAMAGE · Rifter DESTROYED", "LOCKED · 1 DAMAGE on Golem", "LOCKED · NO DAMAGE (RED 3)". */
export function verdict(r: AttackResult, name: string): { head: string; tone: VerdictTone } {
  if (!r.locked) return { head: `MISSED (${r.aims}/${r.dif} aims)`, tone: 'miss' };
  if (r.destroyed.length > 0) return { head: `LOCKED · ${r.dealt} DAMAGE · ${name} DESTROYED`, tone: 'kill' };
  if (r.dealt > 0) return { head: `LOCKED · ${r.dealt} DAMAGE on ${name}`, tone: 'hit' };
  return { head: `LOCKED · NO DAMAGE (RED ${r.red})`, tone: 'blocked' };
}

/** The numbers behind a verdict, line by line, then the effects that changed them. */
export function resultBreakdown(r: AttackResult, name: string): string[] {
  const lines = [`Aims ${r.aims} against DIF ${r.dif}: ${r.locked ? 'locked' : 'missed'}`];
  const beyond = Math.max(0, r.damage - r.red);
  if (!r.locked) lines.push(`Damage ${r.damage}: no lock, so no damage`);
  else if (r.dealt === 0) lines.push(`Damage ${r.damage} − RED ${r.red} = 0: no damage`);
  else lines.push(`Damage ${r.damage} − RED ${r.red} = ${beyond}: ${plural(r.dealt, 'damage token')} on ${name}${r.destroyed.length > 0 ? ' (destroyed)' : ''}`);
  if (r.crits > 0) lines.push(`Crits: ${r.crits}`);
  return [...lines, ...r.notes];
}

/** An overflow strike (the remaining aims and damage of a kill) rather than a roll. */
const isOverflow = (r: AttackResult): boolean => r.notes.some((n) => n.startsWith('Overflow'));

/** The newest attack: its roll and the overflow strikes that followed it, oldest first (empty without results). */
export function attackChain(results: readonly AttackResult[]): AttackResult[] {
  let i = results.length - 1;
  while (i > 0 && isOverflow(results[i]!)) i -= 1;
  return i < 0 ? [] : results.slice(i);
}

/** A result card the player tapped open or shut, with the `collapsed` it was shown under at the time. */
export interface ResultToggle {
  open: boolean;
  under: boolean;
}

/**
 * Whether a result card is open: as the player left it, unless `collapsed` has changed since (a newer strike landed,
 * or the viewer's own attack began); then as `collapsed` says.
 */
export function resultOpen(toggle: ResultToggle | null, collapsed: boolean): boolean {
  return toggle !== null && toggle.under === collapsed ? toggle.open : !collapsed;
}

/** The ship an attack result is about (it may have left the board since). */
export function resultTarget(c: CombatState, r: AttackResult): CombatShip | null {
  return c.ships.find((s) => s.uid === r.target) ?? null;
}

/* ------------------------------------------------------------------ reminders */

function reminderText(e: ActiveOf<'reminder'>): string {
  const data = shipData(e.ship.ship);
  return `${data.name}: ${data.abilities.find((a) => a.slot === e.slot)?.text ?? ''}`;
}

/** The engine's reminders for `side` at `timing`, minus those of ships `keep` rejects (strategy cards always stay). */
function remindersWhere(g: GameState, c: CombatState, side: Side, timing: EffectTiming, keep: (e: ActiveOf<'reminder'>) => boolean): string[] {
  const effects = effectsOfKind(g, c, side, 'reminder').filter((e) => e.entry.effect.timing === timing);
  const kept = new Set(effects.filter(keep).map(reminderText));
  const dropped = new Set(effects.map(reminderText).filter((t) => !kept.has(t)));
  return reminders(g, c, side, timing).filter((t) => !dropped.has(t));
}

/**
 * Reminders for `side`'s attack from `orbit` at `timing` (`roll`, `kill`): leader-only abilities ("[Critical Damage]",
 * "Leader:") only from the attacking orbit's leader; a basic ability only for attacks from the orbit its ship is in
 * (the Fleet Commanders' "reroll … in its orbit"; their O2 says "all orbits" and stays); other abilities and the
 * strategy card as the engine lists them.
 */
export function attackReminders(g: GameState, c: CombatState, side: Side, timing: EffectTiming, orbit: Orbit): string[] {
  return remindersWhere(
    g, c, side, timing,
    (e) => (e.entry.role !== 'leader' || (e.ship.role === 'leader' && e.ship.orbit === orbit)) && (e.slot !== 'basic' || e.ship.orbit === orbit),
  );
}

/**
 * What stops the attacker rerolling against `target` (Sleipnir D2: "Enemies targeting it cannot reroll dice"): the
 * target's active "when targeted" abilities that say so, as "Sleipnir: …" lines. Shown to the attacker, who must not reroll.
 */
export function rerollBlockers(g: GameState, c: CombatState, target: CombatShip): string[] {
  return effectsOfKind(g, c, target.side, 'reminder')
    .filter((e) => e.entry.effect.timing === 'targeted' && e.ship.uid === target.uid)
    .map(reminderText)
    .filter((t) => /cannot reroll/i.test(t));
}

/**
 * "When it destroys" reminders (Flycatcher) for the attack that produced `r`, if it killed: those of the attacking
 * orbit's leader — judged with that leader back on the board when it was a wreck that has left since (a defender's
 * wreck leaves right after its attack).
 */
export function killReminders(g: GameState, c: CombatState, r: AttackResult): string[] {
  if (r.destroyed.length === 0) return [];
  let view = c;
  if (leaderOf(c, r.side, r.orbit) === null) {
    const gone = [...c.ships].reverse().find((s) => s.side === r.side && s.orbit === r.orbit && s.role === 'leader' && s.removed);
    if (gone !== undefined) view = { ...c, ships: c.ships.map((s) => (s.uid === gone.uid ? { ...s, removed: false } : s)) };
  }
  return attackReminders(g, view, r.side, 'kill', r.orbit);
}

/** Reminders for the owner of a targeted ship: that ship's own "when targeted" ability and Defensive Tactic. */
export function targetedReminders(g: GameState, c: CombatState, target: CombatShip): string[] {
  return remindersWhere(g, c, target.side, 'targeted', (e) => e.ship.uid === target.uid);
}

/**
 * Prompts of `side`'s destroyed ships ("Panther: If this ship is destroyed, … add up to two small ships"), for the
 * rest of the combat — also after the wreck has left the board (judged as if it were still there).
 */
export function lossReminders(g: GameState, c: CombatState, side: Side): { uid: string; text: string }[] {
  const view: CombatState = { ...c, ships: c.ships.map((s) => (s.side === side && s.destroyed ? { ...s, removed: false } : s)) };
  return effectsOfKind(g, view, side, 'reminder')
    .filter((e) => e.entry.effect.timing === 'destroyed' && e.ship.destroyed)
    .map((e) => ({ uid: e.ship.uid, text: reminderText(e) }));
}

/* ------------------------------------------------------------------ retreat and the round so far */

/** What a retreat by `side` does, as clauses: "round 2 becomes the last round", "you don't attack", … */
export function retreatConsequence(g: GameState, c: CombatState, side: Side): string[] {
  const dif = [{ amount: RETREAT_DIF, label: 'retreating' }];
  for (const e of distinctNames(effectsOfKind(g, c, opponent(side), 'enemyRetreatDif'))) {
    dif.push({ amount: e.entry.effect.amount, label: shipData(e.ship.ship).name });
  }
  const total = dif.reduce((n, d) => n + d.amount, 0);
  const why = dif.length > 1 ? ` (${dif.map((d) => `${signed(d.amount)} ${d.label}`).join(', ')})` : '';
  return [
    c.round >= c.lastRound ? `round ${c.round} is the last round anyway` : `round ${c.round} becomes the last round`,
    "you don't attack",
    `your ships get ${signed(total)} DIF${why}`,
    'you lose the combat',
  ];
}

/** One side's losses and the damage on its survivors: "Lost: Crow + Buzzard", "Damage: Golem 2/6". */
export function battleSoFar(c: CombatState, side: Side): { lost: string; damage: string } {
  const lost = losses(c, side);
  const hurt = survivors(c, side).filter((s) => s.damage > 0);
  return {
    lost: lost.length === 0 ? 'No ships lost' : `Lost: ${nameList(lost.map((s) => s.ship))}`,
    damage: hurt.length === 0 ? 'No damage' : `Damage: ${hurt.map((s) => `${nameOf(s)} ${s.damage}/${shipData(s.ship).hp}`).join(', ')}`,
  };
}

/* ------------------------------------------------------------------ the end */

export interface StrengthParts {
  total: number;
  parts: { label: string; amount: number }[];
}

/** A strength part in words: "2 small ships", "home system", "2 upgraded citadels", "Guerilla Warfare". */
function partLabel(x: StrengthPart): string {
  switch (x.kind) {
    case 'ships':
      return plural(x.count, `${x.size} ship`);
    case 'home':
      return 'home system';
    case 'citadels':
      return plural(x.count, x.upgraded ? 'upgraded citadel' : 'citadel');
    case 'guerilla':
      return 'Guerilla Warfare';
  }
}

/** A side's strength as the engine counts it (`strengthBreakdown`), with each part in words. */
export function strengthParts(g: GameState, c: CombatState, side: Side): StrengthParts {
  const b = strengthBreakdown(g, c, side);
  return { total: b.total, parts: b.parts.map((x) => ({ label: partLabel(x), amount: x.amount })) };
}

/** "7 = 2 small ships (2) + 1 medium ship (3) + home system (2)", or "0: no ships left". */
export function strengthText(s: StrengthParts): string {
  if (s.parts.length === 0) return '0: no ships left';
  return `${s.total} = ${s.parts.map((p) => `${p.label} (${p.amount})`).join(' + ')}`;
}

/** Why the winner won: "Strength 3 against 1", "Strength 1 each: a tie goes to the defender", "Amarr retreated". */
export function outcomeReason(c: CombatState, o: CombatOutcome): string {
  if (c.retreatedSide === null && o.strength.attacker === 0 && o.strength.defender === 0) return 'Both fleets are gone: the defender wins';
  const v = engineVerdict(c, o).replace(/^\(|\)$/g, '');
  return v.charAt(0).toUpperCase() + v.slice(1);
}

export interface NoEscape {
  side: Side;
  faction: FactionId;
  /** The loser's survivors, destroyed when its fleet cannot escape. */
  ships: ShipId[];
  /** Event cards and insurance ISK that adds. */
  extraCards: number;
  extraIsk: number;
}

/** What "Fleet cannot escape" adds (combatFinish noEscape); null when the loser has no survivors. */
export function noEscapeEffect(g: GameState, c: CombatState, o: CombatOutcome): NoEscape | null {
  const side = opponent(o.winner);
  const stranded = survivors(c, side);
  if (stranded.length === 0) return null;
  const gone = new Set(stranded.map((s) => s.uid));
  const after = computeOutcome(g, { ...c, ships: c.ships.map((s) => (gone.has(s.uid) ? { ...s, destroyed: true, damage: shipData(s.ship).hp } : s)) });
  const f = c.sides[side].faction;
  return {
    side,
    faction: f,
    ships: stranded.map((s) => s.ship),
    extraCards: after.events[side] - o.events[side],
    extraIsk: (after.insurance[f] ?? 0) - (o.insurance[f] ?? 0),
  };
}

export interface RewardLine {
  faction: FactionId;
  kind: 'vp' | 'isk' | 'cards' | 'lost' | 'move';
  text: string;
}

/** What finishing the combat does to each faction, as combatFinish applies it (VP, insurance, cards, losses, escape). */
export function rewardLines(g: GameState, c: CombatState, o: CombatOutcome, noEscape: boolean): RewardLine[] {
  const out: RewardLine[] = [];
  const winner = c.sides[o.winner].faction;
  const killed = losses(c, 'defender').length;
  const attackerVP = attackerEarnsVP(c, o.winner) ? 1 : 0;
  if (attackerVP > 0) out.push({ faction: c.attacker, kind: 'vp', text: `+1 VP: won the attack and destroyed ${plural(killed, 'ship')}` });
  if ((o.vp[winner] ?? 0) - (winner === c.attacker ? attackerVP : 0) > 0) out.push({ faction: winner, kind: 'vp', text: '+1 VP: Space Warlord' });
  const esc = noEscape ? noEscapeEffect(g, c, o) : null;
  const sides: Side[] = ['attacker', 'defender'];
  for (const side of sides) {
    const f = c.sides[side].faction;
    const isk = (o.insurance[f] ?? 0) + (esc?.side === side ? esc.extraIsk : 0);
    if (isk > 0) out.push({ faction: f, kind: 'isk', text: `+${isk} ISK: Spaceship Insurance` });
  }
  for (const side of sides) {
    const f = c.sides[side].faction;
    if (o.events[side] > 0) out.push({ faction: f, kind: 'cards', text: `Draws ${plural(o.events[side], 'Event card')} (reparations)` });
    if (esc?.side === side && esc.extraCards > 0) {
      out.push({ faction: f, kind: 'cards', text: `Draws ${esc.extraCards} more Event ${esc.extraCards === 1 ? 'card' : 'cards'} (the fleet that could not escape)` });
    }
  }
  for (const side of sides) {
    const lost = [...losses(c, side).map((s) => s.ship), ...(esc?.side === side ? esc.ships : [])];
    if (lost.length > 0) out.push({ faction: c.sides[side].faction, kind: 'lost', text: `Loses ${nameList(lost)}` });
  }
  const loser = opponent(o.winner);
  const left = survivors(c, loser);
  if (!noEscape && left.length > 0) {
    out.push({
      faction: c.sides[loser].faction,
      kind: 'move',
      text: `Moves its surviving fleet (${nameList(left.map((s) => s.ship))}) to an adjacent explored system that no other player controls and that has no enemy ships, then gets a Fleet Exhausted token`,
    });
  }
  return out;
}

/**
 * The Finish bar's line once combatFinish would go through: who wins and where the results go. A light game records no
 * losses (fleets stay on the board), so it says to take the destroyed ships off the board instead.
 */
export function finishText(g: GameState, winner: FactionId): string {
  const where =
    g.mode === 'light'
      ? 'rewards go to the Panel and the Table; take the destroyed ships off the board'
      : 'rewards and losses go to the Panel and the Table';
  return `${factionName(winner)} wins · ${where}`;
}

/* ------------------------------------------------------------------ re-align */

type Role = CombatShip['role'];

export interface RealignMove {
  uid: string;
  orbit: Orbit;
  role: Role;
}

export interface RealignDraft {
  moves: RealignMove[];
}

export const EMPTY_REALIGN: RealignDraft = { moves: [] };

/** The re-align draft's name: this combat's sides, the round, my side and the ships I must place. */
export function realignDraftName(c: CombatState, side: Side): string {
  return `combat-realign:${c.attacker}-${c.defender}:r${c.round}:${side}:${needsRealign(c, side)
    .map((s) => s.uid)
    .join(',')}`;
}

/** Whether `orbit` has a leader: a present one, or one promoted in the draft (other than `except`). */
function ledIn(c: CombatState, side: Side, moves: readonly RealignMove[], orbit: Orbit, except: string | null = null): boolean {
  return leaderOf(c, side, orbit) !== null || moves.some((m) => m.orbit === orbit && m.role === 'leader' && m.uid !== except);
}

export interface RealignSlot {
  orbit: Orbit;
  role: Role;
  /** Why the ship can't go there, or null. */
  block: string | null;
}

/**
 * Where ship `uid` may go (manual p.30 step 8): lead the orbit it was supporting (when it is that orbit's size), or
 * support another orbit that has a leader (present or promoted in the draft), with the reason where it can't. Staying
 * as a support of the orbit it was in is not a choice: it follows from another ship being promoted there.
 */
export function realignSlots(c: CombatState, side: Side, d: RealignDraft, uid: string): RealignSlot[] {
  const s = c.ships.find((x) => x.uid === uid);
  if (s === undefined) return [];
  const { name, size } = shipData(s.ship);
  return ORBITS.flatMap((orbit): RealignSlot[] => {
    if (orbit === s.orbit) {
      return [{ orbit, role: 'leader', block: size === orbit ? null : `${name} is a ${size} ship: it can only lead the ${size} orbit` }];
    }
    return [{ orbit, role: 'support', block: ledIn(c, side, d.moves, orbit, uid) ? null : `No leader in the ${orbit} orbit yet` }];
  });
}

/** Drops draft supports sent to an orbit that has no leader (a promotion they relied on was withdrawn). */
function tidyRealign(c: CombatState, side: Side, moves: RealignMove[]): RealignMove[] {
  return moves.filter((m) => m.role === 'leader' || ledIn(c, side, moves, m.orbit));
}

/**
 * Places one ship: its earlier placement is replaced. Promoting a ship replaces the orbit's other promotion and makes
 * the orbit's other supports stay; moving a ship away withdraws a promotion in its orbit (the others must move too).
 */
export function placeRealign(c: CombatState, side: Side, d: RealignDraft, move: RealignMove): RealignDraft {
  const from = c.ships.find((x) => x.uid === move.uid)?.orbit;
  const sameOrbit = (m: RealignMove) => c.ships.find((x) => x.uid === m.uid)?.orbit === from;
  let moves = d.moves.filter((m) => m.uid !== move.uid);
  if (move.role === 'leader') {
    moves = moves.filter((m) => !(m.orbit === move.orbit && m.role === 'leader') && !sameOrbit(m)); // others there stay
  } else {
    moves = moves.filter((m) => !(sameOrbit(m) && m.role === 'leader')); // the promotion is off
  }
  moves = [...moves, move];
  return { moves: tidyRealign(c, side, moves) };
}

/** Takes a ship back out of the draft (its supports without a leader go back too). */
export function unplaceRealign(c: CombatState, side: Side, d: RealignDraft, uid: string): RealignDraft {
  return { moves: tidyRealign(c, side, d.moves.filter((m) => m.uid !== uid)) };
}

/** The draft with the supports that stay (their orbit's other ship was promoted) filled in: what the command sends. */
export function realignMoves(c: CombatState, side: Side, d: RealignDraft): RealignMove[] {
  const must = needsRealign(c, side);
  const promoted = new Set(d.moves.filter((m) => m.role === 'leader').map((m) => m.orbit));
  const stays = must
    .filter((s) => promoted.has(s.orbit) && !d.moves.some((m) => m.uid === s.uid))
    .map((s): RealignMove => ({ uid: s.uid, orbit: s.orbit, role: 'support' }));
  return [...d.moves, ...stays];
}

/** The command once every ship that must re-align is placed; else null. */
export function realignCommand(c: CombatState, side: Side, d: RealignDraft): Command | null {
  const must = needsRealign(c, side).map((s) => s.uid);
  const moves = realignMoves(c, side, d).filter((m) => must.includes(m.uid));
  if (must.length === 0 || moves.length !== must.length) return null;
  return { type: 'combatRealign', assign: moves.map((m) => ({ uid: m.uid, orbit: m.orbit, role: m.role })) };
}

export function sanitizeRealign(raw: unknown): RealignDraft | null {
  if (!isRecord(raw)) return null;
  if (!Array.isArray(raw.moves)) return EMPTY_REALIGN;
  return {
    moves: raw.moves.flatMap((m): RealignMove[] =>
      isRecord(m) && typeof m.uid === 'string' && isOrbit(m.orbit) && ROLES.includes(m.role as Role) ? [{ uid: m.uid, orbit: m.orbit, role: m.role as Role }] : [],
    ),
  };
}

/* ------------------------------------------------------------------ manual tools */

/** The sections of the combat tools sheet ("More"). */
export type ToolSection = 'damage' | 'add' | 'cancel';

const FIGHTING: ReadonlySet<CombatState['stage']> = new Set(['retreat', 'attack', 'realign', 'end']);

/**
 * The tools this device may use: damage, destroy and add ships for the two fighting sides once the rounds have begun
 * (as the engine allows them); Cancel combat for any seated player in any stage.
 */
export function toolSections(c: CombatState, side: Side | null, seated: boolean): ToolSection[] {
  const fighting: ToolSection[] = side !== null && FIGHTING.has(c.stage) ? ['damage', 'add'] : [];
  return seated ? [...fighting, 'cancel'] : fighting;
}

/**
 * My faction's small ships with models still in the box (`left`), A–Z: the box less my ships on the board, or in a
 * light game (no fleets kept) less my ships of the type already in this battle — as the engine counts them.
 */
export function addableShips(g: GameState, faction: FactionId): { ship: Ship; left: number }[] {
  const owned = g.players[faction]?.ships ?? {};
  const c = g.combat;
  const side = c === null ? null : sideOf(c, faction);
  const used = (id: ShipId): number => {
    if (g.mode !== 'light') return Object.hasOwn(owned, id) ? (owned[id] as number) : 0;
    return c === null || side === null ? 0 : c.ships.filter((s) => s.side === side && s.ship === id).length;
  };
  return factionShips(faction)
    .filter((s) => s.size === 'small')
    .map((ship) => ({ ship, left: Math.max(0, ship.qty - used(ship.id)) }))
    .sort((a, b) => a.ship.name.localeCompare(b.ship.name));
}

/** combatAddShips for the picked counts; null when nothing is picked. */
export function addCommand(picks: Partial<Record<ShipId, number>>, orbit: Orbit): Command | null {
  const ships = Object.entries(picks).flatMap(([id, n]) => Array.from({ length: n ?? 0 }, () => id as ShipId));
  return ships.length === 0 ? null : { type: 'combatAddShips', ships, orbit };
}

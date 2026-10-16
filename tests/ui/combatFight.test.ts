import { describe, expect, it } from 'vitest';
import { DEV } from '../../src/data/developments';
import type { Orbit } from '../../src/data/types';
import { apply } from '../../src/engine/apply';
import { effDif, reminders } from '../../src/engine/combat/abilities';
import { resolveRoll } from '../../src/engine/combat/attack';
import { computeOutcome, sideStrength } from '../../src/engine/combat/end';
import { isError, type AttackResult } from '../../src/engine/types';
import {
  addableShips,
  addCommand,
  attackChain,
  attackReminders,
  rerollBlockers,
  battleSoFar,
  finishText,
  killReminders,
  EMPTY_REALIGN,
  lossReminders,
  noEscapeEffect,
  outcomeReason,
  overflowRows,
  placeRealign,
  realignCommand,
  realignDraftName,
  realignSlots,
  resultBreakdown,
  resultOpen,
  retreatConsequence,
  rewardLines,
  sanitizeRealign,
  unplaceRealign,
  strengthParts,
  strengthText,
  tally,
  targetedReminders,
  targetRows,
  toolSections,
  verdict,
} from '../../src/ui/lib/combatFight';
import { padDice } from '../../src/ui/lib/dicePad';
import { battle, dice, hit, lead, losePanther, miss, NO_ADJUST, noRetreat, sup } from '../engine/combat/fixtures';
import { startedGame } from '../engine/helpers';

const last = (b: ReturnType<typeof battle>): AttackResult => b.c().results[b.c().results.length - 1]!;

/** Amarr's Heretic + Anathema against Caldari's Crow + Buzzard, all in the small orbit; round 1, Amarr's attack. */
function smallFight() {
  const b = battle([lead('heretic'), sup('anathema', 'small')], [lead('crow'), sup('buzzard', 'small')]);
  noRetreat(b);
  return { b, crow: b.uid('defender', 'crow'), buzzard: b.uid('defender', 'buzzard'), heretic: b.uid('attacker', 'heretic') };
}

describe('tally (the live tally above the pad, from resolveRoll)', () => {
  it('a kill: lock, damage through RED to the HP left, and the carry', () => {
    const { b, crow } = smallFight();
    const r = resolveRoll(b.t.game, b.c(), 'attacker', 'small', crow, padDice({ white: { aim2: 1, aim: 1, damage: 2 }, black: {} }), NO_ADJUST);
    expect(tally(r, b.ship(crow), 0)).toStrictEqual({
      aims: 'Aims 3 / DIF 3',
      locked: true,
      damage: 'Damage 2 − RED 0 = 2 → Crow HP 1 · DESTROYED',
      destroyed: true,
      carry: 'Carry over: 0 aims, 1 damage · no ship in reach',
      effects: [],
    });
    expect(tally(r, b.ship(crow), 2).carry).toBe('Carry over: 0 aims, 1 damage · 2 ships in reach');
  });

  it('a miss', () => {
    const { b, crow } = smallFight();
    const r = resolveRoll(b.t.game, b.c(), 'attacker', 'small', crow, padDice({ white: { aim: 2, damage: 1 }, black: {} }), NO_ADJUST);
    expect(tally(r, b.ship(crow), null)).toMatchObject({ aims: 'Aims 2 / DIF 3', locked: false, damage: 'Damage 1 · no lock, no damage', destroyed: false, carry: null });
  });

  it('a hit that does not kill, with the leader’s crit effect and an adjustment as chips', () => {
    const b = battle([lead('zealot')], [lead('cerberus')]);
    noRetreat(b);
    const cerberus = b.uid('defender', 'cerberus');
    const d = padDice({ white: { crit: 1 }, black: { damage2: 1, aim: 1 } });
    const r = resolveRoll(b.t.game, b.c(), 'attacker', 'medium', cerberus, d, NO_ADJUST);
    expect(tally(r, b.ship(cerberus), null)).toStrictEqual({
      aims: 'Aims 2 / DIF 2',
      locked: true,
      damage: 'Damage 3 − RED 2 = 1 → Cerberus HP 3 · 1 damage',
      destroyed: false,
      carry: null,
      effects: ['Zealot: +1 aim (1 crit)'],
    });
    const adj = resolveRoll(b.t.game, b.c(), 'attacker', 'medium', cerberus, d, { aim: 0, damage: 1, crit: 0 });
    expect(tally(adj, b.ship(cerberus), null)).toMatchObject({ damage: 'Damage 4 − RED 2 = 2 → Cerberus HP 3 · 2 damage', effects: ['Adjusted: +1 damage', 'Zealot: +1 aim (1 crit)'] });
  });

  it('locked but stopped by RED', () => {
    const b = battle([lead('paladin')], [lead('golem')]);
    noRetreat(b);
    const golem = b.uid('defender', 'golem');
    const r = resolveRoll(b.t.game, b.c(), 'attacker', 'large', golem, padDice({ white: {}, black: { aim: 1, damage: 2 } }), NO_ADJUST);
    expect(tally(r, b.ship(golem), null).damage).toBe('Damage 2 − RED 3 = 0 → no damage');
  });
});

describe('verdict, breakdown and the one-line result', () => {
  it('a kill and a miss, as the engine recorded them', () => {
    const { b, crow } = smallFight();
    hit(b, 'attacker', crow, dice({ aim2: 1, aim: 1, damage: 2 }));
    const kill = last(b);
    expect(verdict(kill, 'Crow')).toStrictEqual({ head: 'LOCKED · 1 DAMAGE · Crow DESTROYED', tone: 'kill' });
    expect(resultBreakdown(kill, 'Crow')).toStrictEqual(['Aims 3 against DIF 3: locked', 'Damage 2 − RED 0 = 2: 1 damage token on Crow (destroyed)']);

    miss(b, 'defender');
    const m = last(b);
    expect(verdict(m, 'Heretic')).toStrictEqual({ head: 'MISSED (0/3 aims)', tone: 'miss' });
    expect(resultBreakdown(m, 'Heretic')).toStrictEqual(['Aims 0 against DIF 3: missed', 'Damage 0: no lock, so no damage']);
  });

  it('a hit, a hit stopped by RED, crits and notes', () => {
    const b = battle([lead('paladin')], [lead('golem')]);
    noRetreat(b);
    const golem = b.uid('defender', 'golem');
    hit(b, 'attacker', golem, dice({}, { aim: 1, damage: 2 }));
    expect(verdict(last(b), 'Golem')).toStrictEqual({ head: 'LOCKED · NO DAMAGE (RED 3)', tone: 'blocked' });
    expect(resultBreakdown(last(b), 'Golem')[1]).toBe('Damage 2 − RED 3 = 0: no damage');
    miss(b, 'defender');
    noRetreat(b); // round 2
    hit(b, 'attacker', golem, dice({}, { aim: 1, damage2: 1, crit: 1 }), { aim: 0, damage: 1, crit: 0 });
    // 2 + 1 (crit) + 1 (adjusted) + 1 (Paladin crit) = 5 damage − RED 3 = 2
    expect(verdict(last(b), 'Golem')).toStrictEqual({ head: 'LOCKED · 2 DAMAGE on Golem', tone: 'hit' });
    expect(resultBreakdown(last(b), 'Golem')).toStrictEqual([
      'Aims 1 against DIF 1: locked',
      'Damage 5 − RED 3 = 2: 2 damage tokens on Golem',
      'Crits: 1',
      'Adjusted: +1 damage',
      'Paladin: +1 damage (1 crit against a large ship)',
    ]);
  });
});

describe('overflowRows', () => {
  it('the ships in the destroyed ship’s orbit, the ones the carry reaches, and why the others are out of reach', () => {
    const b = battle([lead('heretic'), sup('anathema', 'small')], [lead('crow'), sup('buzzard', 'small'), sup('flycatcher', 'small'), sup('rook', 'small'), lead('cerberus')], {
      defender: { tiers: ['D1'], evasive: [1] },
    });
    noRetreat(b);
    expect(overflowRows(b.t.game, b.c())).toStrictEqual([]);
    // 6 aims, 2 damage on the Crow (DIF 3, HP 1): 3 aims and 1 damage carry over.
    hit(b, 'attacker', b.uid('defender', 'crow'), dice({ aim2: 3, damage: 2 }));
    expect(b.c().attack?.overflow).toStrictEqual({ aims: 3, damage: 1, zeroDif: false });
    const rows = overflowRows(b.t.game, b.c());
    expect(rows.map((r) => [r.s.ship, r.reach, r.why])).toStrictEqual([
      ['buzzard', false, 'DIF 5 is more than 3 aims'],
      ['flycatcher', true, null],
      ['rook', false, 'RED 1 stops 1 damage'], // DIF 3: the aims reach it, the damage doesn't
    ]);
    expect(rows[1]).toMatchObject({ dif: 3, red: 0, hp: 2, hpLeft: 2 });
  });
});

describe('resultOpen', () => {
  it('follows `collapsed` until the player toggles, and again once a newer strike changes `collapsed`', () => {
    // the newest strike is open; a newer one lands and it folds
    expect(resultOpen(null, false)).toBe(true);
    expect(resultOpen(null, true)).toBe(false);
    // the player unfolds an earlier strike: it stays open while it stays an earlier strike
    expect(resultOpen({ open: true, under: true }, true)).toBe(true);
    // the player folds it again
    expect(resultOpen({ open: false, under: true }, true)).toBe(false);
    // a toggle made under another `collapsed` no longer counts
    expect(resultOpen({ open: true, under: false }, true)).toBe(false);
  });
});

describe('attackChain', () => {
  it('is the newest roll with the overflow strikes that followed it, oldest first', () => {
    const b = battle([lead('heretic'), sup('anathema', 'small')], [lead('crow'), sup('buzzard', 'small'), sup('flycatcher', 'small'), lead('cerberus')]);
    noRetreat(b);
    expect(attackChain(b.c().results)).toStrictEqual([]);
    hit(b, 'attacker', b.uid('defender', 'crow'), dice({ aim2: 3, damage: 2 }));
    expect(attackChain(b.c().results).map((r) => r.target)).toStrictEqual([b.uid('defender', 'crow')]);
    b.t.dispatch('amarr', { type: 'combatOverflow', target: b.uid('defender', 'buzzard') });
    expect(attackChain(b.c().results).map((r) => r.target)).toStrictEqual([b.uid('defender', 'crow'), b.uid('defender', 'buzzard')]);
    miss(b, 'defender');
    expect(attackChain(b.c().results)).toHaveLength(1);
  });
});

describe('targetRows', () => {
  it('lists the enemy ships on the board, small → large, leader first, with DIF from my orbit', () => {
    const b = battle([lead('heretic'), lead('zealot')], [sup('buzzard', 'small'), lead('crow'), lead('nighthawk')], { defender: { tiers: ['D2'] } });
    noRetreat(b);
    const rows = targetRows(b.t.game, b.c(), 'attacker', 'small');
    expect(rows.map((r) => r.s.ship)).toStrictEqual(['crow', 'buzzard', 'nighthawk']);
    const nh = rows[2]!;
    expect([nh.dif, nh.red, nh.hp, nh.hpLeft, nh.targetable]).toStrictEqual([effDif(b.t.game, b.c(), nh.s, 'small'), 2, 4, 4, true]);
    expect(nh.dif).toBe(3); // Nighthawk D2: +1 DIF against a small-orbit attack
    expect(targetRows(b.t.game, b.c(), 'attacker', 'large')[2]!.dif).toBe(2);
    b.ship(b.uid('defender', 'crow')).destroyed = true;
    expect(targetRows(b.t.game, b.c(), 'attacker', 'small')[0]).toMatchObject({ destroyed: true, targetable: false });
  });
});

describe('reminders for this attack', () => {
  it('roll: leader-only abilities only from the attacking orbit’s leader; the strategy card always', () => {
    const b = battle([lead('heretic'), lead('zealot')], [lead('crow'), lead('cerberus')], { attacker: { tiers: ['O1'], devs: [DEV.offensiveTactic] } });
    const g = b.t.game;
    const all = reminders(g, b.c(), 'attacker', 'roll');
    expect(all).toHaveLength(2);
    expect(all[0]).toMatch(/^Heretic: /);
    expect(all[1]).toMatch(/^Offensive Tactic: /);
    expect(attackReminders(g, b.c(), 'attacker', 'roll', 'small')).toStrictEqual(all);
    expect(attackReminders(g, b.c(), 'attacker', 'roll', 'medium')).toStrictEqual([all[1]]);
  });

  it('roll: a Fleet Commander’s basic reroll only for attacks from its own orbit (leader or support); its O2 for all', () => {
    const fleet = [lead('heretic'), lead('absolution'), sup('absolution', 'medium')];
    const b = battle(fleet, [lead('crow')], { attacker: { tiers: ['O1'] } });
    const texts = (orbit: Orbit) => attackReminders(b.t.game, b.c(), 'attacker', 'roll', orbit);
    expect(texts('medium').filter((t) => t.includes('in its orbit'))).toHaveLength(1);
    expect(texts('small').filter((t) => t.includes('in its orbit'))).toStrictEqual([]);
    expect(texts('large')).toStrictEqual([]);
    expect(texts('small').filter((t) => t.includes('Heretic'))).toHaveLength(1);

    // a Fleet Commander supporting an orbit counts for attacks from that orbit
    const sup2 = battle([lead('heretic'), sup('absolution', 'small'), lead('zealot')], [lead('crow')]);
    expect(attackReminders(sup2.t.game, sup2.c(), 'attacker', 'roll', 'small').some((t) => t.includes('in its orbit'))).toBe(true);
    expect(attackReminders(sup2.t.game, sup2.c(), 'attacker', 'roll', 'medium').some((t) => t.includes('in its orbit'))).toBe(false);

    // the second researched ability (O2) says "all orbits" and stays everywhere
    const o2 = battle(fleet, [lead('crow')], { attacker: { tiers: ['O2'] } });
    for (const orbit of ['small', 'medium', 'large'] as const) {
      expect(attackReminders(o2.t.game, o2.c(), 'attacker', 'roll', orbit).some((t) => t.includes('in all orbits'))).toBe(true);
    }
  });

  it('rerollBlockers: the attacker is told a targeted Sleipnir with D2 forbids rerolls', () => {
    const on = battle([lead('malediction')], [lead('stiletto'), lead('sleipnir')], { defender: { tiers: ['D2'] } });
    expect(rerollBlockers(on.t.game, on.c(), on.ship(on.uid('defender', 'sleipnir')))).toStrictEqual(['Sleipnir: Enemies targeting it cannot reroll dice.']);
    expect(rerollBlockers(on.t.game, on.c(), on.ship(on.uid('defender', 'stiletto')))).toStrictEqual([]);
    const off = battle([lead('malediction')], [lead('stiletto'), lead('sleipnir')]);
    expect(rerollBlockers(off.t.game, off.c(), off.ship(off.uid('defender', 'sleipnir')))).toStrictEqual([]);
  });

  it('kill: the Flycatcher only after a kill from its own orbit', () => {
    const b = battle([lead('heretic'), lead('zealot')], [lead('flycatcher'), lead('cerberus')], { defender: { tiers: ['O1'] } });
    expect(attackReminders(b.t.game, b.c(), 'defender', 'kill', 'small')).toStrictEqual([reminders(b.t.game, b.c(), 'defender', 'kill')[0]]);
    expect(attackReminders(b.t.game, b.c(), 'defender', 'kill', 'medium')).toStrictEqual([]);
  });

  it('kill: also when the killing leader was a wreck that left right after its attack', () => {
    const b = battle([lead('heretic'), lead('zealot')], [lead('flycatcher'), lead('cerberus')], { defender: { tiers: ['O1'] } });
    noRetreat(b);
    const flycatcher = b.uid('defender', 'flycatcher');
    hit(b, 'attacker', flycatcher, dice({ aim2: 2, damage: 2 }));
    expect(b.ship(flycatcher)).toMatchObject({ destroyed: true, removed: false });
    // The wrecked Flycatcher still attacks and kills the Heretic; then both leave the board.
    hit(b, 'defender', b.uid('attacker', 'heretic'), dice({ aim2: 2, damage: 2 }));
    expect(b.ship(flycatcher).removed).toBe(true);
    const r = last(b);
    expect(killReminders(b.t.game, b.c(), r)).toStrictEqual([reminders(b.t.game, { ...b.c(), ships: b.c().ships.map((s) => ({ ...s, removed: false })) }, 'defender', 'kill')[0]]);
    expect(killReminders(b.t.game, b.c(), b.c().results[0]!)).toStrictEqual([]); // Amarr's kill: no such ability
  });

  it('targeted: the targeted ship’s own reminder and the defender’s strategy card', () => {
    const b = battle([lead('malediction')], [lead('stiletto'), lead('sleipnir')], { defender: { tiers: ['D2'], devs: [DEV.defensiveTactic] } });
    const g = b.t.game;
    const all = reminders(g, b.c(), 'defender', 'targeted');
    expect(all.map((t) => t.split(':')[0])).toStrictEqual(['Sleipnir', 'Defensive Tactic']);
    expect(targetedReminders(g, b.c(), b.ship(b.uid('defender', 'sleipnir')))).toStrictEqual(all);
    expect(targetedReminders(g, b.c(), b.ship(b.uid('defender', 'stiletto')))).toStrictEqual([all[1]]);
  });

  it('destroyed: a lost Panther’s prompt, until the end of the combat', () => {
    const b = battle([lead('malediction'), lead('redeemer')], [lead('stiletto'), lead('panther')], { defender: { tiers: ['U2'] } });
    const panther = b.uid('defender', 'panther');
    expect(lossReminders(b.t.game, b.c(), 'defender')).toStrictEqual([]);
    b.ship(panther).destroyed = true;
    const prompt = lossReminders(b.t.game, b.c(), 'defender');
    expect(prompt).toHaveLength(1);
    expect(prompt[0]!.uid).toBe(panther);
    expect(prompt[0]!.text).toMatch(/^Panther: If this ship is destroyed/);
    b.ship(panther).removed = true;
    expect(lossReminders(b.t.game, b.c(), 'defender')).toStrictEqual(prompt);
    expect(lossReminders(b.t.game, b.c(), 'attacker')).toStrictEqual([]);
    const noTier = battle([lead('malediction')], [lead('panther')]);
    noTier.ship(noTier.uid('defender', 'panther')).destroyed = true;
    expect(lossReminders(noTier.t.game, noTier.c(), 'defender')).toStrictEqual([]);
  });
});

describe('retreatConsequence and battleSoFar', () => {
  it('spells out what a retreat does', () => {
    const b = battle([lead('heretic')], [lead('crow')]);
    expect(retreatConsequence(b.t.game, b.c(), 'attacker').join('; ')).toBe("round 1 becomes the last round; you don't attack; your ships get +1 DIF; you lose the combat");
    b.c().round = 3;
    expect(retreatConsequence(b.t.game, b.c(), 'defender')[0]).toBe('round 3 is the last round anyway');
  });

  it('counts the enemy Lachesis', () => {
    const b = battle([lead('malediction')], [lead('ares'), sup('lachesis', 'small')], { defender: { tiers: ['U1'] } });
    expect(retreatConsequence(b.t.game, b.c(), 'attacker')[2]).toBe('your ships get −1 DIF (+1 retreating, −2 Lachesis)');
  });

  it('sums up each side’s losses and damage', () => {
    const { b, crow, heretic } = smallFight();
    expect(battleSoFar(b.c(), 'attacker')).toStrictEqual({ lost: 'No ships lost', damage: 'No damage' });
    hit(b, 'attacker', crow, dice({ aim2: 1, aim: 1, damage: 2 }));
    b.ship(heretic).damage = 1;
    expect(battleSoFar(b.c(), 'defender')).toStrictEqual({ lost: 'Lost: Crow', damage: 'No damage' });
    expect(battleSoFar(b.c(), 'attacker')).toStrictEqual({ lost: 'No ships lost', damage: 'Damage: Heretic 1/2' });
  });
});

describe('the outcome', () => {
  it('strength by ship size plus the bonuses, equal to the engine’s', () => {
    const b = battle([lead('heretic'), lead('zealot'), sup('anathema', 'small')], [lead('crow'), lead('golem')], {
      homeOf: 'caldari',
      controller: 'caldari',
      citadels: 2,
      defender: { devs: [DEV.upgradedCitadel, DEV.guerillaWarfare] },
    });
    const g = b.t.game;
    const def = strengthParts(g, b.c(), 'defender');
    expect(def.total).toBe(sideStrength(g, b.c(), 'defender'));
    expect(strengthText(def)).toBe('13 = 1 small ship (1) + 1 large ship (5) + home system (2) + 2 upgraded citadels (4) + Guerilla Warfare (1)');
    const att = strengthParts(g, b.c(), 'attacker');
    expect(att.total).toBe(sideStrength(g, b.c(), 'attacker'));
    expect(strengthText(att)).toBe('5 = 2 small ships (2) + 1 medium ship (3)');
    for (const s of b.c().ships.filter((x) => x.side === 'defender')) s.destroyed = true;
    expect(strengthText(strengthParts(g, b.c(), 'defender'))).toBe('0: no ships left');
  });

  it('why the winner won', () => {
    const b = battle([lead('heretic')], [lead('crow')]);
    const c = b.c();
    expect(outcomeReason(c, computeOutcome(b.t.game, c))).toBe('Strength 1 each: a tie goes to the defender');
    b.ship(b.uid('defender', 'crow')).destroyed = true;
    expect(outcomeReason(c, computeOutcome(b.t.game, c))).toBe('Strength 1 against 0');
    b.ship(b.uid('attacker', 'heretic')).destroyed = true;
    expect(outcomeReason(c, computeOutcome(b.t.game, c))).toBe('Both fleets are gone: the defender wins');
    c.retreatedSide = 'defender';
    expect(outcomeReason(c, computeOutcome(b.t.game, c))).toBe('Caldari retreated');
  });

  it('lists the rewards, and what “Fleet cannot escape” adds — as combatFinish does it', () => {
    const b = battle([lead('heretic'), lead('zealot')], [lead('crow'), sup('buzzard', 'small'), lead('cerberus')], {
      attacker: { devs: [DEV.spaceWarlord] },
      defender: { devs: [DEV.spaceshipInsurance] },
    });
    const c = b.c();
    b.ship(b.uid('defender', 'crow')).destroyed = true;
    b.ship(b.uid('defender', 'crow')).removed = true;
    b.ship(b.uid('defender', 'buzzard')).destroyed = true;
    c.stage = 'end';
    const g = b.t.game;
    const o = computeOutcome(g, c);
    expect(rewardLines(g, c, o, false)).toStrictEqual([
      { faction: 'amarr', kind: 'vp', text: '+1 VP: won the attack and destroyed 2 ships' },
      { faction: 'amarr', kind: 'vp', text: '+1 VP: Space Warlord' },
      { faction: 'caldari', kind: 'isk', text: '+4 ISK: Spaceship Insurance' },
      { faction: 'caldari', kind: 'cards', text: 'Draws 1 Event card (reparations)' },
      { faction: 'caldari', kind: 'lost', text: 'Loses Crow + Buzzard' },
      { faction: 'caldari', kind: 'move', text: 'Moves its surviving fleet (Cerberus) to an adjacent explored system that no other player controls and that has no enemy ships, then gets a Fleet Exhausted token' },
    ]);
    expect(noEscapeEffect(g, c, o)).toStrictEqual({ side: 'defender', faction: 'caldari', ships: ['cerberus'], extraCards: 1, extraIsk: 4 });
    expect(rewardLines(g, c, o, true)).toStrictEqual([
      { faction: 'amarr', kind: 'vp', text: '+1 VP: won the attack and destroyed 2 ships' },
      { faction: 'amarr', kind: 'vp', text: '+1 VP: Space Warlord' },
      { faction: 'caldari', kind: 'isk', text: '+8 ISK: Spaceship Insurance' },
      { faction: 'caldari', kind: 'cards', text: 'Draws 1 Event card (reparations)' },
      { faction: 'caldari', kind: 'cards', text: 'Draws 1 more Event card (the fleet that could not escape)' },
      { faction: 'caldari', kind: 'lost', text: 'Loses Crow + Buzzard + Cerberus' },
    ]);
    // The engine agrees.
    const r = apply(g, { type: 'combatFinish', noEscape: true }, b.t.ctxFor(b.t.uids.caldari));
    if (isError(r)) throw new Error(r.message);
    expect(r.game.players.caldari!.res.isk - g.players.caldari!.res.isk).toBe(8);
    expect(r.game.players.amarr!.vp - g.players.amarr!.vp).toBe(2);
    expect(r.notices.filter((n) => n.to === 'caldari').map((n) => n.text)).toContain('Draw 1 Event card (reparations for the fleet that could not escape)');
  });

  it('no escape effect when the loser has no survivors; no rewards at all reads as such', () => {
    const b = battle([lead('heretic')], [lead('crow')]);
    const c = b.c();
    b.ship(b.uid('defender', 'crow')).destroyed = true;
    b.ship(b.uid('attacker', 'heretic')).destroyed = true;
    const o = computeOutcome(b.t.game, c);
    expect(noEscapeEffect(b.t.game, c, o)).toBeNull();
    const tie = battle([lead('heretic')], [lead('crow')]);
    const to = computeOutcome(tie.t.game, tie.c());
    expect(rewardLines(tie.t.game, tie.c(), to, false)).toStrictEqual([
      { faction: 'amarr', kind: 'move', text: 'Moves its surviving fleet (Heretic) to an adjacent explored system that no other player controls and that has no enemy ships, then gets a Fleet Exhausted token' },
    ]);
  });
});

describe('finishText', () => {
  it('says where the results go; a light game records no losses, so the board does', () => {
    const full = startedGame(['amarr', 'caldari']);
    expect(finishText(full.game, 'amarr')).toBe('Amarr wins · rewards and losses go to the Panel and the Table');
    const light = startedGame(['amarr', 'caldari'], { mode: 'light' });
    expect(finishText(light.game, 'caldari')).toBe(
      'Caldari wins · rewards go to the Panel and the Table; take the destroyed ships off the board',
    );
  });
});

describe('re-align', () => {
  /** Amarr's small leader is destroyed between rounds: its Anathema and Malediction must re-align. */
  function lostLeader() {
    const b = battle([lead('heretic'), sup('anathema', 'small'), sup('malediction', 'small'), lead('zealot')], [lead('crow'), lead('golem')]);
    b.t.dispatch('amarr', { type: 'combatDestroy', ship: b.uid('attacker', 'heretic') });
    expect(b.c().stage).toBe('realign');
    return { b, anathema: b.uid('attacker', 'anathema'), malediction: b.uid('attacker', 'malediction') };
  }
  const blocks = (xs: ReturnType<typeof realignSlots>) => xs.map((x) => `${x.orbit}-${x.role}:${x.block ?? 'ok'}`);

  it('offers the orbit it was in as a leader slot (size-matched) and the other orbits that have a leader as support slots', () => {
    const { b, anathema } = lostLeader();
    expect(blocks(realignSlots(b.c(), 'attacker', EMPTY_REALIGN, anathema))).toStrictEqual([
      'small-leader:ok',
      'medium-support:ok',
      'large-support:No leader in the large orbit yet',
    ]);
  });

  it('promoting one keeps the others in place; moving one away withdraws the promotion; taking back clears it', () => {
    const { b, anathema, malediction } = lostLeader();
    const c = b.c();
    let d = placeRealign(c, 'attacker', EMPTY_REALIGN, { uid: anathema, orbit: 'small', role: 'leader' });
    const cmd = realignCommand(c, 'attacker', d);
    expect(cmd).toStrictEqual({
      type: 'combatRealign',
      assign: [
        { uid: anathema, orbit: 'small', role: 'leader' },
        { uid: malediction, orbit: 'small', role: 'support' },
      ],
    });
    const r = apply(b.t.game, cmd!, b.t.ctxFor(b.t.uids.amarr));
    expect(isError(r) ? r.code : r.game.combat?.stage).toBe('retreat');

    // Malediction takes over as leader: Anathema stays, so nothing else is in the draft.
    const swapped = placeRealign(c, 'attacker', d, { uid: malediction, orbit: 'small', role: 'leader' });
    expect(swapped.moves).toStrictEqual([{ uid: malediction, orbit: 'small', role: 'leader' }]);
    // Anathema moves to the medium orbit: the promotion is off, so Malediction must move away too.
    const away = placeRealign(c, 'attacker', d, { uid: anathema, orbit: 'medium', role: 'support' });
    expect(away.moves).toStrictEqual([{ uid: anathema, orbit: 'medium', role: 'support' }]);
    expect(realignCommand(c, 'attacker', away)).toBeNull();
    const both = placeRealign(c, 'attacker', away, { uid: malediction, orbit: 'medium', role: 'support' });
    expect(realignCommand(c, 'attacker', both)).toMatchObject({ type: 'combatRealign' });
    // Promoting after moving one away sends the explicit move home (it stays).
    expect(placeRealign(c, 'attacker', away, { uid: malediction, orbit: 'small', role: 'leader' }).moves).toStrictEqual([{ uid: malediction, orbit: 'small', role: 'leader' }]);
    expect(unplaceRealign(c, 'attacker', d, anathema).moves).toStrictEqual([]);
  });

  it('names its draft by the ships to place; sanitizes stored drafts', () => {
    const { b, anathema, malediction } = lostLeader();
    expect(realignDraftName(b.c(), 'attacker')).toBe(`combat-realign:amarr-caldari:r1:attacker:${anathema},${malediction}`);
    expect(sanitizeRealign({ moves: [{ uid: 's2', orbit: 'small', role: 'leader' }, { uid: 3, orbit: 'small', role: 'leader' }, { uid: 's3', orbit: 'x', role: 'support' }] })).toStrictEqual({
      moves: [{ uid: 's2', orbit: 'small', role: 'leader' }],
    });
    expect(sanitizeRealign('x')).toBeNull();
  });
});

describe('combat tools', () => {
  it('offers the manual tools to the fighting sides once the rounds begin, Cancel to every seated player', () => {
    const b = battle([lead('heretic')], [lead('crow')], { stopAt: 'start' });
    expect(toolSections(b.c(), 'attacker', true)).toStrictEqual(['cancel']);
    expect(toolSections(b.c(), null, false)).toStrictEqual([]);
    for (const stage of ['retreat', 'attack', 'realign', 'end'] as const) {
      b.c().stage = stage;
      expect(toolSections(b.c(), 'defender', true)).toStrictEqual(['damage', 'add', 'cancel']);
      expect(toolSections(b.c(), null, true)).toStrictEqual(['cancel']);
    }
  });

  it('lists my small ships with models left and builds combatAddShips', () => {
    const b = battle([lead('malediction')], [lead('stiletto'), lead('panther')], { defender: { tiers: ['U2'] } });
    const rows = addableShips(b.t.game, 'minmatar');
    expect(rows.map((r) => [r.ship.id, r.left])).toStrictEqual([
      ['cheetah', 4],
      ['sabre', 5],
      ['stiletto', 4],
    ]);
    expect(addCommand({ cheetah: 1, sabre: 1 }, 'large')).toStrictEqual({ type: 'combatAddShips', ships: ['cheetah', 'sabre'], orbit: 'large' });
    expect(addCommand({ cheetah: 0 }, 'small')).toBeNull();
  });

  it('in a light game, counts the box less my ships of the type already in this battle (no fleets are kept)', () => {
    const table = startedGame(['amarr', 'minmatar'], { mode: 'light' });
    const stilettos = [lead('stiletto'), sup('stiletto', 'small'), sup('stiletto', 'small'), sup('stiletto', 'small')];
    const b = battle([lead('malediction'), sup('anathema', 'small')], [...stilettos, lead('panther')], { table, defender: { tiers: ['U2'] } });
    expect(addableShips(b.t.game, 'minmatar').map((r) => [r.ship.id, r.left])).toStrictEqual([
      ['cheetah', 5],
      ['sabre', 5],
      ['stiletto', 1],
    ]);
    // The engine draws the same line.
    losePanther(b, 'defender');
    const two = b.t.tryDispatch('minmatar', { type: 'combatAddShips', ships: ['stiletto', 'stiletto'], orbit: 'small' });
    expect(isError(two) && two.code).toBe('no_models');
    b.t.dispatch('minmatar', { type: 'combatAddShips', ships: ['stiletto', 'sabre'], orbit: 'small' });
    expect(addableShips(b.t.game, 'minmatar').map((r) => [r.ship.id, r.left])).toStrictEqual([
      ['cheetah', 5],
      ['sabre', 4],
      ['stiletto', 0],
    ]);
    expect(addableShips(b.t.game, 'amarr').find((r) => r.ship.id === 'anathema')?.left).toBe(4);
  });
});

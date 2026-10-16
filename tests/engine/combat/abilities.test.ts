import { describe, expect, it } from 'vitest';
import { dev, DEV } from '../../../src/data/developments';
import {
  activeEffects, dicePool, effDif, effStats, leaderOf, reminders, type ActiveEffect,
} from '../../../src/engine/combat/abilities';
import type { Side } from '../../../src/engine/types';
import { battle, lead, sup, type Battle } from './fixtures';

/** `ship.slot` of each active effect, in order. */
const names = (effects: ActiveEffect[]): string[] => effects.map((e) => `${e.ship.ship}.${e.slot}`);
const effectsOf = (b: Battle, side: Side): string[] => names(activeEffects(b.t.game, b.c(), side));
const pool = (b: Battle, side: Side, orbit: 'small' | 'medium' | 'large') => dicePool(b.t.game, b.c(), side, orbit);
const difOf = (b: Battle, uid: string, from: 'small' | 'medium' | 'large' = 'small') => effDif(b.t.game, b.c(), b.ship(uid), from);
const statsOf = (b: Battle, uid: string) => effStats(b.t.game, b.c(), b.ship(uid));

// ---------------------------------------------------------------------------------------------------------------

describe('dicePool', () => {
  it('adds the leader ATK and the supports SUP, split half/half in the medium orbit (spec example)', () => {
    // Caldari: Rook (ATK 4) leads the medium orbit with three Crows (SUP 1) in support.
    const b = battle([lead('rook'), sup('crow', 'medium'), sup('crow', 'medium'), sup('crow', 'medium')], [lead('anathema')]);
    expect(pool(b, 'attacker', 'medium')).toStrictEqual({
      total: 7, white: 3, black: 3, choice: 1, parts: ['Rook ATK 4', '3× Crow SUP 1'],
    });
  });

  it('rolls white dice in the small orbit and black dice in the large orbit', () => {
    const b = battle([lead('malediction'), sup('anathema', 'small'), lead('redeemer'), sup('paladin', 'large')], [lead('crow')]);
    expect(pool(b, 'attacker', 'small')).toStrictEqual({
      total: 4, white: 4, black: 0, choice: 0, parts: ['Malediction ATK 3', 'Anathema SUP 1'],
    });
    expect(pool(b, 'attacker', 'large')).toStrictEqual({
      total: 7, white: 0, black: 7, choice: 0, parts: ['Redeemer ATK 6', 'Paladin SUP 1'],
    });
  });

  it('caps the pool at 10 dice', () => {
    const b = battle([lead('golem'), sup('golem', 'large'), sup('widow', 'large'), sup('widow', 'large')], [lead('anathema')]);
    expect(pool(b, 'attacker', 'large')).toStrictEqual({
      total: 10, white: 0, black: 10, choice: 0, parts: ['Golem ATK 6', 'Golem SUP 3', '2× Widow SUP 2', 'Capped at 10'],
    });
  });

  it('is empty when the side has no leader in that orbit', () => {
    const b = battle([lead('malediction')], [lead('crow')]);
    expect(pool(b, 'attacker', 'medium')).toStrictEqual({ total: 0, white: 0, black: 0, choice: 0, parts: [] });
  });

  it('a Paladin support with O1+U1 adds its SUP to the other orbits; without U1 it does not', () => {
    const fleet = [lead('malediction'), lead('zealot'), lead('redeemer'), sup('paladin', 'large')];
    const on = battle(fleet, [lead('crow')], { attacker: { tiers: ['O1', 'U1'] } });
    expect(pool(on, 'attacker', 'small')).toMatchObject({ total: 4, parts: ['Malediction ATK 3', 'Paladin SUP 1 (from the large orbit)'] });
    expect(pool(on, 'attacker', 'medium')).toMatchObject({ total: 6, white: 3, black: 3, choice: 0 });
    expect(pool(on, 'attacker', 'large')).toMatchObject({ total: 7, parts: ['Redeemer ATK 6', 'Paladin SUP 1'] });

    const off = battle(fleet, [lead('crow')], { attacker: { tiers: ['O1'] } });
    expect(pool(off, 'attacker', 'small').total).toBe(3);
    expect(pool(off, 'attacker', 'medium').total).toBe(5);
    expect(pool(off, 'attacker', 'large').total).toBe(7);
  });

  it('two Paladins do not stack their SUP into the other orbits (same-named abilities, spec 9.3)', () => {
    const b = battle(
      [lead('malediction'), lead('redeemer'), sup('paladin', 'large'), sup('paladin', 'large')],
      [lead('crow')],
      { attacker: { tiers: ['O1', 'U1'] } },
    );
    expect(pool(b, 'attacker', 'small').total).toBe(4);
    expect(pool(b, 'attacker', 'large').total).toBe(8); // both still support their own orbit
  });

  it('Upgraded Citadel with 2 citadels adds 2 SUP to every orbit, for the system controller only', () => {
    const b = battle([lead('malediction'), lead('zealot')], [lead('crow'), lead('rook')], {
      homeOf: 'caldari', citadels: 2,
      attacker: { devs: [DEV.upgradedCitadel] }, defender: { devs: [DEV.upgradedCitadel] },
    });
    expect(b.c().controller).toBe('caldari');
    expect(pool(b, 'defender', 'small')).toStrictEqual({
      total: 5, white: 5, black: 0, choice: 0, parts: ['Crow ATK 3', 'Upgraded citadels +2'],
    });
    expect(pool(b, 'defender', 'medium').total).toBe(6);
    expect(pool(b, 'defender', 'large').total).toBe(0); // no leader, no pool
    expect(pool(b, 'attacker', 'small').total).toBe(3);
    expect(pool(b, 'attacker', 'medium').total).toBe(5);
  });

  it('a plain citadel adds 1 SUP to the chosen orbit only, however many citadels there are', () => {
    const b = battle([lead('malediction')], [lead('crow'), lead('rook')], {
      controller: 'caldari', citadels: 2, defender: { citadelOrbit: 'small' },
    });
    expect(pool(b, 'defender', 'small')).toMatchObject({ total: 4, parts: ['Crow ATK 3', 'Citadel +1'] });
    expect(pool(b, 'defender', 'medium').total).toBe(4);
  });

  it('uses effective stats: an evasive leader rolls fewer dice, a Marauder with O2+D2 more', () => {
    const evasive = battle([lead('anathema')], [lead('crow')], { attacker: { tiers: ['D1'], evasive: [0] } });
    expect(pool(evasive, 'attacker', 'small')).toStrictEqual({ total: 0, white: 0, black: 0, choice: 0, parts: ['Anathema ATK 0'] });
    const vargur = battle([lead('vargur')], [lead('crow')], { attacker: { tiers: ['O2', 'D2'] } });
    expect(pool(vargur, 'attacker', 'large')).toMatchObject({ total: 7, parts: ['Vargur ATK 7'] });
  });
});

// ---------------------------------------------------------------------------------------------------------------

describe('effDif', () => {
  it('a Golem support (O1) gives -1 DIF to enemy ships in its orbit; as a leader it does not', () => {
    const amarr = [lead('redeemer'), sup('malediction', 'large'), lead('malediction')];
    const support = battle(amarr, [lead('widow'), sup('golem', 'large')], { defender: { tiers: ['O1'] } });
    expect(difOf(support, support.uid('attacker', 'malediction', 0), 'large')).toBe(2);
    expect(difOf(support, support.uid('attacker', 'malediction', 1), 'small')).toBe(3); // other orbit
    expect(difOf(support, support.uid('attacker', 'redeemer'), 'large')).toBe(0);

    const leader = battle(amarr, [lead('golem'), sup('widow', 'large')], { defender: { tiers: ['O1'] } });
    expect(difOf(leader, leader.uid('attacker', 'malediction', 0), 'large')).toBe(3);
  });

  it('two Maledictions (U2) give -1 DIF in total; an interceptor plus a Huginn (U1) give -2', () => {
    const twins = battle([lead('malediction'), sup('malediction', 'small')], [lead('crow'), lead('rook')], {
      attacker: { tiers: ['U1', 'U2'] },
    });
    expect(difOf(twins, twins.uid('defender', 'crow'))).toBe(2);
    expect(difOf(twins, twins.uid('defender', 'rook'))).toBe(3); // medium orbit: out of reach

    // Malediction and Huginn are different factions; Stiletto is the Minmatar interceptor with the same ability.
    const mixed = battle([lead('stiletto'), sup('huginn', 'small')], [lead('crow')], { attacker: { tiers: ['U1', 'U2'] } });
    expect(difOf(mixed, mixed.uid('defender', 'crow'))).toBe(1);
  });

  it('never goes below 0', () => {
    const b = battle([lead('redeemer')], [lead('widow'), sup('golem', 'large'), sup('crow', 'large')], {
      defender: { tiers: ['O1', 'U1', 'U2'] },
    });
    expect(difOf(b, b.uid('attacker', 'redeemer'), 'large')).toBe(0);
  });

  it('an evasive Anathema (D1) has DIF 5 and ATK 0', () => {
    const b = battle([lead('anathema')], [lead('crow')], { attacker: { tiers: ['D1'], evasive: [0] } });
    const anathema = b.uid('attacker', 'anathema');
    expect(b.ship(anathema).evasive).toBe(true);
    expect(difOf(b, anathema)).toBe(5);
    expect(statsOf(b, anathema)).toStrictEqual({ atk: 0, sup: 0, red: 0 });
  });

  it('Nighthawk (D2) has +1 DIF against attacks from the small and medium orbits only', () => {
    const b = battle([lead('malediction')], [lead('nighthawk')], { defender: { tiers: ['D2'] } });
    const nighthawk = b.uid('defender', 'nighthawk');
    expect(difOf(b, nighthawk, 'small')).toBe(3);
    expect(difOf(b, nighthawk, 'medium')).toBe(3);
    expect(difOf(b, nighthawk, 'large')).toBe(2);
    const locked = battle([lead('malediction')], [lead('nighthawk')]);
    expect(difOf(locked, locked.uid('defender', 'nighthawk'), 'small')).toBe(2);
  });

  it('a Redeemer leader (U2) suppresses the Golem support aura in its orbit', () => {
    const caldari = [lead('widow'), sup('golem', 'large')];
    const b = battle([lead('redeemer'), sup('malediction', 'large')], caldari, {
      attacker: { tiers: ['U2'] }, defender: { tiers: ['O1'] },
    });
    expect(difOf(b, b.uid('attacker', 'malediction'), 'large')).toBe(3);
    expect(effectsOf(b, 'defender')).toStrictEqual(['widow.basic']);

    const without = battle([lead('redeemer'), sup('malediction', 'large')], caldari, { defender: { tiers: ['O1'] } });
    expect(difOf(without, without.uid('attacker', 'malediction'), 'large')).toBe(2);
  });

  it('retreating ships get +1 DIF, and -2 per distinct enemy Lachesis (U1)', () => {
    const plain = battle([lead('malediction')], [lead('ares')]);
    plain.c().retreatedSide = 'attacker';
    expect(difOf(plain, plain.uid('attacker', 'malediction'))).toBe(4);
    expect(difOf(plain, plain.uid('defender', 'ares'))).toBe(3);

    const lachesis = battle([lead('malediction')], [lead('ares'), sup('lachesis', 'small'), sup('lachesis', 'small')], {
      defender: { tiers: ['U1'] },
    });
    lachesis.c().retreatedSide = 'attacker';
    expect(difOf(lachesis, lachesis.uid('attacker', 'malediction'))).toBe(2);
  });
});

// ---------------------------------------------------------------------------------------------------------------

describe('effStats', () => {
  it('adds stats abilities: Marauder O2+D2 +1 ATK/SUP/RED, Absolution D2 +1 RED, also as supports', () => {
    const vargur = battle([lead('vargur')], [lead('crow')], { attacker: { tiers: ['O2', 'D2'] } });
    expect(statsOf(vargur, vargur.uid('attacker', 'vargur'))).toStrictEqual({ atk: 7, sup: 3, red: 4 });
    const o2only = battle([lead('vargur')], [lead('crow')], { attacker: { tiers: ['O2'] } });
    expect(statsOf(o2only, o2only.uid('attacker', 'vargur'))).toStrictEqual({ atk: 6, sup: 2, red: 3 });

    const amarr = battle([lead('absolution'), lead('redeemer'), sup('paladin', 'large')], [lead('crow')], {
      attacker: { tiers: ['O2', 'D2'] },
    });
    expect(statsOf(amarr, amarr.uid('attacker', 'absolution'))).toStrictEqual({ atk: 4, sup: 1, red: 3 });
    expect(statsOf(amarr, amarr.uid('attacker', 'paladin'))).toStrictEqual({ atk: 7, sup: 2, red: 4 });
    expect(pool(amarr, 'attacker', 'large').total).toBe(8);
  });
});

// ---------------------------------------------------------------------------------------------------------------

describe('activeEffects', () => {
  it('needs every required tier, the matching role and a ship that is not removed', () => {
    const fleet = [lead('redeemer'), sup('paladin', 'large')];
    expect(effectsOf(battle(fleet, [lead('crow')], { attacker: { tiers: ['O1'] } }), 'attacker')).toStrictEqual(['redeemer.basic']);

    const b = battle(fleet, [lead('crow')], { attacker: { tiers: ['O1', 'U1'] } });
    expect(effectsOf(b, 'attacker')).toStrictEqual(['redeemer.basic', 'redeemer.first', 'paladin.first']);
    b.ship(b.uid('attacker', 'paladin')).destroyed = true; // destroyed but still on the board: still active
    expect(effectsOf(b, 'attacker')).toStrictEqual(['redeemer.basic', 'redeemer.first', 'paladin.first']);
    b.ship(b.uid('attacker', 'paladin')).removed = true;
    expect(effectsOf(b, 'attacker')).toStrictEqual(['redeemer.basic', 'redeemer.first']);

    // A Golem leader has no support ability (its O1 aura says "Support:"), but its crit ability is a leader's.
    const golem = battle([lead('golem')], [lead('anathema')], { attacker: { tiers: ['O1'] } });
    expect(effectsOf(golem, 'attacker')).toStrictEqual(['golem.basic']);
  });

  it('Curse suppresses the chosen ability on every enemy ship of that name for the rest of combat', () => {
    const b = battle([lead('curse'), lead('malediction')], [lead('rook'), sup('crow', 'medium'), lead('crow')], {
      attacker: { tiers: ['U1'], curse: { ship: 'crow', slot: 'second' } },
      defender: { tiers: ['U1', 'U2'] },
    });
    expect(b.c().sides.attacker.curse).toStrictEqual({ ship: 'crow', slot: 'second' });
    expect(effectsOf(b, 'defender')).toStrictEqual(['rook.first', 'crow.first', 'crow.first']);
    expect(difOf(b, b.uid('attacker', 'curse'), 'medium')).toBe(3);
    expect(difOf(b, b.uid('attacker', 'malediction'))).toBe(3);

    b.ship(b.uid('attacker', 'curse')).removed = true; // the Curse is gone; its curse stays
    expect(effectsOf(b, 'defender')).toStrictEqual(['rook.first', 'crow.first', 'crow.first']);
  });

  it('a Redeemer suppresses only enemy supports, only in its own orbit', () => {
    const b = battle(
      [lead('redeemer'), lead('malediction')],
      [lead('widow'), sup('golem', 'large'), lead('crow'), sup('crow', 'small')],
      { attacker: { tiers: ['U2'] }, defender: { tiers: ['O1', 'U2'] } },
    );
    expect(effectsOf(b, 'defender')).toStrictEqual(['widow.basic', 'crow.second', 'crow.second']);
    expect(difOf(b, b.uid('attacker', 'malediction'))).toBe(2);
  });
});

// ---------------------------------------------------------------------------------------------------------------

describe('leaderOf', () => {
  it('is the orbit leader until it is removed (a destroyed leader still leads)', () => {
    const b = battle([lead('malediction'), sup('anathema', 'small')], [lead('crow')]);
    const leader = b.uid('attacker', 'malediction');
    expect(leaderOf(b.c(), 'attacker', 'small')?.uid).toBe(leader);
    expect(leaderOf(b.c(), 'attacker', 'medium')).toBeNull();
    b.ship(leader).destroyed = true;
    expect(leaderOf(b.c(), 'attacker', 'small')?.uid).toBe(leader);
    b.ship(leader).removed = true;
    expect(leaderOf(b.c(), 'attacker', 'small')).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------------------

describe('reminders', () => {
  it('lists active reminder abilities once per ship name, plus an untapped Offensive Tactic when rolling', () => {
    const b = battle([lead('nighthawk'), sup('nighthawk', 'medium')], [lead('malediction')], {
      attacker: { tiers: ['O2'], devs: [DEV.offensiveTactic] },
    });
    const shipTexts = [
      'Nighthawk: You may reroll any number of dice in your attacks in its orbit.',
      'Nighthawk: You may reroll any number of dice in your attacks in all orbits.',
    ];
    const tactic = `Offensive Tactic: ${dev(DEV.offensiveTactic).text}`;
    expect(reminders(b.t.game, b.c(), 'attacker', 'roll')).toStrictEqual([...shipTexts, tactic]);
    expect(reminders(b.t.game, b.c(), 'attacker', 'targeted')).toStrictEqual([]);
    b.t.p('caldari').tapped.push(DEV.offensiveTactic);
    expect(reminders(b.t.game, b.c(), 'attacker', 'roll')).toStrictEqual(shipTexts);
  });

  it('adds an untapped Defensive Tactic when targeted', () => {
    const b = battle([lead('malediction')], [lead('sleipnir')], { defender: { tiers: ['D2'], devs: [DEV.defensiveTactic] } });
    expect(reminders(b.t.game, b.c(), 'defender', 'targeted')).toStrictEqual([
      'Sleipnir: Enemies targeting it cannot reroll dice.',
      `Defensive Tactic: ${dev(DEV.defensiveTactic).text}`,
    ]);
    expect(reminders(b.t.game, b.c(), 'attacker', 'targeted')).toStrictEqual([]);
  });

  it('skips reminders of suppressed ships', () => {
    // A Sleipnir support's reroll ability works from any role, but not under an enemy Redeemer leader (U2).
    const fleet = [lead('panther'), sup('sleipnir', 'large')];
    const free = battle(fleet, [lead('redeemer')]);
    expect(reminders(free.t.game, free.c(), 'attacker', 'roll')).toStrictEqual([
      'Sleipnir: You may reroll any number of dice in your attacks in its orbit.',
    ]);
    const suppressed = battle(fleet, [lead('redeemer')], { defender: { tiers: ['U2'] } });
    expect(reminders(suppressed.t.game, suppressed.c(), 'attacker', 'roll')).toStrictEqual([]);
  });
});

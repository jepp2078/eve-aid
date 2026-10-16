import { describe, expect, it } from 'vitest';
import { DEV } from '../../../src/data/developments';
import type { Orbit } from '../../../src/data/types';
import { apply } from '../../../src/engine/apply';
import { effDif } from '../../../src/engine/combat/abilities';
import { overflowCandidates, resolveRoll } from '../../../src/engine/combat/attack';
import { isError, type AttackResult, type Command, type DiceEntry, type Side } from '../../../src/engine/types';
import {
  battle, deepFreeze, dice, expectRejected, hit, lead, miss, NO_ADJUST, noRetreat, sup, type Battle,
} from './fixtures';

const roll = (b: Battle, side: Side, orbit: Orbit, target: string, d: DiceEntry, adjust = NO_ADJUST) =>
  resolveRoll(b.t.game, b.c(), side, orbit, target, d, adjust);
const target = (t: string): Command => ({ type: 'combatTarget', target: t });
const rollCmd = (d: DiceEntry, adjust = NO_ADJUST): Command => ({ type: 'combatRoll', dice: d, adjust });
const overflow = (t: string | null): Command => ({ type: 'combatOverflow', target: t });
const candidates = (b: Battle): string[] => overflowCandidates(b.t.game, b.c());

// ---------------------------------------------------------------------------------------------------------------

describe('lock-on and RED', () => {
  it('misses when the aims are below the target DIF: no damage, and the step passes to the defender', () => {
    const b = battle([lead('malediction')], [lead('crow')]);
    noRetreat(b);
    expect(b.c()).toMatchObject({ stage: 'attack', step: { orbit: 'small', side: 'attacker' }, attack: { target: null, overflow: null } });
    const crow = b.uid('defender', 'crow');

    const t = b.t.dispatch('amarr', target(crow));
    expect(t.lines).toStrictEqual(["Amarr targets Caldari's Crow (small orbit)"]);
    expect(b.c().attack).toStrictEqual({ target: crow, overflow: null });

    const r = b.t.dispatch('amarr', rollCmd(dice({ aim: 2, damage: 3 })));
    expect(b.c().results).toStrictEqual([{
      side: 'attacker', orbit: 'small', target: crow, aims: 2, damage: 3, crits: 0, dif: 3, red: 0,
      locked: false, dealt: 0, destroyed: [], notes: [],
    } satisfies AttackResult]);
    expect(b.ship(crow)).toMatchObject({ damage: 0, destroyed: false });
    expect(r.lines).toStrictEqual(["Amarr's small-orbit attack on Caldari's Crow missed (2 aims against DIF 3)"]);
    expect(b.c().step).toStrictEqual({ orbit: 'small', side: 'defender' });
    expect(b.c().attack).toStrictEqual({ target: null, overflow: null });
  });

  it('RED blocks that much damage: 4 damage against RED 3 puts 1 damage token on the target', () => {
    const b = battle([lead('malediction')], [lead('golem')]);
    noRetreat(b);
    const golem = b.uid('defender', 'golem');
    const r = hit(b, 'attacker', golem, dice({ aim: 1, damage: 4 }));
    expect(b.c().results[0]).toMatchObject({ aims: 1, dif: 1, locked: true, damage: 4, red: 3, dealt: 1, destroyed: [] });
    expect(b.ship(golem)).toMatchObject({ damage: 1, destroyed: false });
    expect(r.lines).toStrictEqual(["Amarr's small-orbit attack hit Caldari's Golem for 1 damage (4 damage against RED 3)"]);
    expect(b.c().kills).toStrictEqual({ attacker: 0, defender: 0 });

    // locked, but RED absorbs everything
    expect(roll(b, 'attacker', 'small', golem, dice({ aim: 1, damage: 3 }))).toMatchObject({ locked: true, dealt: 0, destroyed: [] });
  });

  it('destroys the target once its damage reaches HP, and counts the kill', () => {
    const b = battle([lead('zealot')], [lead('rook')]);
    noRetreat(b);
    const rook = b.uid('defender', 'rook');
    hit(b, 'attacker', rook, dice({ aim: 3, damage: 2 })); // 2 - RED 1 = 1 token
    expect(b.ship(rook)).toMatchObject({ damage: 1, destroyed: false });
    miss(b, 'defender');
    noRetreat(b);
    const r = hit(b, 'attacker', rook, dice({ aim: 3, damage: 5 })); // 5 - 1 = 4 tokens, 2 HP left
    expect(b.c().results[2]).toMatchObject({ damage: 5, red: 1, locked: true, dealt: 2, destroyed: [rook] });
    expect(b.ship(rook)).toMatchObject({ damage: 3, destroyed: true, removed: false });
    expect(b.c().kills).toStrictEqual({ attacker: 1, defender: 0 });
    expect(r.lines).toStrictEqual(["Amarr's medium-orbit attack destroyed Caldari's Rook (5 damage against RED 1)"]);
    // the destroyed Rook still leads its orbit and attacks back
    expect(b.c().step).toStrictEqual({ orbit: 'medium', side: 'defender' });
  });
});

describe('dice entry and adjusters', () => {
  it('counts every face: white aim2 is 2 aims, black aimDamage and damage2, crits count as damage too', () => {
    const b = battle([lead('zealot')], [lead('rook')]);
    const rook = b.uid('defender', 'rook');
    expect(roll(b, 'attacker', 'small', rook, dice({ blank: 2, aim: 1, aim2: 2, damage: 1, crit: 1 }, { aim: 1, aimDamage: 1, damage2: 1, crit: 1 })))
      .toMatchObject({ aims: 7, damage: 6, crits: 2 });
  });

  it('adjusters change the totals; a crit adjustment is a crit that also deals 1 damage', () => {
    const b = battle([lead('zealot')], [lead('rook')]);
    const rook = b.uid('defender', 'rook');
    expect(roll(b, 'attacker', 'medium', rook, dice({ aim: 1, damage: 2 }), { aim: 1, damage: -1, crit: 1 })).toMatchObject({
      aims: 3, damage: 2, crits: 1, notes: ['Adjusted: +1 aim, -1 damage, +1 crit', 'Zealot: +1 aim (1 crit)'],
    });
  });

  it('a negative crit adjustment removes at most the crits rolled, each with its 1 damage', () => {
    const b = battle([lead('zealot')], [lead('rook')]);
    const rook = b.uid('defender', 'rook');
    expect(roll(b, 'attacker', 'medium', rook, dice({ crit: 1, damage: 3 }), { aim: 0, damage: 0, crit: -2 })).toMatchObject({
      aims: 0, damage: 3, crits: 0, notes: ['Adjusted: -2 crit'],
    });
  });

  it('totals never go below 0', () => {
    const b = battle([lead('malediction')], [lead('crow')]);
    const crow = b.uid('defender', 'crow');
    expect(roll(b, 'attacker', 'small', crow, dice({ aim: 1 }), { aim: -3, damage: -1, crit: -1 })).toMatchObject({
      aims: 0, damage: 0, crits: 0, locked: false,
    });
  });

  it('rejects malformed dice and adjusters', () => {
    const b = battle([lead('malediction')], [lead('crow')]);
    noRetreat(b);
    b.t.dispatch('amarr', target(b.uid('defender', 'crow')));
    const bad = (d: unknown): Command => ({ type: 'combatRoll', dice: d as DiceEntry, adjust: NO_ADJUST });
    expectRejected(b.t, 'amarr', bad(null), 'bad_dice');
    expectRejected(b.t, 'amarr', bad({ white: { aim: -1 }, black: {} }), 'bad_dice');
    expectRejected(b.t, 'amarr', bad({ white: { aim: 1.5 }, black: {} }), 'bad_dice');
    expectRejected(b.t, 'amarr', bad({ white: {}, black: { aim2: 1 } }), 'bad_dice');
    expectRejected(b.t, 'amarr', bad({ white: { toString: 1 }, black: {} }), 'bad_dice');
    expectRejected(b.t, 'amarr', bad({ white: 'aim', black: {} }), 'bad_dice');
    const adj = (a: unknown): Command => ({ type: 'combatRoll', dice: dice(), adjust: a as typeof NO_ADJUST });
    expectRejected(b.t, 'amarr', adj({ aim: 0.5, damage: 0, crit: 0 }), 'bad_amount');
    expectRejected(b.t, 'amarr', adj({ aim: 0, damage: '1', crit: 0 }), 'bad_amount');
    expectRejected(b.t, 'amarr', adj(null), 'bad_amount');
  });
});

describe('leader abilities in an attack', () => {
  it('a Zealot leader gets +1 aim per crit', () => {
    const b = battle([lead('zealot')], [lead('rook')]);
    expect(roll(b, 'attacker', 'medium', b.uid('defender', 'rook'), dice({ crit: 2 }))).toMatchObject({
      aims: 2, damage: 2, crits: 2, notes: ['Zealot: +2 aim (2 crits)'],
    });
  });

  it('a Black Ops leader gets +1 damage per crit, +2 against a large ship', () => {
    const b = battle([lead('redeemer')], [lead('golem'), lead('crow')]);
    expect(roll(b, 'attacker', 'large', b.uid('defender', 'golem'), dice({}, { aim: 1, crit: 1 }))).toMatchObject({
      aims: 1, damage: 3, crits: 1, notes: ['Redeemer: +2 damage (1 crit against a large ship)'],
    });
    expect(roll(b, 'attacker', 'large', b.uid('defender', 'crow'), dice({}, { crit: 1 }))).toMatchObject({
      damage: 2, notes: ['Redeemer: +1 damage (1 crit)'],
    });
  });

  it('a Sabre leader with O1 gets +1 damage once, however many crits', () => {
    const b = battle([lead('sabre')], [lead('crow')], { attacker: { tiers: ['O1'] } });
    expect(roll(b, 'attacker', 'small', b.uid('defender', 'crow'), dice({ crit: 3 }))).toMatchObject({
      damage: 4, crits: 3, notes: ['Sabre: +1 damage (crit)'],
    });
    expect(roll(b, 'attacker', 'small', b.uid('defender', 'crow'), dice({ damage: 3 }))).toMatchObject({ damage: 3, notes: [] });
    const locked = battle([lead('sabre')], [lead('crow')]);
    expect(roll(locked, 'attacker', 'small', locked.uid('defender', 'crow'), dice({ crit: 3 }))).toMatchObject({ damage: 3, notes: [] });
  });

  it('crit abilities do nothing for a supporting ship', () => {
    const sabre = battle([lead('stiletto'), sup('sabre', 'small')], [lead('crow')], { attacker: { tiers: ['O1'] } });
    expect(roll(sabre, 'attacker', 'small', sabre.uid('defender', 'crow'), dice({ crit: 3 }))).toMatchObject({ damage: 3, notes: [] });
    const zealot = battle([lead('curse'), sup('zealot', 'medium')], [lead('rook')]);
    expect(roll(zealot, 'attacker', 'medium', zealot.uid('defender', 'rook'), dice({ crit: 2 }))).toMatchObject({ aims: 0, notes: [] });
  });

  it('Ishtar (O2) +1 aim; Cerberus (O2) +1 damage against a ship in another orbit', () => {
    const ishtar = battle([lead('ishtar')], [lead('rook')], { attacker: { tiers: ['O2'] } });
    expect(roll(ishtar, 'attacker', 'medium', ishtar.uid('defender', 'rook'), dice({ aim: 1 }))).toMatchObject({
      aims: 2, notes: ['Ishtar: +1 aim'],
    });
    const cerberus = battle([lead('cerberus')], [lead('malediction'), lead('zealot')], { attacker: { tiers: ['O2'] } });
    expect(roll(cerberus, 'attacker', 'medium', cerberus.uid('defender', 'malediction'), dice({ damage: 1 }))).toMatchObject({
      damage: 2, notes: ['Cerberus: +1 damage (target in another orbit)'],
    });
    expect(roll(cerberus, 'attacker', 'medium', cerberus.uid('defender', 'zealot'), dice({ damage: 1 }))).toMatchObject({ damage: 1, notes: [] });
  });

  it('a Rook (U1) in the enemy small orbit gives the small-orbit attack -1 aim', () => {
    const b = battle([lead('malediction')], [lead('crow'), sup('rook', 'small')], { defender: { tiers: ['U1'] } });
    noRetreat(b);
    const crow = b.uid('defender', 'crow');
    hit(b, 'attacker', crow, dice({ aim: 3, damage: 1 }));
    expect(b.c().results[0]).toMatchObject({ aims: 2, dif: 3, locked: false, notes: ['Rook: -1 aim'] });
    expect(b.ship(crow).destroyed).toBe(false);

    // only attacks from the Rook's own orbit, and only with U1
    const far = battle([lead('malediction')], [lead('crow'), lead('rook')], { defender: { tiers: ['U1'] } });
    expect(roll(far, 'attacker', 'small', far.uid('defender', 'crow'), dice({ aim: 3 }))).toMatchObject({ aims: 3, notes: [] });
    const locked = battle([lead('malediction')], [lead('crow'), sup('rook', 'small')]);
    expect(roll(locked, 'attacker', 'small', locked.uid('defender', 'crow'), dice({ aim: 3 }))).toMatchObject({ aims: 3, notes: [] });
  });
});

describe('overflow', () => {
  // Caldari: Crow leads the small orbit with a Flycatcher (HP 2) and an evasive Buzzard (DIF 5) in support; a Rook leads medium.
  const setup = (): Battle =>
    battle([lead('malediction')], [lead('crow'), sup('flycatcher', 'small'), sup('buzzard', 'small'), lead('rook')], {
      defender: { tiers: ['D1'], evasive: [2] },
    });

  it("after a kill the remaining aims and damage can hit another ship in the destroyed ship's orbit", () => {
    const b = setup();
    noRetreat(b);
    const [crow, flycatcher, buzzard] = b.uids.defender as [string, string, string];
    expect(effDif(b.t.game, b.c(), b.ship(buzzard), 'small')).toBe(5);

    const r = hit(b, 'attacker', crow, dice({ aim2: 3, aim: 1, damage: 3 }));
    expect(b.c().results[0]).toMatchObject({ aims: 7, damage: 3, dif: 3, red: 0, locked: true, dealt: 1, destroyed: [crow] });
    expect(r.lines).toStrictEqual(["Amarr's small-orbit attack destroyed Caldari's Crow (3 damage against RED 0)"]);
    // 7 - DIF 3 = 4 aims; 3 - RED 0 - 1 HP = 2 damage
    expect(b.c().attack).toStrictEqual({ target: crow, overflow: { aims: 4, damage: 2, zeroDif: false } });
    expect(b.c().step).toStrictEqual({ orbit: 'small', side: 'attacker' });
    // the evasive Buzzard (DIF 5) is out of reach, the Rook is in another orbit
    expect(candidates(b)).toStrictEqual([flycatcher]);

    const o = b.t.dispatch('amarr', overflow(flycatcher));
    expect(b.c().results[1]).toStrictEqual({
      side: 'attacker', orbit: 'small', target: flycatcher, aims: 4, damage: 2, crits: 0, dif: 3, red: 0,
      locked: true, dealt: 2, destroyed: [flycatcher], notes: ['Overflow'],
    } satisfies AttackResult);
    expect(o.lines).toStrictEqual(["Overflow: Amarr's attack destroyed Caldari's Flycatcher (2 damage against RED 0)"]);
    expect(b.ship(flycatcher)).toMatchObject({ damage: 2, destroyed: true });
    expect(b.c().kills).toStrictEqual({ attacker: 2, defender: 0 });
    // 1 aim and 0 damage left: nothing more in reach, so the defender's destroyed leader attacks next
    expect(b.c().attack).toStrictEqual({ target: null, overflow: null });
    expect(b.c().step).toStrictEqual({ orbit: 'small', side: 'defender' });
  });

  it('the attacker may let the remaining damage go instead', () => {
    const b = setup();
    noRetreat(b);
    hit(b, 'attacker', b.uids.defender[0]!, dice({ aim2: 3, aim: 1, damage: 3 }));
    const r = b.t.dispatch('amarr', overflow(null));
    expect(r.lines).toStrictEqual(['Amarr lets the remaining damage go']);
    expect(b.c().results).toHaveLength(1);
    expect(b.c()).toMatchObject({ step: { orbit: 'small', side: 'defender' }, attack: { target: null, overflow: null } });
  });

  it('only a candidate may take the overflow, chosen by the attacking side; nothing else happens meanwhile', () => {
    const b = setup();
    noRetreat(b);
    const [crow, flycatcher, buzzard, rook] = b.uids.defender as [string, string, string, string];
    expectRejected(b.t, 'amarr', overflow(flycatcher), 'no_overflow');
    hit(b, 'attacker', crow, dice({ aim2: 3, aim: 1, damage: 3 }));
    for (const uid of [buzzard, rook, crow, b.uids.attacker[0]!, 'nope']) expectRejected(b.t, 'amarr', overflow(uid), 'bad_target');
    expectRejected(b.t, 'caldari', overflow(flycatcher), 'not_your_step');
    expectRejected(b.t, 'amarr', target(flycatcher), 'overflow_pending');
    expectRejected(b.t, 'amarr', rollCmd(dice({ aim: 3 })), 'overflow_pending');
  });

  it('reaches supports in a Vanguard Ship orbit once its leader is destroyed (errata: excess hits ships, not targets)', () => {
    const b = battle([lead('malediction')], [lead('crow'), sup('flycatcher', 'small')], {
      defender: { devs: [DEV.vanguardShip], vanguardOrbit: 'small' },
    });
    noRetreat(b);
    const [crow, flycatcher] = b.uids.defender as [string, string];
    hit(b, 'attacker', crow, dice({ aim2: 3, aim: 1, damage: 3 }));
    expect(candidates(b)).toStrictEqual([flycatcher]);
    b.t.dispatch('amarr', overflow(flycatcher));
    expect(b.ship(flycatcher)).toMatchObject({ destroyed: true });
  });

  it('with nothing in reach after a kill, the attack ends at once', () => {
    const b = battle([lead('malediction')], [lead('crow'), lead('rook')]);
    noRetreat(b);
    hit(b, 'attacker', b.uid('defender', 'crow'), dice({ aim2: 3, damage: 5 }));
    expect(b.c()).toMatchObject({ step: { orbit: 'small', side: 'defender' }, attack: { target: null, overflow: null } });
  });

  it('Vargur (O1): after its kill the remaining damage ignores DIF', () => {
    const fleet = [lead('crow'), sup('buzzard', 'small')];
    const b = battle([lead('vargur')], fleet, { attacker: { tiers: ['O1'] } });
    noRetreat(b);
    expect(b.c().step).toStrictEqual({ orbit: 'small', side: 'defender' });
    miss(b, 'defender');
    expect(b.c().step).toStrictEqual({ orbit: 'large', side: 'attacker' });
    const [crow, buzzard] = b.uids.defender as [string, string];

    hit(b, 'attacker', crow, dice({}, { aim: 3, damage2: 2 }));
    expect(b.c().results[1]).toMatchObject({ aims: 3, damage: 4, dif: 3, destroyed: [crow], notes: ['Vargur: overflow ignores DIF'] });
    expect(b.c().attack).toStrictEqual({ target: crow, overflow: { aims: 0, damage: 3, zeroDif: true } });
    expect(candidates(b)).toStrictEqual([buzzard]);

    b.t.dispatch('minmatar', overflow(buzzard));
    expect(b.c().results[2]).toStrictEqual({
      side: 'attacker', orbit: 'large', target: buzzard, aims: 0, damage: 3, crits: 0, dif: 0, red: 0,
      locked: true, dealt: 1, destroyed: [buzzard], notes: ['Overflow (DIF counts as 0)'],
    } satisfies AttackResult);
    // the Caldari fleet is gone once the large orbit is done
    expect(b.c().stage).toBe('end');

    const plain = battle([lead('vargur')], fleet);
    noRetreat(plain);
    miss(plain, 'defender');
    hit(plain, 'attacker', plain.uids.defender[0]!, dice({}, { aim: 3, damage2: 2 }));
    expect(plain.c().results[1]!.notes).toStrictEqual([]);
    expect(plain.c().stage).toBe('realign'); // no overflow; the Buzzard lost its leader
  });

  it('a Zealot (O2) leader adds +1 aim and +1 damage once per attack, after its first kill', () => {
    const b = battle([lead('zealot')], [lead('crow'), sup('crow', 'small'), sup('crow', 'small')], { attacker: { tiers: ['O2'] } });
    noRetreat(b);
    miss(b, 'defender');
    const [c1, c2, c3] = b.uids.defender as [string, string, string];
    hit(b, 'attacker', c1, dice({ aim2: 5, damage: 2 }));
    expect(b.c().results[1]!.notes).toStrictEqual(['Zealot: +1 aim and +1 damage after the kill']);
    // 10 - 3 + 1 = 8 aims; 2 - 0 - 1 + 1 = 2 damage
    expect(b.c().attack!.overflow).toStrictEqual({ aims: 8, damage: 2, zeroDif: false });
    expect(candidates(b)).toStrictEqual([c2, c3]);
    b.t.dispatch('amarr', overflow(c2));
    // no second bonus: 8 - 3 = 5 aims, 2 - 0 - 1 = 1 damage
    expect(b.c().attack!.overflow).toStrictEqual({ aims: 5, damage: 1, zeroDif: false });
    b.t.dispatch('amarr', overflow(c3));
    expect(b.c().kills.attacker).toBe(3);
    expect(b.c().stage).toBe('end');
  });
});

describe('combatTarget and combatRoll', () => {
  it('only the side whose step it is targets and rolls, and it needs a target first', () => {
    const b = battle([lead('malediction')], [lead('crow')]);
    noRetreat(b);
    const crow = b.uid('defender', 'crow');
    expectRejected(b.t, 'caldari', target(b.uid('attacker', 'malediction')), 'not_your_step');
    expectRejected(b.t, 'caldari', rollCmd(dice()), 'not_your_step');
    expectRejected(b.t, 'amarr', rollCmd(dice()), 'no_target');
    b.t.dispatch('amarr', target(crow));
    expectRejected(b.t, 'caldari', rollCmd(dice()), 'not_your_step');
  });

  it('targets an enemy ship that is still in the battle and not destroyed; it may change its mind before rolling', () => {
    const b = battle([lead('malediction'), sup('anathema', 'small')], [lead('crow'), sup('buzzard', 'small')]);
    noRetreat(b);
    const [crow, buzzard] = b.uids.defender as [string, string];
    expectRejected(b.t, 'amarr', target(b.uid('attacker', 'anathema')), 'bad_target');
    expectRejected(b.t, 'amarr', target('s99'), 'bad_target');
    expectRejected(b.t, 'amarr', { type: 'combatTarget', target: 7 as never }, 'bad_target');
    b.ship(buzzard).destroyed = true;
    expectRejected(b.t, 'amarr', target(buzzard), 'bad_target');
    b.ship(buzzard).removed = true;
    expectRejected(b.t, 'amarr', target(buzzard), 'bad_target');

    b.t.dispatch('amarr', target(b.uid('defender', 'crow')));
    b.ship(buzzard).destroyed = false;
    b.ship(buzzard).removed = false;
    b.t.dispatch('amarr', target(buzzard));
    expect(b.c().attack!.target).toBe(buzzard);
    // a target destroyed meanwhile (manual tools) must be replaced before rolling
    b.ship(buzzard).destroyed = true;
    expectRejected(b.t, 'amarr', rollCmd(dice({ aim: 3, damage: 1 })), 'bad_target');
    b.t.dispatch('amarr', target(crow));
    b.t.dispatch('amarr', rollCmd(dice({ aim: 3, damage: 1 })));
    expect(b.ship(crow).destroyed).toBe(true);
  });

  it('supports in the enemy Vanguard Ship orbit cannot be targeted; its leader can', () => {
    const b = battle([lead('malediction')], [lead('crow'), sup('buzzard', 'small'), lead('rook'), sup('crow', 'medium')], {
      defender: { devs: [DEV.vanguardShip], vanguardOrbit: 'small' },
    });
    noRetreat(b);
    const [crow, buzzard, rook, crow2] = b.uids.defender as [string, string, string, string];
    expectRejected(b.t, 'amarr', target(buzzard), 'untargetable');
    for (const uid of [crow, rook, crow2]) b.t.dispatch('amarr', target(uid));
  });

  it('only in the attack stage', () => {
    const b = battle([lead('malediction')], [lead('crow')]);
    expectRejected(b.t, 'amarr', target(b.uid('defender', 'crow')), 'wrong_stage');
    expectRejected(b.t, 'amarr', rollCmd(dice()), 'wrong_stage');
    expectRejected(b.t, 'amarr', overflow(null), 'wrong_stage');
  });

  it('keeps the last 12 attack results', () => {
    const b = battle([lead('malediction')], [lead('crow')]);
    noRetreat(b);
    const old = (n: number): AttackResult => ({
      side: 'defender', orbit: 'small', target: `s${n}`, aims: n, damage: 0, crits: 0, dif: 3, red: 0,
      locked: false, dealt: 0, destroyed: [], notes: [],
    });
    b.c().results = Array.from({ length: 12 }, (_, i) => old(i));
    miss(b, 'attacker');
    expect(b.c().results).toHaveLength(12);
    expect(b.c().results[0]!.aims).toBe(1);
    expect(b.c().results[11]).toMatchObject({ side: 'attacker', aims: 0 });
  });

  it('never mutates its inputs and keeps the state JSON-safe', () => {
    const b = battle([lead('malediction')], [lead('crow'), sup('crow', 'small')]);
    noRetreat(b);
    b.t.dispatch('amarr', target(b.uids.defender[0]!));
    const ctx = deepFreeze(b.t.ctxFor(b.t.uids.amarr));
    const game = deepFreeze(structuredClone(b.t.game));
    const r = apply(game, deepFreeze(rollCmd(dice({ aim2: 3, damage: 3 }))), ctx);
    if (isError(r)) throw new Error(r.code);
    expect(r.game.combat!.attack!.overflow).toStrictEqual({ aims: 3, damage: 2, zeroDif: false });
    expect(JSON.parse(JSON.stringify(r.game))).toStrictEqual(r.game);
    const o = apply(deepFreeze(r.game), deepFreeze(overflow(b.uids.defender[1]!)), ctx);
    if (isError(o)) throw new Error(o.code);
    expect(o.game.combat!.ships.filter((s) => s.destroyed)).toHaveLength(2);
  });
});

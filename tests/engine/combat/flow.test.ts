import { describe, expect, it } from 'vitest';
import type { Orbit, ShipId } from '../../../src/data/types';
import { effDif } from '../../../src/engine/combat/abilities';
import { computeOutcome } from '../../../src/engine/combat/end';
import { addAllowance, needsRealign } from '../../../src/engine/combat/flow';
import type { Command } from '../../../src/engine/types';
import { startedGame } from '../helpers';
import { battle, codeOf, dice, expectRejected, hit, lead, losePanther, miss, noRetreat, sup, type Battle } from './fixtures';

const retreat = (yes: boolean): Command => ({ type: 'combatRetreat', retreat: yes });
type Move = { uid: string; orbit: Orbit; role: 'leader' | 'support' };
const realign = (assign: Move[]): Command => ({ type: 'combatRealign', assign });
const damage = (ship: string, delta: number): Command => ({ type: 'combatDamage', ship, delta });
const destroy = (ship: string): Command => ({ type: 'combatDestroy', ship });
const add = (ships: ShipId[], orbit: Orbit): Command => ({ type: 'combatAddShips', ships, orbit });
const CONTINUE: Command = { type: 'combatContinue' };
const CHOICES: Command = { type: 'combatStartChoices', citadelOrbit: null, vanguardOrbit: null, evasive: [], curse: null };
const steps = (b: Battle): string[] => b.c().results.map((r) => `${r.side}:${r.orbit}`);

// ---------------------------------------------------------------------------------------------------------------

describe('retreat', () => {
  it('asks the attacker first, then the defender; then the attacks begin with the first orbit that has a leader', () => {
    const b = battle([lead('malediction'), lead('zealot')], [lead('rook')]);
    expect(b.c()).toMatchObject({ stage: 'retreat', round: 1, retreatAsked: [], step: null, attack: null });
    expectRejected(b.t, 'caldari', retreat(false), 'not_your_step');
    expectRejected(b.t, 'amarr', { type: 'combatRetreat', retreat: 'no' as never }, 'bad_command');

    expect(b.t.dispatch('amarr', retreat(false)).lines).toStrictEqual(['Amarr does not retreat']);
    expect(b.c()).toMatchObject({ stage: 'retreat', retreatAsked: ['attacker'] });
    expectRejected(b.t, 'amarr', retreat(false), 'not_your_step');

    expect(b.t.dispatch('caldari', retreat(false)).lines).toStrictEqual(['Caldari does not retreat']);
    expect(b.c()).toMatchObject({
      stage: 'attack', round: 1, retreatAsked: ['attacker', 'defender'], retreatedSide: null, lastRound: 3,
      step: { orbit: 'small', side: 'attacker' }, attack: { target: null, overflow: null },
    });
  });

  it('an attacker retreating in round 2: the defender is not asked, it is the last round, the attacker does not attack and has +1 DIF', () => {
    // Amarr defends with a Heretic (U2): no retreat for Caldari in round 1.
    const b = battle([lead('crow')], [lead('heretic')], { defender: { tiers: ['U2'] } });
    expectRejected(b.t, 'caldari', retreat(true), 'retreat_blocked');
    noRetreat(b);
    miss(b, 'attacker');
    miss(b, 'defender');
    expect(b.c()).toMatchObject({ stage: 'retreat', round: 2 });

    const crow = b.uid('attacker', 'crow');
    expect(effDif(b.t.game, b.c(), b.ship(crow), 'small')).toBe(3);
    const r = b.t.dispatch('caldari', retreat(true));
    expect(r.lines).toStrictEqual(['Caldari retreats: round 2 is the last round']);
    expect(b.c()).toMatchObject({
      stage: 'attack', round: 2, lastRound: 2, retreatedSide: 'attacker', retreatAsked: ['attacker'],
      step: { orbit: 'small', side: 'defender' },
    });
    expect(effDif(b.t.game, b.c(), b.ship(crow), 'small')).toBe(4);
    expectRejected(b.t, 'amarr', retreat(false), 'wrong_stage');

    const end = miss(b, 'defender');
    expect(steps(b)).toStrictEqual(['attacker:small', 'defender:small', 'defender:small']);
    expect(b.c()).toMatchObject({ stage: 'end', round: 2 });
    expect(b.c().outcome).toMatchObject({ winner: 'defender' });
    expect(end.lines.slice(1)).toStrictEqual(['Round 2 ends', 'The combat is over: Amarr wins (Caldari retreated)']);
  });

  it("the Heretic's block is only the enemy's, only in round 1, and needs U2", () => {
    const own = battle([lead('crow')], [lead('heretic')], { defender: { tiers: ['U2'] } });
    own.t.dispatch('caldari', retreat(false));
    own.t.dispatch('amarr', retreat(true));
    expect(own.c()).toMatchObject({ stage: 'attack', retreatedSide: 'defender', step: { orbit: 'small', side: 'attacker' } });

    const locked = battle([lead('crow')], [lead('heretic')]);
    locked.t.dispatch('caldari', retreat(true));
    expect(locked.c().retreatedSide).toBe('attacker');
  });

  it('a defender that retreats makes no attacks and loses', () => {
    const b = battle([lead('malediction')], [lead('cerberus')]);
    b.t.dispatch('amarr', retreat(false));
    b.t.dispatch('caldari', retreat(true));
    expect(b.c()).toMatchObject({ retreatedSide: 'defender', lastRound: 1, step: { orbit: 'small', side: 'attacker' } });
    miss(b, 'attacker');
    expect(steps(b)).toStrictEqual(['attacker:small']);
    expect(b.c()).toMatchObject({ stage: 'end', outcome: { winner: 'attacker' } });
  });
});

describe('orbit order and simultaneity', () => {
  it("a leader destroyed in its own orbit still attacks back; both wrecks leave before the medium orbit", () => {
    const b = battle([lead('malediction'), lead('zealot')], [lead('crow'), lead('rook')]);
    noRetreat(b);
    const mal = b.uid('attacker', 'malediction');
    const crow = b.uid('defender', 'crow');
    hit(b, 'attacker', crow, dice({ aim: 3, damage: 1 }));
    expect(b.ship(crow)).toMatchObject({ destroyed: true, removed: false });
    expect(b.c().step).toStrictEqual({ orbit: 'small', side: 'defender' });

    const r = hit(b, 'defender', mal, dice({ aim: 3, damage: 1 }));
    expect(r.lines).toStrictEqual([
      "Caldari's small-orbit attack destroyed Amarr's Malediction (1 damage against RED 0)",
      "Removed from the battle: Amarr's Malediction and Caldari's Crow",
    ]);
    expect(b.ship(crow).removed).toBe(true);
    expect(b.ship(mal).removed).toBe(true);
    expect(b.c().kills).toStrictEqual({ attacker: 1, defender: 1 });
    expect(b.c().step).toStrictEqual({ orbit: 'medium', side: 'attacker' });
  });

  it('a medium leader destroyed by a small-orbit attack does not attack from the medium orbit that round', () => {
    const b = battle([lead('malediction'), lead('zealot')], [lead('crow'), lead('rook')]);
    noRetreat(b);
    const rook = b.uid('defender', 'rook');
    hit(b, 'attacker', rook, dice({ aim: 3, damage: 4 }));
    expect(b.ship(rook)).toMatchObject({ destroyed: true, removed: false });
    miss(b, 'defender');
    expect(b.ship(rook).removed).toBe(true);
    expect(b.c().step).toStrictEqual({ orbit: 'medium', side: 'attacker' });

    const r = miss(b, 'attacker');
    expect(steps(b)).toStrictEqual(['attacker:small', 'defender:small', 'attacker:medium']);
    expect(b.c()).toMatchObject({ stage: 'retreat', round: 2, step: null, attack: null, retreatAsked: [] });
    expect(r.lines).toStrictEqual([
      "Amarr's medium-orbit attack on Caldari's Crow missed (0 aims against DIF 3)", 'Round 1 ends', 'Round 2 begins',
    ]);
  });

  it('runs three rounds, then ends; a tie goes to the defender', () => {
    const b = battle([lead('malediction')], [lead('crow')]);
    for (let round = 1; round <= 3; round++) {
      expect(b.c()).toMatchObject({ stage: 'retreat', round });
      noRetreat(b);
      miss(b, 'attacker');
      miss(b, 'defender');
    }
    expect(b.c()).toMatchObject({ stage: 'end', round: 3, lastRound: 3, step: null, attack: null });
    expect(b.t.last!.lines.slice(1)).toStrictEqual([
      'Round 3 ends', 'The combat is over: Caldari wins (strength 1 each: a tie goes to the defender)',
    ]);
    expect(b.c().outcome).toStrictEqual(computeOutcome(b.t.game, b.c()));
    expect(b.c().outcome!.winner).toBe('defender');
    expectRejected(b.t, 'amarr', retreat(false), 'wrong_stage');
  });

  it('damage stays across rounds; survivors fight to the end of round 3', () => {
    const b = battle([lead('malediction'), lead('zealot')], [lead('crow'), lead('rook')]);
    const rook = b.uid('defender', 'rook');
    const zealot = b.uid('attacker', 'zealot');
    noRetreat(b);
    hit(b, 'attacker', rook, dice({ aim: 3, damage: 2 }));
    miss(b, 'defender');
    hit(b, 'attacker', rook, dice({ aim: 3, damage: 2 }));
    miss(b, 'defender');
    expect(b.c()).toMatchObject({ stage: 'retreat', round: 2 });
    expect(b.ship(rook).damage).toBe(2);

    noRetreat(b);
    miss(b, 'attacker');
    hit(b, 'defender', zealot, dice({ aim: 2, damage: 3 }));
    miss(b, 'attacker');
    miss(b, 'defender');
    expect(b.c()).toMatchObject({ stage: 'retreat', round: 3 });
    expect(b.ship(rook).damage).toBe(2);
    expect(b.ship(zealot).damage).toBe(1);

    noRetreat(b);
    for (const side of ['attacker', 'defender', 'attacker', 'defender'] as const) miss(b, side);
    expect(b.c()).toMatchObject({ stage: 'end', round: 3, kills: { attacker: 0, defender: 0 } });
    expect(b.c().ships.map((s) => [s.damage, s.destroyed, s.removed])).toStrictEqual([
      [0, false, false], [1, false, false], [0, false, false], [2, false, false],
    ]);
    expect(b.c().results).toHaveLength(12);
    expect(b.c().outcome).toMatchObject({ winner: 'defender', strength: { attacker: 4, defender: 4 } });
  });

  it('ends the combat as soon as a side has no ships left, mid-round', () => {
    const b = battle([lead('malediction'), lead('zealot')], [lead('crow')]);
    noRetreat(b);
    hit(b, 'attacker', b.uid('defender', 'crow'), dice({ aim: 3, damage: 1 }));
    const r = miss(b, 'defender');
    expect(b.c()).toMatchObject({ stage: 'end', round: 1, step: null, attack: null });
    expect(b.c().outcome).toStrictEqual(computeOutcome(b.t.game, b.c()));
    expect(b.c().outcome).toMatchObject({ winner: 'attacker', strength: { attacker: 4, defender: 0 } });
    expect(r.lines.slice(1)).toStrictEqual([
      "Removed from the battle: Caldari's Crow", 'The combat is over: Amarr wins (strength 4 against 0)',
    ]);
    expect(steps(b)).toStrictEqual(['attacker:small', 'defender:small']);
  });

  it('a Kronos leader (O1) stays until the round ends once destroyed, and still attacks; a side with nothing to target is skipped', () => {
    const b = battle([lead('crow'), lead('widow')], [lead('kronos')], { defender: { tiers: ['O1'] } });
    noRetreat(b);
    const kronos = b.uid('defender', 'kronos');
    const first = hit(b, 'attacker', kronos, dice({ aim: 1, damage: 9 }));
    expect(b.ship(kronos)).toMatchObject({ destroyed: true, removed: false });
    expect(first.lines.slice(1)).toStrictEqual(['Caldari has no target for its large-orbit attack']);
    expect(b.c().step).toStrictEqual({ orbit: 'large', side: 'defender' });

    const r = hit(b, 'defender', b.uid('attacker', 'widow'), dice({}, { aim: 1, damage2: 2 }));
    expect(r.lines).toStrictEqual([
      "Gallente's large-orbit attack hit Caldari's Widow for 1 damage (4 damage against RED 3)",
      'Round 1 ends',
      "Removed from the battle: Gallente's Kronos",
      'The combat is over: Caldari wins (strength 6 against 0)',
    ]);

    const plain = battle([lead('crow'), lead('widow')], [lead('kronos')]);
    noRetreat(plain);
    hit(plain, 'attacker', plain.uid('defender', 'kronos'), dice({ aim: 1, damage: 9 }));
    expect(plain.c().stage).toBe('end');
  });

  it('an Astarte (D2) repairs 1 damage at the end of each round', () => {
    const b = battle([lead('zealot')], [lead('astarte')], { defender: { tiers: ['D2'] } });
    noRetreat(b);
    const astarte = b.uid('defender', 'astarte');
    hit(b, 'attacker', astarte, dice({ aim: 2, damage: 4 }));
    expect(b.ship(astarte).damage).toBe(2);
    const r = miss(b, 'defender');
    expect(r.lines.slice(1)).toStrictEqual(['Round 1 ends', "Gallente's Astarte repairs 1 damage", 'Round 2 begins']);
    expect(b.ship(astarte).damage).toBe(1);
  });

  it('combatContinue: the side whose step it is may skip its attack', () => {
    const b = battle([lead('malediction')], [lead('crow'), sup('crow', 'small')]);
    expectRejected(b.t, 'amarr', CONTINUE, 'wrong_stage');
    noRetreat(b);
    expectRejected(b.t, 'caldari', CONTINUE, 'not_your_step');
    expect(b.t.dispatch('amarr', CONTINUE).lines).toStrictEqual(['Amarr skips its small-orbit attack']);
    expect(b.c().step).toStrictEqual({ orbit: 'small', side: 'defender' });
    miss(b, 'defender');
    noRetreat(b);
    hit(b, 'attacker', b.uids.defender[0]!, dice({ aim2: 3, damage: 2 }));
    expect(b.c().attack!.overflow).not.toBe(null);
    expectRejected(b.t, 'amarr', CONTINUE, 'overflow_pending');
  });
});

describe('re-align', () => {
  it('after the small leader dies with two small supports left, a support is promoted and round 2 follows', () => {
    const b = battle([lead('malediction')], [lead('crow'), sup('crow', 'small'), sup('buzzard', 'small')]);
    noRetreat(b);
    const [c1, c2, buzzard] = b.uids.defender as [string, string, string];
    hit(b, 'attacker', c1, dice({ aim: 3, damage: 1 }));
    const r = miss(b, 'defender');
    expect(r.lines.slice(1)).toStrictEqual([
      "Removed from the battle: Caldari's Crow", 'Round 1 ends', 'Caldari must re-align ships that lost their leader',
    ]);
    expect(b.c()).toMatchObject({ stage: 'realign', round: 1, step: null, attack: null });
    expect(needsRealign(b.c(), 'defender').map((s) => s.uid)).toStrictEqual([c2, buzzard]);
    expect(needsRealign(b.c(), 'attacker')).toStrictEqual([]);

    const mal = b.uid('attacker', 'malediction');
    expectRejected(b.t, 'amarr', realign([{ uid: mal, orbit: 'small', role: 'leader' }]), 'no_realign');
    expectRejected(b.t, 'caldari', realign([{ uid: c2, orbit: 'small', role: 'leader' }]), 'bad_realign');
    expectRejected(b.t, 'caldari', realign([{ uid: c2, orbit: 'small', role: 'leader' }, { uid: c2, orbit: 'small', role: 'support' }]), 'bad_realign');
    expectRejected(b.t, 'caldari', realign([{ uid: c2, orbit: 'small', role: 'leader' }, { uid: mal, orbit: 'small', role: 'support' }]), 'bad_realign');
    expectRejected(b.t, 'caldari', realign([{ uid: c2, orbit: 'small', role: 'leader' }, { uid: buzzard, orbit: 'small', role: 'leader' }]), 'two_leaders');
    expectRejected(b.t, 'caldari', realign([{ uid: c2, orbit: 'small', role: 'support' }, { uid: buzzard, orbit: 'small', role: 'support' }]), 'no_leader');
    expectRejected(b.t, 'caldari', realign([{ uid: c2, orbit: 'medium', role: 'leader' }, { uid: buzzard, orbit: 'medium', role: 'support' }]), 'bad_leader');
    expectRejected(b.t, 'caldari', realign([{ uid: c2, orbit: 'huge' as Orbit, role: 'leader' }, { uid: buzzard, orbit: 'small', role: 'support' }]), 'bad_orbit');
    expectRejected(b.t, 'caldari', realign([{ uid: c2, orbit: 'small', role: 'captain' as 'leader' }, { uid: buzzard, orbit: 'small', role: 'support' }]), 'bad_role');
    expectRejected(b.t, 'caldari', { type: 'combatRealign', assign: 'all' as never }, 'no_ships');
    expectRejected(b.t, 'caldari', retreat(false), 'wrong_stage');

    const done = b.t.dispatch('caldari', realign([{ uid: buzzard, orbit: 'small', role: 'support' }, { uid: c2, orbit: 'small', role: 'leader' }]));
    expect(done.lines).toStrictEqual(['Caldari re-aligned: Crow leads the small orbit; Buzzard supports the small orbit', 'Round 2 begins']);
    expect(b.ship(c2)).toMatchObject({ orbit: 'small', role: 'leader' });
    expect(b.ship(buzzard)).toMatchObject({ orbit: 'small', role: 'support' });
    expect(b.c()).toMatchObject({ stage: 'retreat', round: 2, retreatAsked: [] });
  });

  it('supports may also move to another orbit that has a leader', () => {
    const b = battle([lead('zealot')], [lead('crow'), sup('buzzard', 'small'), lead('rook')]);
    noRetreat(b);
    miss(b, 'defender');
    hit(b, 'attacker', b.uid('defender', 'crow'), dice({ aim: 3, damage: 1 }));
    miss(b, 'defender');
    expect(b.c().stage).toBe('realign');
    const buzzard = b.uid('defender', 'buzzard');
    b.t.dispatch('caldari', realign([{ uid: buzzard, orbit: 'medium', role: 'support' }]));
    expect(b.ship(buzzard)).toMatchObject({ orbit: 'medium', role: 'support' });
    expect(b.c()).toMatchObject({ stage: 'retreat', round: 2 });
  });

  it('per lost orbit: promote one (the others stay) or move them all away (manual p.30 step 8)', () => {
    const b = battle([lead('zealot')], [lead('crow'), sup('buzzard', 'small'), sup('crow', 'small'), lead('rook')]);
    noRetreat(b);
    miss(b, 'defender');
    hit(b, 'attacker', b.uid('defender', 'crow', 0), dice({ aim: 3, damage: 1 }));
    miss(b, 'defender');
    expect(b.c().stage).toBe('realign');
    const buzzard = b.uid('defender', 'buzzard');
    const crow2 = b.uid('defender', 'crow', 1);
    // promoted ship must be size-matched and from this orbit; a promotion means the others stay
    expectRejected(b.t, 'caldari', realign([{ uid: buzzard, orbit: 'small', role: 'leader' }, { uid: crow2, orbit: 'medium', role: 'support' }]), 'bad_realign');
    // no promotion: nobody may stay
    expectRejected(b.t, 'caldari', realign([{ uid: buzzard, orbit: 'medium', role: 'support' }, { uid: crow2, orbit: 'small', role: 'support' }]), 'no_leader');
    // moving away is all or nothing: both go, each to an orbit that has a leader
    expectRejected(b.t, 'caldari', realign([{ uid: buzzard, orbit: 'medium', role: 'support' }, { uid: crow2, orbit: 'small', role: 'support' }]), 'no_leader');
    // a support can't take over an orbit it wasn't in (the medium orbit already has Rook anyway)
    expectRejected(b.t, 'caldari', realign([{ uid: buzzard, orbit: 'medium', role: 'leader' }, { uid: crow2, orbit: 'medium', role: 'support' }]), 'bad_leader');
    b.t.dispatch('caldari', realign([{ uid: buzzard, orbit: 'medium', role: 'support' }, { uid: crow2, orbit: 'medium', role: 'support' }]));
    expect(b.c()).toMatchObject({ stage: 'retreat', round: 2 });
    expect(b.ship(crow2)).toMatchObject({ orbit: 'medium', role: 'support' });
  });

  it('a stay without a promotion is refused even where the orbit would otherwise be led', () => {
    const b = battle([lead('zealot')], [lead('crow'), sup('buzzard', 'small'), lead('rook')]);
    noRetreat(b);
    miss(b, 'defender');
    hit(b, 'attacker', b.uid('defender', 'crow'), dice({ aim: 3, damage: 1 }));
    miss(b, 'defender');
    const buzzard = b.uid('defender', 'buzzard');
    expectRejected(b.t, 'caldari', realign([{ uid: buzzard, orbit: 'small', role: 'support' }]), 'no_leader');
  });

  it('a lost orbit may send a support to another lost orbit that gets a promoted leader', () => {
    const b = battle([lead('zealot')], [lead('crow'), sup('buzzard', 'small'), lead('rook'), sup('rook', 'medium')]);
    b.t.dispatch('caldari', { type: 'combatDestroy', ship: b.uid('defender', 'crow') });
    b.t.dispatch('caldari', { type: 'combatDestroy', ship: b.uid('defender', 'rook', 0) });
    expect(b.c().stage).toBe('realign');
    const buzzard = b.uid('defender', 'buzzard');
    const rook2 = b.uid('defender', 'rook', 1);
    expectRejected(b.t, 'caldari', realign([{ uid: buzzard, orbit: 'medium', role: 'support' }, { uid: rook2, orbit: 'small', role: 'support' }]), 'no_leader');
    b.t.dispatch('caldari', realign([{ uid: buzzard, orbit: 'medium', role: 'support' }, { uid: rook2, orbit: 'medium', role: 'leader' }]));
    expect(b.c().stage).toBe('retreat');
    expect(b.ship(buzzard)).toMatchObject({ orbit: 'medium', role: 'support' });
  });

  it('when both sides must re-align, the attacker goes first', () => {
    const b = battle([lead('malediction'), sup('anathema', 'small')], [lead('crow'), sup('buzzard', 'small')]);
    noRetreat(b);
    hit(b, 'attacker', b.uid('defender', 'crow'), dice({ aim: 3, damage: 1 }));
    hit(b, 'defender', b.uid('attacker', 'malediction'), dice({ aim: 3, damage: 1 }));
    expect(b.c().stage).toBe('realign');
    expect(b.t.last!.lines.at(-1)).toBe('Amarr and Caldari must re-align ships that lost their leader');
    const buzzard = b.uid('defender', 'buzzard');
    const anathema = b.uid('attacker', 'anathema');
    expectRejected(b.t, 'caldari', realign([{ uid: buzzard, orbit: 'small', role: 'leader' }]), 'wait_attacker');
    b.t.dispatch('amarr', realign([{ uid: anathema, orbit: 'small', role: 'leader' }]));
    expect(b.c().stage).toBe('realign');
    expectRejected(b.t, 'amarr', realign([{ uid: anathema, orbit: 'small', role: 'leader' }]), 'no_realign');
    b.t.dispatch('caldari', realign([{ uid: buzzard, orbit: 'small', role: 'leader' }]));
    expect(b.c()).toMatchObject({ stage: 'retreat', round: 2 });
  });
});

describe('manual tools', () => {
  it('combatDamage adds or removes damage within 0..HP, setting or clearing destroyed and keeping kills in step', () => {
    const b = battle([lead('malediction')], [lead('crow'), lead('rook')]);
    noRetreat(b);
    const rook = b.uid('defender', 'rook');
    expect(b.t.dispatch('amarr', damage(rook, 2)).lines).toStrictEqual(["Amarr added 2 damage to Caldari's Rook (now 2 of 3)"]);
    expect(b.ship(rook)).toMatchObject({ damage: 2, destroyed: false });
    expect(b.t.dispatch('caldari', damage(rook, 5)).lines).toStrictEqual(["Caldari added 1 damage to Caldari's Rook (now 3 of 3, destroyed)"]);
    // during the attacks a wreck stays until its orbit is done
    expect(b.ship(rook)).toMatchObject({ damage: 3, destroyed: true, removed: false });
    expect(b.c().kills).toStrictEqual({ attacker: 1, defender: 0 });
    expectRejected(b.t, 'caldari', damage(rook, 1), 'no_change');
    expect(b.t.dispatch('caldari', damage(rook, -1)).lines).toStrictEqual(["Caldari removed 1 damage from Caldari's Rook (now 2 of 3)"]);
    expect(b.ship(rook)).toMatchObject({ damage: 2, destroyed: false });
    expect(b.c().kills).toStrictEqual({ attacker: 0, defender: 0 });

    expectRejected(b.t, 'amarr', damage(rook, 0), 'bad_amount');
    expectRejected(b.t, 'amarr', damage(rook, 1.5), 'bad_amount');
    expectRejected(b.t, 'amarr', damage('s99', 1), 'bad_ship');
    b.ship(rook).removed = true;
    expectRejected(b.t, 'amarr', damage(rook, 1), 'bad_ship');
  });

  it('reviving a ship destroyed by an attack takes the kill back', () => {
    const b = battle([lead('malediction')], [lead('crow')]);
    noRetreat(b);
    const crow = b.uid('defender', 'crow');
    hit(b, 'attacker', crow, dice({ aim: 3, damage: 1 }));
    expect(b.c().kills).toStrictEqual({ attacker: 1, defender: 0 });
    b.t.dispatch('caldari', damage(crow, -1));
    expect(b.ship(crow)).toMatchObject({ damage: 0, destroyed: false });
    expect(b.c().kills).toStrictEqual({ attacker: 0, defender: 0 });
  });

  it('combatDestroy during the attacks marks a wreck that leaves when its orbit is done', () => {
    const b = battle([lead('malediction')], [lead('crow'), lead('rook')]);
    noRetreat(b);
    const rook = b.uid('defender', 'rook');
    expect(b.t.dispatch('amarr', destroy(rook)).lines).toStrictEqual(["Amarr marked Caldari's Rook as destroyed"]);
    expect(b.ship(rook)).toMatchObject({ damage: 3, destroyed: true, removed: false });
    expect(b.c().kills).toStrictEqual({ attacker: 1, defender: 0 });
    expectRejected(b.t, 'amarr', destroy(rook), 'already_destroyed');
    miss(b, 'attacker');
    miss(b, 'defender');
    expect(b.ship(rook).removed).toBe(true);
  });

  it('between rounds a ship destroyed by hand leaves at once, and a side left without ships loses', () => {
    const b = battle([lead('malediction')], [lead('crow')]);
    noRetreat(b);
    miss(b, 'attacker');
    miss(b, 'defender');
    expect(b.c()).toMatchObject({ stage: 'retreat', round: 2 });
    const r = b.t.dispatch('amarr', destroy(b.uid('defender', 'crow')));
    expect(r.lines).toStrictEqual([
      "Amarr marked Caldari's Crow as destroyed",
      "Removed from the battle: Caldari's Crow",
      'The combat is over: Amarr wins (strength 1 against 0)',
    ]);
    expect(b.c()).toMatchObject({ stage: 'end', outcome: { winner: 'attacker', strength: { attacker: 1, defender: 0 } } });
  });

  it('between rounds a leader destroyed by hand leaves its supports to re-align, then the retreat prompts start again', () => {
    const b = battle([lead('malediction')], [lead('crow'), sup('buzzard', 'small')]);
    noRetreat(b);
    miss(b, 'attacker');
    miss(b, 'defender');
    b.t.dispatch('amarr', retreat(false));
    expect(b.c()).toMatchObject({ stage: 'retreat', round: 2, retreatAsked: ['attacker'] });

    const r = b.t.dispatch('amarr', damage(b.uid('defender', 'crow'), 1));
    expect(r.lines).toStrictEqual([
      "Amarr added 1 damage to Caldari's Crow (now 1 of 1, destroyed)",
      "Removed from the battle: Caldari's Crow",
      'Caldari must re-align ships that lost their leader',
    ]);
    expect(b.c()).toMatchObject({ stage: 'realign', round: 2, retreatAsked: [] });

    const buzzard = b.uid('defender', 'buzzard');
    const done = b.t.dispatch('caldari', realign([{ uid: buzzard, orbit: 'small', role: 'leader' }]));
    expect(done.lines).toStrictEqual(['Caldari re-aligned: Buzzard leads the small orbit', 'Round 2 resumes with the retreat decisions']);
    expect(b.c()).toMatchObject({ stage: 'retreat', round: 2, retreatAsked: [] });
    expectRejected(b.t, 'caldari', retreat(false), 'not_your_step');
    noRetreat(b);
    expect(b.c()).toMatchObject({ stage: 'attack', round: 2, step: { orbit: 'small', side: 'attacker' } });
  });

  it('during a re-align a ship destroyed by hand leaves at once: it may add a side to the re-align, or end the combat', () => {
    const merge = battle([lead('malediction'), sup('anathema', 'small')], [lead('crow'), sup('buzzard', 'small'), sup('buzzard', 'small')]);
    noRetreat(merge);
    hit(merge, 'attacker', merge.uid('defender', 'crow'), dice({ aim: 3, damage: 1 }));
    miss(merge, 'defender');
    expect(merge.c().stage).toBe('realign');
    const r = merge.t.dispatch('caldari', destroy(merge.uid('attacker', 'malediction')));
    expect(r.lines).toStrictEqual(["Caldari marked Amarr's Malediction as destroyed", "Removed from the battle: Amarr's Malediction"]);
    expect(merge.c()).toMatchObject({ stage: 'realign', round: 1 });
    const [b1, b2] = [merge.uid('defender', 'buzzard', 0), merge.uid('defender', 'buzzard', 1)];
    const twoBuzzards = realign([{ uid: b1, orbit: 'small', role: 'leader' }, { uid: b2, orbit: 'small', role: 'support' }]);
    expectRejected(merge.t, 'caldari', twoBuzzards, 'wait_attacker');
    merge.t.dispatch('amarr', realign([{ uid: merge.uid('attacker', 'anathema'), orbit: 'small', role: 'leader' }]));
    expect(merge.t.dispatch('caldari', twoBuzzards).lines.at(-1)).toBe('Round 2 begins');
    expect(merge.c()).toMatchObject({ stage: 'retreat', round: 2, retreatAsked: [] });

    const wipe = battle([lead('malediction')], [lead('crow'), sup('buzzard', 'small')]);
    noRetreat(wipe);
    hit(wipe, 'attacker', wipe.uid('defender', 'crow'), dice({ aim: 3, damage: 1 }));
    miss(wipe, 'defender');
    expect(wipe.c().stage).toBe('realign');
    wipe.t.dispatch('amarr', destroy(wipe.uid('defender', 'buzzard')));
    expect(wipe.c()).toMatchObject({ stage: 'end', outcome: { winner: 'attacker' } });
  });

  it('combatAddShips adds small ships to the owner and to the battle: supports where there is a leader', () => {
    const b = battle([lead('malediction')], [lead('crow')]);
    expectRejected(b.t, 'caldari', add(['buzzard', 'crow'], 'small'), 'no_panther'); // needs a destroyed Panther
    losePanther(b, 'defender', 2);
    const r = b.t.dispatch('caldari', add(['buzzard', 'crow'], 'small'));
    expect(r.lines).toStrictEqual(['Caldari added Buzzard + Crow to the small orbit']);
    expect(b.t.p('caldari').ships).toStrictEqual({ buzzard: 2, crow: 2 });
    const base = { side: 'defender', orbit: 'small', role: 'support', damage: 0, destroyed: false, removed: false, evasive: false, added: true };
    expect(b.c().ships.slice(4)).toStrictEqual([{ uid: 's5', ship: 'buzzard', ...base }, { uid: 's6', ship: 'crow', ...base }]);
    expect(b.c().nextUid).toBe(7);

    expectRejected(b.t, 'caldari', add(['crow'], 'medium'), 'bad_orbit');
    expectRejected(b.t, 'caldari', add(['crow'], 'huge' as Orbit), 'bad_orbit');
    expectRejected(b.t, 'caldari', add(['rook'], 'small'), 'bad_ship');
    expectRejected(b.t, 'caldari', add(['enterprise'], 'small'), 'bad_ship');
    expectRejected(b.t, 'caldari', add(['malediction'], 'small'), 'wrong_faction');
    expectRejected(b.t, 'caldari', add([], 'small'), 'no_ships');
    b.t.p('caldari').ships.crow = 4;
    expectRejected(b.t, 'caldari', add(['crow', 'crow'], 'small'), 'no_models');
  });

  it('combatAddShips: two per destroyed Panther with U2, once (Panther U2)', () => {
    const b = battle([lead('malediction')], [lead('stiletto'), lead('panther')], { defender: { tiers: ['U2'] } });
    const panther = b.uid('defender', 'panther');
    expectRejected(b.t, 'minmatar', add(['stiletto'], 'small'), 'no_panther'); // nothing destroyed yet
    expect(addAllowance(b.t.game, b.c(), 'defender')).toBe(0);
    b.t.dispatch('minmatar', destroy(panther));
    expect(addAllowance(b.t.game, b.c(), 'defender')).toBe(2);
    expect(addAllowance(b.t.game, b.c(), 'attacker')).toBe(0);
    expectRejected(b.t, 'amarr', add(['anathema'], 'small'), 'no_panther'); // the enemy's loss is not mine
    expectRejected(b.t, 'minmatar', add(['stiletto', 'stiletto', 'stiletto'], 'small'), 'no_panther');
    b.t.dispatch('minmatar', add(['stiletto'], 'small'));
    expect(addAllowance(b.t.game, b.c(), 'defender')).toBe(1);
    b.t.dispatch('minmatar', add(['cheetah'], 'small'));
    expect(addAllowance(b.t.game, b.c(), 'defender')).toBe(0);
    expectRejected(b.t, 'minmatar', add(['stiletto'], 'small'), 'no_panther'); // used up
  });

  it('combatAddShips: a Panther without U2 allows nothing; 2 Panthers allow 4 ships', () => {
    const fleet = [lead('stiletto'), lead('panther'), sup('panther', 'large')];
    const b = battle([lead('malediction')], fleet);
    b.t.dispatch('minmatar', destroy(b.uid('defender', 'panther', 0)));
    expect(addAllowance(b.t.game, b.c(), 'defender')).toBe(0);
    const u2 = battle([lead('malediction')], fleet, { defender: { tiers: ['U2'] } });
    u2.t.dispatch('minmatar', destroy(u2.uid('defender', 'panther', 0)));
    u2.t.dispatch('minmatar', destroy(u2.uid('defender', 'panther', 1)));
    expect(addAllowance(u2.t.game, u2.c(), 'defender')).toBe(4);
  });

  it('combatAddShips: the first ship leads an empty small orbit', () => {
    const b = battle([lead('malediction')], [lead('rook')]);
    losePanther(b, 'defender');
    const r = b.t.dispatch('caldari', add(['crow', 'buzzard'], 'small'));
    expect(r.lines).toStrictEqual(['Caldari added Crow + Buzzard to the small orbit (Crow leads it)']);
    expect(b.c().ships.slice(3).map((s) => [s.ship, s.orbit, s.role])).toStrictEqual([['crow', 'small', 'leader'], ['buzzard', 'small', 'support']]);
  });

  it('a leader added during re-align settles it', () => {
    const b = battle([lead('malediction')], [lead('crow'), sup('buzzard', 'small')]);
    noRetreat(b);
    hit(b, 'attacker', b.uid('defender', 'crow'), dice({ aim: 3, damage: 1 }));
    miss(b, 'defender');
    expect(b.c().stage).toBe('realign');
    losePanther(b, 'defender');
    const r = b.t.dispatch('caldari', add(['crow'], 'small'));
    expect(r.lines).toStrictEqual(['Caldari added Crow to the small orbit (Crow leads it)', 'Round 2 begins']);
    expect(b.c()).toMatchObject({ stage: 'retreat', round: 2 });
  });

  it('ships added beside a wreck leader during the attacks support it, then re-align once it has left (Panther)', () => {
    const b = battle([lead('malediction'), lead('redeemer')], [lead('stiletto'), lead('panther')], { defender: { tiers: ['U2'] } });
    noRetreat(b);
    miss(b, 'attacker');
    miss(b, 'defender');
    const panther = b.uid('defender', 'panther');
    hit(b, 'attacker', panther, dice({}, { aim: 2, damage2: 4 }));
    expect(b.ship(panther)).toMatchObject({ destroyed: true, removed: false });
    expect(b.c().step).toStrictEqual({ orbit: 'large', side: 'defender' });

    expect(b.t.dispatch('minmatar', add(['cheetah', 'stiletto'], 'large')).lines).toStrictEqual([
      'Minmatar added Cheetah + Stiletto to the large orbit',
    ]);
    const [cheetah, stiletto2] = b.c().ships.slice(-2).map((s) => s.uid) as [string, string];
    expect([b.ship(cheetah), b.ship(stiletto2)].map((s) => [s.orbit, s.role])).toStrictEqual([['large', 'support'], ['large', 'support']]);
    expect(b.t.p('minmatar').ships).toMatchObject({ cheetah: 2, stiletto: 2, panther: 1 });

    miss(b, 'defender'); // the Panther wreck still attacks, then leaves; its new supports have no leader
    expect(b.ship(panther).removed).toBe(true);
    expect(b.c()).toMatchObject({ stage: 'realign', round: 1 });
    expect(needsRealign(b.c(), 'defender').map((s) => s.uid)).toStrictEqual([cheetah, stiletto2]);
    b.t.dispatch('minmatar', realign([{ uid: cheetah, orbit: 'small', role: 'support' }, { uid: stiletto2, orbit: 'small', role: 'support' }]));
    expect([b.ship(cheetah), b.ship(stiletto2)].map((s) => [s.orbit, s.role])).toStrictEqual([['small', 'support'], ['small', 'support']]);
    expect(b.c()).toMatchObject({ stage: 'retreat', round: 2 });
  });

  it('in the end stage the outcome follows manual changes', () => {
    const b = battle([lead('malediction')], [lead('crow')]);
    for (let round = 1; round <= 3; round++) {
      noRetreat(b);
      miss(b, 'attacker');
      miss(b, 'defender');
    }
    expect(b.c().outcome).toMatchObject({ winner: 'defender', strength: { attacker: 1, defender: 1 } });
    b.t.dispatch('amarr', destroy(b.uid('defender', 'crow')));
    expect(b.c().outcome).toMatchObject({ winner: 'attacker', strength: { attacker: 1, defender: 0 } });
  });

  it('need an involved side, after the start-of-combat choices', () => {
    const t = startedGame(['amarr', 'caldari', 'gallente']);
    const b = battle([lead('malediction')], [lead('crow')], { table: t, stopAt: 'start' });
    const crow = b.uid('defender', 'crow');
    for (const cmd of [damage(crow, 1), destroy(crow), add(['crow'], 'small')]) expectRejected(t, 'caldari', cmd, 'wrong_stage');
    t.dispatch('amarr', CHOICES);
    t.dispatch('caldari', CHOICES);
    for (const cmd of [damage(crow, 1), destroy(crow), add(['ares'], 'small')]) expectRejected(t, 'gallente', cmd, 'not_in_combat');
  });
});

describe('retreats this round (for Pacifist)', () => {
  it('a retreat is recorded for the round; refusing to retreat is not', () => {
    const b = battle([lead('zealot')], [lead('crow')]);
    expect(b.t.game.retreatsThisRound).toStrictEqual([]);
    b.t.dispatch('amarr', retreat(false));
    b.t.dispatch('caldari', retreat(true));
    expect(b.t.game.retreatsThisRound).toStrictEqual(['caldari']);
  });

  it('starts empty again with the next round', () => {
    const t = startedGame(['amarr', 'caldari']);
    t.game.retreatsThisRound = ['caldari'];
    t.dispatch('amarr', { type: 'pass' });
    t.dispatch('caldari', { type: 'pass' });
    expect(t.game.phase).toBe('upkeep');
    expect(t.game.retreatsThisRound).toStrictEqual(['caldari']); // still this round's upkeep
    const confirm: Command = { type: 'confirmUpkeep', refinery: { planetary: 0, moon: 0, convert: 0 }, discard: {}, raids: [], researchLab: false };
    t.dispatch('amarr', confirm);
    t.dispatch('caldari', confirm);
    expect(t.game.round).toBe(2);
    expect(t.game.retreatsThisRound).toStrictEqual([]);
  });

  it('then lets another player\'s Pacifist score', () => {
    const t = startedGame(['amarr', 'caldari', 'gallente']);
    t.p('gallente').completed.push('pacifist');
    const b = battle([lead('zealot')], [lead('crow')], { table: t });
    t.dispatch('amarr', retreat(true));
    expect(t.game.retreatsThisRound).toStrictEqual(['amarr']);
    miss(b, 'defender');
    t.dispatch('caldari', { type: 'combatFinish', noEscape: false });
    t.dispatch('gallente', { type: 'useDev', dev: 'pacifist', params: { kind: 'none' } });
    expect(t.p('gallente').vp).toBe(1);
  });
});

describe('combatCancel', () => {
  it('any seated player may cancel a combat at any stage, with no rewards', () => {
    const t = startedGame(['amarr', 'caldari', 'gallente']);
    const b = battle([lead('malediction')], [lead('crow')], { table: t });
    noRetreat(b);
    hit(b, 'attacker', b.uid('defender', 'crow'), dice({ aim: 3, damage: 1 }));
    const players = structuredClone(t.game.players);
    const r = t.dispatch('gallente', { type: 'combatCancel' });
    expect(t.game.combat).toBe(null);
    expect(t.game.players).toStrictEqual(players);
    expect(r.lines).toStrictEqual(['Gallente cancelled the combat between Amarr and Caldari (no rewards)']);
    expect(r.notices).toStrictEqual([]);
    expectRejected(t, 'gallente', { type: 'combatCancel' }, 'no_combat');

    battle([lead('malediction')], [lead('crow')], { table: t, stopAt: 'assign' });
    expect(codeOf(t.tryAsUid('uid-stranger', { type: 'combatCancel' }))).toBe('not_seated');
    t.dispatch('caldari', { type: 'combatCancel' });
    expect(t.game.combat).toBe(null);
  });
});

describe('a combat outside the action phase', () => {
  const crowUid = (b: Battle) => b.uid('defender', 'crow');
  const commands = (b: Battle): Command[] => [
    { type: 'combatAssign', ships: [{ ship: 'crow', orbit: 'small', role: 'leader' }] },
    CHOICES, retreat(false), { type: 'combatTarget', target: crowUid(b) },
    { type: 'combatRoll', dice: dice(), adjust: { aim: 0, damage: 0, crit: 0 } }, { type: 'combatOverflow', target: null },
    CONTINUE, realign([]), damage(crowUid(b), 1), destroy(crowUid(b)), add(['crow'], 'small'),
    { type: 'combatFinish', noEscape: false },
  ];

  it('every combat command but Cancel needs the action phase: a combat left open can never score after the end (P3)', () => {
    for (const phase of ['upkeep', 'ended'] as const) {
      const b = battle([lead('zealot')], [lead('crow')]);
      const c = b.c();
      c.stage = 'end';
      c.outcome = computeOutcome(b.t.game, c);
      b.t.game.phase = phase;
      for (const cmd of commands(b)) {
        for (const f of [b.attacker, b.defender]) {
          expect(codeOf(b.t.tryDispatch(f, cmd)), `${cmd.type} by ${f} in ${phase}`).toBe('wrong_phase');
        }
      }
      expect(b.t.p('amarr').vp).toBe(0);
      const r = b.t.dispatch('caldari', { type: 'combatCancel' });
      expect(r.lines).toStrictEqual(['Caldari cancelled the combat between Amarr and Caldari (no rewards)']);
      expect(b.t.game.combat).toBe(null);
    }
  });

  it('says how to clear it', () => {
    const b = battle([lead('zealot')], [lead('crow')]);
    b.t.game.phase = 'ended';
    const r = b.t.tryDispatch('amarr', retreat(false));
    expect(codeOf(r)).toBe('wrong_phase');
    expect('message' in r && r.message).toBe('The action phase is over; cancel this combat (Combat → More → Cancel combat)');
  });
});

describe('state', () => {
  it('a mid-combat state survives a JSON round trip', () => {
    const b = battle([lead('malediction')], [lead('crow'), sup('crow', 'small')], { defender: { tiers: ['U2'] } });
    noRetreat(b);
    hit(b, 'attacker', b.uids.defender[0]!, dice({ aim2: 3, damage: 2 }));
    expect(b.c().attack!.overflow).not.toBe(null);
    expect(JSON.parse(JSON.stringify(b.t.game))).toStrictEqual(b.t.game);
  });
});

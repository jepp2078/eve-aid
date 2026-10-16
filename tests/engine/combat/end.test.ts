import { describe, expect, it } from 'vitest';
import { DEV } from '../../../src/data/developments';
import { ship as shipData } from '../../../src/data/ships';
import type { FactionId } from '../../../src/data/types';
import { apply } from '../../../src/engine/apply';
import { computeOutcome, strengthBreakdown } from '../../../src/engine/combat/end';
import { isError, type Command, type Notice } from '../../../src/engine/types';
import { startedGame } from '../helpers';
import { battle, deepFreeze, dice, expectRejected, hit, lead, miss, noRetreat, sup, type Battle } from './fixtures';

const outcome = (b: Battle) => computeOutcome(b.t.game, b.c());
const finish = (noEscape = false): Command => ({ type: 'combatFinish', noEscape });

/** Marks a ship destroyed and removed, as a finished attack would. */
function kill(b: Battle, uid: string): void {
  const s = b.ship(uid);
  s.damage = shipData(s.ship).hp;
  s.destroyed = true;
  s.removed = true;
}

/** Jumps the combat to its end stage (as round 3 or an elimination would). */
function toEnd(b: Battle): void {
  const c = b.c();
  c.stage = 'end';
  c.step = null;
  c.attack = null;
  c.outcome = computeOutcome(b.t.game, c);
}

const STRATEGY = (a: FactionId, d: FactionId): Notice[] => [
  { to: a, text: 'Discard the strategy cards used', kind: 'todo' },
  { to: d, text: 'Discard the strategy cards used', kind: 'todo' },
];
const ESCAPE =
  'Move your surviving fleet to an adjacent explored system that no other player controls and that holds no enemy ships, then give it a Fleet Exhausted token';

// ---------------------------------------------------------------------------------------------------------------

describe('computeOutcome', () => {
  it('the higher surviving strength wins (small 1, medium 3, large 5)', () => {
    const b = battle([lead('zealot')], [lead('crow')]);
    expect(outcome(b)).toStrictEqual({
      winner: 'attacker', strength: { attacker: 3, defender: 1 }, vp: {}, events: { attacker: 0, defender: 0 }, insurance: {},
    });
  });

  it('a tie goes to the defender', () => {
    const b = battle([lead('malediction')], [lead('crow')]);
    expect(outcome(b)).toMatchObject({ winner: 'defender', strength: { attacker: 1, defender: 1 } });
  });

  it('mutual destruction: the attacker loses', () => {
    const b = battle([lead('malediction')], [lead('crow')]);
    kill(b, b.uid('attacker', 'malediction'));
    kill(b, b.uid('defender', 'crow'));
    expect(outcome(b)).toStrictEqual({
      winner: 'defender', strength: { attacker: 0, defender: 0 }, vp: {}, events: { attacker: 0, defender: 1 }, insurance: {},
    });
  });

  it('a defender at home adds +2 and its citadels (2 each with Upgraded Citadel, +1 Guerilla Warfare) while it has ships', () => {
    const b = battle([lead('zealot'), lead('malediction')], [lead('crow')], { homeOf: 'caldari', citadels: 2 });
    expect(outcome(b)).toMatchObject({ winner: 'defender', strength: { attacker: 4, defender: 5 } });
    b.t.p('caldari').completed.push(DEV.upgradedCitadel);
    expect(outcome(b).strength.defender).toBe(7);
    b.t.p('caldari').completed.push(DEV.guerillaWarfare);
    expect(outcome(b).strength.defender).toBe(8);
    expect(strengthBreakdown(b.t.game, b.c(), 'defender')).toStrictEqual({
      total: 8,
      parts: [
        { kind: 'ships', size: 'small', count: 1, amount: 1 },
        { kind: 'home', amount: 2 },
        { kind: 'citadels', count: 2, upgraded: true, amount: 4 },
        { kind: 'guerilla', amount: 1 },
      ],
    });
    expect(strengthBreakdown(b.t.game, b.c(), 'attacker')).toStrictEqual({
      total: 4,
      parts: [{ kind: 'ships', size: 'small', count: 1, amount: 1 }, { kind: 'ships', size: 'medium', count: 1, amount: 3 }],
    });
    kill(b, b.uid('defender', 'crow'));
    expect(strengthBreakdown(b.t.game, b.c(), 'defender')).toStrictEqual({ total: 0, parts: [] });
    expect(outcome(b)).toMatchObject({ winner: 'attacker', strength: { attacker: 4, defender: 0 }, vp: { amarr: 1 } });
  });

  it('citadels and Guerilla Warfare count for the system controller; +2 for the home system owner', () => {
    const b = battle([lead('zealot')], [lead('crow')], {
      homeOf: 'caldari', controller: 'amarr', citadels: 1, attacker: { devs: [DEV.guerillaWarfare] }, defender: { devs: [DEV.guerillaWarfare] },
    });
    expect(outcome(b)).toMatchObject({ winner: 'attacker', strength: { attacker: 5, defender: 3 } });
  });

  it('the side that retreated loses, whatever the strength', () => {
    const b = battle([lead('zealot')], [lead('crow')]);
    b.c().retreatedSide = 'attacker';
    expect(outcome(b)).toMatchObject({ winner: 'defender', strength: { attacker: 3, defender: 1 } });
    b.c().retreatedSide = 'defender';
    expect(outcome(b)).toMatchObject({ winner: 'attacker' });
  });

  it('the attacker gets 1 VP only if it won and destroyed at least one ship', () => {
    const won = battle([lead('zealot')], [lead('crow'), sup('buzzard', 'small')]);
    kill(won, won.uid('defender', 'buzzard'));
    expect(outcome(won)).toMatchObject({ winner: 'attacker', vp: { amarr: 1 } });

    const noKill = battle([lead('zealot')], [lead('crow')]);
    expect(outcome(noKill)).toMatchObject({ winner: 'attacker', vp: {} });

    const lost = battle([lead('malediction')], [lead('crow'), sup('crow', 'small')]);
    kill(lost, lost.uid('defender', 'crow', 1));
    expect(outcome(lost)).toMatchObject({ winner: 'defender', vp: {} });
  });

  it('Space Warlord: +1 VP to the winner', () => {
    const a = battle([lead('zealot')], [lead('crow'), sup('buzzard', 'small')], {
      attacker: { devs: [DEV.spaceWarlord] }, defender: { devs: [DEV.spaceWarlord] },
    });
    kill(a, a.uid('defender', 'buzzard'));
    expect(outcome(a).vp).toStrictEqual({ amarr: 2 });

    const d = battle([lead('malediction')], [lead('crow')], { defender: { devs: [DEV.spaceWarlord] } });
    expect(outcome(d).vp).toStrictEqual({ caldari: 1 });
  });

  it('reparations: 1 Event card per full 3 strength lost, +1 for a defender that lost a ship', () => {
    const b = battle([lead('zealot'), sup('curse', 'medium'), lead('malediction')], [lead('crow'), sup('crow', 'small'), lead('rook')]);
    kill(b, b.uid('attacker', 'zealot'));
    kill(b, b.uid('attacker', 'curse'));
    kill(b, b.uid('defender', 'crow', 1));
    expect(outcome(b).events).toStrictEqual({ attacker: 2, defender: 1 });
    kill(b, b.uid('defender', 'rook'));
    expect(outcome(b).events).toStrictEqual({ attacker: 2, defender: 2 });
  });

  it('Spaceship Insurance pays 2/4/6 ISK per small/medium/large ship lost', () => {
    const b = battle([lead('zealot'), lead('malediction')], [lead('crow'), lead('rook'), lead('widow')], {
      defender: { devs: [DEV.spaceshipInsurance] },
    });
    for (const uid of [...b.uids.defender, b.uid('attacker', 'malediction')]) kill(b, uid);
    expect(outcome(b).insurance).toStrictEqual({ caldari: 12 });
  });
});

describe('combatFinish', () => {
  it('after an elimination: attacker VP, Space Warlord, lost ships leave, insurance, reparations; the combat is cleared', () => {
    const b = battle([lead('zealot'), lead('malediction')], [lead('crow'), sup('buzzard', 'small')], {
      attacker: { devs: [DEV.spaceWarlord] }, defender: { devs: [DEV.spaceshipInsurance] },
    });
    noRetreat(b);
    const [crow, buzzard] = b.uids.defender as [string, string];
    hit(b, 'attacker', crow, dice({ aim2: 3, damage: 2 }));
    b.t.dispatch('amarr', { type: 'combatOverflow', target: buzzard });
    hit(b, 'defender', b.uid('attacker', 'malediction'), dice({ aim: 3, damage: 1 }));
    expect(b.c().stage).toBe('end');
    expect(b.c().outcome).toStrictEqual({
      winner: 'attacker', strength: { attacker: 3, defender: 0 }, vp: { amarr: 2 }, events: { attacker: 0, defender: 1 }, insurance: { caldari: 4 },
    });

    const r = b.t.dispatch('caldari', finish());
    expect(b.t.game.combat).toBe(null);
    expect(b.t.p('amarr').vp).toBe(2);
    expect(b.t.p('amarr').ships).toStrictEqual({ anathema: 1, zealot: 1 });
    expect(b.t.p('caldari').ships).toStrictEqual({});
    expect(b.t.p('caldari').res.isk).toBe(8);
    expect(r.lines).toStrictEqual([
      'Caldari finished the combat: Amarr won (strength 3 against 0)',
      'Amarr won the attack and destroyed 2 ships',
      'Ana gains 1 VP (1 total)',
      'Space Warlord: Amarr won a combat',
      'Ana gains 1 VP (2 total)',
      'Amarr lost Malediction; Caldari lost Crow + Buzzard',
      'Spaceship Insurance: Caldari gains 4 ISK',
    ]);
    expect(r.notices).toStrictEqual([{ to: 'caldari', text: 'Draw 1 Event card (reparations)', kind: 'todo' }, ...STRATEGY('amarr', 'caldari')]);
  });

  it('a loser with survivors must escape; no kill, no attacker VP', () => {
    const b = battle([lead('zealot')], [lead('crow')]);
    toEnd(b);
    const r = b.t.dispatch('amarr', finish());
    expect(r.lines).toStrictEqual(['Amarr finished the combat: Amarr won (strength 3 against 1)']);
    expect(r.notices).toStrictEqual([{ to: 'caldari', text: ESCAPE, kind: 'todo' }, ...STRATEGY('amarr', 'caldari')]);
    expect(b.t.p('amarr').vp).toBe(0);
    expect(b.t.p('caldari').ships).toStrictEqual({ buzzard: 1, crow: 1 });
  });

  it('noEscape: the loser\'s survivors are destroyed too, with their own reparations and insurance', () => {
    const b = battle([lead('zealot'), lead('redeemer')], [lead('crow'), sup('crow', 'small'), lead('rook')], {
      defender: { devs: [DEV.spaceshipInsurance] },
    });
    kill(b, b.uid('defender', 'crow', 1));
    toEnd(b);
    // 8 against 4: Caldari lost 1 strength in the battle (0 cards, +1 as the defender)
    expect(b.c().outcome).toMatchObject({ winner: 'attacker', vp: { amarr: 1 }, events: { attacker: 0, defender: 1 }, insurance: { caldari: 2 } });

    const r = b.t.dispatch('amarr', finish(true));
    expect(b.t.p('caldari').ships).toStrictEqual({ buzzard: 1 });
    expect(b.t.p('caldari').res.isk).toBe(4 + 2 + 2 + 4);
    expect(b.t.p('amarr').vp).toBe(1);
    expect(r.lines).toStrictEqual([
      'Amarr finished the combat: Amarr won (strength 8 against 4)',
      'Amarr won the attack and destroyed 1 ship',
      'Ana gains 1 VP (1 total)',
      "Caldari's surviving fleet could not escape and is destroyed: Crow + Rook",
      'Caldari lost 2× Crow + Rook',
      'Spaceship Insurance: Caldari gains 8 ISK',
    ]);
    // 5 strength lost in all: 1 + 1 cards; 1 of them was owed already
    expect(r.notices).toStrictEqual([
      { to: 'caldari', text: 'Draw 1 Event card (reparations)', kind: 'todo' },
      { to: 'caldari', text: 'Draw 1 Event card (reparations for the fleet that could not escape)', kind: 'todo' },
      ...STRATEGY('amarr', 'caldari'),
    ]);
  });

  it('noEscape does nothing when the loser has no survivors', () => {
    const b = battle([lead('zealot')], [lead('crow')]);
    kill(b, b.uid('defender', 'crow'));
    toEnd(b);
    const r = b.t.dispatch('amarr', finish(true));
    expect(r.notices).toStrictEqual([{ to: 'caldari', text: 'Draw 1 Event card (reparations)', kind: 'todo' }, ...STRATEGY('amarr', 'caldari')]);
  });

  it('after a retreat the retreater loses and escapes; other untapped Pacifist holders may use Pacifist', () => {
    const t = startedGame(['amarr', 'caldari', 'gallente', 'minmatar']);
    for (const f of ['amarr', 'caldari', 'gallente', 'minmatar'] as const) t.p(f).completed.push(DEV.pacifist);
    t.p('minmatar').tapped.push(DEV.pacifist);
    const b = battle([lead('zealot')], [lead('crow')], { table: t });
    t.dispatch('amarr', { type: 'combatRetreat', retreat: true });
    miss(b, 'defender');
    expect(b.c()).toMatchObject({ stage: 'end', outcome: { winner: 'defender' } });

    const r = t.dispatch('caldari', finish());
    expect(r.lines).toStrictEqual(['Caldari finished the combat: Caldari won (Amarr retreated)']);
    expect(r.notices).toStrictEqual([
      { to: 'amarr', text: ESCAPE, kind: 'todo' },
      ...STRATEGY('amarr', 'caldari'),
      { to: 'caldari', text: 'Amarr retreated — you may Use Pacifist', kind: 'todo' },
      { to: 'gallente', text: 'Amarr retreated — you may Use Pacifist', kind: 'todo' },
    ]);
  });

  it('VP goes through gainVP: other Lobbyist holders are paid', () => {
    const t = startedGame(['amarr', 'caldari', 'gallente']);
    t.p('gallente').completed.push(DEV.lobbyist);
    const b = battle([lead('zealot')], [lead('crow'), sup('buzzard', 'small')], { table: t });
    kill(b, b.uid('defender', 'buzzard'));
    toEnd(b);
    const isk = t.p('gallente').res.isk;
    t.dispatch('amarr', finish());
    expect(t.p('amarr').vp).toBe(1);
    expect(t.p('gallente').res.isk).toBe(isk + 1);
  });

  it('only an involved side, only once the combat is over', () => {
    const t = startedGame(['amarr', 'caldari', 'gallente']);
    const b = battle([lead('zealot')], [lead('crow')], { table: t });
    expectRejected(t, 'amarr', finish(), 'wrong_stage');
    toEnd(b);
    expectRejected(t, 'gallente', finish(), 'not_in_combat');
    expectRejected(t, 'amarr', { type: 'combatFinish', noEscape: 'yes' as never }, 'bad_command');
    t.dispatch('amarr', finish());
    expectRejected(t, 'amarr', finish(), 'no_combat');
  });

  it('recomputes the outcome rather than trusting the stored one', () => {
    const b = battle([lead('zealot')], [lead('crow')]);
    toEnd(b);
    b.c().outcome = { winner: 'defender', strength: { attacker: 0, defender: 9 }, vp: { caldari: 5 }, events: { attacker: 9, defender: 9 }, insurance: {} };
    b.t.dispatch('caldari', finish());
    expect(b.t.p('caldari').vp).toBe(0);
  });

  it('never mutates its inputs and keeps the state JSON-safe', () => {
    const b = battle([lead('zealot')], [lead('crow'), sup('buzzard', 'small')], { defender: { devs: [DEV.spaceshipInsurance] } });
    kill(b, b.uid('defender', 'buzzard'));
    toEnd(b);
    const game = deepFreeze(structuredClone(b.t.game));
    const r = apply(game, deepFreeze(finish(true)), deepFreeze(b.t.ctxFor(b.t.uids.caldari)));
    if (isError(r)) throw new Error(r.code);
    expect(r.game.combat).toBe(null);
    expect(r.game.players.caldari!.ships).toStrictEqual({});
    expect(JSON.parse(JSON.stringify(r.game))).toStrictEqual(r.game);
  });
});

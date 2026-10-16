import { describe, expect, it } from 'vitest';
import { DEV } from '../../../src/data/developments';
import { ship as shipData } from '../../../src/data/ships';
import type { FactionId, Orbit, ShipId } from '../../../src/data/types';
import { isError, type Command } from '../../../src/engine/types';
import { startedGame, type Table } from '../helpers';
import { battle, codeOf, dice, expectRejected, hit, lead, losePanther, miss, noRetreat, sup, type Battle, type Placement } from './fixtures';

const start = (defender: FactionId): Command => ({ type: 'combatStart', defender, homeOf: null, controller: null, citadels: 0 });
const assign = (...ships: Placement[]): Command => ({ type: 'combatAssign', ships });
const add = (ships: ShipId[], orbit: Orbit): Command => ({ type: 'combatAddShips', ships, orbit });

const lightTable = (): Table => startedGame(['amarr', 'caldari'], { mode: 'light' });

/** The refusal's message (the test fails if the command was accepted). */
function messageOf(t: Table, f: FactionId, cmd: Command): string {
  const r = t.tryDispatch(f, cmd);
  codeOf(r);
  return isError(r) ? r.message : '';
}

describe('light combat: starting', () => {
  it('a light combat starts without fleets on record', () => {
    const t = lightTable();
    expect(t.p('amarr').ships).toStrictEqual({});
    expect(t.p('caldari').ships).toStrictEqual({});
    const r = t.dispatch('amarr', start('caldari'));
    expect(t.game.combat).toMatchObject({ attacker: 'amarr', defender: 'caldari', stage: 'assign' });
    expect(r.lines).toStrictEqual(['Amarr attacked Caldari']);
  });

  it('a full game with no ships on the board still refuses, on either side', () => {
    const t = startedGame(['amarr', 'caldari']);
    t.p('caldari').ships = {};
    expect(messageOf(t, 'amarr', start('caldari'))).toBe('Caldari has no ships on the board to fight with');
    expectRejected(t, 'amarr', start('caldari'), 'no_ships');

    const u = startedGame(['amarr', 'caldari']);
    u.p('amarr').ships = {};
    expect(messageOf(u, 'amarr', start('caldari'))).toBe('You have no ships on the board to attack with');
    expectRejected(u, 'amarr', start('caldari'), 'no_ships');
  });

  it('the other checks still apply in a light game', () => {
    const t = lightTable();
    expectRejected(t, 'amarr', start('amarr'), 'bad_target');
    expectRejected(t, 'caldari', start('amarr'), 'not_your_turn');
    t.dispatch('amarr', start('caldari'));
    expectRejected(t, 'amarr', start('caldari'), 'combat_active');
  });
});

describe('light combat: assigning ships', () => {
  const open = (): Table => {
    const t = lightTable();
    t.dispatch('amarr', start('caldari'));
    return t;
  };

  it('ships are limited by the box, not a fleet', () => {
    const t = open();
    expect(shipData('malediction').qty).toBeGreaterThanOrEqual(2);
    const r = t.dispatch('amarr', assign(lead('malediction'), sup('malediction', 'small')));
    expect(r.lines).toStrictEqual(['Amarr assigned 2 ships (small: 2× Malediction)']);
    expect(t.game.combat?.ships.map((s) => s.ship)).toStrictEqual(['malediction', 'malediction']);
    expect(t.p('amarr').ships).toStrictEqual({});

    // The whole box: all `qty` of a small ship and all of a large one.
    const { qty } = shipData('anathema');
    const all = open();
    all.dispatch('amarr', assign(lead('anathema'), ...Array.from({ length: qty - 1 }, () => sup('anathema', 'small'))));
    expect(all.game.combat?.ships).toHaveLength(qty);
    expect(all.p('amarr').ships).toStrictEqual({});
  });

  it('refuses more models than the box holds (no_models), naming the box', () => {
    const t = open();
    const { qty, name } = shipData('malediction');
    const tooMany = [lead('malediction'), ...Array.from({ length: qty }, () => sup('malediction', 'small'))];
    expect(tooMany).toHaveLength(qty + 1);
    expect(messageOf(t, 'amarr', assign(...tooMany))).toBe(`The box has ${qty} ${name}`);
    expectRejected(t, 'amarr', assign(...tooMany), 'no_models');

    // Large ships come two to a box.
    const redeemer = shipData('redeemer');
    expect(redeemer.qty).toBe(2);
    const three = assign(lead('redeemer'), sup('redeemer', 'large'), sup('redeemer', 'large'));
    expect(messageOf(t, 'amarr', three)).toBe('The box has 2 Redeemer');
    expectRejected(t, 'amarr', three, 'no_models');
    expect(t.game.combat?.sides.attacker.assigned).toBe(false);
  });

  it('the box limit is per ship, and a full game still answers not_owned', () => {
    const t = open();
    // Two different ships at their limit each are fine.
    const r = t.dispatch('amarr', assign(lead('redeemer'), sup('redeemer', 'large'), sup('paladin', 'large')));
    expect(r.lines[0]).toBe('Amarr assigned 3 ships (large: 2× Redeemer + Paladin)');

    const full = startedGame(['amarr', 'caldari']);
    full.dispatch('amarr', start('caldari'));
    full.p('amarr').ships = { malediction: 1 };
    const two = assign(lead('malediction'), sup('malediction', 'small'));
    expect(messageOf(full, 'amarr', two)).toBe('You have 1 Malediction on the board, not 2');
    expectRejected(full, 'amarr', two, 'not_owned');
  });

  it('leader size, two_leaders, no_leader and wrong_faction still apply', () => {
    const t = open();
    expectRejected(t, 'amarr', assign({ ship: 'zealot', orbit: 'small', role: 'leader' }), 'bad_leader');
    expectRejected(t, 'amarr', assign(lead('malediction'), lead('anathema')), 'two_leaders');
    expectRejected(t, 'amarr', assign(lead('malediction'), sup('zealot', 'medium')), 'no_leader');
    expectRejected(t, 'amarr', assign(lead('crow')), 'wrong_faction');
    expectRejected(t, 'amarr', assign(), 'no_ships');
    expectRejected(t, 'caldari', assign(lead('crow')), 'wait_attacker');
  });

  it('both sides place from the box and the combat reaches the start stage', () => {
    const t = open();
    t.dispatch('amarr', assign(lead('malediction')));
    const r = t.dispatch('caldari', assign(lead('crow'), sup('crow', 'small')));
    expect(t.game.combat?.stage).toBe('start');
    expect(r.lines.at(-1)).toBe('Both fleets are in place: reveal strategy cards');
    expect(t.p('caldari').ships).toStrictEqual({});
  });
});

describe('light combat: adding ships mid-battle', () => {
  const crows = (n: number): Placement[] => [lead('crow'), ...Array.from({ length: n - 1 }, () => sup('crow', 'small'))];

  it('adding ships counts what is already in the battle', () => {
    const t = lightTable();
    const { qty, name } = shipData('crow');
    const b = battle([lead('malediction')], crows(qty - 1), { table: t });
    losePanther(b, 'defender', 2);
    expect(b.c().ships.filter((s) => s.ship === 'crow')).toHaveLength(qty - 1);

    expect(messageOf(t, 'caldari', add(['crow', 'crow'], 'small'))).toBe(`Only 1 more ${name} in the box`);
    expectRejected(t, 'caldari', add(['crow', 'crow'], 'small'), 'no_models');

    const r = t.dispatch('caldari', add(['crow'], 'small'));
    expect(r.lines).toStrictEqual(['Caldari added Crow to the small orbit']);
    expect(b.c().ships.filter((s) => s.ship === 'crow')).toHaveLength(qty);
    expect(t.p('caldari').ships).toStrictEqual({});

    // The box is empty of Crows now, but another small ship is still there.
    expect(messageOf(t, 'caldari', add(['crow'], 'small'))).toBe(`No more ${name} in the box`);
    expectRejected(t, 'caldari', add(['crow'], 'small'), 'no_models');
    t.dispatch('caldari', add(['buzzard'], 'small'));
    expect(t.p('caldari').ships).toStrictEqual({});
  });

  it('the other add rules still apply, and a full game keeps its own count and message', () => {
    const t = lightTable();
    losePanther(battle([lead('malediction')], [lead('crow')], { table: t }), 'defender', 2);
    expectRejected(t, 'caldari', add(['crow'], 'medium'), 'bad_orbit');
    expectRejected(t, 'caldari', add(['rook'], 'small'), 'bad_ship');
    expectRejected(t, 'caldari', add(['malediction'], 'small'), 'wrong_faction');
    expectRejected(t, 'caldari', add([], 'small'), 'no_ships');

    const u = lightTable();
    losePanther(battle([lead('malediction')], [lead('rook')], { table: u }), 'defender');
    const r = u.dispatch('caldari', add(['crow', 'buzzard'], 'small'));
    expect(r.lines).toStrictEqual(['Caldari added Crow + Buzzard to the small orbit (Crow leads it)']);

    const full = battle([lead('malediction')], [lead('crow')]);
    losePanther(full, 'defender', 2);
    full.t.p('caldari').ships.crow = 4;
    expect(messageOf(full.t, 'caldari', add(['crow', 'crow'], 'small'))).toBe('Only 1 more Crow models are available');
    full.t.dispatch('caldari', add(['crow'], 'small'));
    expect(full.t.p('caldari').ships).toStrictEqual({ buzzard: 1, crow: 5 });
  });
});

describe('light combat: finishing', () => {
  /** A fight to the end stage: the Crow (small orbit, so first) misses, then the Zealot kills it. */
  function fight(t: Table): Battle {
    const b = battle([lead('zealot')], [lead('crow')], { table: t, defender: { devs: [DEV.spaceshipInsurance] } });
    noRetreat(b);
    miss(b, 'defender');
    hit(b, 'attacker', b.uid('defender', 'crow'), dice({ aim: 3, damage: 1 }));
    expect(b.c().stage).toBe('end');
    return b;
  }

  it('finishing a light combat leaves no fleet record and turns insurance into a to-do', () => {
    const t = lightTable();
    const b = fight(t);
    expect(b.c().outcome).toMatchObject({ winner: 'attacker', vp: { amarr: 1 }, insurance: { caldari: 2 } });

    const r = t.dispatch('caldari', { type: 'combatFinish', noEscape: false });
    expect(t.game.combat).toBe(null);
    expect(t.p('amarr').ships).toStrictEqual({});
    expect(t.p('caldari').ships).toStrictEqual({});
    expect(t.p('caldari').res.isk).toBe(0);
    expect(t.p('amarr').vp).toBe(1);
    expect(r.notices).toContainEqual({ to: 'caldari', text: 'Spaceship Insurance: take 2 ISK', kind: 'todo' });
    expect(r.lines).toStrictEqual([
      'Caldari finished the combat: Amarr won (strength 3 against 0)',
      'Amarr won the attack and destroyed 1 ship',
      'Ana gains 1 VP (1 total)',
      'Caldari lost Crow',
      'Caldari: Spaceship Insurance: take 2 ISK',
    ]);
    expect(r.notices).toStrictEqual([
      { to: 'caldari', text: 'Spaceship Insurance: take 2 ISK', kind: 'todo' },
      { to: 'caldari', text: 'Draw 1 Event card (reparations)', kind: 'todo' },
      { to: 'amarr', text: 'Discard the strategy cards used', kind: 'todo' },
      { to: 'caldari', text: 'Discard the strategy cards used', kind: 'todo' },
    ]);
  });

  it('the same fight in a full game keeps its fleets, pays the ISK and logs as before', () => {
    const t = startedGame(['amarr', 'caldari']);
    t.p('caldari').ships = {};
    const amarrFleet = { ...t.p('amarr').ships, zealot: 1 }; // the fixture adds the Zealot it fights with
    const isk = t.p('caldari').res.isk;
    fight(t);
    const r = t.dispatch('caldari', { type: 'combatFinish', noEscape: false });
    expect(t.p('amarr').ships).toStrictEqual(amarrFleet);
    expect(t.p('caldari').ships).toStrictEqual({});
    expect(t.p('caldari').res.isk).toBe(isk + 2);
    expect(r.lines).toContain('Spaceship Insurance: Caldari gains 2 ISK');
    expect(r.lines.some((l) => l.includes('take'))).toBe(false);
    expect(r.notices.some((n) => n.text.startsWith('Spaceship Insurance'))).toBe(false);
  });

  it('insurance is per ship size, for each side that holds the card, and the other notices are as in a full game', () => {
    const t = lightTable();
    const b = battle([lead('zealot'), lead('malediction')], [lead('crow'), lead('rook'), lead('widow')], {
      table: t,
      attacker: { devs: [DEV.spaceshipInsurance, DEV.spaceWarlord] },
      defender: { devs: [DEV.spaceshipInsurance] },
    });
    // Everything the defender has dies, and the attacker's Malediction with it.
    for (const uid of [...b.uids.defender, b.uid('attacker', 'malediction')]) {
      const s = b.ship(uid);
      s.damage = shipData(s.ship).hp;
      s.destroyed = true;
      s.removed = true;
    }
    const c = b.c();
    c.stage = 'end';
    c.step = null;
    c.attack = null;

    const r = t.dispatch('amarr', { type: 'combatFinish', noEscape: false });
    const take = r.notices.filter((n) => n.text.startsWith('Spaceship Insurance'));
    expect(take).toStrictEqual([
      { to: 'amarr', text: 'Spaceship Insurance: take 2 ISK', kind: 'todo' },
      { to: 'caldari', text: 'Spaceship Insurance: take 12 ISK', kind: 'todo' },
    ]);
    expect(r.lines).toContain('Space Warlord: Amarr won a combat');
    expect(r.lines).toContain('Amarr lost Malediction; Caldari lost Crow + Rook + Widow');
    expect(t.p('amarr').vp).toBe(2);
    expect(t.p('amarr').res.isk).toBe(0);
    expect(t.p('caldari').res.isk).toBe(0);
    expect(t.p('amarr').ships).toStrictEqual({});
    expect(t.p('caldari').ships).toStrictEqual({});
  });

  it('a side without the card gets no insurance notice', () => {
    const t = lightTable();
    const b = battle([lead('zealot')], [lead('crow')], { table: t });
    noRetreat(b);
    miss(b, 'defender');
    hit(b, 'attacker', b.uid('defender', 'crow'), dice({ aim: 3, damage: 1 }));
    const r = t.dispatch('amarr', { type: 'combatFinish', noEscape: false });
    expect(r.notices.some((n) => n.text.includes('Insurance'))).toBe(false);
    expect(r.lines.some((l) => l.includes('Insurance'))).toBe(false);
  });
});

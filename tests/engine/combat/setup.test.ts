import { describe, expect, it } from 'vitest';
import { DEV } from '../../../src/data/developments';
import type { FactionId } from '../../../src/data/types';
import { apply } from '../../../src/engine/apply';
import { effDif, effStats } from '../../../src/engine/combat/abilities';
import { isError, type ApplyResult, type Command, type CombatSide, type RuleError } from '../../../src/engine/types';
import { NOW, startedGame, uidOf, type Table } from '../helpers';
import { battle, lead, sup, type Placement } from './fixtures';

const start = (defender: FactionId, homeOf: FactionId | null = null, controller: FactionId | null = null, citadels = 0): Command => ({
  type: 'combatStart', defender, homeOf, controller, citadels,
});
const assign = (...ships: Placement[]): Command => ({ type: 'combatAssign', ships });
const choices = (c: Partial<Extract<Command, { type: 'combatStartChoices' }>> = {}): Command => ({
  type: 'combatStartChoices', citadelOrbit: null, vanguardOrbit: null, evasive: [], curse: null, ...c,
});

function codeOf(r: ApplyResult | RuleError): string {
  if (!isError(r)) throw new Error(`expected a RuleError, got success: ${r.lines.join(' | ')}`);
  return r.code;
}

/** Rejected commands must leave the table exactly as it was. */
function expectRejected(t: Table, f: FactionId, cmd: Command, code: string): void {
  const game = structuredClone(t.game);
  const privs = structuredClone(t.privs);
  expect(codeOf(t.tryDispatch(f, cmd))).toBe(code);
  expect(t.game).toStrictEqual(game);
  expect(t.privs).toStrictEqual(privs);
}

const freshSide = (faction: FactionId): CombatSide => ({
  faction, assigned: false, ready: false, citadelOrbit: null, vanguardOrbit: null, curse: null,
});

function deepFreeze<T>(x: T): T {
  if (typeof x === 'object' && x !== null && !Object.isFrozen(x)) {
    Object.freeze(x);
    for (const v of Object.values(x)) deepFreeze(v);
  }
  return x;
}

// ---------------------------------------------------------------------------------------------------------------

describe('combatStart', () => {
  it('opens a combat in the assign stage, logs it and tells the defender', () => {
    const t = startedGame(['amarr', 'caldari', 'gallente']);
    const r = t.dispatch('amarr', start('caldari', 'gallente', null, 1));
    expect(t.game.combat).toStrictEqual({
      attacker: 'amarr', defender: 'caldari', homeOf: 'gallente', controller: 'gallente', citadels: 1,
      stage: 'assign', round: 0, lastRound: 3,
      sides: { attacker: freshSide('amarr'), defender: freshSide('caldari') },
      ships: [], nextUid: 1, retreatAsked: [], retreatedSide: null, step: null, attack: null,
      results: [], kills: { attacker: 0, defender: 0 }, outcome: null,
    });
    expect(r.lines).toStrictEqual(["Amarr attacked Caldari (in Gallente's home system; controlled by Gallente with 1 citadel)"]);
    expect(r.notices).toStrictEqual([
      { to: 'caldari', text: 'Amarr is attacking you: choose a strategy card face down, then assign your ships once Amarr has placed theirs', kind: 'info' },
    ]);
  });

  it('defaults the controller to the home system owner; an explicit controller wins', () => {
    const t = startedGame(['amarr', 'caldari']);
    t.dispatch('amarr', start('caldari', 'caldari', null, 2));
    expect(t.game.combat).toMatchObject({ homeOf: 'caldari', controller: 'caldari', citadels: 2 });

    const u = startedGame(['amarr', 'caldari']);
    const r = u.dispatch('amarr', start('caldari', 'caldari', 'amarr'));
    expect(u.game.combat).toMatchObject({ homeOf: 'caldari', controller: 'amarr', citadels: 0 });
    expect(r.lines).toStrictEqual(["Amarr attacked Caldari (in Caldari's home system; controlled by Amarr)"]);

    const v = startedGame(['amarr', 'caldari']);
    expect(v.dispatch('amarr', start('caldari')).lines).toStrictEqual(['Amarr attacked Caldari']);
    expect(v.game.combat).toMatchObject({ homeOf: null, controller: null, citadels: 0 });
  });

  it('only the turn holder may attack, during the actions phase, with no combat running', () => {
    const t = startedGame(['amarr', 'caldari']);
    expectRejected(t, 'caldari', start('amarr'), 'not_your_turn');
    t.dispatch('amarr', start('caldari'));
    expectRejected(t, 'amarr', start('caldari'), 'combat_active');

    const u = startedGame(['amarr', 'caldari']);
    u.game.phase = 'upkeep';
    expectRejected(u, 'amarr', start('caldari'), 'wrong_phase');
  });

  it('refuses a fight with a side that has no ships on the board: it could never be assigned (M4)', () => {
    const t = startedGame(['amarr', 'caldari']);
    t.p('caldari').ships = {};
    expectRejected(t, 'amarr', start('caldari'), 'no_ships');
    const r = t.tryDispatch('amarr', start('caldari'));
    expect(isError(r) && r.message).toBe('Caldari has no ships on the board to fight with');
    t.p('caldari').ships = { crow: 0 };
    expectRejected(t, 'amarr', start('caldari'), 'no_ships');

    const u = startedGame(['amarr', 'caldari']);
    u.p('amarr').ships = {};
    const own = u.tryDispatch('amarr', start('caldari'));
    expect(codeOf(own)).toBe('no_ships');
    expect(isError(own) && own.message).toBe('You have no ships on the board to attack with');
  });

  it('rejects a defender that is the attacker or not seated, and unseated home/controller factions', () => {
    const t = startedGame(['amarr', 'caldari']);
    expectRejected(t, 'amarr', start('amarr'), 'bad_target');
    expectRejected(t, 'amarr', start('gallente'), 'bad_target');
    expectRejected(t, 'amarr', start('__proto__' as FactionId), 'bad_target');
    expectRejected(t, 'amarr', start('caldari', 'gallente'), 'bad_faction');
    expectRejected(t, 'amarr', start('caldari', null, 'minmatar'), 'bad_faction');
  });

  it('rejects a negative or fractional number of citadels', () => {
    const t = startedGame(['amarr', 'caldari']);
    expectRejected(t, 'amarr', start('caldari', 'caldari', null, -1), 'bad_amount');
    expectRejected(t, 'amarr', start('caldari', 'caldari', null, 1.5), 'bad_amount');
  });
});

// ---------------------------------------------------------------------------------------------------------------

describe('combatAssign', () => {
  it('places the attacker, then the defender, with fresh uids; both placed → start stage', () => {
    const b = battle([], [], { stopAt: 'assign' }); // amarr attacks caldari; default ships: 1 anathema/malediction, 1 buzzard/crow
    const r = b.t.dispatch('amarr', assign(lead('malediction'), sup('anathema', 'small')));
    expect(r.lines).toStrictEqual(['Amarr assigned 2 ships (small: Malediction + Anathema)']);
    expect(r.notices).toStrictEqual([{ to: 'caldari', text: 'Amarr has placed their ships: assign yours', kind: 'info' }]);
    expect(b.c()).toMatchObject({ stage: 'assign', nextUid: 3, sides: { attacker: { assigned: true }, defender: { assigned: false } } });

    b.t.p('caldari').ships.rook = 1;
    const d = b.t.dispatch('caldari', assign(lead('crow'), lead('rook'), sup('buzzard', 'medium')));
    expect(d.lines).toStrictEqual([
      'Caldari assigned 3 ships (small: Crow; medium: Rook + Buzzard)',
      'Both fleets are in place: reveal strategy cards',
    ]);
    expect(d.notices).toStrictEqual([
      { to: 'amarr', text: 'Reveal your strategy card', kind: 'info' },
      { to: 'caldari', text: 'Reveal your strategy card', kind: 'info' },
    ]);
    const ship = (uid: string, id: string, side: 'attacker' | 'defender', orbit: string, role: string) => ({
      uid, ship: id, side, orbit, role, damage: 0, destroyed: false, removed: false, evasive: false,
    });
    expect(b.c().ships).toStrictEqual([
      ship('s1', 'malediction', 'attacker', 'small', 'leader'),
      ship('s2', 'anathema', 'attacker', 'small', 'support'),
      ship('s3', 'crow', 'defender', 'small', 'leader'),
      ship('s4', 'rook', 'defender', 'medium', 'leader'),
      ship('s5', 'buzzard', 'defender', 'medium', 'support'),
    ]);
    expect(b.c()).toMatchObject({ stage: 'start', round: 0, nextUid: 6, sides: { attacker: { assigned: true }, defender: { assigned: true } } });
  });

  it('the defender must wait for the attacker (wait_attacker)', () => {
    const b = battle([], [], { stopAt: 'assign' });
    expectRejected(b.t, 'caldari', assign(lead('crow')), 'wait_attacker');
  });

  it('cannot assign more ships of a name than are owned (not_owned)', () => {
    const b = battle([], [], { stopAt: 'assign' });
    expect(b.t.p('amarr').ships.malediction).toBe(1);
    expectRejected(b.t, 'amarr', assign(lead('malediction'), sup('malediction', 'small')), 'not_owned');
    expectRejected(b.t, 'amarr', assign(lead('zealot')), 'not_owned');
    b.t.p('amarr').ships.malediction = 2;
    b.t.dispatch('amarr', assign(lead('malediction'), sup('malediction', 'small')));
  });

  it('allows one leader per orbit (two_leaders), size-matched (bad_leader), and supports only under a leader (no_leader)', () => {
    const b = battle([], [], { stopAt: 'assign' });
    b.t.p('amarr').ships.zealot = 1;
    expectRejected(b.t, 'amarr', assign(lead('malediction'), lead('anathema')), 'two_leaders');
    expectRejected(b.t, 'amarr', assign(lead('zealot', 'small')), 'bad_leader');
    expectRejected(b.t, 'amarr', assign(lead('malediction', 'medium')), 'bad_leader');
    expectRejected(b.t, 'amarr', assign(lead('malediction'), sup('anathema', 'medium')), 'no_leader');
    expectRejected(b.t, 'amarr', assign(sup('anathema', 'small')), 'no_leader');
    b.t.dispatch('amarr', assign(lead('zealot'), sup('malediction', 'medium'), sup('anathema', 'medium')));
  });

  it('needs at least one known ship of your own faction, in a real orbit and role', () => {
    const b = battle([], [], { stopAt: 'assign' });
    expectRejected(b.t, 'amarr', assign(), 'no_ships');
    expectRejected(b.t, 'amarr', { type: 'combatAssign', ships: 'all' as never }, 'no_ships');
    expectRejected(b.t, 'amarr', assign(lead('crow')), 'wrong_faction');
    expectRejected(b.t, 'amarr', assign({ ship: 'enterprise', orbit: 'small', role: 'leader' }), 'bad_ship');
    expectRejected(b.t, 'amarr', assign({ ship: '__proto__', orbit: 'small', role: 'leader' }), 'bad_ship');
    expectRejected(b.t, 'amarr', assign({ ship: 'malediction', orbit: 'huge' as never, role: 'leader' }), 'bad_orbit');
    expectRejected(b.t, 'amarr', assign({ ship: 'malediction', orbit: 'small', role: 'captain' as never }), 'bad_role');
    expectRejected(b.t, 'amarr', { type: 'combatAssign', ships: [null as never] }, 'bad_ship');
  });

  it('is only for the two combatants, once each, during the assign stage', () => {
    const t = startedGame(['amarr', 'caldari', 'gallente']);
    expectRejected(t, 'amarr', assign(lead('malediction')), 'no_combat');
    t.dispatch('amarr', start('caldari'));
    expectRejected(t, 'gallente', assign(lead('ares')), 'not_in_combat');
    t.dispatch('amarr', assign(lead('malediction')));
    expectRejected(t, 'amarr', assign(lead('anathema')), 'already_assigned');
    t.dispatch('caldari', assign(lead('crow')));
    expectRejected(t, 'caldari', assign(lead('buzzard')), 'wrong_stage');
  });
});

// ---------------------------------------------------------------------------------------------------------------

describe('combatStartChoices', () => {
  it('marks each side ready; both ready → round 1, retreat stage', () => {
    const b = battle([lead('malediction')], [lead('crow')], { stopAt: 'start' });
    const r = b.t.dispatch('amarr', choices());
    expect(r.lines).toStrictEqual(['Amarr is ready for combat']);
    expect(b.c()).toMatchObject({ stage: 'start', round: 0, sides: { attacker: { ready: true }, defender: { ready: false } } });
    expectRejected(b.t, 'amarr', choices(), 'already_ready');
    expect(r.notices).toStrictEqual([{ to: 'caldari', text: 'Amarr has made their start-of-combat choices: make yours', kind: 'info' }]);

    const d = b.t.dispatch('caldari', choices());
    expect(d.lines).toStrictEqual(['Caldari is ready for combat', 'Round 1 begins']);
    expect(b.c()).toMatchObject({ stage: 'retreat', round: 1, retreatAsked: [], sides: { attacker: { ready: true }, defender: { ready: true } } });
    expectRejected(b.t, 'amarr', choices(), 'wrong_stage');
  });

  it('is sequential: the defender waits for the attacker (manual p.28)', () => {
    const b = battle([lead('malediction')], [lead('crow')], { stopAt: 'start' });
    expectRejected(b.t, 'caldari', choices(), 'wait_attacker');
    expect(b.c().sides.defender.ready).toBe(false);
    b.t.dispatch('amarr', choices());
    b.t.dispatch('caldari', choices());
    expect(b.c().stage).toBe('retreat');
  });

  it('is only for the combatants, after both have assigned', () => {
    const t = startedGame(['amarr', 'caldari', 'gallente']);
    expectRejected(t, 'amarr', choices(), 'no_combat');
    t.dispatch('amarr', start('caldari'));
    expectRejected(t, 'amarr', choices(), 'wrong_stage');
    t.dispatch('amarr', assign(lead('malediction')));
    t.dispatch('caldari', assign(lead('crow')));
    expectRejected(t, 'gallente', choices(), 'not_in_combat');
  });

  it('a citadel orbit only for the system controller, and only with citadels', () => {
    const b = battle([lead('malediction')], [lead('crow')], { homeOf: 'caldari', citadels: 1, stopAt: 'start' });
    expectRejected(b.t, 'amarr', choices({ citadelOrbit: 'small' }), 'bad_citadel');
    b.t.dispatch('amarr', choices());
    expectRejected(b.t, 'caldari', choices({ citadelOrbit: 'tiny' as never }), 'bad_orbit');
    const r = b.t.dispatch('caldari', choices({ citadelOrbit: 'small' }));
    expect(r.lines).toStrictEqual(['Caldari is ready for combat (citadel: small orbit)', 'Round 1 begins']);
    expect(b.c().sides.defender.citadelOrbit).toBe('small');

    const none = battle([lead('malediction')], [lead('crow')], { homeOf: 'caldari', citadels: 0, stopAt: 'start' });
    none.t.dispatch('amarr', choices());
    expectRejected(none.t, 'caldari', choices({ citadelOrbit: 'small' }), 'bad_citadel');
  });

  it('a Vanguard Ship orbit only with the Vanguard Ship development', () => {
    const b = battle([lead('malediction')], [lead('crow')], { defender: { devs: [DEV.vanguardShip] }, stopAt: 'start' });
    expectRejected(b.t, 'amarr', choices({ vanguardOrbit: 'small' }), 'bad_vanguard');
    b.t.dispatch('amarr', choices());
    const r = b.t.dispatch('caldari', choices({ vanguardOrbit: 'medium' }));
    expect(r.lines).toStrictEqual(['Caldari is ready for combat (Vanguard Ship: medium orbit)', 'Round 1 begins']);
    expect(b.c().sides.defender.vanguardOrbit).toBe('medium');
  });

  it('evasive only for own explorers with D1 unlocked, each once', () => {
    const fleet = [lead('anathema'), sup('anathema', 'small'), sup('malediction', 'small')];
    const b = battle(fleet, [lead('crow')], { attacker: { tiers: ['D1'] }, stopAt: 'start' });
    const [a1, a2, mal] = b.uids.attacker as [string, string, string];
    const crow = b.uid('defender', 'crow');
    expectRejected(b.t, 'amarr', choices({ evasive: [mal] }), 'bad_evasive');
    expectRejected(b.t, 'amarr', choices({ evasive: [crow] }), 'bad_evasive');
    expectRejected(b.t, 'amarr', choices({ evasive: [a1, a1] }), 'bad_evasive');
    expectRejected(b.t, 'amarr', choices({ evasive: ['s99'] }), 'bad_evasive');
    expectRejected(b.t, 'amarr', choices({ evasive: 'all' as never }), 'bad_evasive');
    const r = b.t.dispatch('amarr', choices({ evasive: [a1, a2] }));
    expect(r.lines).toStrictEqual(['Amarr is ready for combat (evasive: 2× Anathema)']);
    expect(b.c().ships.map((s) => s.evasive)).toStrictEqual([true, true, false, false]);

    const locked = battle([lead('anathema')], [lead('crow')], { stopAt: 'start' });
    expectRejected(locked.t, 'amarr', choices({ evasive: [locked.uid('attacker', 'anathema')] }), 'bad_evasive');
  });

  it('a curse needs an active Curse and an enemy ship in its orbit with an ability in that slot', () => {
    const amarr = [lead('curse'), lead('malediction')];
    const caldari = [lead('rook'), sup('crow', 'medium'), lead('crow'), lead('golem')];
    const b = battle(amarr, caldari, { attacker: { tiers: ['U1'] }, stopAt: 'start' });
    const curse = (ship: string, slot: 'basic' | 'first' | 'second') => choices({ curse: { ship, slot } });
    expectRejected(b.t, 'amarr', curse('crow', 'basic'), 'bad_curse'); // interceptors have no basic ability
    expectRejected(b.t, 'amarr', curse('golem', 'first'), 'bad_curse'); // the Golem is in the large orbit
    expectRejected(b.t, 'amarr', curse('vargur', 'first'), 'bad_curse'); // not in this combat
    expectRejected(b.t, 'amarr', curse('malediction', 'second'), 'bad_curse'); // own ship
    expectRejected(b.t, 'amarr', curse('nonsense', 'first'), 'bad_curse');
    expectRejected(b.t, 'amarr', choices({ curse: { ship: 'crow', slot: 'third' as never } }), 'bad_curse');
    const r = b.t.dispatch('amarr', curse('crow', 'second'));
    expect(r.lines).toStrictEqual(["Amarr is ready for combat (Curse: Crow's 2nd researched ability)"]);
    expect(b.c().sides.attacker.curse).toStrictEqual({ ship: 'crow', slot: 'second' });
    expectRejected(b.t, 'caldari', curse('malediction', 'second'), 'bad_curse'); // Caldari has no Curse

    const locked = battle(amarr, caldari, { stopAt: 'start' }); // no U1: the Curse has no ability
    expectRejected(locked.t, 'amarr', curse('crow', 'second'), 'bad_curse');
  });

  it('the defender is judged against the attacker\'s Curse: a cursed explorer can\'t go evasive', () => {
    const fleets = [[lead('curse')], [lead('rook'), sup('buzzard', 'medium')]];
    const b = battle(fleets[0]!, fleets[1]!, { attacker: { tiers: ['U1'] }, defender: { tiers: ['D1'] }, stopAt: 'start' });
    const buzzard = b.uid('defender', 'buzzard');
    b.t.dispatch('amarr', choices({ curse: { ship: 'buzzard', slot: 'first' } }));
    expectRejected(b.t, 'caldari', choices({ evasive: [buzzard] }), 'bad_evasive');
    b.t.dispatch('caldari', choices());
    expect(b.ship(buzzard).evasive).toBe(false);

    // without the Curse the same choice is fine, and the trade is all-or-nothing
    const free = battle(fleets[0]!, fleets[1]!, { attacker: { tiers: ['U1'] }, defender: { tiers: ['D1'], evasive: [1] } });
    expect(free.ship(free.uid('defender', 'buzzard')).evasive).toBe(true);
  });

  it('logs every choice together', () => {
    const b = battle([lead('anathema'), lead('curse')], [lead('rook'), sup('crow', 'medium')], {
      controller: 'amarr', citadels: 1, attacker: { tiers: ['D1', 'U1'], devs: [DEV.vanguardShip] }, stopAt: 'start',
    });
    const r = b.t.dispatch('amarr', choices({
      citadelOrbit: 'large', vanguardOrbit: 'medium', evasive: [b.uid('attacker', 'anathema')], curse: { ship: 'rook', slot: 'first' },
    }));
    expect(r.lines).toStrictEqual([
      "Amarr is ready for combat (citadel: large orbit; Vanguard Ship: medium orbit; evasive: Anathema; Curse: Rook's 1st researched ability)",
    ]);
    expect(b.c().sides.attacker).toStrictEqual({
      faction: 'amarr', assigned: true, ready: true, citadelOrbit: 'large', vanguardOrbit: 'medium', curse: { ship: 'rook', slot: 'first' },
    });
  });
});

// ---------------------------------------------------------------------------------------------------------------

describe('purity', () => {
  function expectPure(t: Table, f: FactionId, cmd: Command): ApplyResult {
    const before = structuredClone(t.game);
    const game = deepFreeze(structuredClone(t.game));
    const priv = deepFreeze(structuredClone(t.privs[f]));
    const r = apply(game, deepFreeze(structuredClone(cmd)), deepFreeze({ actor: f, uid: uidOf(f), priv, now: NOW }));
    if (isError(r)) throw new Error(`${cmd.type} should succeed, got ${r.code} (${r.message})`);
    expect(game).toStrictEqual(before);
    expect(r.game).not.toStrictEqual(before);
    expect(Object.isFrozen(r.game.combat)).toBe(false);
    return r;
  }

  it('combat setup commands never mutate their inputs', () => {
    const t = startedGame(['amarr', 'caldari']);
    t.p('amarr').completed.push(DEV.defensiveSystemsT1);
    expectPure(t, 'amarr', start('caldari', 'caldari', null, 1));
    t.dispatch('amarr', start('caldari', 'caldari', null, 1));
    expectPure(t, 'amarr', assign(lead('anathema')));
    t.dispatch('amarr', assign(lead('anathema')));
    t.dispatch('caldari', assign(lead('crow')));
    expectPure(t, 'amarr', choices({ evasive: ['s1'] }));
    t.dispatch('amarr', choices({ evasive: ['s1'] }));
    expectPure(t, 'caldari', choices({ citadelOrbit: 'small' }));
  });

  it('keeps state JSON-safe (no undefined anywhere) through setup', () => {
    const b = battle([lead('anathema'), lead('curse')], [lead('rook'), sup('crow', 'medium')], {
      homeOf: 'caldari', citadels: 1,
      attacker: { tiers: ['D1', 'U1'], evasive: [0], curse: { ship: 'crow', slot: 'second' } },
      defender: { citadelOrbit: 'medium' },
    });
    expect(JSON.parse(JSON.stringify(b.t.game))).toStrictEqual(b.t.game);
  });
});

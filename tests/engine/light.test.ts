import { describe, expect, it } from 'vitest';
import { DEV } from '../../src/data/developments';
import type { FactionId } from '../../src/data/types';
import { boardISK, type Out } from '../../src/engine/util';
import { useParamsKind } from '../../src/engine/developments';
import { MAX_GAINED_RESEARCH } from '../../src/engine/light';
import { isError, type AdjustDelta, type CombatState, type Command, type RuleError, type UseParams } from '../../src/engine/types';
import { DEFAULT_SETUP, newGame, startedGame, type Table } from './helpers';

/** Manual p. 24: where a raiding fleet goes, and what happens when it has nowhere to go. */
const raidText = (target: string): string =>
  `Raid on ${target}: move your raiding fleet from ${target}'s home system to an adjacent system that is explored, not a home system, not controlled by another player and free of enemy ships (no exhausted token). If there is none it is destroyed: draw 1 event per full 3 of its strength (reparations)`;

/** The full-only commands, each in a shape that passes its own validation, so only the mode can refuse it. */
const FULL_ONLY: [string, Command][] = [
  ['action:move', { type: 'action', action: 'move' }],
  ['action:claim', { type: 'action', action: 'claim', from: null, central: false }],
  ['action:extract', { type: 'action', action: 'extract', planetary: false, moon: false }],
  ['action:trade', { type: 'action', action: 'trade', ops: [] }],
  ['action:manufacture', { type: 'action', action: 'manufacture', ops: [] }],
  ['action:build', { type: 'action', action: 'build', items: [] }],
  ['discover', { type: 'discover', rewards: [] }],
  ['autoClaim', { type: 'autoClaim', central: false }],
  ['payJump', { type: 'payJump', planetary: 0, moon: 0 }],
  ['deployableInfrastructure', { type: 'deployableInfrastructure', structure: 'engineering', home: false, discount: { bp: 0, isk: 0, pyrite: false } }],
  ['discardMinerals', { type: 'discardMinerals', minerals: {} }],
  ['confirmUpkeep', { type: 'confirmUpkeep', refinery: { planetary: 0, moon: 0, convert: 0 }, discard: {}, raids: [], researchLab: false }],
];

describe('light games: creation and gating', () => {
  it('creates a light game whose players start with nothing on the board', () => {
    const t = startedGame(['amarr', 'caldari'], { mode: 'light' });
    expect(t.game.mode).toBe('light');
    expect(t.p('amarr').res.isk).toBe(0);
    expect(t.p('amarr').ships).toStrictEqual({});
    expect(t.privs.amarr.area).toHaveLength(4);
    expect(t.game.phase).toBe('actions');
  });

  it('starts every resource at nothing and keeps the rest of the player shape', () => {
    const t = startedGame(['amarr', 'caldari'], { mode: 'light' });
    expect(t.p('caldari').res).toStrictEqual({ isk: 0, pyrite: 0, mexallon: 0, tritanium: 0, morphite: 0, planetary: 0, moon: 0, component: 0 });
    expect(t.p('caldari').belts).toStrictEqual({ pyrite: 0, mexallon: 0, tritanium: 0, morphite: 0 });
    expect(t.p('caldari')).toMatchObject({ vp: 0, systems: 0, central: false, passed: false, setupDone: true, devAreaCount: 4, lockedHomeBelts: 2 });
  });

  it('full games keep their starting ISK and ships', () => {
    const t = startedGame(['amarr', 'caldari']);
    expect(t.game.mode).toBe('full');
    expect(t.p('amarr').res.isk).toBe(4);
    expect(Object.keys(t.p('amarr').ships)).toHaveLength(2);
  });

  it.each(FULL_ONLY)('refuses %s in a light game, changing nothing', (_, cmd) => {
    const t = startedGame(['amarr', 'caldari'], { mode: 'light' });
    const before = structuredClone(t.game);
    const privBefore = structuredClone(t.privs.amarr);
    expect(t.tryDispatch('amarr', cmd)).toStrictEqual({ error: true, code: 'wrong_mode', message: 'Not used in a scorekeeper game' });
    expect(t.game).toStrictEqual(before);
    expect(t.privs.amarr).toStrictEqual(privBefore);
  });

  it('answers wrong_mode for any device, before it asks who is acting', () => {
    const t = startedGame(['amarr', 'caldari'], { mode: 'light' });
    const r = t.tryAsUid('stranger', { type: 'action', action: 'move' });
    expect(isError(r) && r.code).toBe('wrong_mode');
  });

  it('keeps every full-only command answering as before in a full game', () => {
    const t = startedGame(['amarr', 'caldari']);
    for (const [, cmd] of FULL_ONLY) {
      const r = t.tryDispatch('amarr', cmd);
      expect(isError(r) ? r.code : null).not.toBe('wrong_mode');
    }
  });

  it('a light setup takes no belt; a full setup still needs one', () => {
    const light = newGame(['amarr', 'caldari'], { mode: 'light' });
    light.dispatch('amarr', { type: 'startGame', firstPlayer: 'amarr' });
    const devs = DEFAULT_SETUP.amarr.devs;
    expect(light.tryDispatch('amarr', { type: 'setupFaction', revealedBelt: 'pyrite', devs })).toStrictEqual({
      error: true, code: 'bad_belt', message: "Scorekeeper games don't track belts",
    });
    expect(light.p('amarr').setupDone).toBe(false);

    const full = newGame(['amarr', 'caldari']);
    full.dispatch('amarr', { type: 'startGame', firstPlayer: 'amarr' });
    const r = full.tryDispatch('amarr', { type: 'setupFaction', revealedBelt: null, devs });
    expect(isError(r) && r.code).toBe('bad_belt');
    expect(full.p('amarr').setupDone).toBe(false);
  });

  it('a light setup deals the developments and gives no belt or mineral', () => {
    const t = newGame(['amarr', 'caldari'], { mode: 'light' });
    t.dispatch('amarr', { type: 'startGame', firstPlayer: 'amarr' });
    const r = t.dispatch('amarr', { type: 'setupFaction', revealedBelt: null, devs: DEFAULT_SETUP.amarr.devs });
    expect(t.p('amarr')).toMatchObject({ setupDone: true, devAreaCount: 4 });
    expect(t.p('amarr').belts).toStrictEqual({ pyrite: 0, mexallon: 0, tritanium: 0, morphite: 0 });
    expect(t.p('amarr').res).toStrictEqual({ isk: 0, pyrite: 0, mexallon: 0, tritanium: 0, morphite: 0, planetary: 0, moon: 0, component: 0 });
    expect(t.privs.amarr.area.map((a) => a.dev)).toStrictEqual(DEFAULT_SETUP.amarr.devs);
    expect(r.lines.join('\n')).toContain('finished setup');
    expect(r.lines.join('\n')).not.toContain('belt');
    expect(r.notices).toStrictEqual([{ to: 'amarr', text: expect.stringMatching(/Event/), kind: 'todo' }]);
  });

  it('a light setup still checks the four developments', () => {
    const t = newGame(['amarr', 'caldari'], { mode: 'light' });
    t.dispatch('amarr', { type: 'startGame', firstPlayer: 'amarr' });
    const r = t.tryDispatch('amarr', { type: 'setupFaction', revealedBelt: null, devs: [DEV.mediumHull] });
    expect(isError(r) && r.code).toBe('bad_devs');
  });

  it('a player joining a light game starts with nothing', () => {
    const t = newGame(['amarr'], { mode: 'light' });
    t.asUid('uid-caldari', { type: 'join', name: 'Cal', faction: 'caldari' });
    expect(t.p('caldari').res.isk).toBe(0);
    expect(t.p('caldari').ships).toStrictEqual({});
    expect(t.game.mode).toBe('light');
  });
});

const lightClaim = (from: FactionId | null = null, central = false): Command => ({ type: 'lightClaim', from, central });
const gainResearch = (research: number): Command => ({ type: 'gainResearch', research });
const delta = (d: Partial<AdjustDelta> = {}): AdjustDelta => ({
  res: {}, vp: 0, systems: 0, homeCitadels: 0, lockedHomeBelts: 0, structures: {}, belts: {}, ships: {}, central: null, ...d,
});
const adjust = (d: Partial<AdjustDelta>, correction = false, reason = 'table fix'): Command => ({
  type: 'adjust', delta: delta(d), correction, reason,
});
const give = (t: Table, f: FactionId, id: string): void => {
  t.p(f).completed.push(id);
};
const noticesTo = (t: Table, f: FactionId): string[] => (t.last?.notices ?? []).filter((n) => n.to === f).map((n) => n.text);
const rejected = (t: Table, f: FactionId, cmd: Command): RuleError => {
  const r = t.tryDispatch(f, cmd);
  if (!isError(r)) throw new Error(`${cmd.type} by ${f} was accepted`);
  return r;
};
/** Everyone passes: the round ends and the upkeep phase begins. */
function toUpkeep(t: Table): void {
  for (const f of t.game.seats) t.dispatch(f, { type: 'pass' });
  expect(t.game.phase).toBe('upkeep');
}

describe('boardISK', () => {
  const out = (): Out => ({ lines: [], notices: [] });

  it('moves the ISK in a full game, logging nothing and noticing nobody', () => {
    const t = startedGame(['amarr', 'caldari']);
    const o = out();
    boardISK(t.game, 'amarr', 3, 'Lobbyist', o);
    expect(t.p('amarr').res.isk).toBe(7);
    boardISK(t.game, 'amarr', -2, 'Lobbyist', o);
    expect(t.p('amarr').res.isk).toBe(5);
    expect(o).toStrictEqual({ lines: [], notices: [] });
  });

  it('keeps the ISK cap and the insufficient check in a full game', () => {
    const t = startedGame(['amarr', 'caldari']);
    const o = out();
    t.p('amarr').res.isk = 48;
    boardISK(t.game, 'amarr', 3, 'Lobbyist', o);
    expect(t.p('amarr').res.isk).toBe(49);
    expect(o.lines).toStrictEqual(['ISK capped at 49 (2 lost)']);
    expect(() => boardISK(t.game, 'amarr', -50, 'Lobbyist', out())).toThrow();
  });

  it('is a to-do and a log line in a light game, changing no state', () => {
    const t = startedGame(['amarr', 'caldari'], { mode: 'light' });
    const before = structuredClone(t.game);
    const o = out();
    boardISK(t.game, 'caldari', 2, 'Lobbyist', o);
    boardISK(t.game, 'caldari', -4, 'Dirty Politics', o);
    expect(o.notices).toStrictEqual([
      { to: 'caldari', text: 'Lobbyist: take 2 ISK', kind: 'todo' },
      { to: 'caldari', text: 'Dirty Politics: pay 4 ISK', kind: 'todo' },
    ]);
    expect(o.lines).toStrictEqual(['Caldari: Lobbyist: take 2 ISK', 'Caldari: Dirty Politics: pay 4 ISK']);
    expect(t.game).toStrictEqual(before);
  });

  it('names who is paid when the payer owes a rival', () => {
    const t = startedGame(['amarr', 'caldari'], { mode: 'light' });
    const o = out();
    boardISK(t.game, 'amarr', -3, 'Civilian Resistance', o, 'caldari');
    expect(o.notices).toStrictEqual([{ to: 'amarr', text: 'Civilian Resistance: pay Caldari 3 ISK', kind: 'todo' }]);
    expect(o.lines).toStrictEqual(['Amarr: Civilian Resistance: pay Caldari 3 ISK']);
  });

  it('does nothing for 0, and refuses a fraction in either mode', () => {
    for (const mode of ['full', 'light'] as const) {
      const t = startedGame(['amarr', 'caldari'], { mode });
      const before = structuredClone(t.game);
      const o = out();
      boardISK(t.game, 'amarr', 0, 'Lobbyist', o);
      expect(o).toStrictEqual({ lines: [], notices: [] });
      expect(t.game).toStrictEqual(before);
      expect(() => boardISK(t.game, 'amarr', 1.5, 'Lobbyist', o)).toThrow();
    }
  });
});

describe('light games: turns, VP, systems, research', () => {
  it('End turn needs no action first in a light game', () => {
    const t = startedGame(['amarr', 'caldari'], { mode: 'light' });
    t.dispatch('amarr', { type: 'endTurn' });
    expect(t.game.turn?.faction).toBe('caldari');
    expect(t.last?.lines).toContain('Amarr ended their turn');

    const full = startedGame(['amarr', 'caldari']);
    expect(rejected(full, 'amarr', { type: 'endTurn' }).code).toBe('no_action');
    expect(full.game.turn?.faction).toBe('amarr');
  });

  it('End turn still refuses during a combat', () => {
    const t = startedGame(['amarr', 'caldari'], { mode: 'light' });
    t.dispatch('amarr', { type: 'combatStart', defender: 'caldari', homeOf: null, controller: null, citadels: 0 });
    expect(t.game.combat?.stage).toBe('assign');
    expect(rejected(t, 'amarr', { type: 'endTurn' }).code).toBe('combat_active');
    t.dispatch('amarr', { type: 'combatCancel' });
    t.dispatch('amarr', { type: 'endTurn' });
    expect(t.game.turn?.faction).toBe('caldari');
  });

  it('End turn waits for research to be placed', () => {
    const t = startedGame(['amarr', 'caldari'], { mode: 'light' });
    t.dispatch('amarr', gainResearch(2));
    expect(t.privs.amarr.pendingResearch).toBe(2);
    expect(t.last?.lines).toStrictEqual(['Amarr gained 2 research']);
    expect(rejected(t, 'amarr', { type: 'endTurn' }).code).toBe('pending_research');
    expect(t.game.turn?.faction).toBe('amarr');
  });

  it('gainResearch refuses 0 and more than 20, and adds up', () => {
    const t = startedGame(['amarr', 'caldari'], { mode: 'light' });
    expect(MAX_GAINED_RESEARCH).toBe(20);
    for (const n of [0, 21, -1, 1.5, Number.NaN]) {
      expect(rejected(t, 'amarr', gainResearch(n)).code).toBe('bad_amount');
    }
    t.dispatch('amarr', gainResearch(20));
    t.dispatch('amarr', gainResearch(1));
    expect(t.privs.amarr.pendingResearch).toBe(21);
  });

  it('gainResearch needs no turn and is accepted in the upkeep phase too', () => {
    const t = startedGame(['amarr', 'caldari'], { mode: 'light' });
    t.dispatch('caldari', gainResearch(3)); // amarr's turn
    expect(t.privs.caldari.pendingResearch).toBe(3);
    toUpkeep(t);
    t.dispatch('amarr', gainResearch(4));
    expect(t.privs.amarr.pendingResearch).toBe(4);
  });

  it('gainResearch is refused before the game starts', () => {
    const t = newGame(['amarr', 'caldari'], { mode: 'light' });
    expect(rejected(t, 'amarr', gainResearch(1)).code).toBe('wrong_phase');
  });

  it('a full game refuses lightClaim and gainResearch', () => {
    const t = startedGame(['amarr', 'caldari']);
    const before = structuredClone(t.game);
    expect(t.tryDispatch('amarr', lightClaim())).toStrictEqual({ error: true, code: 'wrong_mode', message: 'Not used in a full game' });
    expect(t.tryDispatch('amarr', gainResearch(2))).toStrictEqual({ error: true, code: 'wrong_mode', message: 'Not used in a full game' });
    expect(t.game).toStrictEqual(before);
    expect(t.privs.amarr.pendingResearch).toBe(0);
  });

  it('a light game refuses the full claim with the light message', () => {
    const t = startedGame(['amarr', 'caldari'], { mode: 'light' });
    expect(t.tryDispatch('amarr', { type: 'action', action: 'claim', from: null, central: false })).toStrictEqual({
      error: true, code: 'wrong_mode', message: 'Not used in a scorekeeper game',
    });
  });

  it('a light claim adds a system and takes one from a rival', () => {
    const t = startedGame(['amarr', 'caldari'], { mode: 'light' });
    const slots = structuredClone(t.p('amarr').slots);
    t.p('caldari').systems = 2;
    t.dispatch('amarr', lightClaim('caldari'));
    expect(t.p('amarr').systems).toBe(1);
    expect(t.p('caldari').systems).toBe(1);
    expect(t.last?.lines).toStrictEqual(['Amarr claimed a system from Caldari']);
    expect(t.last?.notices).toStrictEqual([{ to: 'caldari', text: 'Amarr took one of your systems', kind: 'todo' }]);
    expect(t.game.turn?.actionTaken).toBeNull();
    expect(t.p('amarr').cubesUsed).toBe(0);
    expect(t.p('amarr').slots).toStrictEqual(slots);
  });

  it('a light claim from nobody just adds a system, and can be made again the same turn', () => {
    const t = startedGame(['amarr', 'caldari'], { mode: 'light' });
    t.dispatch('amarr', lightClaim());
    t.dispatch('amarr', lightClaim());
    expect(t.p('amarr').systems).toBe(2);
    expect(t.last?.lines).toStrictEqual(['Amarr claimed a system']);
    expect(t.last?.notices).toStrictEqual([]);
  });

  it('a light claim needs your turn and a rival with a system', () => {
    const t = startedGame(['amarr', 'caldari'], { mode: 'light' });
    expect(rejected(t, 'caldari', lightClaim()).code).toBe('not_your_turn');
    expect(rejected(t, 'amarr', lightClaim('caldari')).code).toBe('no_systems');
    t.p('amarr').systems = 1;
    expect(rejected(t, 'amarr', lightClaim('amarr')).code).toBe('bad_target');
    expect(rejected(t, 'amarr', lightClaim('minmatar')).code).toBe('no_player');
    expect(t.p('amarr').systems).toBe(1);
    expect(t.p('caldari').systems).toBe(0);
  });

  it('a light claim is refused outside the actions phase', () => {
    const t = startedGame(['amarr', 'caldari'], { mode: 'light' });
    toUpkeep(t);
    expect(rejected(t, 'amarr', lightClaim()).code).toBe('wrong_phase');
  });

  it('Invader scores and Civilian Resistance becomes a payment to-do', () => {
    const t = startedGame(['amarr', 'caldari'], { mode: 'light' });
    give(t, 'amarr', DEV.invader);
    give(t, 'caldari', DEV.civilianResistance);
    t.p('caldari').systems = 1;
    t.dispatch('amarr', lightClaim('caldari'));
    expect(t.p('amarr').vp).toBe(1);
    expect(t.last?.notices).toContainEqual({ to: 'amarr', kind: 'todo', text: 'Civilian Resistance: pay Caldari 3 ISK' });
    expect(noticesTo(t, 'caldari')).toStrictEqual(['Amarr took one of your systems and owes you 3 ISK (Civilian Resistance)']);
    expect(t.last?.lines).toContain('Amarr: Civilian Resistance: pay Caldari 3 ISK');
    for (const f of ['amarr', 'caldari'] as const) {
      expect(t.p(f).res).toStrictEqual({ isk: 0, pyrite: 0, mexallon: 0, tritanium: 0, morphite: 0, planetary: 0, moon: 0, component: 0 });
    }
  });

  it('Civilian Resistance asks nothing for an unclaimed system or from its own holder', () => {
    const t = startedGame(['amarr', 'caldari'], { mode: 'light' });
    give(t, 'caldari', DEV.civilianResistance);
    t.dispatch('amarr', lightClaim());
    expect(t.last?.notices).toStrictEqual([]);

    const t2 = startedGame(['amarr', 'caldari'], { mode: 'light' });
    give(t2, 'amarr', DEV.civilianResistance);
    t2.p('caldari').systems = 1;
    t2.dispatch('amarr', lightClaim('caldari'));
    expect(t2.last?.notices).toStrictEqual([{ to: 'caldari', text: 'Amarr took one of your systems', kind: 'todo' }]);
  });

  it('Invader pays other Lobbyist holders as a to-do, not ISK', () => {
    const t = startedGame(['amarr', 'caldari', 'gallente'], { mode: 'light' });
    give(t, 'amarr', DEV.invader);
    give(t, 'gallente', DEV.lobbyist);
    t.p('caldari').systems = 1;
    t.dispatch('amarr', lightClaim('caldari'));
    expect(noticesTo(t, 'gallente')).toStrictEqual(['Lobbyist: take 1 ISK']);
    expect(t.p('gallente').res.isk).toBe(0);
  });

  it('a light claim takes the central system', () => {
    const t = startedGame(['amarr', 'caldari', 'gallente'], { mode: 'light' });
    t.p('caldari').central = true;
    t.dispatch('amarr', lightClaim(null, true));
    expect(t.p('amarr').central).toBe(true);
    expect(t.p('caldari').central).toBe(false);
    expect(t.p('amarr').systems).toBe(1);
    expect(t.last?.lines).toContain('Amarr took the central system from Caldari');
    expect(noticesTo(t, 'caldari')).toStrictEqual(['Amarr took the central system from you']);
  });

  it('Lobbyist in a light game is a to-do; in a full game it still pays ISK', () => {
    const t = startedGame(['amarr', 'caldari'], { mode: 'light' });
    give(t, 'caldari', DEV.lobbyist);
    t.dispatch('amarr', adjust({ vp: 2 }));
    expect(t.p('amarr').vp).toBe(2);
    expect(noticesTo(t, 'caldari')).toStrictEqual(['Lobbyist: take 2 ISK']);
    expect(t.last?.notices).toStrictEqual([{ to: 'caldari', text: 'Lobbyist: take 2 ISK', kind: 'todo' }]);
    expect(t.p('caldari').res.isk).toBe(0);
    expect(t.last?.lines).toContain('Caldari: Lobbyist: take 2 ISK');

    const full = startedGame(['amarr', 'caldari']);
    give(full, 'caldari', DEV.lobbyist);
    full.dispatch('amarr', adjust({ vp: 2 }));
    expect(full.p('caldari').res.isk).toBe(6);
    expect(full.last?.notices).toStrictEqual([]);
    expect(full.last?.lines).toContain('Cal gains 2 ISK (Lobbyist)');
  });

  it('Lobbyist pays nothing to the gainer, and nothing for a correction', () => {
    const t = startedGame(['amarr', 'caldari'], { mode: 'light' });
    give(t, 'amarr', DEV.lobbyist);
    t.dispatch('amarr', adjust({ vp: 1 }));
    expect(t.last?.notices).toStrictEqual([]);
    give(t, 'caldari', DEV.lobbyist);
    t.dispatch('amarr', adjust({ vp: 1 }, true));
    expect(t.last?.notices).toStrictEqual([]);
  });

  it('Intelligence Network in a light game is a to-do; in a full game it still pays ISK', () => {
    const t = startedGame(['amarr', 'caldari'], { mode: 'light' });
    give(t, 'caldari', DEV.intelligenceNetwork);
    t.dispatch('amarr', { type: 'eventPlayed' });
    expect(t.last?.notices).toStrictEqual([{ to: 'caldari', text: 'Intelligence Network: take 2 ISK', kind: 'todo' }]);
    expect(t.last?.lines).toStrictEqual(['Amarr played an Event card', 'Caldari: Intelligence Network: take 2 ISK']);
    expect(t.p('caldari').res.isk).toBe(0);

    const full = startedGame(['amarr', 'caldari']);
    give(full, 'caldari', DEV.intelligenceNetwork);
    full.dispatch('amarr', { type: 'eventPlayed' });
    expect(full.p('caldari').res.isk).toBe(6);
    expect(full.last?.notices).toStrictEqual([]);
    expect(full.last?.lines).toStrictEqual(['Amarr played an Event card', 'Caldari gains 2 ISK (Intelligence Network)']);
  });

  it('Adjust in a light game changes only VP, systems and central', () => {
    const t = startedGame(['amarr', 'caldari'], { mode: 'light' });
    const wrong = { error: true, code: 'wrong_mode', message: 'Scorekeeper games only adjust VP, systems and the central system' };
    const before = structuredClone(t.game);
    for (const d of [
      { res: { isk: 1 } },
      { structures: { engineering: 1 } },
      { belts: { pyrite: 1 } },
      { ships: { crow: 1 } },
      { homeCitadels: 1 },
      { lockedHomeBelts: -1 },
      { vp: 1, res: { pyrite: 2 } },
    ] as Partial<AdjustDelta>[]) {
      expect(t.tryDispatch('amarr', adjust(d))).toStrictEqual(wrong);
    }
    expect(t.game).toStrictEqual(before);

    t.dispatch('amarr', adjust({ systems: 1, central: true, vp: 1 }));
    expect(t.p('amarr')).toMatchObject({ systems: 1, central: true, vp: 1 });
    // 2 players: the flag is the most tier 3 systems (official errata)
    expect(t.last?.lines[0]).toBe('Amarr adjusted: VP +1, systems +1, now most tier 3 systems (table fix)');
    t.dispatch('amarr', adjust({ central: false }));
    expect(t.last?.lines[0]).toBe('Amarr adjusted: no longer most tier 3 systems (table fix)');
  });

  it('Adjust in a light game ignores zero-valued board fields', () => {
    const t = startedGame(['amarr', 'caldari'], { mode: 'light' });
    t.dispatch('amarr', adjust({ vp: 1, res: { isk: 0 }, ships: { crow: 0 } }));
    expect(t.p('amarr').vp).toBe(1);
  });

  it('Adjust in a full game still changes the board fields', () => {
    const t = startedGame(['amarr', 'caldari']);
    t.dispatch('amarr', adjust({ res: { isk: 1 }, homeCitadels: 0 }));
    expect(t.p('amarr').res.isk).toBe(5);
  });

  it('research in a light game: any time, no cube', () => {
    const t = startedGame(['amarr', 'caldari'], { mode: 'light' });
    t.privs.amarr.area.pop();
    t.p('amarr').devAreaCount = 3;
    const cmd: Command = { type: 'action', action: 'research', fill: [DEV.upgradedRefinery], swap: [] };
    t.dispatch('amarr', { type: 'endTurn' });
    expect(t.game.turn?.faction).toBe('caldari'); // amarr researches on caldari's turn
    t.dispatch('amarr', cmd);
    expect(t.privs.amarr.area).toHaveLength(4);
    expect(t.privs.amarr.area.at(-1)).toStrictEqual({ dev: DEV.upgradedRefinery, tokens: 0 });
    expect(t.p('amarr').devAreaCount).toBe(4);
    expect(t.p('amarr').cubesUsed).toBe(0);
    expect(t.game.turn).toStrictEqual({ faction: 'caldari', actionTaken: null, deployable: false });
    expect(t.last?.lines).toStrictEqual(['Amarr researched (1 card)']);
  });

  it('research in a light game is accepted in the upkeep phase and refused before the game starts', () => {
    const t = startedGame(['amarr', 'caldari'], { mode: 'light' });
    t.privs.amarr.area.pop();
    t.p('amarr').devAreaCount = 3;
    toUpkeep(t);
    t.dispatch('amarr', { type: 'action', action: 'research', fill: [DEV.upgradedRefinery], swap: [] });
    expect(t.p('amarr').devAreaCount).toBe(4);

    const lobby = newGame(['amarr', 'caldari'], { mode: 'light' });
    const r = lobby.tryDispatch('amarr', { type: 'action', action: 'research', fill: [DEV.upgradedRefinery], swap: [] });
    expect(isError(r) && r.code).toBe('wrong_phase');
  });

  it('research in a light game still checks the cards', () => {
    const t = startedGame(['amarr', 'caldari'], { mode: 'light' });
    expect(rejected(t, 'amarr', { type: 'action', action: 'research', fill: [DEV.upgradedRefinery], swap: [] }).code).toBe('area_full');
    expect(rejected(t, 'amarr', { type: 'action', action: 'research', fill: [], swap: [] }).code).toBe('no_change');
  });

  it('research in a full game still takes the turn, a cube and the research slot', () => {
    const t = startedGame(['amarr', 'caldari']);
    t.privs.amarr.area.pop();
    t.p('amarr').devAreaCount = 3;
    t.dispatch('amarr', { type: 'action', action: 'research', fill: [DEV.upgradedRefinery], swap: [] });
    expect(t.p('amarr').cubesUsed).toBe(1);
    expect(t.game.turn?.actionTaken).toBe('research');
    t.privs.caldari.area.pop();
    expect(rejected(t, 'caldari', { type: 'action', action: 'research', fill: [DEV.mediumHull], swap: [] }).code).toBe('not_your_turn');
  });
});

describe('light games: using cards', () => {
  const use = (dev: string, params: UseParams): Command => ({ type: 'useDev', dev, params });
  const none: UseParams = { kind: 'none' };
  const zeroRes = { isk: 0, pyrite: 0, mexallon: 0, tritanium: 0, morphite: 0, planetary: 0, moon: 0, component: 0 };
  const lightTable = (...extra: FactionId[]): Table => startedGame(['amarr', 'caldari', ...extra], { mode: 'light' });

  /** The reminder cards of spec 4.4 and the exact text each leaves as a to-do. */
  const REMINDERS: [string, string, string][] = [
    ['Mineral Market', DEV.mineralMarket, 'Mineral Market: change 1 basic mineral into another'],
    ['Trade Contracts', DEV.tradeContracts, 'Trade Contracts: make 1 trade at the market'],
    ['Manufacturing Hub', DEV.manufacturingHub, 'Manufacturing Hub: make 1 manufacturing operation (record research, VP or a card on the Panel)'],
    ['Asteroid Mining', DEV.asteroidMining, 'Asteroid Mining: take 1 mineral from a belt in a system you control'],
    ['Extracting Crew', DEV.extractingCrew, 'Extracting Crew: take 1 planetary or moon material from a system you control'],
    ['Defensive Tactic', DEV.defensiveTactic, 'Defensive Tactic: cancel 1 damage result (pay 1 planetary or moon to cancel 1 more damage or crit)'],
    ['Offensive Tactic', DEV.offensiveTactic, 'Offensive Tactic: reroll 1 die (pay 1 planetary or moon to reroll any number)'],
    ['Guerilla Warfare', DEV.guerillaWarfare, 'Guerilla Warfare: pay 1 planetary or moon for +1 strength in the system being claimed'],
    ['Strategic Reposition', DEV.strategicReposition, 'Strategic Reposition: move 1 small ship to an adjacent system (pay 1 planetary or moon to move a medium ship)'],
  ];

  it.each(REMINDERS)('%s taps and leaves a to-do', (_, dev, text) => {
    const t = lightTable();
    if (dev === DEV.defensiveTactic || dev === DEV.offensiveTactic) t.game.combat = { attacker: 'amarr', defender: 'caldari' } as unknown as CombatState;
    if (dev === DEV.guerillaWarfare) t.game.turn = { faction: 'caldari', actionTaken: null, deployable: false };
    give(t, 'amarr', dev);
    t.dispatch('amarr', use(dev, none));
    expect(t.p('amarr').tapped).toStrictEqual([dev]);
    expect(t.last?.notices).toStrictEqual([{ to: 'amarr', text, kind: 'todo' }]);
    expect(t.p('amarr').res).toStrictEqual(zeroRes);
    expect(t.p('amarr').completed).toStrictEqual([dev]);
  });

  it('a reminder card can be used once a round, and still needs to be completed', () => {
    const t = lightTable();
    give(t, 'amarr', DEV.mineralMarket);
    t.dispatch('amarr', use(DEV.mineralMarket, none));
    expect(rejected(t, 'amarr', use(DEV.mineralMarket, none)).code).toBe('tapped');
    expect(rejected(t, 'amarr', use(DEV.tradeContracts, none)).code).toBe('not_completed');
  });

  it('a reminder card refuses full-game params in a light game', () => {
    const t = lightTable();
    give(t, 'amarr', DEV.mineralMarket);
    give(t, 'amarr', DEV.defensiveTactic);
    t.game.combat = { attacker: 'amarr', defender: 'caldari' } as unknown as CombatState;
    expect(rejected(t, 'amarr', use(DEV.mineralMarket, { kind: 'mineralMarket', from: 'pyrite', to: 'mexallon' })).code).toBe('bad_params');
    expect(rejected(t, 'amarr', use(DEV.defensiveTactic, { kind: 'payMaterial', material: 'moon' })).code).toBe('bad_params');
    expect(t.p('amarr').tapped).toStrictEqual([]);
  });

  it('Galactic Trust Fund is a to-do', () => {
    const t = lightTable();
    give(t, 'amarr', DEV.galacticTrustFund);
    t.dispatch('amarr', use(DEV.galacticTrustFund, none));
    expect(t.last?.notices).toStrictEqual([{ to: 'amarr', text: 'Galactic Trust Fund: take 2 ISK', kind: 'todo' }]);
    expect(t.last?.lines).toStrictEqual(['Amarr used Galactic Trust Fund', 'Amarr: Galactic Trust Fund: take 2 ISK']);
    expect(t.p('amarr').res.isk).toBe(0);
    expect(t.p('amarr').tapped).toStrictEqual([DEV.galacticTrustFund]);
  });

  it('Dirty Politics steals the VP and leaves the payment to-do', () => {
    const t = lightTable();
    give(t, 'amarr', DEV.dirtyPolitics);
    t.p('caldari').vp = 3;
    t.dispatch('amarr', use(DEV.dirtyPolitics, { kind: 'target', faction: 'caldari' }));
    expect(t.p('caldari').vp).toBe(2);
    expect(t.p('amarr').vp).toBe(1);
    expect(noticesTo(t, 'amarr')).toStrictEqual(['Dirty Politics: pay Caldari 5 ISK']);
    // The victim is told about the ISK, as Civilian Resistance tells its holder.
    expect(noticesTo(t, 'caldari')).toStrictEqual(['Amarr owes you 5 ISK (Dirty Politics)', 'Amarr stole 1 VP from you']);
    expect(t.last?.notices.every((n) => n.kind === 'todo')).toBe(true);
    expect(t.last?.lines).toContain('Amarr: Dirty Politics: pay Caldari 5 ISK');
    expect(t.p('amarr').res).toStrictEqual(zeroRes);
    expect(t.p('caldari').res).toStrictEqual(zeroRes);
    expect(t.p('amarr').tapped).toStrictEqual([DEV.dirtyPolitics]);
  });

  it('Dirty Politics still refuses a target with no VP, yourself or a stranger, and needs no ISK', () => {
    const t = lightTable();
    give(t, 'amarr', DEV.dirtyPolitics);
    const aim = (faction: FactionId): Command => use(DEV.dirtyPolitics, { kind: 'target', faction });
    expect(t.p('amarr').res.isk).toBe(0);
    expect(rejected(t, 'amarr', aim('caldari')).code).toBe('no_vp');
    expect(rejected(t, 'amarr', aim('amarr')).code).toBe('bad_target');
    expect(rejected(t, 'amarr', aim('gallente')).code).toBe('bad_target');
    expect(t.p('amarr').tapped).toStrictEqual([]);
    expect(t.p('amarr').vp).toBe(0);
  });

  it('Dirty Politics pays other Lobbyist holders as a to-do', () => {
    const t = lightTable('gallente');
    give(t, 'amarr', DEV.dirtyPolitics);
    give(t, 'gallente', DEV.lobbyist);
    t.p('caldari').vp = 1;
    t.dispatch('amarr', use(DEV.dirtyPolitics, { kind: 'target', faction: 'caldari' }));
    expect(noticesTo(t, 'gallente')).toStrictEqual(['Lobbyist: take 1 ISK']);
    expect(t.p('gallente').res.isk).toBe(0);
  });

  it('Underdog, Pacifist and Research Spy work as in full games', () => {
    const t = lightTable();
    give(t, 'amarr', DEV.underdog);
    t.p('caldari').vp = 2;
    t.dispatch('amarr', use(DEV.underdog, none));
    expect(t.p('amarr').vp).toBe(1);
    expect(rejected(t, 'amarr', use(DEV.underdog, none)).code).toBe('tapped');

    const t2 = lightTable();
    give(t2, 'amarr', DEV.pacifist);
    expect(rejected(t2, 'amarr', use(DEV.pacifist, none)).code).toBe('no_retreat');
    t2.game.retreatsThisRound = ['caldari'];
    t2.dispatch('amarr', use(DEV.pacifist, none));
    expect(t2.p('amarr').vp).toBe(1);

    const t3 = lightTable();
    give(t3, 'amarr', DEV.researchSpy);
    give(t3, 'caldari', DEV.sequentialJump);
    t3.dispatch('amarr', use(DEV.researchSpy, { kind: 'dev', dev: DEV.sequentialJump }));
    expect(t3.p('amarr').completed).toStrictEqual([DEV.sequentialJump]);
    expect(t3.p('amarr').tapped).toStrictEqual([]);
    expect(t3.last?.lines).toStrictEqual(['Amarr used Research Spy: completed Sequential Jump (Research Spy discarded)']);
  });

  it('Star Map and Sequential Jump stay reminders', () => {
    const t = lightTable();
    give(t, 'amarr', DEV.starMap);
    give(t, 'amarr', DEV.sequentialJump);
    t.dispatch('amarr', use(DEV.starMap, none));
    expect(noticesTo(t, 'amarr')).toHaveLength(1);
    t.dispatch('amarr', use(DEV.sequentialJump, none));
    expect(noticesTo(t, 'amarr')).toStrictEqual(['Sequential Jump: remove one exhausted fleet token from a system with your fleet']);
  });

  it('a full game keeps the full effects of the same cards', () => {
    const t = startedGame(['amarr', 'caldari']);
    give(t, 'amarr', DEV.mineralMarket);
    give(t, 'amarr', DEV.galacticTrustFund);
    t.p('amarr').res.pyrite = 1;
    t.dispatch('amarr', use(DEV.mineralMarket, { kind: 'mineralMarket', from: 'pyrite', to: 'mexallon' }));
    expect(t.p('amarr').res).toMatchObject({ pyrite: 0, mexallon: 1 });
    expect(t.last?.notices).toStrictEqual([]);
    t.dispatch('amarr', use(DEV.galacticTrustFund, none));
    expect(t.p('amarr').res.isk).toBe(6);
    expect(t.last?.notices).toStrictEqual([]);
  });

  it('useParamsKind follows the mode', () => {
    expect(useParamsKind(DEV.mineralMarket, 'light')).toBe('none');
    expect(useParamsKind(DEV.mineralMarket)).toBe('mineralMarket');
    expect(useParamsKind(DEV.mineralMarket, 'full')).toBe('mineralMarket');
    expect(useParamsKind(DEV.dirtyPolitics, 'light')).toBe('target');
    expect(useParamsKind(DEV.researchSpy, 'light')).toBe('dev');
    for (const id of [DEV.galacticTrustFund, DEV.underdog, DEV.pacifist, DEV.tradeContracts, DEV.manufacturingHub, DEV.asteroidMining,
      DEV.extractingCrew, DEV.defensiveTactic, DEV.offensiveTactic, DEV.guerillaWarfare, DEV.strategicReposition, DEV.starMap,
      DEV.sequentialJump]) {
      expect(useParamsKind(id, 'light')).toBe('none');
    }
    // Passive cards have no use in either mode.
    expect(useParamsKind(DEV.lobbyist, 'light')).toBeNull();
    expect(useParamsKind(DEV.lobbyist)).toBeNull();
    expect(useParamsKind(DEV.defensiveTactic)).toBe('payMaterial');
  });
});

interface UpkeepOpts {
  research?: number;
  researchLab?: boolean;
  raids?: FactionId[];
  largeShip?: boolean;
}
const lightUpkeep = (o: UpkeepOpts = {}): Command => ({
  type: 'lightUpkeep', research: o.research ?? 0, researchLab: o.researchLab ?? false, raids: o.raids ?? [], largeShip: o.largeShip ?? false,
});
const fullConfirm = (raids: { target: FactionId; strength: number }[] = []): Command => ({
  type: 'confirmUpkeep', refinery: { planetary: 0, moon: 0, convert: 0 }, discard: {}, raids, researchLab: false,
});
/** The rejection of `cmd`, which must change nothing: the game and every private doc stay exactly as they were. */
function refuses(t: Table, f: FactionId, cmd: Command, code: string): RuleError {
  const game = structuredClone(t.game);
  const privs = structuredClone(t.privs);
  const e = rejected(t, f, cmd);
  expect(e.code).toBe(code);
  expect(t.game).toStrictEqual(game);
  expect(t.privs).toStrictEqual(privs);
  return e;
}
/** A light game in its round-1 upkeep (amarr first player). */
function lightUpkeepTable(factions: FactionId[] = ['amarr', 'caldari', 'gallente']): Table {
  const t = startedGame(factions, { mode: 'light' });
  toUpkeep(t);
  return t;
}
const vps = (t: Table): number[] => t.game.seats.map((f) => t.p(f).vp);

describe('light games: upkeep and the end', () => {
  it('a light upkeep records research, a Research Lab card, raids and a large ship', () => {
    const t = lightUpkeepTable(['amarr', 'caldari']);
    give(t, 'amarr', DEV.researchLab);
    give(t, 'amarr', DEV.fleetSupremacy);
    const r = t.dispatch('amarr', lightUpkeep({ research: 3, researchLab: true, raids: ['caldari'], largeShip: true }));
    expect(t.privs.amarr.pendingResearch).toBe(3);
    expect(t.privs.amarr.pendingCards).toBe(1);
    expect(t.game.upkeep).toStrictEqual({
      emergency: false,
      confirmed: ['amarr'],
      raids: [{ raider: 'amarr', target: 'caldari', strength: 0 }],
      largeShips: ['amarr'],
    });
    expect(t.game.phase).toBe('upkeep');
    expect(r.lines).toStrictEqual(['Amarr confirmed upkeep: 3 research, a Research Lab card, raided Caldari, a large ship on the board']);
    expect(r.notices).toStrictEqual([]);
    // Nothing on the board changes: a light upkeep touches no resources.
    expect(t.p('amarr').res.isk).toBe(0);
    expect(t.p('amarr').vp).toBe(0);
  });

  it('logs only what applies, and says so when there is nothing to record', () => {
    const t = lightUpkeepTable();
    t.dispatch('amarr', lightUpkeep());
    expect(t.last?.lines).toStrictEqual(['Amarr confirmed upkeep: nothing to record']);
    t.dispatch('caldari', lightUpkeep({ research: 1 }));
    expect(t.last?.lines).toStrictEqual(['Caldari confirmed upkeep: 1 research']);
    expect(t.privs.caldari.pendingResearch).toBe(1);
    expect(t.privs.caldari.pendingCards).toBe(0);
    expect(t.game.upkeep?.raids).toStrictEqual([]);
    expect(t.game.upkeep?.largeShips).toStrictEqual([]);

    const u = lightUpkeepTable();
    u.dispatch('amarr', lightUpkeep({ raids: ['caldari', 'gallente'] }));
    expect(u.last?.lines).toStrictEqual(['Amarr confirmed upkeep: raided Caldari and Gallente']);
    expect(u.game.upkeep?.raids).toStrictEqual([
      { raider: 'amarr', target: 'caldari', strength: 0 },
      { raider: 'amarr', target: 'gallente', strength: 0 },
    ]);
  });

  it('refuses what is not allowed, changing nothing', () => {
    const t = lightUpkeepTable();
    for (const research of [21, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(refuses(t, 'amarr', lightUpkeep({ research }), 'bad_amount').message).toBe('Research gained is a whole number from 0 to 20');
    }
    refuses(t, 'amarr', { ...lightUpkeep(), research: '3' } as unknown as Command, 'bad_amount');
    refuses(t, 'amarr', lightUpkeep({ researchLab: true }), 'bad_research_lab');
    expect(refuses(t, 'amarr', lightUpkeep({ largeShip: true }), 'bad_fleet_supremacy').message).toBe('Fleet Supremacy needs the completed card');
    refuses(t, 'amarr', lightUpkeep({ raids: ['amarr'] }), 'bad_target');
    refuses(t, 'amarr', lightUpkeep({ raids: ['caldari', 'caldari'] }), 'bad_target');
    refuses(t, 'amarr', lightUpkeep({ raids: ['minmatar'] }), 'bad_target'); // not seated
    refuses(t, 'amarr', lightUpkeep({ raids: ['__proto__' as FactionId] }), 'bad_target');
    refuses(t, 'amarr', { ...lightUpkeep(), raids: null } as unknown as Command, 'bad_target');
    // A bad part cancels the good ones with it.
    refuses(t, 'amarr', lightUpkeep({ research: 4, raids: ['caldari', 'amarr'] }), 'bad_target');
    refuses(t, 'amarr', lightUpkeep({ research: 4, raids: ['caldari'], largeShip: true }), 'bad_fleet_supremacy');

    expect(refuses(t, 'amarr', lightUpkeep({ researchLab: true }), 'bad_research_lab').message)
      .toBe('A Research Lab card needs Upgraded Eng. Complex – Research Lab');

    // 0 and 20 are the ends of the range.
    t.dispatch('amarr', lightUpkeep({ research: 20 }));
    expect(t.privs.amarr.pendingResearch).toBe(20);
    t.dispatch('caldari', lightUpkeep({ research: 0 }));
    expect(t.privs.caldari.pendingResearch).toBe(0);
  });

  it('refuses a second confirm, a stranger, the wrong phase and a full game', () => {
    const t = lightUpkeepTable();
    t.dispatch('amarr', lightUpkeep({ research: 2 }));
    refuses(t, 'amarr', lightUpkeep(), 'already_confirmed');
    expect(t.privs.amarr.pendingResearch).toBe(2);
    expect(rejected(t, 'amarr', lightUpkeep()).message).toBe('You already confirmed your upkeep');
    const stranger = t.tryAsUid('uid-stranger', lightUpkeep());
    expect(isError(stranger) && stranger.code).toBe('not_seated');

    const actions = startedGame(['amarr', 'caldari'], { mode: 'light' });
    refuses(actions, 'amarr', lightUpkeep(), 'wrong_phase');

    const full = startedGame(['amarr', 'caldari']);
    toUpkeep(full);
    expect(full.tryDispatch('amarr', lightUpkeep())).toStrictEqual({ error: true, code: 'wrong_mode', message: 'Not used in a full game' });
  });

  it('a light game ignores the full confirm', () => {
    const t = lightUpkeepTable();
    expect(t.tryDispatch('amarr', fullConfirm())).toStrictEqual({ error: true, code: 'wrong_mode', message: 'Not used in a scorekeeper game' });
  });

  it('the last confirm finishes the upkeep', () => {
    const t = startedGame(['amarr', 'caldari', 'gallente'], { mode: 'light' });
    give(t, 'amarr', DEV.fleetSupremacy);
    give(t, 'gallente', DEV.fleetSupremacy); // holds the card, but declares no large ship
    t.p('amarr').systems = 5;
    t.p('caldari').vp = 2;
    t.p('caldari').central = true;
    t.p('caldari').homeCitadels = 3; // no defence matters: the raid was judged at the table
    t.p('gallente').vp = 1;
    for (const f of ['amarr', 'caldari', 'gallente'] as const) t.p(f).tapped = [DEV.galacticTrustFund];
    t.game.retreatsThisRound = ['amarr'];
    toUpkeep(t);

    t.dispatch('amarr', lightUpkeep({ research: 3, raids: ['caldari'], largeShip: true }));
    t.dispatch('caldari', lightUpkeep({ raids: ['gallente'] }));
    expect(t.game.phase).toBe('upkeep');
    expect(vps(t)).toStrictEqual([0, 2, 1]);

    const r = t.dispatch('gallente', lightUpkeep());
    // Raids from the first player: amarr takes 1 from caldari, then caldari takes 1 from gallente.
    // Domination: amarr's 5 systems (+1) and the most (+1), caldari's central system (+1). Fleet Supremacy: amarr (+1).
    expect(vps(t)).toStrictEqual([4, 3, 0]);
    expect(r.lines).toStrictEqual([
      'Gallente confirmed upkeep: nothing to record',
      'Everyone confirmed: finishing the upkeep',
      "Amarr's raid on Caldari succeeds",
      'Ana steals 1 VP from Cal',
      'Ana gains 1 VP (1 total)',
      "Caldari's raid on Gallente succeeds",
      'Cal steals 1 VP from Gil',
      'Cal gains 1 VP (2 total)',
      'Domination: Amarr controls 5 systems',
      'Ana gains 1 VP (2 total)',
      'Domination: Amarr controls the most systems',
      'Ana gains 1 VP (3 total)',
      'Domination: Caldari holds the central system',
      'Cal gains 1 VP (3 total)',
      'Fleet Supremacy: Amarr has a large ship',
      'Ana gains 1 VP (4 total)',
      'Round 2 begins: Cal (Caldari) is first player and takes the first turn',
    ]);
    expect(r.notices).toStrictEqual([
      { to: 'caldari', text: 'Amarr stole 1 VP from you', kind: 'todo' },
      { to: 'amarr', text: raidText('Caldari'), kind: 'todo' },
      { to: 'gallente', text: 'Caldari stole 1 VP from you', kind: 'todo' },
      { to: 'caldari', text: raidText('Gallente'), kind: 'todo' },
      { to: 'all', text: 'Round 2: pass the first player token to Caldari', kind: 'todo', key: 'firstPlayer' },
    ]);
    expect(t.game).toMatchObject({ phase: 'actions', round: 2, firstPlayer: 'caldari', upkeep: null, retreatsThisRound: [] });
    expect(t.game.turn).toStrictEqual({ faction: 'caldari', actionTaken: null, deployable: false });
    for (const f of ['amarr', 'caldari', 'gallente'] as const) {
      expect(t.p(f).tapped).toStrictEqual([]);
      expect(t.p(f).passed).toBe(false);
    }

    // Amarr's declared research waits for them: nobody ends their turn with research to place.
    expect(t.privs.amarr.pendingResearch).toBe(3);
    t.dispatch('caldari', { type: 'endTurn' });
    t.dispatch('gallente', { type: 'endTurn' });
    expect(t.game.turn?.faction).toBe('amarr');
    expect(rejected(t, 'amarr', { type: 'endTurn' }).code).toBe('pending_research');
    t.dispatch('amarr', { type: 'distributeResearch', alloc: { [t.privs.amarr.area[0]!.dev]: 3 }, fetch: [] });
    t.dispatch('amarr', { type: 'endTurn' });
    expect(t.game.turn?.faction).toBe('caldari');
  });

  it('a raid succeeds whatever the home defends, and steals only what is there', () => {
    const t = lightUpkeepTable(['amarr', 'caldari']);
    t.p('caldari').homeCitadels = 5;
    t.p('caldari').vp = 1;
    t.dispatch('amarr', lightUpkeep({ raids: ['caldari'] }));
    t.dispatch('caldari', lightUpkeep({ raids: ['amarr'] }));
    // Amarr's raid takes Caldari's only VP; Caldari's raid then finds Amarr with 1 (just stolen) and takes it back.
    expect(vps(t)).toStrictEqual([0, 1]);
    expect(t.last?.lines).toContain("Caldari's raid on Amarr succeeds");

    const u = lightUpkeepTable(['amarr', 'caldari']);
    u.dispatch('amarr', lightUpkeep({ raids: ['caldari'] }));
    u.dispatch('caldari', lightUpkeep());
    expect(vps(u)).toStrictEqual([0, 0]);
    expect(u.last?.lines).toContain("Amarr's raid on Caldari succeeds");
    expect(u.last?.lines).toContain('Ana steals no VP: Cal has none');
  });

  it('Fleet Supremacy scores for the declared large ships only', () => {
    const t = lightUpkeepTable();
    give(t, 'amarr', DEV.fleetSupremacy);
    give(t, 'caldari', DEV.fleetSupremacy);
    t.dispatch('amarr', lightUpkeep({ largeShip: true }));
    t.dispatch('caldari', lightUpkeep());
    t.dispatch('gallente', lightUpkeep());
    expect(vps(t)).toStrictEqual([1, 0, 0]);
    expect(t.last?.lines.filter((l) => l.startsWith('Fleet Supremacy'))).toStrictEqual(['Fleet Supremacy: Amarr has a large ship']);
  });

  it('an emergency light upkeep scores raids and Fleet Supremacy but not domination', () => {
    const t = startedGame(['amarr', 'caldari', 'gallente'], { mode: 'light' });
    give(t, 'gallente', DEV.fleetSupremacy);
    t.p('amarr').systems = 7;
    t.p('amarr').central = true;
    t.game.verge = { by: 'caldari', finalRound: 2, emergencyPending: true };
    t.dispatch('amarr', { type: 'endTurn' });
    expect(t.game.upkeep).toStrictEqual({ emergency: true, confirmed: [], raids: [], largeShips: [] });
    t.dispatch('amarr', lightUpkeep());
    t.dispatch('caldari', lightUpkeep());
    t.dispatch('gallente', lightUpkeep({ largeShip: true }));
    expect(vps(t)).toStrictEqual([0, 0, 1]);
    expect(t.game).toMatchObject({ phase: 'actions', round: 2 });
  });

  it('a full upkeep still judges a raid by its strength against the defence, and Fleet Supremacy by the ships', () => {
    const t = startedGame(['amarr', 'caldari', 'gallente']);
    toUpkeep(t);
    give(t, 'amarr', DEV.fleetSupremacy);
    give(t, 'caldari', DEV.fleetSupremacy);
    t.p('amarr').ships.redeemer = 1; // large
    t.p('caldari').ships.cerberus = 1; // medium
    t.p('caldari').vp = 2;
    t.p('gallente').vp = 2;
    t.p('gallente').homeCitadels = 1; // defence 3
    t.dispatch('amarr', fullConfirm([{ target: 'caldari', strength: 3 }, { target: 'gallente', strength: 3 }]));
    expect(t.game.upkeep?.largeShips).toStrictEqual([]);
    t.dispatch('caldari', fullConfirm());
    t.dispatch('gallente', fullConfirm());
    // Caldari's home defends 2: strength 3 gets through. Gallente's citadel makes it 3: strength 3 fails.
    expect(t.last?.lines).toEqual(expect.arrayContaining([
      "Amarr's raid on Caldari succeeds (strength 3 against 2)",
      "Amarr's raid on Gallente fails (strength 3 against 3)",
      'Fleet Supremacy: Amarr has a large ship',
    ]));
    expect(t.last?.lines.filter((l) => l.startsWith('Fleet Supremacy'))).toStrictEqual(['Fleet Supremacy: Amarr has a large ship']);
    expect(vps(t)).toStrictEqual([2, 1, 2]);
  });

  describe('the end', () => {
    /** A round-1 light upkeep with the verge already set for round 1, so this upkeep is the last one. */
    function finalUpkeep(): Table {
      const t = lightUpkeepTable();
      t.game.verge = { by: 'amarr', finalRound: 1, emergencyPending: false };
      return t;
    }
    const confirmAll = (t: Table): void => {
      for (const f of t.game.seats) t.dispatch(f, lightUpkeep());
    };

    it('a light game ends ranked by VP, then systems', () => {
      const t = finalUpkeep();
      t.p('amarr').vp = 10;
      t.p('caldari').vp = 10;
      t.p('gallente').vp = 4;
      t.p('amarr').systems = 3;
      t.p('caldari').systems = 2;
      confirmAll(t);
      expect(t.game.phase).toBe('ended');
      expect(t.game).toMatchObject({ turn: null, upkeep: null, round: 1 });
      expect(t.game.result).toStrictEqual({ ranking: ['amarr', 'caldari', 'gallente'], winners: ['amarr'] });
      expect(t.last?.lines).toContain('Game over: Amarr wins');
      expect(t.last?.lines).toContain('Final ranking: 1. Amarr (10 VP, 3 systems), 2. Caldari (10 VP, 2 systems), 3. Gallente (4 VP, 0 systems)');
      expect(t.last?.lines.some((l) => l.includes('strength'))).toBe(false);
      expect(t.last?.notices).toContainEqual({ to: 'all', text: 'Game over: Amarr wins', kind: 'info' });
    });

    it('the seat with more systems wins a tie on VP, whatever the seat order', () => {
      const t = finalUpkeep();
      t.p('amarr').vp = 10;
      t.p('caldari').vp = 10;
      t.p('caldari').systems = 4;
      t.p('amarr').systems = 3;
      confirmAll(t);
      expect(t.game.result).toStrictEqual({ ranking: ['caldari', 'amarr', 'gallente'], winners: ['caldari'] });
    });

    it('a tie on VP and systems is shared, and ship strength never enters it', () => {
      const t = finalUpkeep();
      t.p('amarr').vp = 10;
      t.p('caldari').vp = 10;
      t.p('amarr').systems = 2;
      t.p('caldari').systems = 2;
      t.p('caldari').ships.sin = 1; // a light game never has ships; if one were there it would still not count
      confirmAll(t);
      expect(t.game.result).toStrictEqual({ ranking: ['amarr', 'caldari', 'gallente'], winners: ['amarr', 'caldari'] });
      expect(t.last?.lines).toContain('Game over: Amarr and Caldari share the victory');
      expect(t.last?.lines).toContain('Final ranking: 1. Amarr (10 VP, 2 systems), 2. Caldari (10 VP, 2 systems), 3. Gallente (0 VP, 0 systems)');
    });

    it('scores domination and Fleet Supremacy in the last upkeep before ranking', () => {
      const t = finalUpkeep();
      give(t, 'amarr', DEV.fleetSupremacy);
      t.p('amarr').vp = 9;
      t.p('caldari').vp = 10;
      t.p('caldari').systems = 5;
      t.dispatch('amarr', lightUpkeep({ largeShip: true }));
      t.dispatch('caldari', lightUpkeep());
      t.dispatch('gallente', lightUpkeep());
      expect(vps(t)).toStrictEqual([10, 12, 0]);
      expect(t.game.result).toStrictEqual({ ranking: ['caldari', 'amarr', 'gallente'], winners: ['caldari'] });
    });

    it('accepts no further commands once ended', () => {
      const t = finalUpkeep();
      confirmAll(t);
      refuses(t, 'amarr', lightUpkeep(), 'wrong_phase');
      refuses(t, 'amarr', { type: 'pass' }, 'wrong_phase');
    });

    it('a full game still ranks ties by ship strength, and prints it', () => {
      const t = startedGame(['amarr', 'caldari', 'gallente']);
      toUpkeep(t);
      t.game.verge = { by: 'amarr', finalRound: 1, emergencyPending: false };
      for (const f of ['amarr', 'caldari', 'gallente'] as const) t.p(f).vp = 10;
      t.p('gallente').ships.sin = 1; // +5 strength
      t.p('amarr').ships.zealot = 1; // +3
      t.p('caldari').ships.cerberus = 1; // +3
      for (const f of t.game.seats) t.dispatch(f, fullConfirm());
      expect(t.game.result).toStrictEqual({ ranking: ['gallente', 'amarr', 'caldari'], winners: ['gallente'] });
      expect(t.last?.lines).toContain('Final ranking: 1. Gallente (10 VP, 0 systems, strength 7), 2. Amarr (10 VP, 0 systems, strength 5), 3. Caldari (10 VP, 0 systems, strength 5)');
    });
  });
});

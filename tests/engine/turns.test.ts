import { describe, expect, it } from 'vitest';
import { DEV } from '../../src/data/developments';
import type { FactionId } from '../../src/data/types';
import { apply } from '../../src/engine/apply';
import { isError, type AdjustDelta, type ApplyResult, type Command, type GameState, type RuleError, type SystemContents } from '../../src/engine/types';
import { advanceTurn, beginAction } from '../../src/engine/turns';
import { RuleFail, type Out } from '../../src/engine/util';
import { NOW, startedGame, uidOf, type Table } from './helpers';

const move: Command = { type: 'action', action: 'move' };
const claim = (from: FactionId | null = null, central = false): Command => ({ type: 'action', action: 'claim', from, central });
const extract = (planetary: boolean, moon: boolean): Command => ({ type: 'action', action: 'extract', planetary, moon });
const endTurn: Command = { type: 'endTurn' };
const pass: Command = { type: 'pass' };
/** Forces Amarr's turn on (Amarr is the first player in these tables). */
const forceAdvance: Command = { type: 'forceAdvance', expected: 'amarr' };

const delta = (d: Partial<AdjustDelta> = {}): AdjustDelta => ({
  res: {}, vp: 0, systems: 0, homeCitadels: 0, lockedHomeBelts: 0, structures: {}, belts: {}, ships: {}, central: null, ...d,
});
const adjust = (d: Partial<AdjustDelta>, correction = false, reason = 'table fix'): Command => ({
  type: 'adjust', delta: delta(d), correction, reason,
});

function codeOf(r: ApplyResult | RuleError): string {
  if (!isError(r)) throw new Error(`expected a RuleError, got success: ${r.lines.join(' | ')}`);
  return r.code;
}

function failure(fn: () => unknown): RuleError {
  try {
    fn();
  } catch (e) {
    if (e instanceof RuleFail) return e.e;
    throw e;
  }
  throw new Error('expected a RuleFail');
}

const newOut = (): Out => ({ lines: [], notices: [] });
const give = (t: Table, f: FactionId, dev: string): void => {
  t.p(f).completed.push(dev);
};
const lines = (t: Table): string[] => t.last?.lines ?? [];

/** The faction holding the turn (read through a function so TS does not remember an earlier `g.turn = null`). */
const turnHolder = (g: GameState): FactionId | undefined => g.turn?.faction;

/** `f` takes an action and ends the turn. */
function actAndEnd(t: Table, f: FactionId, cmd: Command = move): void {
  t.dispatch(f, cmd);
  t.dispatch(f, endTurn);
}

/** Caldari starts and passes at once, so Amarr is the only player left taking turns. */
function soloAmarr(isk = 30): Table {
  const t = startedGame(['amarr', 'caldari'], { firstPlayer: 'caldari' });
  t.dispatch('caldari', pass);
  t.p('amarr').res.isk = isk;
  expect(t.game.turn?.faction).toBe('amarr');
  return t;
}

/** Rejected commands must leave the table exactly as it was. */
function expectRejected(t: Table, f: FactionId, cmd: Command, code: string): void {
  const game = structuredClone(t.game);
  const privs = structuredClone(t.privs);
  expect(codeOf(t.tryDispatch(f, cmd))).toBe(code);
  expect(t.game).toStrictEqual(game);
  expect(t.privs).toStrictEqual(privs);
}

describe('actions and cubes', () => {
  it('takes the first three actions free, then charges 5 and 10 ISK for the 4th and 5th', () => {
    const t = soloAmarr(30);
    actAndEnd(t, 'amarr', move);
    actAndEnd(t, 'amarr', move);
    actAndEnd(t, 'amarr', claim());
    expect(t.p('amarr').res.isk).toBe(30);
    expect(t.p('amarr').cubesUsed).toBe(3);

    t.dispatch('amarr', claim());
    expect(t.p('amarr').res.isk).toBe(25);
    expect(t.p('amarr').cubesUsed).toBe(4);
    expect(lines(t)).toContain('Amarr pays 5 ISK for their 4th action');
    t.dispatch('amarr', endTurn);

    t.dispatch('amarr', extract(true, false));
    expect(t.p('amarr').res.isk).toBe(15);
    expect(t.p('amarr').cubesUsed).toBe(5);
    expect(lines(t)).toContain('Amarr pays 10 ISK for their 5th action');
  });

  it('rejects a paid action the player cannot afford and keeps the cube', () => {
    const t = soloAmarr(4);
    t.p('amarr').cubesUsed = 3;
    expectRejected(t, 'amarr', move, 'insufficient');
    expect(t.p('amarr').cubesUsed).toBe(3);
    expect(t.game.turn?.actionTaken).toBeNull();
  });

  it('rejects a 6th action with no_cubes', () => {
    const t = soloAmarr();
    t.p('amarr').cubesUsed = 5;
    expectRejected(t, 'amarr', extract(true, false), 'no_cubes');
  });

  it('rejects the third claim of a round with slot_full', () => {
    const t = soloAmarr();
    actAndEnd(t, 'amarr', claim());
    actAndEnd(t, 'amarr', claim());
    expectRejected(t, 'amarr', claim(), 'slot_full');
    // other action types still have slots
    t.dispatch('amarr', move);
    expect(t.p('amarr').slots).toStrictEqual({ move: 1, claim: 2, extract: 0, manufacture: 0, trade: 0, build: 0, research: 0 });
  });

  it('rejects an action when it is not your turn', () => {
    const t = startedGame(['amarr', 'caldari']);
    expectRejected(t, 'caldari', move, 'not_your_turn');
  });

  it('rejects a second action in the same turn with already_acted', () => {
    const t = startedGame(['amarr', 'caldari']);
    t.dispatch('amarr', move);
    expectRejected(t, 'amarr', extract(true, false), 'already_acted');
    expect(t.p('amarr').cubesUsed).toBe(1);
  });

  it('records the cube, the slot and the action taken', () => {
    const t = startedGame(['amarr', 'caldari']);
    t.dispatch('amarr', move);
    expect(t.p('amarr').cubesUsed).toBe(1);
    expect(t.p('amarr').slots.move).toBe(1);
    expect(t.game.turn).toStrictEqual({ faction: 'amarr', actionTaken: 'move', deployable: false });
  });

  it('beginAction validates and applies on the game it is given', () => {
    const t = startedGame(['amarr', 'caldari']);
    const g: GameState = structuredClone(t.game);
    const out = newOut();
    expect(failure(() => beginAction(g, 'caldari', 'move', out)).code).toBe('not_your_turn');
    const p = beginAction(g, 'amarr', 'trade', out);
    expect(p).toBe(g.players.amarr);
    expect(p.slots.trade).toBe(1);
    expect(g.turn?.actionTaken).toBe('trade');
    expect(failure(() => beginAction(g, 'amarr', 'trade', out)).code).toBe('already_acted');
    g.phase = 'upkeep';
    expect(failure(() => beginAction(g, 'amarr', 'move', out)).code).toBe('wrong_phase');
  });
});

describe('ending the turn', () => {
  it('rejects endTurn before an action with no_action', () => {
    const t = startedGame(['amarr', 'caldari']);
    expectRejected(t, 'amarr', endTurn, 'no_action');
  });

  it('rejects endTurn from a player who does not hold the turn', () => {
    const t = startedGame(['amarr', 'caldari']);
    t.dispatch('amarr', move);
    expectRejected(t, 'caldari', endTurn, 'not_your_turn');
  });

  it('rejects endTurn while a combat is active', () => {
    const t = startedGame(['amarr', 'caldari']);
    t.dispatch('amarr', move);
    t.game.combat = {} as GameState['combat'];
    expectRejected(t, 'amarr', endTurn, 'combat_active');
  });

  it('rejects endTurn while research is pending, but only when the private doc is present', () => {
    const t = startedGame(['amarr', 'caldari']);
    t.dispatch('amarr', move);
    t.privs.amarr.pendingResearch = 2;
    expectRejected(t, 'amarr', endTurn, 'pending_research');
    t.privs.amarr.pendingResearch = 0;
    t.dispatch('amarr', endTurn);
    expect(t.game.turn?.faction).toBe('caldari');

    const t2 = startedGame(['amarr', 'caldari']);
    t2.dispatch('amarr', move);
    const r = apply(t2.game, endTurn, { actor: 'amarr', uid: uidOf('amarr'), priv: null, now: NOW });
    expect(isError(r)).toBe(false);
  });

  it('hands the turn clockwise with a fresh turn state', () => {
    const t = startedGame(['amarr', 'caldari', 'gallente']);
    t.dispatch('amarr', move);
    t.dispatch('amarr', endTurn);
    expect(t.game.turn).toStrictEqual({ faction: 'caldari', actionTaken: null, deployable: false });
    expect(lines(t)).toContain('Amarr ended their turn');
  });

  it('skips passed players and wraps around the table', () => {
    const t = startedGame(['amarr', 'caldari', 'gallente'], { firstPlayer: 'caldari' });
    t.dispatch('caldari', pass);
    expect(t.game.turn?.faction).toBe('gallente');
    actAndEnd(t, 'gallente');
    expect(t.game.turn?.faction).toBe('amarr'); // wrapped past the end of the seat list
    actAndEnd(t, 'amarr');
    expect(t.game.turn?.faction).toBe('gallente'); // caldari passed, so skipped
    expect(t.p('caldari').passed).toBe(true);
  });

  it('keeps giving the turn to the last player still in', () => {
    const t = soloAmarr();
    actAndEnd(t, 'amarr');
    expect(t.game.turn).toStrictEqual({ faction: 'amarr', actionTaken: null, deployable: false });
    expect(t.game.phase).toBe('actions');
  });

  it('passes a player automatically when they end their turn with 5 cubes used', () => {
    const t = startedGame(['amarr', 'caldari']);
    t.p('amarr').cubesUsed = 4;
    t.p('amarr').res.isk = 20;
    t.dispatch('amarr', move);
    expect(t.p('amarr').passed).toBe(false);
    t.dispatch('amarr', endTurn);
    expect(t.p('amarr').passed).toBe(true);
    expect(t.game.turn?.faction).toBe('caldari');
    actAndEnd(t, 'caldari');
    expect(t.game.turn?.faction).toBe('caldari'); // amarr is out
  });

  it('marks a player with 5 cubes passed when the turn would reach them', () => {
    const t = startedGame(['amarr', 'caldari', 'gallente']);
    t.p('caldari').cubesUsed = 5;
    actAndEnd(t, 'amarr');
    expect(t.p('caldari').passed).toBe(true);
    expect(t.game.turn?.faction).toBe('gallente');
  });

  it('advanceTurn can be called directly and starts from the first player when there is no turn', () => {
    const t = startedGame(['amarr', 'caldari', 'gallente'], { firstPlayer: 'gallente' });
    const g: GameState = structuredClone(t.game);
    g.turn = null;
    advanceTurn(g, newOut());
    expect(g.turn).toStrictEqual({ faction: 'gallente', actionTaken: null, deployable: false });
    g.players.gallente!.passed = true;
    g.turn = null;
    advanceTurn(g, newOut());
    expect(turnHolder(g)).toBe('amarr');
  });

  it('moves to the upkeep phase when every player has passed', () => {
    const t = startedGame(['amarr', 'caldari', 'gallente']);
    t.dispatch('amarr', pass);
    t.dispatch('caldari', pass);
    expect(t.game.phase).toBe('actions');
    t.dispatch('gallente', pass);
    expect(t.game.phase).toBe('upkeep');
    expect(t.game.turn).toBeNull();
    expect(t.game.upkeep).toStrictEqual({ emergency: false, confirmed: [], raids: [], largeShips: [] });
  });

  it('runs an emergency upkeep when the verge was reached during the actions', () => {
    const t = startedGame(['amarr', 'caldari', 'gallente']);
    t.game.verge = { by: 'caldari', finalRound: 2, emergencyPending: true };
    t.dispatch('amarr', move);
    t.dispatch('amarr', endTurn);
    expect(t.game.phase).toBe('upkeep');
    expect(t.game.turn).toBeNull();
    expect(t.game.upkeep).toStrictEqual({ emergency: true, confirmed: [], raids: [], largeShips: [] });
  });
});

describe('pass', () => {
  it('passes only before acting, on your own turn', () => {
    const t = startedGame(['amarr', 'caldari', 'gallente']);
    expectRejected(t, 'caldari', pass, 'not_your_turn');
    t.dispatch('amarr', move);
    expectRejected(t, 'amarr', pass, 'already_acted');
    t.dispatch('amarr', endTurn);
    t.dispatch('caldari', pass);
    expect(t.p('caldari').passed).toBe(true);
    expect(t.game.turn?.faction).toBe('gallente');
    expect(lines(t)).toContain('Caldari passed');
  });
});

describe('forceAdvance', () => {
  it('lets any seated player move on a stuck turn without passing its holder', () => {
    const t = startedGame(['amarr', 'caldari', 'gallente']);
    t.dispatch('gallente', forceAdvance);
    expect(t.game.turn?.faction).toBe('caldari');
    expect(t.p('amarr').passed).toBe(false);
    expect(t.p('amarr').cubesUsed).toBe(0);
    expect(lines(t)).toContain('Gallente forced the turn on from Amarr');
  });

  it('works after the holder acted, and the holder can still be reached later', () => {
    const t = startedGame(['amarr', 'caldari']);
    t.dispatch('amarr', move);
    t.dispatch('caldari', forceAdvance);
    expect(t.game.turn).toStrictEqual({ faction: 'caldari', actionTaken: null, deployable: false });
    t.dispatch('caldari', pass);
    expect(t.game.turn?.faction).toBe('amarr');
  });

  it('is refused for devices that are not seated', () => {
    const t = startedGame(['amarr', 'caldari']);
    expect(codeOf(t.tryAsUid('stranger', forceAdvance))).toBe('not_seated');
  });

  it('skips only the turn it names: refused once that turn has already ended', () => {
    const t = startedGame(['amarr', 'caldari', 'gallente']);
    t.dispatch('amarr', pass); // Amarr's turn ends while Gallente's request is on its way
    const before = structuredClone(t.game);
    const r = t.tryDispatch('gallente', forceAdvance);
    expect(codeOf(r)).toBe('stale_turn');
    expect(isError(r) && r.message).toBe("Amarr's turn already ended, so nothing was skipped");
    expect(t.game).toStrictEqual(before);
    t.dispatch('gallente', { type: 'forceAdvance', expected: 'caldari' });
    expect(t.game.turn?.faction).toBe('gallente');
  });

  it('needs the turn holder it means to skip', () => {
    const t = startedGame(['amarr', 'caldari']);
    expect(codeOf(t.tryDispatch('caldari', { type: 'forceAdvance' } as unknown as Command))).toBe('bad_command');
  });
});

describe('a combat belongs to its turn', () => {
  const attack: Command = { type: 'combatStart', defender: 'caldari', homeOf: null, controller: null, citadels: 0 };

  it('refuses to pass while a combat is open, even before any action (P1)', () => {
    const t = startedGame(['amarr', 'caldari']);
    t.dispatch('amarr', attack);
    expectRejected(t, 'amarr', pass, 'combat_active');
    const r = t.tryDispatch('amarr', pass);
    expect(isError(r) && r.message).toBe('Finish or cancel the combat before passing (Combat → More → Cancel combat)');
    t.dispatch('amarr', { type: 'combatCancel' });
    t.dispatch('amarr', pass);
    expect(t.game.turn?.faction).toBe('caldari');
  });

  it('refuses to force the turn on while a combat is open, saying how to cancel it (P2)', () => {
    const t = startedGame(['amarr', 'caldari']);
    t.dispatch('amarr', attack);
    expectRejected(t, 'caldari', forceAdvance, 'combat_active');
    const r = t.tryDispatch('caldari', forceAdvance);
    expect(isError(r) && r.message).toBe('Cancel or finish the combat first (Combat → More → Cancel combat)');
    t.dispatch('caldari', { type: 'combatCancel' });
    t.dispatch('caldari', forceAdvance);
    expect(t.game.turn?.faction).toBe('caldari');
  });

  it('never lets the turn, the round or the game move on with a combat open', () => {
    const t = startedGame(['amarr', 'caldari']);
    t.dispatch('amarr', attack);
    const err = failure(() => advanceTurn(t.game, newOut()));
    expect(err.code).toBe('combat_active');
    expect(t.game.phase).toBe('actions');
  });
});

describe('phase gates', () => {
  const actionsOnly: Command[] = [
    move, claim(), extract(true, false), endTurn, pass, forceAdvance,
    { type: 'discover', rewards: [{ kind: 'control' }] }, { type: 'autoClaim', central: false },
    { type: 'payJump', planetary: 1, moon: 0 },
  ];
  const anyTime: Command[] = [
    adjust({ vp: 1 }), { type: 'missionComplete', vp: 1 }, { type: 'eventPlayed' },
    { type: 'discardMinerals', minerals: { pyrite: 1 } },
  ];

  it('only allows the actions-phase commands during the actions phase', () => {
    for (const phase of ['upkeep', 'setup', 'lobby', 'ended'] as const) {
      const t = startedGame(['amarr', 'caldari']);
      t.p('amarr').res.planetary = 2;
      t.game.phase = phase;
      for (const cmd of actionsOnly) {
        expect(codeOf(t.tryDispatch('amarr', cmd)), `${cmd.type} in ${phase}`).toBe('wrong_phase');
      }
    }
  });

  it('allows adjustments, missions, events and discards in the actions and upkeep phases only', () => {
    for (const phase of ['actions', 'upkeep'] as const) {
      const t = startedGame(['amarr', 'caldari']);
      t.p('amarr').res.pyrite = 2;
      t.game.phase = phase;
      for (const cmd of anyTime) t.dispatch('amarr', cmd);
    }
    for (const phase of ['setup', 'lobby', 'ended'] as const) {
      const t = startedGame(['amarr', 'caldari']);
      t.p('amarr').res.pyrite = 2;
      t.game.phase = phase;
      for (const cmd of anyTime) expect(codeOf(t.tryDispatch('amarr', cmd)), `${cmd.type} in ${phase}`).toBe('wrong_phase');
    }
  });
});

describe('move, claim and extract', () => {
  it('logs a move', () => {
    const t = startedGame(['amarr', 'caldari']);
    t.dispatch('amarr', move);
    expect(lines(t)).toContain('Amarr took a Move action');
  });

  it('claims a system for the actor', () => {
    const t = startedGame(['amarr', 'caldari']);
    t.dispatch('amarr', claim());
    expect(t.p('amarr').systems).toBe(1);
    expect(t.p('caldari').systems).toBe(0);
    expect(lines(t)).toContain('Amarr claimed a system');
  });

  it('takes a system from a rival: theirs -1, yours +1, no VP without Invader', () => {
    const t = startedGame(['amarr', 'caldari']);
    t.p('caldari').systems = 2;
    t.dispatch('amarr', claim('caldari'));
    expect(t.p('amarr').systems).toBe(1);
    expect(t.p('caldari').systems).toBe(1);
    expect(t.p('amarr').vp).toBe(0);
    expect(lines(t)).toContain('Amarr claimed a system from Caldari');
    expect(t.last?.notices).toStrictEqual([{ to: 'caldari', text: 'Amarr took one of your systems', kind: 'todo' }]);
  });

  it('tells nobody when the claimed system was unclaimed', () => {
    const t = startedGame(['amarr', 'caldari']);
    t.dispatch('amarr', claim());
    expect(t.last?.notices).toStrictEqual([]);
  });

  it('gives an Invader holder +1 VP for taking a system from a rival', () => {
    const t = startedGame(['amarr', 'caldari', 'gallente'], { firstPlayer: 'caldari' });
    give(t, 'caldari', DEV.invader);
    t.p('amarr').systems = 2;
    t.dispatch('caldari', claim('amarr'));
    expect(t.p('caldari').vp).toBe(1);
    expect(t.p('amarr').systems).toBe(1);
    expect(t.p('caldari').systems).toBe(1);
    expect(lines(t)).toContain('Caldari claimed a system from Amarr');
  });

  it('gives Invader nothing for an unclaimed system', () => {
    const t = startedGame(['amarr', 'caldari']);
    give(t, 'amarr', DEV.invader);
    t.dispatch('amarr', claim());
    expect(t.p('amarr').vp).toBe(0);
  });

  it('pays Lobbyist holders when Invader scores', () => {
    const t = startedGame(['amarr', 'caldari', 'gallente'], { firstPlayer: 'caldari' });
    give(t, 'caldari', DEV.invader);
    give(t, 'gallente', DEV.lobbyist);
    t.p('amarr').systems = 1;
    t.dispatch('caldari', claim('amarr'));
    expect(t.p('gallente').res.isk).toBe(5);
  });

  it('moves 3 ISK to a rival holding Civilian Resistance', () => {
    const t = startedGame(['amarr', 'caldari']);
    give(t, 'caldari', DEV.civilianResistance);
    t.p('caldari').systems = 1;
    t.p('amarr').res.isk = 10;
    t.dispatch('amarr', claim('caldari'));
    expect(t.p('amarr').res.isk).toBe(7);
    expect(t.p('caldari').res.isk).toBe(7);
    expect(t.p('caldari').systems).toBe(0);
    expect(lines(t)).toContain("Caldari's Civilian Resistance: Amarr pays Caldari 3 ISK");
    expect(t.last?.notices).toStrictEqual([{ to: 'caldari', text: 'Amarr took one of your systems and paid you 3 ISK (Civilian Resistance)', kind: 'todo' }]);
  });

  it('counts the cube cost before Civilian Resistance and rejects when 3 ISK are missing', () => {
    const t = startedGame(['amarr', 'caldari']);
    give(t, 'caldari', DEV.civilianResistance);
    t.p('caldari').systems = 1;
    t.p('amarr').res.isk = 2;
    expectRejected(t, 'amarr', claim('caldari'), 'insufficient');
    // 7 ISK pay a 5 ISK cube but then leave only 2 for the 3 ISK owed
    t.p('amarr').res.isk = 7;
    t.p('amarr').cubesUsed = 3;
    expectRejected(t, 'amarr', claim('caldari'), 'insufficient');
    t.p('amarr').res.isk = 8;
    t.dispatch('amarr', claim('caldari'));
    expect(t.p('amarr').res.isk).toBe(0);
    expect(t.p('caldari').res.isk).toBe(7);
  });

  it('charges nothing for an unclaimed system, or when only the claimer holds Civilian Resistance', () => {
    const t = startedGame(['amarr', 'caldari']);
    give(t, 'caldari', DEV.civilianResistance);
    t.dispatch('amarr', claim());
    expect(t.p('amarr').res.isk).toBe(4);
    expect(t.p('caldari').res.isk).toBe(4);

    const t2 = startedGame(['amarr', 'caldari']);
    give(t2, 'amarr', DEV.civilianResistance); // the claimer's own card never applies
    t2.p('caldari').systems = 1;
    t2.dispatch('amarr', claim('caldari'));
    expect(t2.p('amarr').res.isk).toBe(4);
    expect(t2.p('caldari').res.isk).toBe(4);
  });

  it('caps the ISK a Civilian Resistance holder receives', () => {
    const t = startedGame(['amarr', 'caldari']);
    give(t, 'caldari', DEV.civilianResistance);
    t.p('caldari').systems = 1;
    t.p('caldari').res.isk = 48;
    t.p('amarr').res.isk = 10;
    t.dispatch('amarr', claim('caldari'));
    expect(t.p('caldari').res.isk).toBe(49);
    expect(lines(t)).toContain('ISK capped at 49 (2 lost)');
  });

  it('rejects a claim from a rival with no systems', () => {
    const t = startedGame(['amarr', 'caldari']);
    expectRejected(t, 'amarr', claim('caldari'), 'no_systems');
  });

  it('rejects claiming from yourself or from a faction that is not in the game', () => {
    const t = startedGame(['amarr', 'caldari']);
    t.p('amarr').systems = 2;
    expectRejected(t, 'amarr', claim('amarr'), 'bad_target');
    expectRejected(t, 'amarr', claim('minmatar'), 'no_player');
    expectRejected(t, 'amarr', claim('__proto__' as FactionId), 'no_player');
  });

  it('sets central for the actor and clears it from every other player', () => {
    const t = startedGame(['amarr', 'caldari', 'gallente']);
    t.p('caldari').central = true;
    t.dispatch('amarr', claim(null, true));
    expect(t.p('amarr').central).toBe(true);
    expect(t.p('caldari').central).toBe(false);
    expect(t.p('gallente').central).toBe(false);
    expect(lines(t)).toContain('Amarr took the central system from Caldari');
    expect(t.last?.notices).toStrictEqual([{ to: 'caldari', text: 'Amarr took the central system from you', kind: 'todo' }]);
  });

  it('tells nobody when the central system was free or already the claimer\'s', () => {
    const t = startedGame(['amarr', 'caldari']);
    t.dispatch('amarr', claim(null, true));
    expect(t.last?.notices).toStrictEqual([]);
  });

  it('tells a rival about both losses when a claim takes their system and the central one', () => {
    const t = startedGame(['amarr', 'caldari', 'gallente']);
    t.p('caldari').systems = 1;
    t.p('caldari').central = true;
    t.dispatch('amarr', claim('caldari', true));
    expect(t.last?.notices).toStrictEqual([
      { to: 'caldari', text: 'Amarr took one of your systems', kind: 'todo' },
      { to: 'caldari', text: 'Amarr took the central system from you', kind: 'todo' },
    ]);
  });

  it('names the flag the most tier 3 systems in a 2-player game (no central system there)', () => {
    const t = startedGame(['amarr', 'caldari']);
    t.p('caldari').central = true;
    t.dispatch('amarr', claim(null, true));
    expect(t.p('amarr').central).toBe(true);
    expect(t.p('caldari').central).toBe(false);
    expect(lines(t)).toContain('Amarr now controls the most tier 3 systems');
    expect(t.last?.notices).toStrictEqual([{ to: 'caldari', text: 'Amarr now controls the most tier 3 systems, not you', kind: 'todo' }]);
  });

  it('leaves central alone when the claim does not take it', () => {
    const t = startedGame(['amarr', 'caldari']);
    t.p('caldari').central = true;
    t.dispatch('amarr', claim());
    expect(t.p('caldari').central).toBe(true);
    expect(t.p('amarr').central).toBe(false);
  });

  it('offers Deployable Infrastructure after a claim only to its holder', () => {
    const t = startedGame(['amarr', 'caldari']);
    t.dispatch('amarr', claim());
    expect(t.game.turn?.deployable).toBe(false);

    const t2 = startedGame(['amarr', 'caldari']);
    give(t2, 'amarr', DEV.deployableInfrastructure);
    t2.dispatch('amarr', claim());
    expect(t2.game.turn?.deployable).toBe(true);
    t2.dispatch('amarr', endTurn);
    expect(t2.game.turn?.deployable).toBe(false);
  });

  it('extracts planetary and/or moon materials, at least one', () => {
    const t = startedGame(['amarr', 'caldari']);
    expectRejected(t, 'amarr', extract(false, false), 'bad_extract');
    t.dispatch('amarr', extract(true, true));
    expect(t.p('amarr').res.planetary).toBe(1);
    expect(t.p('amarr').res.moon).toBe(1);
    expect(lines(t)).toContain('Amarr extracted planetary and moon materials');

    const t2 = startedGame(['amarr', 'caldari']);
    t2.dispatch('amarr', extract(false, true));
    expect(t2.p('amarr').res.planetary).toBe(0);
    expect(t2.p('amarr').res.moon).toBe(1);
    expect(lines(t2)).toContain('Amarr extracted moon materials');
  });

  it('counts claim and extract against the cube and slot limits', () => {
    const t = soloAmarr();
    actAndEnd(t, 'amarr', extract(true, false));
    actAndEnd(t, 'amarr', extract(false, true));
    expectRejected(t, 'amarr', extract(true, true), 'slot_full');
    expect(t.p('amarr').slots.extract).toBe(2);
  });
});

describe('what a claimed system holds', () => {
  const claimWith = (from: FactionId | null, contents: SystemContents): Command => ({ type: 'action', action: 'claim', from, central: false, contents });
  const rich = (): Table => {
    const t = startedGame(['amarr', 'caldari']);
    const c = t.p('caldari');
    c.systems = 2;
    c.belts = { pyrite: 2, mexallon: 1, tritanium: 0, morphite: 0 };
    c.structures = { engineering: 1, citadel: 2, customs: 1, refinery: 0 };
    c.homeCitadels = 1;
    t.p('amarr').belts = { pyrite: 0, mexallon: 0, tritanium: 0, morphite: 0 };
    return t;
  };

  it('moves belts and structures from the rival to the claimer, and says so', () => {
    const t = rich();
    const before = { ...t.p('amarr').structures };
    t.dispatch('amarr', claimWith('caldari', { belts: { pyrite: 2 }, structures: { customs: 1, citadel: 1 } }));
    expect(t.p('amarr').belts.pyrite).toBe(2);
    expect(t.p('caldari').belts).toMatchObject({ pyrite: 0, mexallon: 1 });
    expect(t.p('amarr').structures).toStrictEqual({ ...before, customs: before.customs + 1, citadel: before.citadel + 1 });
    expect(t.p('caldari').structures).toMatchObject({ customs: 0, citadel: 1, engineering: 1 });
    expect(lines(t)).toContain('Amarr claimed a system from Caldari with 2 pyrite belts, 1 Citadel, 1 Customs Office');
    expect(t.last?.notices).toStrictEqual([
      { to: 'caldari', text: 'Amarr took one of your systems (with 2 pyrite belts, 1 Citadel, 1 Customs Office: take them off your board)', kind: 'todo' },
    ]);
  });

  it('refuses what the rival does not have (belts, structures, a home Citadel), changing nothing', () => {
    const t = rich();
    expectRejected(t, 'amarr', claimWith('caldari', { belts: { pyrite: 3 }, structures: {} }), 'rival_lacks');
    expectRejected(t, 'amarr', claimWith('caldari', { belts: {}, structures: { refinery: 1 } }), 'rival_lacks');
    expectRejected(t, 'amarr', claimWith('caldari', { belts: {}, structures: { citadel: 2 } }), 'rival_lacks'); // 1 of the 2 is a home citadel
  });

  it('gives an unclaimed system\'s belts to the claimer, but no structures', () => {
    const t = rich();
    t.dispatch('amarr', claimWith(null, { belts: { morphite: 1, tritanium: 2 }, structures: {} }));
    expect(t.p('amarr').belts).toMatchObject({ morphite: 1, tritanium: 2 });
    expect(lines(t)).toContain('Amarr claimed a system with 2 tritanium belts, 1 morphite belt');
    expectRejected(rich(), 'amarr', claimWith(null, { belts: {}, structures: { customs: 1 } }), 'bad_contents');
  });

  it('rejects malformed contents', () => {
    const t = rich();
    expectRejected(t, 'amarr', claimWith('caldari', { belts: { gold: 1 } as never, structures: {} }), 'bad_contents');
    expectRejected(t, 'amarr', claimWith('caldari', { belts: {}, structures: { castle: 1 } as never }), 'bad_contents');
    expectRejected(t, 'amarr', claimWith('caldari', { belts: { pyrite: -1 }, structures: {} }), 'bad_amount');
  });

  it('a claim with no contents changes no belts or structures (the quick path)', () => {
    const t = rich();
    t.dispatch('amarr', claim('caldari'));
    expect(t.p('caldari').belts.pyrite).toBe(2);
    expect(t.p('amarr').belts.pyrite).toBe(0);
    expect(t.last?.notices[0]?.text).toBe('Amarr took one of your systems');
  });

  it('an automatic claim and a discovery control token give the belts too', () => {
    const t = rich();
    t.dispatch('amarr', move);
    t.dispatch('amarr', { type: 'autoClaim', central: false, contents: { belts: { pyrite: 1 }, structures: {} } });
    expect(t.p('amarr').belts.pyrite).toBe(1);
    expect(t.p('amarr').systems).toBe(1);
    expect(lines(t)).toContain('Amarr claimed a system by fleet strength with 1 pyrite belt');
    t.dispatch('amarr', { type: 'discover', rewards: [{ kind: 'control', contents: { belts: { mexallon: 2 }, structures: {} } }, { kind: 'control' }] });
    expect(t.p('amarr').belts.mexallon).toBe(2);
    expect(t.p('amarr').systems).toBe(3);
    expect(lines(t).some((l) => l.includes('control of a system with 2 mexallon belts'))).toBe(true);
    expectRejected(t, 'amarr', { type: 'autoClaim', central: false, contents: { belts: {}, structures: { customs: 1 } } }, 'bad_contents');
  });
});

describe('discover', () => {
  it('records research into the private doc and returns it with its owner', () => {
    const t = startedGame(['amarr', 'caldari']);
    t.dispatch('amarr', move);
    const r = t.dispatch('amarr', { type: 'discover', rewards: [{ kind: 'research', amount: 2 }] });
    expect(r.privOwner).toBe('amarr');
    expect(r.priv?.pendingResearch).toBe(2);
    expect(t.privs.amarr.pendingResearch).toBe(2);
    expect(lines(t).some((l) => l.includes('Amarr discovered') && l.includes('2 research'))).toBe(true);
    t.dispatch('amarr', { type: 'discover', rewards: [{ kind: 'research', amount: 1 }] });
    expect(t.privs.amarr.pendingResearch).toBe(3);
  });

  it('requires the private doc', () => {
    const t = startedGame(['amarr', 'caldari']);
    const r = apply(t.game, { type: 'discover', rewards: [{ kind: 'control' }] }, { actor: 'amarr', uid: uidOf('amarr'), priv: null, now: NOW });
    expect(codeOf(r)).toBe('no_private');
  });

  it('adds chosen basic minerals, any count', () => {
    const t = startedGame(['amarr', 'caldari']);
    Object.assign(t.p('amarr').res, { pyrite: 0, mexallon: 0, tritanium: 0 });
    t.dispatch('amarr', { type: 'discover', rewards: [{ kind: 'minerals', minerals: ['pyrite', 'pyrite', 'tritanium'] }] });
    expect(t.p('amarr').res.pyrite).toBe(2);
    expect(t.p('amarr').res.tritanium).toBe(1);
    expect(t.p('amarr').res.mexallon).toBe(0);
    t.dispatch('amarr', { type: 'discover', rewards: [{ kind: 'minerals', minerals: ['mexallon'] }] });
    expect(t.p('amarr').res.mexallon).toBe(1);
  });

  it('rejects morphite and unknown minerals, and an empty mineral reward', () => {
    const t = startedGame(['amarr', 'caldari']);
    expectRejected(t, 'amarr', { type: 'discover', rewards: [{ kind: 'minerals', minerals: ['morphite' as 'pyrite'] }] }, 'bad_mineral');
    expectRejected(t, 'amarr', { type: 'discover', rewards: [{ kind: 'minerals', minerals: ['isk' as 'pyrite'] }] }, 'bad_mineral');
    expectRejected(t, 'amarr', { type: 'discover', rewards: [{ kind: 'minerals', minerals: [] }] }, 'bad_amount');
  });

  it('records control, moon, planetary, component and ISK rewards', () => {
    const t = startedGame(['amarr', 'caldari']);
    t.dispatch('amarr', {
      type: 'discover',
      rewards: [
        { kind: 'control' }, { kind: 'moon', amount: 1 }, { kind: 'planetary', amount: 2 },
        { kind: 'component', amount: 1 }, { kind: 'isk', amount: 4 },
      ],
    });
    const p = t.p('amarr');
    expect([p.systems, p.res.moon, p.res.planetary, p.res.component, p.res.isk]).toStrictEqual([1, 1, 2, 1, 8]);
  });

  it('tells the player to draw a card for a card reward', () => {
    const t = startedGame(['amarr', 'caldari']);
    const r = t.dispatch('amarr', { type: 'discover', rewards: [{ kind: 'card' }] });
    expect(r.notices).toStrictEqual([{ to: 'amarr', text: 'Draw an Event or Mission card', kind: 'todo' }]);
  });

  it('is all or nothing: one bad reward rejects the whole command', () => {
    const t = startedGame(['amarr', 'caldari']);
    expectRejected(t, 'amarr', {
      type: 'discover',
      rewards: [{ kind: 'research', amount: 2 }, { kind: 'control' }, { kind: 'isk', amount: 1.5 }],
    }, 'bad_amount');
    expect(t.privs.amarr.pendingResearch).toBe(0);
    expectRejected(t, 'amarr', { type: 'discover', rewards: [{ kind: 'nonsense' } as never] }, 'bad_reward');
    expectRejected(t, 'amarr', { type: 'discover', rewards: [] }, 'bad_reward');
    expectRejected(t, 'amarr', { type: 'discover', rewards: [{ kind: 'research', amount: 0 }] }, 'bad_amount');
    expectRejected(t, 'amarr', { type: 'discover', rewards: [{ kind: 'research', amount: -1 }] }, 'bad_amount');
  });

  it('caps ISK rewards at 49', () => {
    const t = startedGame(['amarr', 'caldari']);
    t.p('amarr').res.isk = 47;
    t.dispatch('amarr', { type: 'discover', rewards: [{ kind: 'isk', amount: 4 }] });
    expect(t.p('amarr').res.isk).toBe(49);
  });
});

describe('autoClaim', () => {
  it('needs a move this turn', () => {
    const t = startedGame(['amarr', 'caldari']);
    expectRejected(t, 'amarr', { type: 'autoClaim', central: false }, 'no_move');
    t.dispatch('amarr', extract(true, false));
    expectRejected(t, 'amarr', { type: 'autoClaim', central: false }, 'no_move');
  });

  it('is refused for a player who does not hold the turn', () => {
    const t = startedGame(['amarr', 'caldari']);
    t.dispatch('amarr', move);
    expectRejected(t, 'caldari', { type: 'autoClaim', central: false }, 'not_your_turn');
  });

  it('claims a system after a move, optionally the central one', () => {
    const t = startedGame(['amarr', 'caldari', 'gallente']);
    t.p('caldari').central = true;
    t.dispatch('amarr', move);
    t.dispatch('amarr', { type: 'autoClaim', central: false });
    expect(t.p('amarr').systems).toBe(1);
    expect(t.p('caldari').central).toBe(true);
    expect(lines(t)).toContain('Amarr claimed a system by fleet strength');
    t.dispatch('amarr', { type: 'autoClaim', central: true });
    expect(t.p('amarr').systems).toBe(2);
    expect(t.p('amarr').central).toBe(true);
    expect(t.p('caldari').central).toBe(false);
    expect(t.last?.notices).toStrictEqual([{ to: 'caldari', text: 'Amarr took the central system from you', kind: 'todo' }]);
  });

  it('does not use up a claim slot or a cube', () => {
    const t = startedGame(['amarr', 'caldari']);
    t.dispatch('amarr', move);
    t.dispatch('amarr', { type: 'autoClaim', central: false });
    expect(t.p('amarr').cubesUsed).toBe(1);
    expect(t.p('amarr').slots.claim).toBe(0);
  });

  it('offers Deployable Infrastructure to its holder', () => {
    const t = startedGame(['amarr', 'caldari']);
    give(t, 'amarr', DEV.deployableInfrastructure);
    t.dispatch('amarr', move);
    expect(t.game.turn?.deployable).toBe(false);
    t.dispatch('amarr', { type: 'autoClaim', central: false });
    expect(t.game.turn?.deployable).toBe(true);
  });
});

describe('payJump', () => {
  it('spends planetary and moon materials', () => {
    const t = startedGame(['amarr', 'caldari']);
    t.p('amarr').res.planetary = 3;
    t.p('amarr').res.moon = 2;
    t.dispatch('amarr', { type: 'payJump', planetary: 2, moon: 1 });
    expect(t.p('amarr').res.planetary).toBe(1);
    expect(t.p('amarr').res.moon).toBe(1);
    expect(lines(t)).toContain('Amarr paid 2 planetary and 1 moon materials for a jump');
  });

  it('rejects zero, negative or fractional totals, and more than the player holds', () => {
    const t = startedGame(['amarr', 'caldari']);
    t.p('amarr').res.planetary = 1;
    expectRejected(t, 'amarr', { type: 'payJump', planetary: 0, moon: 0 }, 'bad_amount');
    expectRejected(t, 'amarr', { type: 'payJump', planetary: -1, moon: 2 }, 'bad_amount');
    expectRejected(t, 'amarr', { type: 'payJump', planetary: 0.5, moon: 1 }, 'bad_amount');
    expectRejected(t, 'amarr', { type: 'payJump', planetary: 2, moon: 0 }, 'insufficient');
    expectRejected(t, 'amarr', { type: 'payJump', planetary: 1, moon: 1 }, 'insufficient');
    expect(t.p('amarr').res.planetary).toBe(1);
  });
});

describe('missionComplete and Lobbyist', () => {
  it('gains VP and pays every other Lobbyist holder the same amount in ISK', () => {
    const t = startedGame(['amarr', 'caldari', 'gallente']);
    give(t, 'amarr', DEV.lobbyist);
    give(t, 'gallente', DEV.lobbyist);
    t.dispatch('caldari', { type: 'missionComplete', vp: 2 });
    expect(t.p('caldari').vp).toBe(2);
    expect(t.p('amarr').res.isk).toBe(6);
    expect(t.p('gallente').res.isk).toBe(6);
    expect(t.p('caldari').res.isk).toBe(4);
    expect(lines(t)).toContain('Caldari completed a mission');
  });

  it('pays the holder nothing for their own mission', () => {
    const t = startedGame(['amarr', 'caldari']);
    give(t, 'amarr', DEV.lobbyist);
    t.dispatch('amarr', { type: 'missionComplete', vp: 3 });
    expect(t.p('amarr').res.isk).toBe(4);
  });

  it('needs a whole number of VP of at least 1', () => {
    const t = startedGame(['amarr', 'caldari']);
    for (const vp of [0, -1, 1.5, Number.NaN]) {
      expectRejected(t, 'amarr', { type: 'missionComplete', vp }, 'bad_amount');
    }
  });

  it('needs no turn: any seated player can report a mission', () => {
    const t = startedGame(['amarr', 'caldari']);
    t.dispatch('caldari', { type: 'missionComplete', vp: 1 });
    expect(t.p('caldari').vp).toBe(1);
  });
});

describe('eventPlayed', () => {
  it('pays 2 ISK to every other Intelligence Network holder', () => {
    const t = startedGame(['amarr', 'caldari', 'gallente', 'minmatar']);
    give(t, 'amarr', DEV.intelligenceNetwork);
    give(t, 'caldari', DEV.intelligenceNetwork);
    t.dispatch('caldari', { type: 'eventPlayed' });
    expect(t.p('amarr').res.isk).toBe(6);
    expect(t.p('caldari').res.isk).toBe(4); // the player of the event gets nothing
    expect(t.p('gallente').res.isk).toBe(4);
    expect(t.p('minmatar').res.isk).toBe(4);
    expect(lines(t)).toContain('Caldari played an Event card');
    expect(lines(t)).toContain('Amarr gains 2 ISK (Intelligence Network)');
  });

  it('does nothing else when nobody holds Intelligence Network', () => {
    const t = startedGame(['amarr', 'caldari']);
    t.dispatch('amarr', { type: 'eventPlayed' });
    expect(t.p('amarr').res.isk).toBe(4);
    expect(t.p('caldari').res.isk).toBe(4);
  });

  it('respects the ISK cap', () => {
    const t = startedGame(['amarr', 'caldari']);
    give(t, 'amarr', DEV.intelligenceNetwork);
    t.p('amarr').res.isk = 48;
    t.dispatch('caldari', { type: 'eventPlayed' });
    expect(t.p('amarr').res.isk).toBe(49);
  });
});

describe('discardMinerals', () => {
  it('reduces holdings', () => {
    const t = startedGame(['amarr', 'caldari']);
    Object.assign(t.p('amarr').res, { pyrite: 5, mexallon: 2, morphite: 1 });
    t.dispatch('amarr', { type: 'discardMinerals', minerals: { pyrite: 3, morphite: 1 } });
    expect(t.p('amarr').res).toMatchObject({ pyrite: 2, mexallon: 2, tritanium: 0, morphite: 0 });
    expect(lines(t)).toContain('Amarr discarded 3 pyrite and 1 morphite');
  });

  it('rejects more than the player holds, and nothing at all', () => {
    const t = startedGame(['amarr', 'caldari']);
    t.p('amarr').res.pyrite = 2;
    expectRejected(t, 'amarr', { type: 'discardMinerals', minerals: { pyrite: 3 } }, 'insufficient');
    expectRejected(t, 'amarr', { type: 'discardMinerals', minerals: { pyrite: 1, mexallon: 1 } }, 'insufficient');
    expectRejected(t, 'amarr', { type: 'discardMinerals', minerals: {} }, 'bad_amount');
    expectRejected(t, 'amarr', { type: 'discardMinerals', minerals: { pyrite: 0 } }, 'bad_amount');
    expectRejected(t, 'amarr', { type: 'discardMinerals', minerals: { pyrite: -1 } }, 'bad_amount');
    expectRejected(t, 'amarr', { type: 'discardMinerals', minerals: { pyrite: 0.5 } }, 'bad_amount');
  });

  it('only discards minerals, never other resources', () => {
    const t = startedGame(['amarr', 'caldari']);
    expectRejected(t, 'amarr', { type: 'discardMinerals', minerals: { isk: 1 } as never }, 'bad_mineral');
    expectRejected(t, 'amarr', { type: 'discardMinerals', minerals: { planetary: 1 } as never }, 'bad_mineral');
  });
});

describe('adjust', () => {
  it('applies resource, count and central changes and logs the reason', () => {
    const t = startedGame(['amarr', 'caldari']);
    t.p('amarr').res.pyrite = 3;
    t.p('caldari').central = true;
    t.dispatch('amarr', adjust({
      res: { isk: 3, pyrite: -2, moon: 1 }, vp: 0, systems: 2, homeCitadels: 1, lockedHomeBelts: -1,
      structures: { customs: 1, refinery: 2 }, belts: { tritanium: 1 }, central: true,
    }, false, 'fixing a miscount'));
    const p = t.p('amarr');
    expect(p.res).toMatchObject({ isk: 7, pyrite: 1, moon: 1 });
    expect(p.systems).toBe(2);
    expect(p.homeCitadels).toBe(1);
    expect(p.lockedHomeBelts).toBe(1);
    expect(p.structures).toStrictEqual({ engineering: 0, citadel: 0, customs: 1, refinery: 2 });
    expect(p.belts.tritanium).toBe(1);
    expect(p.central).toBe(true);
    expect(t.p('caldari').central).toBe(false);
    const line = lines(t).find((l) => l.startsWith('Amarr adjusted'));
    expect(line).toBeDefined();
    expect(line).toContain('fixing a miscount');
  });

  it('labels corrections', () => {
    const t = startedGame(['amarr', 'caldari']);
    t.dispatch('amarr', adjust({ systems: 1 }, true, 'oops'));
    expect(lines(t).some((l) => l.startsWith('Amarr corrected') && l.includes('oops'))).toBe(true);
  });

  it('treats central true as "take it from everyone" and false as "give it up"', () => {
    const t = startedGame(['amarr', 'caldari', 'gallente']);
    t.p('gallente').central = true;
    t.dispatch('amarr', adjust({ central: null, systems: 1 }));
    expect(t.p('gallente').central).toBe(true); // null leaves central alone
    t.dispatch('amarr', adjust({ central: true }));
    expect([t.p('amarr').central, t.p('caldari').central, t.p('gallente').central]).toStrictEqual([true, false, false]);
    t.dispatch('amarr', adjust({ central: false }));
    expect(t.p('amarr').central).toBe(false);
  });

  it('rejects any change that would take a count below 0, atomically', () => {
    const t = startedGame(['amarr', 'caldari']);
    Object.assign(t.p('amarr').res, { pyrite: 0, mexallon: 0 });
    expectRejected(t, 'amarr', adjust({ res: { isk: 1, pyrite: -1 } }), 'insufficient');
    expectRejected(t, 'amarr', adjust({ res: { isk: -5 } }), 'insufficient');
    expectRejected(t, 'amarr', adjust({ systems: -1 }), 'insufficient');
    expectRejected(t, 'amarr', adjust({ homeCitadels: -1 }), 'insufficient');
    expectRejected(t, 'amarr', adjust({ lockedHomeBelts: -3 }), 'insufficient');
    expectRejected(t, 'amarr', adjust({ structures: { citadel: -1 } }), 'insufficient');
    expectRejected(t, 'amarr', adjust({ belts: { morphite: -1 } }), 'insufficient');
    expectRejected(t, 'amarr', adjust({ vp: -1 }), 'insufficient');
    expectRejected(t, 'amarr', adjust({ vp: -1 }, true), 'insufficient');
    expectRejected(t, 'amarr', adjust({ ships: { anathema: -2 } }), 'insufficient');
    expectRejected(t, 'amarr', adjust({ ships: { stiletto: -1 } }), 'insufficient');
  });

  it('rejects fractional numbers, unknown keys and a missing delta', () => {
    const t = startedGame(['amarr', 'caldari']);
    expectRejected(t, 'amarr', adjust({ vp: 0.5 }), 'bad_amount');
    expectRejected(t, 'amarr', adjust({ systems: Number.NaN }), 'bad_amount');
    expectRejected(t, 'amarr', adjust({ res: { isk: 1.5 } }), 'bad_amount');
    expectRejected(t, 'amarr', adjust({ res: { gold: 1 } as never }), 'bad_key');
    expectRejected(t, 'amarr', adjust({ res: { ['__proto__']: 1 } as never }), 'bad_key');
    expectRejected(t, 'amarr', adjust({ structures: { mine: 1 } as never }), 'bad_key');
    expectRejected(t, 'amarr', adjust({ belts: { gold: 1 } as never }), 'bad_key');
    expectRejected(t, 'amarr', { type: 'adjust', delta: null as never, correction: false, reason: 'x' }, 'bad_delta');
  });

  it('rejects an adjustment that changes nothing', () => {
    const t = startedGame(['amarr', 'caldari']);
    expectRejected(t, 'amarr', adjust({}), 'no_change');
    expectRejected(t, 'amarr', adjust({ res: { isk: 0 }, ships: { anathema: 0 } }), 'no_change');
  });

  it('adds and removes ships, dropping the entry at zero, and rejects unknown ship ids', () => {
    const t = startedGame(['amarr', 'caldari']);
    t.dispatch('amarr', adjust({ ships: { malediction: 1, anathema: -1 } }));
    expect(t.p('amarr').ships).toStrictEqual({ malediction: 2 });
    t.dispatch('amarr', adjust({ ships: { stiletto: 2 } }));
    expect(t.p('amarr').ships).toStrictEqual({ malediction: 2, stiletto: 2 });
    expectRejected(t, 'amarr', adjust({ ships: { 'no-such-ship': 1 } }), 'bad_ship');
    expectRejected(t, 'amarr', adjust({ ships: { ['__proto__']: 1 } as never }), 'bad_ship');
    expectRejected(t, 'amarr', adjust({ ships: { malediction: 1.5 } }), 'bad_amount');
  });

  it('caps ISK at 49', () => {
    const t = startedGame(['amarr', 'caldari']);
    t.p('amarr').res.isk = 45;
    t.dispatch('amarr', adjust({ res: { isk: 10 } }));
    expect(t.p('amarr').res.isk).toBe(49);
    expect(lines(t)).toContain('ISK capped at 49 (6 lost)');
  });

  it('routes positive VP through gainVP unless it is a correction', () => {
    const t = startedGame(['amarr', 'caldari', 'gallente']);
    give(t, 'gallente', DEV.lobbyist);
    t.dispatch('amarr', adjust({ vp: 2 }, false));
    expect(t.p('amarr').vp).toBe(2);
    expect(t.p('gallente').res.isk).toBe(6);
    expect(lines(t)).toContain('Gil gains 2 ISK (Lobbyist)');
  });

  it('does not trigger Lobbyist for a correction', () => {
    const t = startedGame(['amarr', 'caldari', 'gallente']);
    give(t, 'gallente', DEV.lobbyist);
    t.dispatch('amarr', adjust({ vp: 2 }, true));
    expect(t.p('amarr').vp).toBe(2);
    expect(t.p('gallente').res.isk).toBe(4);
    expect(lines(t).some((l) => l.includes('Lobbyist'))).toBe(false);
  });

  it('applies negative VP directly, with or without correction, and never triggers Lobbyist', () => {
    for (const correction of [false, true]) {
      const t = startedGame(['amarr', 'caldari']);
      give(t, 'caldari', DEV.lobbyist);
      t.p('amarr').vp = 3;
      t.dispatch('amarr', adjust({ vp: -2 }, correction));
      expect(t.p('amarr').vp).toBe(1);
      expect(t.p('caldari').res.isk).toBe(4);
    }
  });

  it('works for any seated player at any time during the actions phase', () => {
    const t = startedGame(['amarr', 'caldari']);
    t.dispatch('caldari', adjust({ res: { isk: 1 } })); // not caldari's turn
    expect(t.p('caldari').res.isk).toBe(5);
  });
});

describe('purity and shape', () => {
  function deepFreeze<T>(x: T): T {
    if (typeof x === 'object' && x !== null) {
      for (const v of Object.values(x)) deepFreeze(v);
      Object.freeze(x);
    }
    return x;
  }

  it('never mutates its inputs', () => {
    const t = startedGame(['amarr', 'caldari']);
    t.p('amarr').res.pyrite = 2;
    t.p('amarr').res.planetary = 1;
    t.p('caldari').systems = 1;
    const cmds: Command[] = [
      move, claim('caldari', true), extract(true, true),
      { type: 'discover', rewards: [{ kind: 'research', amount: 1 }, { kind: 'minerals', minerals: ['pyrite'] }] },
      { type: 'autoClaim', central: true }, { type: 'payJump', planetary: 1, moon: 0 },
      adjust({ vp: 1, ships: { stiletto: 1 } }), { type: 'missionComplete', vp: 1 }, { type: 'eventPlayed' },
      { type: 'discardMinerals', minerals: { pyrite: 1 } }, endTurn, pass, forceAdvance,
    ];
    for (const cmd of cmds) {
      const game = deepFreeze(structuredClone(t.game));
      const priv = deepFreeze(structuredClone(t.privs.amarr));
      const ctx = deepFreeze({ actor: 'amarr' as const, uid: uidOf('amarr'), priv, now: NOW });
      // Rejections are fine here: the point is that no handler writes to a frozen input.
      const r = apply(game, deepFreeze(structuredClone(cmd)), ctx);
      if (!isError(r)) expect(r.game).not.toBe(game);
    }
  });

  it('keeps all state JSON-safe (no undefined) through a whole round of turns', () => {
    const t = startedGame(['amarr', 'caldari', 'gallente']);
    give(t, 'amarr', DEV.invader);
    t.p('caldari').systems = 1;
    actAndEnd(t, 'amarr', claim('caldari', true));
    t.dispatch('caldari', move);
    t.dispatch('caldari', { type: 'discover', rewards: [{ kind: 'research', amount: 2 }, { kind: 'card' }] });
    t.privs.caldari.pendingResearch = 0;
    t.dispatch('caldari', endTurn);
    t.dispatch('gallente', pass);
    t.dispatch('amarr', adjust({ ships: { stiletto: 1, anathema: -1 } }));
    t.dispatch('amarr', pass);
    t.dispatch('caldari', pass);
    expect(t.game.phase).toBe('upkeep');
    expect(JSON.parse(JSON.stringify(t.game))).toStrictEqual(t.game);
    expect(JSON.parse(JSON.stringify(t.privs.caldari))).toStrictEqual(t.privs.caldari);
  });
});

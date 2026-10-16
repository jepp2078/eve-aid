import { describe, expect, it } from 'vitest';
import { dev, DEV, DEVELOPMENTS } from '../../src/data/developments';
import type { DevId, FactionId } from '../../src/data/types';
import { apply } from '../../src/engine/apply';
import { tiersOf } from '../../src/engine/developments';
import { isError, type ApplyResult, type Command, type CombatState, type RuleError, type TradeOp, type UseParams } from '../../src/engine/types';
import { NOW, startedGame, uidOf, type Table } from './helpers';

// Cards that no default setup holds (see DEFAULT_SETUP), so tests can bring them in without clashes.
const X = DEV.vanguardShip; // cost 6
const Y = DEV.coordinatedAttack; // cost 7
const Z = DEV.invader; // cost 5

const research = (fill: DevId[], swap: { out: DevId; in: DevId }[] = []): Command => ({ type: 'action', action: 'research', fill, swap });
const distribute = (alloc: Record<DevId, number>, fetch: { dev: DevId; replace: DevId | null }[] = []): Command => ({
  type: 'distributeResearch', alloc, fetch,
});
const addCard = (d: DevId | null): Command => ({ type: 'addCard', dev: d });
const complete = (d: DevId): Command => ({ type: 'completeDev', dev: d });
const use = (d: DevId, params: UseParams): Command => ({ type: 'useDev', dev: d, params });
const none: UseParams = { kind: 'none' };
const target = (faction: FactionId): UseParams => ({ kind: 'target', faction });
const pay = (material: 'planetary' | 'moon' | null): UseParams => ({ kind: 'payMaterial', material });
const sellMoon: TradeOp = { dir: 'sell', item: 'moon', mineral: null };

/** Amarr (to act) and Caldari; nothing completed, default setup areas (every card at 0 tokens). */
function table(...extra: FactionId[]): Table {
  return startedGame(['amarr', 'caldari', ...extra]);
}

function setArea(t: Table, f: FactionId, cards: [DevId, number][]): void {
  t.privs[f].area = cards.map(([d, tokens]) => ({ dev: d, tokens }));
  t.p(f).devAreaCount = cards.length;
}

const give = (t: Table, f: FactionId, ...devs: DevId[]): void => {
  t.p(f).completed.push(...devs);
};

const areaOf = (t: Table, f: FactionId): DevId[] => t.privs[f].area.map((c) => c.dev);
const tokensOn = (t: Table, f: FactionId, d: DevId): number | undefined => t.privs[f].area.find((c) => c.dev === d)?.tokens;
/** An open combat between `attacker` and `defender`: only the two sides matter to `useDev`. */
const openCombat = (t: Table, attacker: FactionId, defender: FactionId): void => {
  t.game.combat = { attacker, defender } as unknown as CombatState;
};
/** Puts the table where `d`'s Use is legal for Amarr: a combat for the tactics, another player's turn for Guerilla Warfare. */
function readyToUse(t: Table, d: DevId): void {
  if (d === DEV.defensiveTactic || d === DEV.offensiveTactic) openCombat(t, 'amarr', 'caldari');
  if (d === DEV.guerillaWarfare) t.game.turn = { faction: 'caldari', actionTaken: null, deployable: false };
}
const lines = (t: Table): string[] => t.last?.lines ?? [];

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

// ---------------------------------------------------------------------------------------------------------------

describe('tiersOf', () => {
  it('returns the tiers of completed Systems cards', () => {
    const t = table();
    give(t, 'amarr', DEV.offensiveSystemsT1);
    expect(tiersOf(t.p('amarr'))).toStrictEqual(new Set(['O1']));
  });

  it('is empty with no Systems cards and ignores other developments', () => {
    const t = table();
    expect(tiersOf(t.p('amarr')).size).toBe(0);
    give(t, 'amarr', DEV.mediumHull, DEV.lobbyist, DEV.starMap);
    expect(tiersOf(t.p('amarr')).size).toBe(0);
  });

  it('collects every tier held, once each', () => {
    const t = table();
    give(t, 'amarr', DEV.defensiveSystemsT1, DEV.defensiveSystemsT2, DEV.utilitySystemsT2, DEV.offensiveSystemsT1, DEV.mediumHull);
    expect(tiersOf(t.p('amarr'))).toStrictEqual(new Set(['D1', 'D2', 'U2', 'O1']));
  });

  it('only counts completed cards, not the development area', () => {
    const t = table();
    expect(tiersOf(t.p('caldari')).size).toBe(0); // Offensive Systems T1 is in Caldari's area
  });
});

// ---------------------------------------------------------------------------------------------------------------

describe('research action', () => {
  it('fills empty slots with fresh cards', () => {
    const t = table();
    setArea(t, 'amarr', [[DEV.mediumHull, 2]]);
    t.dispatch('amarr', research([X, Y]));
    expect(t.privs.amarr.area).toStrictEqual([
      { dev: DEV.mediumHull, tokens: 2 },
      { dev: X, tokens: 0 },
      { dev: Y, tokens: 0 },
    ]);
    expect(t.p('amarr').devAreaCount).toBe(3);
    expect(t.p('amarr').slots.research).toBe(1);
    expect(t.p('amarr').cubesUsed).toBe(1);
    expect(t.game.turn?.actionTaken).toBe('research');
  });

  it('swaps a card in place and discards the swapped-out card\'s tokens', () => {
    const t = table();
    setArea(t, 'amarr', [[DEV.mediumHull, 2], [DEV.assemblyLine, 1], [DEV.lobbyist, 1]]);
    t.dispatch('amarr', research([], [{ out: DEV.assemblyLine, in: X }]));
    expect(t.privs.amarr.area).toStrictEqual([
      { dev: DEV.mediumHull, tokens: 2 },
      { dev: X, tokens: 0 },
      { dev: DEV.lobbyist, tokens: 1 },
    ]);
    expect(t.p('amarr').devAreaCount).toBe(3);
  });

  it('does fills and swaps together', () => {
    const t = table();
    setArea(t, 'amarr', [[DEV.mediumHull, 2], [DEV.assemblyLine, 1]]);
    t.dispatch('amarr', research([Y], [{ out: DEV.mediumHull, in: X }]));
    expect(areaOf(t, 'amarr')).toStrictEqual([X, DEV.assemblyLine, Y]);
    expect(t.p('amarr').devAreaCount).toBe(3);
  });

  it('can fill the area up to 4 and swap in a full area', () => {
    const t = table();
    setArea(t, 'amarr', [[DEV.mediumHull, 0], [DEV.assemblyLine, 0], [DEV.lobbyist, 0]]);
    t.dispatch('amarr', research([X]));
    expect(t.p('amarr').devAreaCount).toBe(4);
    const u = table();
    u.dispatch('amarr', research([], [{ out: DEV.mediumHull, in: X }, { out: DEV.assemblyLine, in: Y }]));
    expect(areaOf(u, 'amarr')).toStrictEqual([X, DEV.technologicalBreakthrough, DEV.galacticTrustFund, Y]);
  });

  it('refuses a card that is completed or already in the area (bad_dev)', () => {
    const t = table();
    setArea(t, 'amarr', [[DEV.mediumHull, 0]]);
    give(t, 'amarr', DEV.lobbyist);
    expectRejected(t, 'amarr', research([DEV.lobbyist]), 'bad_dev');
    expectRejected(t, 'amarr', research([DEV.mediumHull]), 'bad_dev');
    expectRejected(t, 'amarr', research([], [{ out: DEV.mediumHull, in: DEV.lobbyist }]), 'bad_dev');
    expectRejected(t, 'amarr', research([X], [{ out: DEV.mediumHull, in: X }]), 'bad_dev');
  });

  it('refuses unknown ids and a card listed twice (bad_dev)', () => {
    const t = table();
    setArea(t, 'amarr', [[DEV.mediumHull, 0]]);
    expectRejected(t, 'amarr', research(['no-such-card']), 'bad_dev');
    expectRejected(t, 'amarr', research([X, X]), 'bad_dev');
    expectRejected(t, 'amarr', research(['__proto__']), 'bad_dev');
  });

  it('judges fills against the area after the swaps', () => {
    const t = table();
    setArea(t, 'amarr', [[DEV.mediumHull, 3], [DEV.assemblyLine, 0], [DEV.lobbyist, 0]]);
    t.dispatch('amarr', research([DEV.mediumHull], [{ out: DEV.mediumHull, in: X }]));
    expect(areaOf(t, 'amarr')).toStrictEqual([X, DEV.assemblyLine, DEV.lobbyist, DEV.mediumHull]);
    expect(tokensOn(t, 'amarr', DEV.mediumHull)).toBe(0);
  });

  it('refuses swapping out a card that is not in the area (not_in_area)', () => {
    const t = table();
    setArea(t, 'amarr', [[DEV.mediumHull, 0]]);
    expectRejected(t, 'amarr', research([], [{ out: DEV.lobbyist, in: X }]), 'not_in_area');
    expectRejected(t, 'amarr', research([], [{ out: DEV.mediumHull, in: X }, { out: DEV.mediumHull, in: Y }]), 'not_in_area');
  });

  it('refuses an area of more than 4 (area_full)', () => {
    const t = table();
    expectRejected(t, 'amarr', research([X]), 'area_full');
    setArea(t, 'amarr', [[DEV.mediumHull, 0], [DEV.assemblyLine, 0], [DEV.lobbyist, 0]]);
    expectRejected(t, 'amarr', research([X, Y]), 'area_full');
  });

  it('refuses a research that changes nothing (no_change)', () => {
    const t = table();
    expectRejected(t, 'amarr', research([]), 'no_change');
  });

  it('is refused outside your turn and outside the actions phase', () => {
    const t = table();
    setArea(t, 'amarr', [[DEV.mediumHull, 0]]);
    setArea(t, 'caldari', [[DEV.mediumHull, 0]]);
    expectRejected(t, 'caldari', research([X]), 'not_your_turn');
    t.game.phase = 'upkeep';
    t.game.turn = null;
    expectRejected(t, 'amarr', research([X]), 'wrong_phase');
  });

  it('shares the one-action-per-turn rule: no second action after researching', () => {
    const t = table();
    setArea(t, 'amarr', [[DEV.mediumHull, 0]]);
    t.dispatch('amarr', research([X]));
    expectRejected(t, 'amarr', research([Y]), 'already_acted');
  });

  it('logs only how many cards, never which', () => {
    const t = table();
    setArea(t, 'amarr', [[DEV.mediumHull, 0]]);
    t.dispatch('amarr', research([X, Y]));
    expect(lines(t)).toStrictEqual(['Amarr researched (2 cards)']);
    const u = table();
    setArea(u, 'amarr', [[DEV.mediumHull, 0]]);
    u.dispatch('amarr', research([X]));
    expect(lines(u)).toStrictEqual(['Amarr researched (1 card)']);
  });
});

// ---------------------------------------------------------------------------------------------------------------

describe('distributeResearch', () => {
  /** Amarr with `pending` research tokens and the given area. */
  function withPending(pending: number, cards: [DevId, number][]): Table {
    const t = table();
    setArea(t, 'amarr', cards);
    t.privs.amarr.pendingResearch = pending;
    return t;
  }

  it('lands manufactured research in the private doc, ready to distribute', () => {
    const t = table();
    t.p('amarr').res.morphite = 1;
    t.dispatch('amarr', { type: 'action', action: 'manufacture', ops: [{ output: 'research', pay: 'morphite' }] });
    expect(t.privs.amarr.pendingResearch).toBe(2);
    t.dispatch('amarr', distribute({ [DEV.mediumHull]: 2 }));
    expect(t.privs.amarr.pendingResearch).toBe(0);
    expect(tokensOn(t, 'amarr', DEV.mediumHull)).toBe(2);
  });

  it('puts tokens on area cards (adding to what is there)', () => {
    const t = withPending(4, [[DEV.mediumHull, 1], [DEV.assemblyLine, 0]]);
    t.dispatch('amarr', distribute({ [DEV.mediumHull]: 3, [DEV.assemblyLine]: 1 }));
    expect(t.privs.amarr.area).toStrictEqual([{ dev: DEV.mediumHull, tokens: 4 }, { dev: DEV.assemblyLine, tokens: 1 }]);
    expect(t.privs.amarr.pendingResearch).toBe(0);
  });

  it('fetches a card for 3 and puts the other 2 tokens on it', () => {
    const t = withPending(5, [[DEV.mediumHull, 0], [DEV.assemblyLine, 0]]);
    t.dispatch('amarr', distribute({ [X]: 2 }, [{ dev: X, replace: null }]));
    expect(t.privs.amarr.area).toStrictEqual([
      { dev: DEV.mediumHull, tokens: 0 },
      { dev: DEV.assemblyLine, tokens: 0 },
      { dev: X, tokens: 2 },
    ]);
    expect(t.privs.amarr.pendingResearch).toBe(0);
    expect(t.p('amarr').devAreaCount).toBe(3);
  });

  it('replaces a card on a fetch and discards its tokens', () => {
    const t = withPending(3, [[DEV.mediumHull, 2], [DEV.assemblyLine, 1], [DEV.lobbyist, 0], [DEV.starMap, 0]]);
    t.dispatch('amarr', distribute({}, [{ dev: X, replace: DEV.assemblyLine }]));
    expect(t.privs.amarr.area).toStrictEqual([
      { dev: DEV.mediumHull, tokens: 2 },
      { dev: X, tokens: 0 },
      { dev: DEV.lobbyist, tokens: 0 },
      { dev: DEV.starMap, tokens: 0 },
    ]);
    expect(t.p('amarr').devAreaCount).toBe(4);
  });

  it('does several fetches (3 each) before the allocation', () => {
    const t = withPending(8, [[DEV.mediumHull, 0]]);
    t.dispatch('amarr', distribute({ [X]: 1, [Y]: 1 }, [{ dev: X, replace: null }, { dev: Y, replace: DEV.mediumHull }]));
    expect(t.privs.amarr.area).toStrictEqual([{ dev: Y, tokens: 1 }, { dev: X, tokens: 1 }]);
  });

  it('discards leftover tokens: pending always goes to 0', () => {
    const t = withPending(5, [[DEV.mediumHull, 0]]);
    t.dispatch('amarr', distribute({ [DEV.mediumHull]: 1 }));
    expect(t.privs.amarr.pendingResearch).toBe(0);
    expect(tokensOn(t, 'amarr', DEV.mediumHull)).toBe(1);
    const u = withPending(2, [[DEV.mediumHull, 0]]);
    u.dispatch('amarr', distribute({}));
    expect(u.privs.amarr.pendingResearch).toBe(0);
    expect(tokensOn(u, 'amarr', DEV.mediumHull)).toBe(0);
  });

  it('refuses more tokens than pending (too_many_tokens)', () => {
    const t = withPending(4, [[DEV.mediumHull, 0]]);
    expectRejected(t, 'amarr', distribute({ [DEV.mediumHull]: 5 }), 'too_many_tokens');
    expectRejected(t, 'amarr', distribute({ [X]: 2 }, [{ dev: X, replace: null }]), 'too_many_tokens'); // 3 + 2 > 4
    expectRejected(t, 'amarr', distribute({}, [{ dev: X, replace: null }, { dev: Y, replace: null }]), 'too_many_tokens'); // 6 > 4
    t.dispatch('amarr', distribute({ [X]: 1 }, [{ dev: X, replace: null }])); // exactly 4 is fine
  });

  it('needs pending research (no_pending)', () => {
    const t = table();
    expectRejected(t, 'amarr', distribute({}), 'no_pending');
    expectRejected(t, 'amarr', distribute({ [DEV.mediumHull]: 1 }), 'no_pending');
  });

  it('refuses a fetch without replace into a full area (area_full)', () => {
    const t = withPending(3, [[DEV.mediumHull, 0], [DEV.assemblyLine, 0], [DEV.lobbyist, 0], [DEV.starMap, 0]]);
    expectRejected(t, 'amarr', distribute({}, [{ dev: X, replace: null }]), 'area_full');
  });

  it('refuses replacing a card that is not in the area (not_in_area)', () => {
    const t = withPending(3, [[DEV.mediumHull, 0]]);
    expectRejected(t, 'amarr', distribute({}, [{ dev: X, replace: DEV.lobbyist }]), 'not_in_area');
  });

  it('refuses a fetched card that is invalid, completed, in the area or fetched twice (bad_dev)', () => {
    const t = withPending(9, [[DEV.mediumHull, 0]]);
    give(t, 'amarr', DEV.lobbyist);
    expectRejected(t, 'amarr', distribute({}, [{ dev: 'no-such-card', replace: null }]), 'bad_dev');
    expectRejected(t, 'amarr', distribute({}, [{ dev: DEV.lobbyist, replace: null }]), 'bad_dev');
    expectRejected(t, 'amarr', distribute({}, [{ dev: DEV.mediumHull, replace: null }]), 'bad_dev');
    expectRejected(t, 'amarr', distribute({}, [{ dev: X, replace: null }, { dev: X, replace: null }]), 'bad_dev');
  });

  it('refuses an allocation to a card that is not in the area (bad_dev)', () => {
    const t = withPending(5, [[DEV.mediumHull, 0]]);
    expectRejected(t, 'amarr', distribute({ [X]: 1 }), 'bad_dev');
    expectRejected(t, 'amarr', distribute({ [DEV.mediumHull]: 1, [Y]: 1 }), 'bad_dev');
    // a card replaced by a fetch is gone from the area
    expectRejected(t, 'amarr', distribute({ [DEV.mediumHull]: 1 }, [{ dev: X, replace: DEV.mediumHull }]), 'bad_dev');
  });

  it('refuses negative or fractional allocations (bad_amount)', () => {
    const t = withPending(5, [[DEV.mediumHull, 0], [DEV.assemblyLine, 0]]);
    expectRejected(t, 'amarr', distribute({ [DEV.mediumHull]: -1, [DEV.assemblyLine]: 3 }), 'bad_amount');
    expectRejected(t, 'amarr', distribute({ [DEV.mediumHull]: 1.5 }), 'bad_amount');
  });

  it('works during upkeep too (upkeep research is distributed then)', () => {
    const t = withPending(2, [[DEV.mediumHull, 0]]);
    t.game.phase = 'upkeep';
    t.game.turn = null;
    t.dispatch('amarr', distribute({ [DEV.mediumHull]: 2 }));
    expect(tokensOn(t, 'amarr', DEV.mediumHull)).toBe(2);
  });

  it('must be done before the turn can end (pending_research), and unblocks it afterwards', () => {
    const t = withPending(2, [[DEV.mediumHull, 0]]);
    t.dispatch('amarr', { type: 'action', action: 'move' });
    expectRejected(t, 'amarr', { type: 'endTurn' }, 'pending_research');
    t.dispatch('amarr', distribute({ [DEV.mediumHull]: 2 }));
    t.dispatch('amarr', { type: 'endTurn' });
    expect(t.game.turn?.faction).toBe('caldari');
  });

  it('logs the token total but not the cards', () => {
    const t = withPending(5, [[DEV.mediumHull, 0]]);
    t.dispatch('amarr', distribute({ [X]: 2 }, [{ dev: X, replace: null }]));
    expect(lines(t)).toStrictEqual(['Amarr distributed 5 research tokens']);
  });
});

describe('Technological Breakthrough goes back face down (its second clause, M5)', () => {
  const TB = DEV.technologicalBreakthrough;
  const back = { dev: TB, replace: null };

  /** Amarr has completed TB and has `pending` research during an upkeep. */
  function inUpkeep(pending: number, cards: [DevId, number][] = [[DEV.mediumHull, 0]]): Table {
    const t = table();
    setArea(t, 'amarr', cards);
    give(t, 'amarr', TB);
    t.privs.amarr.pendingResearch = pending;
    t.game.phase = 'upkeep';
    t.game.turn = null;
    t.game.upkeep = { emergency: false, confirmed: ['amarr'], raids: [], largeShips: [] };
    return t;
  }

  it('during upkeep, 3 pending research turn it face down into an empty slot of the area (0 tokens)', () => {
    const t = inUpkeep(4);
    t.dispatch('amarr', distribute({ [DEV.mediumHull]: 1 }, [back]));
    expect(t.p('amarr').completed).toStrictEqual([]);
    expect(t.privs.amarr.area).toStrictEqual([{ dev: DEV.mediumHull, tokens: 1 }, { dev: TB, tokens: 0 }]);
    expect(t.p('amarr').devAreaCount).toBe(2);
    expect(t.privs.amarr.pendingResearch).toBe(0);
    expect(lines(t)).toStrictEqual([
      'Amarr turned Technological Breakthrough face down into their development area',
      'Amarr distributed 4 research tokens',
    ]);
  });

  it('can take research in the same go, and scores again when it is completed again', () => {
    const t = inUpkeep(7);
    t.dispatch('amarr', distribute({ [TB]: 4 }, [back]));
    expect(tokensOn(t, 'amarr', TB)).toBe(4);
    t.game.phase = 'actions';
    t.game.upkeep = null;
    t.game.turn = { faction: 'amarr', actionTaken: null, deployable: false };
    const vp = t.p('amarr').vp;
    t.dispatch('amarr', complete(TB));
    expect(t.p('amarr').vp).toBe(vp + 1);
    expect(t.p('amarr').completed).toStrictEqual([TB]);
  });

  it('with a full area it replaces a card like any fetch, discarding its tokens', () => {
    const full: [DevId, number][] = [[DEV.mediumHull, 2], [DEV.assemblyLine, 0], [DEV.lobbyist, 0], [DEV.starMap, 0]];
    const t = inUpkeep(3, full);
    t.dispatch('amarr', distribute({}, [{ dev: TB, replace: DEV.mediumHull }]));
    expect(t.p('amarr').completed).toStrictEqual([]);
    expect(areaOf(t, 'amarr')).toStrictEqual([TB, DEV.assemblyLine, DEV.lobbyist, DEV.starMap]);
    expect(tokensOn(t, 'amarr', TB)).toBe(0);
    expect(t.p('amarr').devAreaCount).toBe(4);
    const u = inUpkeep(3, [[DEV.mediumHull, 0]]);
    u.dispatch('amarr', distribute({}, [{ dev: TB, replace: DEV.mediumHull }])); // also with room
    expect(areaOf(u, 'amarr')).toStrictEqual([TB]);
  });

  it('only during upkeep (wrong_phase), a card to replace that is in the area (not_in_area, area_full), for 3 research (too_many_tokens)', () => {
    const t = inUpkeep(3);
    t.game.phase = 'actions';
    t.game.upkeep = null;
    t.game.turn = { faction: 'amarr', actionTaken: null, deployable: false };
    expectRejected(t, 'amarr', distribute({}, [back]), 'wrong_phase');
    const r = t.tryDispatch('amarr', distribute({}, [back]));
    expect(isError(r) && r.message).toBe('Technological Breakthrough goes back to your development area during upkeep only');

    const u = inUpkeep(3);
    expectRejected(u, 'amarr', distribute({}, [{ dev: TB, replace: DEV.assemblyLine }]), 'not_in_area');
    const full = inUpkeep(3, [[DEV.mediumHull, 0], [DEV.assemblyLine, 0], [DEV.lobbyist, 0], [DEV.starMap, 0]]);
    expectRejected(full, 'amarr', distribute({}, [back]), 'area_full');
    const poor = inUpkeep(2);
    expectRejected(poor, 'amarr', distribute({}, [back]), 'too_many_tokens');
  });

  it('other completed cards still cannot be fetched back', () => {
    const t = inUpkeep(3);
    give(t, 'amarr', DEV.lobbyist);
    expectRejected(t, 'amarr', distribute({}, [{ dev: DEV.lobbyist, replace: null }]), 'bad_dev');
  });
});

// ---------------------------------------------------------------------------------------------------------------

describe('addCard', () => {
  it('adds the chosen card to an empty slot and consumes a pending card', () => {
    const t = table();
    setArea(t, 'amarr', [[DEV.mediumHull, 2]]);
    t.privs.amarr.pendingCards = 2;
    t.dispatch('amarr', addCard(X));
    expect(t.privs.amarr.area).toStrictEqual([{ dev: DEV.mediumHull, tokens: 2 }, { dev: X, tokens: 0 }]);
    expect(t.privs.amarr.pendingCards).toBe(1);
    expect(t.p('amarr').devAreaCount).toBe(2);
    expect(lines(t)).toStrictEqual(['Amarr added a development card']);
  });

  it('skips with null: consumes the pending card, leaves the area alone', () => {
    const t = table();
    t.privs.amarr.pendingCards = 1;
    const before = structuredClone(t.privs.amarr.area);
    t.dispatch('amarr', addCard(null));
    expect(t.privs.amarr.pendingCards).toBe(0);
    expect(t.privs.amarr.area).toStrictEqual(before);
    expect(t.p('amarr').devAreaCount).toBe(4);
  });

  it('needs a pending card (no_pending_card), also to skip', () => {
    const t = table();
    setArea(t, 'amarr', []);
    expectRejected(t, 'amarr', addCard(X), 'no_pending_card');
    expectRejected(t, 'amarr', addCard(null), 'no_pending_card');
  });

  it('needs an empty slot (area_full) unless skipping', () => {
    const t = table();
    t.privs.amarr.pendingCards = 1;
    expectRejected(t, 'amarr', addCard(X), 'area_full');
    t.dispatch('amarr', addCard(null));
    expect(t.privs.amarr.pendingCards).toBe(0);
  });

  it('refuses a card that is invalid, completed or already in the area (bad_dev)', () => {
    const t = table();
    setArea(t, 'amarr', [[DEV.mediumHull, 0]]);
    t.privs.amarr.pendingCards = 1;
    give(t, 'amarr', DEV.lobbyist);
    expectRejected(t, 'amarr', addCard('no-such-card'), 'bad_dev');
    expectRejected(t, 'amarr', addCard(DEV.lobbyist), 'bad_dev');
    expectRejected(t, 'amarr', addCard(DEV.mediumHull), 'bad_dev');
  });

  it('is not tied to the turn: the card arrives after a completion, whoever holds the turn', () => {
    const t = table();
    setArea(t, 'caldari', [[DEV.mediumHull, 0]]);
    t.privs.caldari.pendingCards = 1;
    t.dispatch('caldari', addCard(X));
    expect(areaOf(t, 'caldari')).toStrictEqual([DEV.mediumHull, X]);
  });
});

// ---------------------------------------------------------------------------------------------------------------

describe('completeDev', () => {
  it('completes Medium Hull with 3 tokens: public, area slot freed, a new card is owed', () => {
    const t = table();
    setArea(t, 'amarr', [[DEV.mediumHull, 3], [DEV.assemblyLine, 1]]);
    t.dispatch('amarr', complete(DEV.mediumHull));
    expect(t.p('amarr').completed).toStrictEqual([DEV.mediumHull]);
    expect(areaOf(t, 'amarr')).toStrictEqual([DEV.assemblyLine]);
    expect(t.p('amarr').devAreaCount).toBe(1);
    expect(t.privs.amarr.pendingCards).toBe(1);
    expect(t.last?.notices).toStrictEqual([{ to: 'amarr', text: 'Choose a new development card for your development area', kind: 'info' }]);
    expect(lines(t)).toStrictEqual(['Amarr completed Medium Hull']);
    expect(t.p('amarr').tapped).toStrictEqual([]);
  });

  it('refuses Large Hull without Medium Hull (prereq_missing), allows it with', () => {
    const t = table();
    setArea(t, 'amarr', [[DEV.largeHull, 4]]);
    expectRejected(t, 'amarr', complete(DEV.largeHull), 'prereq_missing');
    give(t, 'amarr', DEV.mediumHull);
    t.dispatch('amarr', complete(DEV.largeHull));
    expect(t.p('amarr').completed).toStrictEqual([DEV.mediumHull, DEV.largeHull]);
    expect(t.privs.amarr.pendingCards).toBe(1);
  });

  it('refuses without enough tokens (not_enough_research)', () => {
    const t = table();
    setArea(t, 'amarr', [[DEV.mediumHull, 2]]);
    expectRejected(t, 'amarr', complete(DEV.mediumHull), 'not_enough_research');
  });

  it('refuses a card that is not in the area (not_in_area)', () => {
    const t = table();
    expectRejected(t, 'amarr', complete(X), 'not_in_area');
    expectRejected(t, 'amarr', complete('no-such-card'), 'not_in_area');
  });

  it('needs the actions phase and the actor\'s turn', () => {
    const t = table();
    setArea(t, 'amarr', [[DEV.mediumHull, 3]]);
    setArea(t, 'caldari', [[DEV.mediumHull, 3]]);
    expectRejected(t, 'caldari', complete(DEV.mediumHull), 'not_your_turn');
    t.game.phase = 'upkeep';
    t.game.turn = null;
    expectRejected(t, 'amarr', complete(DEV.mediumHull), 'wrong_phase');
  });

  it('costs no action: it works after the turn\'s action and leaves the cubes alone', () => {
    const t = table();
    setArea(t, 'amarr', [[DEV.mediumHull, 3]]);
    t.dispatch('amarr', { type: 'action', action: 'move' });
    t.dispatch('amarr', complete(DEV.mediumHull));
    expect(t.p('amarr').cubesUsed).toBe(1);
    expect(t.game.turn?.actionTaken).toBe('move');
  });

  it('gives 1 VP for Technological Breakthrough, and Lobbyist holders ISK', () => {
    const t = table();
    setArea(t, 'amarr', [[DEV.technologicalBreakthrough, 4]]);
    give(t, 'caldari', DEV.lobbyist);
    const isk = t.p('caldari').res.isk;
    t.dispatch('amarr', complete(DEV.technologicalBreakthrough));
    expect(t.p('amarr').vp).toBe(1);
    expect(t.p('caldari').res.isk).toBe(isk + 1);
    expect(t.privs.amarr.pendingCards).toBe(0);
    expect(lines(t)).toContain('Amarr completed Technological Breakthrough');
    expect(lines(t)).toContain('Ana gains 1 VP (1 total)');
    expect(lines(t)).toContain('Cal gains 1 ISK (Lobbyist)');
  });

  it('adds no card for a development without the card symbol', () => {
    const t = table();
    setArea(t, 'amarr', [[DEV.galacticTrustFund, 4]]);
    t.dispatch('amarr', complete(DEV.galacticTrustFund));
    expect(t.privs.amarr.pendingCards).toBe(0);
    expect(t.last?.notices).toStrictEqual([]);
  });

  it('feeds tiersOf: completing Offensive Systems T1 gives {O1}', () => {
    const t = table();
    setArea(t, 'amarr', [[DEV.offensiveSystemsT1, 2]]);
    expect(tiersOf(t.p('amarr')).size).toBe(0);
    t.dispatch('amarr', complete(DEV.offensiveSystemsT1));
    expect(tiersOf(t.p('amarr'))).toStrictEqual(new Set(['O1']));
    expect(t.privs.amarr.pendingCards).toBe(1);
  });

  it('keeps pending cards stacking when several cards complete', () => {
    const t = table();
    setArea(t, 'amarr', [[DEV.mediumHull, 3], [DEV.offensiveSystemsT1, 2]]);
    t.dispatch('amarr', complete(DEV.mediumHull));
    t.dispatch('amarr', complete(DEV.offensiveSystemsT1));
    expect(t.privs.amarr.pendingCards).toBe(2);
    expect(tiersOf(t.p('amarr'))).toStrictEqual(new Set(['O1']));
  });
});

// ---------------------------------------------------------------------------------------------------------------

describe('useDev', () => {
  it('refuses a development that is not completed (not_completed), even one in the area or unknown', () => {
    const t = table();
    expectRejected(t, 'amarr', use(DEV.galacticTrustFund, none), 'not_completed'); // in the area, not completed
    expectRejected(t, 'amarr', use('no-such-card', none), 'not_completed');
  });

  it('refuses a card without a use keyword (not_usable)', () => {
    const t = table();
    give(t, 'amarr', DEV.lobbyist);
    expectRejected(t, 'amarr', use(DEV.lobbyist, none), 'not_usable');
  });

  it('refuses a tapped development (tapped), once per round', () => {
    const t = table();
    give(t, 'amarr', DEV.galacticTrustFund);
    t.dispatch('amarr', use(DEV.galacticTrustFund, none));
    expect(t.p('amarr').tapped).toStrictEqual([DEV.galacticTrustFund]);
    expectRejected(t, 'amarr', use(DEV.galacticTrustFund, none), 'tapped');
  });

  it('works in the action phase only (Pacifist aside: see its own tests), never in the lobby or when ended', () => {
    const t = table();
    give(t, 'amarr', DEV.galacticTrustFund);
    t.dispatch('amarr', use(DEV.galacticTrustFund, none));
    const u = table();
    give(u, 'amarr', DEV.galacticTrustFund);
    u.game.phase = 'upkeep';
    u.game.turn = null;
    expectRejected(u, 'amarr', use(DEV.galacticTrustFund, none), 'wrong_phase');
    const v = table();
    give(v, 'amarr', DEV.galacticTrustFund);
    v.game.phase = 'lobby';
    expectRejected(v, 'amarr', use(DEV.galacticTrustFund, none), 'wrong_phase');
    v.game.phase = 'ended';
    expectRejected(v, 'amarr', use(DEV.galacticTrustFund, none), 'wrong_phase');
  });

  describe('timing (manual p.21: your turn or in combat, unless the card names another trigger)', () => {
    const PLAIN = [
      DEV.galacticTrustFund, DEV.underdog, DEV.mineralMarket, DEV.tradeContracts, DEV.manufacturingHub, DEV.asteroidMining,
      DEV.extractingCrew, DEV.dirtyPolitics, DEV.researchSpy, DEV.strategicReposition, DEV.starMap, DEV.sequentialJump,
    ];

    it.each(PLAIN)('%s is refused on another player\'s turn (not_now), and allowed there inside a combat you fight in', (d) => {
      const t = table();
      give(t, 'caldari', d);
      const r = t.tryDispatch('caldari', use(d, { kind: 'bogus' } as unknown as UseParams)); // Amarr's turn
      expect(codeOf(r)).toBe('not_now');
      expect(isError(r) && r.message).toBe(`${dev(d).name} is used on your own turn or in combat (it is Amarr's turn)`);
      openCombat(t, 'amarr', 'caldari');
      expect(codeOf(t.tryDispatch('caldari', use(d, { kind: 'bogus' } as unknown as UseParams)))).toBe('bad_params'); // timing passed
    });

    it('a combat between two other players does not open the Use up', () => {
      const t = table('minmatar');
      give(t, 'minmatar', DEV.galacticTrustFund);
      openCombat(t, 'amarr', 'caldari');
      expectRejected(t, 'minmatar', use(DEV.galacticTrustFund, none), 'not_now');
    });

    it('works on your own turn without a combat, and in your combat on the other side\'s turn', () => {
      const t = table();
      give(t, 'amarr', DEV.galacticTrustFund);
      t.dispatch('amarr', use(DEV.galacticTrustFund, none));
      const u = table();
      give(u, 'caldari', DEV.galacticTrustFund);
      openCombat(u, 'amarr', 'caldari');
      u.dispatch('caldari', use(DEV.galacticTrustFund, none));
    });

    it('Defensive and Offensive Tactic are used in a combat you fight in, even on your own turn without one (not_now)', () => {
      for (const d of [DEV.defensiveTactic, DEV.offensiveTactic]) {
        const t = table();
        give(t, 'amarr', d);
        expectRejected(t, 'amarr', use(d, pay(null)), 'not_now'); // own turn, no combat
        const r = t.tryDispatch('amarr', use(d, pay(null)));
        expect(isError(r) && r.message).toBe(`${dev(d).name} is used in combat, in a combat you are fighting`);
        openCombat(t, 'caldari', 'minmatar'); // a combat you are not in
        expectRejected(t, 'amarr', use(d, pay(null)), 'not_now');
        openCombat(t, 'caldari', 'amarr'); // as defender, on someone else's turn
        t.dispatch('amarr', use(d, pay(null)));
        expect(t.p('amarr').tapped).toStrictEqual([d]);
      }
    });

    it('Guerilla Warfare is used on another player\'s turn (their claim), not on yours (not_now)', () => {
      const t = table();
      give(t, 'amarr', DEV.guerillaWarfare);
      t.p('amarr').res.planetary = 1;
      expectRejected(t, 'amarr', use(DEV.guerillaWarfare, pay('planetary')), 'not_now'); // Amarr's own turn
      t.game.turn = { faction: 'caldari', actionTaken: null, deployable: false };
      t.dispatch('amarr', use(DEV.guerillaWarfare, pay('planetary')));
      expect(t.p('amarr').tapped).toStrictEqual([DEV.guerillaWarfare]);
    });

    it('Pacifist works on anyone\'s turn in the action or upkeep phase once someone retreated', () => {
      const t = table();
      give(t, 'caldari', DEV.pacifist);
      t.game.retreatsThisRound = ['amarr'];
      t.dispatch('caldari', use(DEV.pacifist, none)); // Amarr's turn
      const u = table();
      give(u, 'caldari', DEV.pacifist);
      u.game.retreatsThisRound = ['amarr'];
      u.game.phase = 'upkeep';
      u.game.turn = null;
      u.dispatch('caldari', use(DEV.pacifist, none));
    });
  });

  it('costs no action cube', () => {
    const t = table();
    give(t, 'amarr', DEV.galacticTrustFund);
    t.dispatch('amarr', use(DEV.galacticTrustFund, none));
    expect(t.p('amarr').cubesUsed).toBe(0);
    expect(t.game.turn?.actionTaken).toBeNull();
  });

  it('refuses params that do not fit the development (bad_params), leaving it untapped', () => {
    const t = table();
    give(t, 'amarr', DEV.galacticTrustFund, DEV.mineralMarket, DEV.defensiveTactic, DEV.dirtyPolitics);
    expectRejected(t, 'amarr', use(DEV.galacticTrustFund, pay(null)), 'bad_params');
    expectRejected(t, 'amarr', use(DEV.mineralMarket, none), 'bad_params');
    openCombat(t, 'amarr', 'caldari');
    expectRejected(t, 'amarr', use(DEV.defensiveTactic, none), 'bad_params');
    expectRejected(t, 'amarr', use(DEV.dirtyPolitics, pay(null)), 'bad_params');
    expectRejected(t, 'amarr', { type: 'useDev', dev: DEV.galacticTrustFund, params: undefined as unknown as UseParams }, 'bad_params');
    expectRejected(t, 'amarr', { type: 'useDev', dev: DEV.galacticTrustFund, params: null as unknown as UseParams }, 'bad_params');
  });

  describe('Galactic Trust Fund', () => {
    it('gives 2 ISK and taps', () => {
      const t = table();
      give(t, 'amarr', DEV.galacticTrustFund);
      t.dispatch('amarr', use(DEV.galacticTrustFund, none));
      expect(t.p('amarr').res.isk).toBe(6);
      expect(lines(t)).toStrictEqual(['Amarr used Galactic Trust Fund: +2 ISK']);
    });

    it('loses ISK above the cap with a line', () => {
      const t = table();
      give(t, 'amarr', DEV.galacticTrustFund);
      t.p('amarr').res.isk = 48;
      t.dispatch('amarr', use(DEV.galacticTrustFund, none));
      expect(t.p('amarr').res.isk).toBe(49);
      expect(lines(t)).toContain('ISK capped at 49 (1 lost)');
    });
  });

  describe('Underdog', () => {
    it('gives 1 VP with strictly fewer VP than every other player', () => {
      const t = table('gallente');
      give(t, 'amarr', DEV.underdog);
      t.p('amarr').vp = 1;
      t.p('caldari').vp = 2;
      t.p('gallente').vp = 5;
      t.dispatch('amarr', use(DEV.underdog, none));
      expect(t.p('amarr').vp).toBe(2);
      expect(t.p('amarr').tapped).toStrictEqual([DEV.underdog]);
    });

    it('is refused when tied for lowest (not_underdog) and does not tap', () => {
      const t = table();
      give(t, 'amarr', DEV.underdog);
      t.p('amarr').vp = 2;
      t.p('caldari').vp = 2;
      expectRejected(t, 'amarr', use(DEV.underdog, none), 'not_underdog');
      expect(t.p('amarr').tapped).toStrictEqual([]);
    });

    it('is refused when ahead of one player but not another', () => {
      const t = table('gallente');
      give(t, 'amarr', DEV.underdog);
      t.p('amarr').vp = 1;
      t.p('caldari').vp = 3;
      t.p('gallente').vp = 0;
      expectRejected(t, 'amarr', use(DEV.underdog, none), 'not_underdog');
    });

    it('is refused when alone at the table', () => {
      const t = table();
      t.game.seats = ['amarr'];
      delete t.game.players.caldari;
      give(t, 'amarr', DEV.underdog);
      expectRejected(t, 'amarr', use(DEV.underdog, none), 'not_underdog');
    });

    it('pays Lobbyist holders for the VP', () => {
      const t = table();
      give(t, 'amarr', DEV.underdog);
      give(t, 'caldari', DEV.lobbyist);
      t.p('caldari').vp = 4;
      t.dispatch('amarr', use(DEV.underdog, none));
      expect(t.p('caldari').res.isk).toBe(5);
    });
  });

  describe('Mineral Market', () => {
    const swap = (from: 'pyrite' | 'mexallon' | 'tritanium', to: 'pyrite' | 'mexallon' | 'tritanium'): UseParams => ({
      kind: 'mineralMarket', from, to,
    });

    it('changes one basic mineral into another', () => {
      const t = table();
      give(t, 'amarr', DEV.mineralMarket);
      t.p('amarr').res.pyrite = 2;
      t.p('amarr').res.mexallon = 0;
      t.dispatch('amarr', use(DEV.mineralMarket, swap('pyrite', 'mexallon')));
      expect(t.p('amarr').res).toMatchObject({ pyrite: 1, mexallon: 1 });
      expect(lines(t)).toStrictEqual(['Amarr used Mineral Market: 1 pyrite to mexallon']);
    });

    it('works at the 12-mineral cap, since the total does not change', () => {
      const t = table();
      give(t, 'amarr', DEV.mineralMarket);
      Object.assign(t.p('amarr').res, { pyrite: 12, mexallon: 0, tritanium: 0, morphite: 0 });
      t.dispatch('amarr', use(DEV.mineralMarket, swap('pyrite', 'tritanium')));
      expect(t.p('amarr').res).toMatchObject({ pyrite: 11, tritanium: 1 });
    });

    it('refuses the same mineral, a mineral you lack, morphite and junk', () => {
      const t = table();
      give(t, 'amarr', DEV.mineralMarket);
      t.p('amarr').res.pyrite = 1;
      t.p('amarr').res.mexallon = 0;
      expectRejected(t, 'amarr', use(DEV.mineralMarket, swap('pyrite', 'pyrite')), 'bad_params');
      expectRejected(t, 'amarr', use(DEV.mineralMarket, swap('mexallon', 'pyrite')), 'insufficient');
      expectRejected(t, 'amarr', use(DEV.mineralMarket, { kind: 'mineralMarket', from: 'morphite', to: 'pyrite' } as unknown as UseParams), 'bad_params');
      expectRejected(t, 'amarr', use(DEV.mineralMarket, { kind: 'mineralMarket', from: 'pyrite', to: 'isk' } as unknown as UseParams), 'bad_params');
    });
  });

  describe('Trade Contracts and Manufacturing Hub', () => {
    it('Trade Contracts performs one trade operation', () => {
      const t = table();
      give(t, 'amarr', DEV.tradeContracts);
      t.p('amarr').res.moon = 1;
      t.dispatch('amarr', use(DEV.tradeContracts, { kind: 'trade', op: sellMoon }));
      expect(t.p('amarr').res).toMatchObject({ moon: 0, isk: 8 });
      expect(t.p('amarr').tapped).toStrictEqual([DEV.tradeContracts]);
      expect(t.p('amarr').slots.trade).toBe(0);
    });

    it('Trade Contracts refuses a bad or unaffordable operation, leaving it untapped', () => {
      const t = table();
      give(t, 'amarr', DEV.tradeContracts);
      t.p('amarr').res.moon = 0;
      expectRejected(t, 'amarr', use(DEV.tradeContracts, { kind: 'trade', op: sellMoon }), 'insufficient');
      expectRejected(t, 'amarr', use(DEV.tradeContracts, { kind: 'trade', op: { dir: 'buy', item: 'triple', mineral: null } }), 'bad_op');
      expectRejected(t, 'amarr', use(DEV.tradeContracts, { kind: 'manufacture', op: { output: 'component', pay: 'basic' } }), 'bad_params');
    });

    it('Manufacturing Hub performs one manufacturing operation', () => {
      const t = table();
      give(t, 'amarr', DEV.manufacturingHub);
      Object.assign(t.p('amarr').res, { pyrite: 1, mexallon: 2, tritanium: 1, morphite: 0 });
      t.dispatch('amarr', use(DEV.manufacturingHub, { kind: 'manufacture', op: { output: 'component', pay: 'basic' } }));
      expect(t.p('amarr').res).toMatchObject({ component: 1, pyrite: 1, mexallon: 0, tritanium: 1 });
      expect(t.p('amarr').tapped).toStrictEqual([DEV.manufacturingHub]);
      expect(t.p('amarr').slots.manufacture).toBe(0);
    });

    it('Manufacturing Hub research lands in the private doc', () => {
      const t = table();
      give(t, 'amarr', DEV.manufacturingHub);
      t.p('amarr').res.morphite = 1;
      t.dispatch('amarr', use(DEV.manufacturingHub, { kind: 'manufacture', op: { output: 'research', pay: 'morphite' } }));
      expect(t.privs.amarr.pendingResearch).toBe(2);
    });

    it('Manufacturing Hub refuses an unaffordable operation (insufficient)', () => {
      const t = table();
      give(t, 'amarr', DEV.manufacturingHub);
      Object.assign(t.p('amarr').res, { pyrite: 0, mexallon: 0, tritanium: 0, morphite: 0 });
      expectRejected(t, 'amarr', use(DEV.manufacturingHub, { kind: 'manufacture', op: { output: 'component', pay: 'basic' } }), 'insufficient');
    });
  });

  describe('Asteroid Mining', () => {
    const mine = (mineral: 'pyrite' | 'mexallon' | 'tritanium' | 'morphite'): UseParams => ({ kind: 'mineral', mineral });

    it('gains 1 mineral of a colour with a belt', () => {
      const t = table();
      give(t, 'amarr', DEV.asteroidMining);
      const pyrite = t.p('amarr').res.pyrite;
      expect(t.p('amarr').belts.pyrite).toBe(1);
      t.dispatch('amarr', use(DEV.asteroidMining, mine('pyrite')));
      expect(t.p('amarr').res.pyrite).toBe(pyrite + 1);
      expect(lines(t)).toStrictEqual(['Amarr used Asteroid Mining: 1 pyrite']);
    });

    it('works for a morphite belt', () => {
      const t = table();
      give(t, 'amarr', DEV.asteroidMining);
      t.p('amarr').belts.morphite = 1;
      t.dispatch('amarr', use(DEV.asteroidMining, mine('morphite')));
      expect(t.p('amarr').res.morphite).toBe(1);
    });

    it('refuses a colour without a belt (no_belt)', () => {
      const t = table();
      give(t, 'amarr', DEV.asteroidMining);
      expectRejected(t, 'amarr', use(DEV.asteroidMining, mine('mexallon')), 'no_belt');
      expectRejected(t, 'amarr', use(DEV.asteroidMining, mine('morphite')), 'no_belt');
    });

    it('gains past 12 minerals too (manual p.10): the blocking overlay then has the player discard down to 12', () => {
      const t = table();
      give(t, 'amarr', DEV.asteroidMining);
      Object.assign(t.p('amarr').res, { pyrite: 6, mexallon: 4, tritanium: 1, morphite: 1 });
      t.dispatch('amarr', use(DEV.asteroidMining, mine('pyrite')));
      expect(t.p('amarr').res.pyrite).toBe(7);
      expect(t.p('amarr').tapped).toStrictEqual([DEV.asteroidMining]);
      t.dispatch('amarr', { type: 'discardMinerals', minerals: { pyrite: 1 } });
      expect(t.p('amarr').res.pyrite).toBe(6);
    });

    it('refuses a made-up mineral (bad_params)', () => {
      const t = table();
      give(t, 'amarr', DEV.asteroidMining);
      expectRejected(t, 'amarr', use(DEV.asteroidMining, { kind: 'mineral', mineral: 'isk' } as unknown as UseParams), 'bad_params');
    });
  });

  describe('Extracting Crew', () => {
    it('gains 1 of the chosen material', () => {
      const t = table();
      give(t, 'amarr', DEV.extractingCrew);
      t.dispatch('amarr', use(DEV.extractingCrew, { kind: 'material', material: 'moon' }));
      expect(t.p('amarr').res.moon).toBe(1);
      expect(lines(t)).toStrictEqual(['Amarr used Extracting Crew: 1 moon']);
      const u = table();
      give(u, 'amarr', DEV.extractingCrew);
      u.dispatch('amarr', use(DEV.extractingCrew, { kind: 'material', material: 'planetary' }));
      expect(u.p('amarr').res.planetary).toBe(1);
    });

    it('refuses anything but planetary or moon (bad_params)', () => {
      const t = table();
      give(t, 'amarr', DEV.extractingCrew);
      expectRejected(t, 'amarr', use(DEV.extractingCrew, { kind: 'material', material: 'pyrite' } as unknown as UseParams), 'bad_params');
      expectRejected(t, 'amarr', use(DEV.extractingCrew, { kind: 'material', material: null } as unknown as UseParams), 'bad_params');
    });
  });

  describe('Dirty Politics', () => {
    it('pays 5 ISK to the target and steals 1 VP', () => {
      const t = table();
      give(t, 'amarr', DEV.dirtyPolitics);
      t.p('amarr').res.isk = 10;
      t.p('caldari').vp = 2;
      t.dispatch('amarr', use(DEV.dirtyPolitics, target('caldari')));
      expect(t.p('amarr').res.isk).toBe(5);
      expect(t.p('caldari').res.isk).toBe(9);
      expect(t.p('caldari').vp).toBe(1);
      expect(t.p('amarr').vp).toBe(1);
      expect(lines(t)).toContain('Amarr used Dirty Politics: paid Caldari 5 ISK');
      expect(lines(t)).toContain('Ana steals 1 VP from Cal');
      expect(t.last?.notices).toStrictEqual([{ to: 'caldari', text: 'Amarr stole 1 VP from you', kind: 'todo' }]);
    });

    it('caps the target\'s ISK at 49', () => {
      const t = table();
      give(t, 'amarr', DEV.dirtyPolitics);
      t.p('amarr').res.isk = 10;
      t.p('caldari').res.isk = 47;
      t.p('caldari').vp = 1;
      t.dispatch('amarr', use(DEV.dirtyPolitics, target('caldari')));
      expect(t.p('caldari').res.isk).toBe(49);
      expect(lines(t)).toContain('ISK capped at 49 (3 lost)');
    });

    it('pays Lobbyist holders other than the thief for the stolen VP', () => {
      const t = table('gallente');
      give(t, 'amarr', DEV.dirtyPolitics);
      give(t, 'gallente', DEV.lobbyist);
      t.p('amarr').res.isk = 10;
      t.p('caldari').vp = 1;
      const isk = t.p('gallente').res.isk;
      t.dispatch('amarr', use(DEV.dirtyPolitics, target('caldari')));
      expect(t.p('gallente').res.isk).toBe(isk + 1);
    });

    it('refuses with under 5 ISK (insufficient), a target with no VP (no_vp), yourself or a stranger (bad_target)', () => {
      const t = table();
      give(t, 'amarr', DEV.dirtyPolitics);
      t.p('caldari').vp = 2;
      t.p('amarr').res.isk = 4;
      expectRejected(t, 'amarr', use(DEV.dirtyPolitics, target('caldari')), 'insufficient');
      t.p('amarr').res.isk = 10;
      t.p('caldari').vp = 0;
      expectRejected(t, 'amarr', use(DEV.dirtyPolitics, target('caldari')), 'no_vp');
      t.p('amarr').vp = 3;
      expectRejected(t, 'amarr', use(DEV.dirtyPolitics, target('amarr')), 'bad_target');
      expectRejected(t, 'amarr', use(DEV.dirtyPolitics, target('gallente')), 'bad_target');
      expectRejected(t, 'amarr', use(DEV.dirtyPolitics, target('__proto__' as FactionId)), 'bad_target');
    });
  });

  describe('Pacifist', () => {
    it('gives 1 VP after another player retreated from a combat this round', () => {
      const t = table();
      give(t, 'amarr', DEV.pacifist);
      t.game.retreatsThisRound = ['caldari'];
      t.dispatch('amarr', use(DEV.pacifist, none));
      expect(t.p('amarr').vp).toBe(1);
      expect(t.p('amarr').tapped).toStrictEqual([DEV.pacifist]);
    });

    it('is refused without another player\'s retreat this round, the user\'s own retreat not counting (M3)', () => {
      const t = table();
      give(t, 'amarr', DEV.pacifist);
      expectRejected(t, 'amarr', use(DEV.pacifist, none), 'no_retreat');
      const r = t.tryDispatch('amarr', use(DEV.pacifist, none));
      expect(isError(r) && r.message).toBe('Pacifist needs another player to have retreated from a combat this round');
      t.game.retreatsThisRound = ['amarr'];
      expectRejected(t, 'amarr', use(DEV.pacifist, none), 'no_retreat');
    });
  });

  describe('Research Spy', () => {
    /** Amarr holds Research Spy with an area of just Invader; Caldari has completed Medium Hull. */
    function spyTable(): Table {
      const t = table('gallente');
      setArea(t, 'amarr', [[Z, 1]]);
      give(t, 'amarr', DEV.researchSpy);
      give(t, 'caldari', DEV.mediumHull);
      return t;
    }
    const spy = (d: DevId): Command => use(DEV.researchSpy, { kind: 'dev', dev: d });

    it('completes a development another player completed, and discards itself', () => {
      const t = spyTable();
      t.dispatch('amarr', spy(DEV.mediumHull));
      expect(t.p('amarr').completed).toStrictEqual([DEV.mediumHull]);
      expect(t.p('amarr').tapped).toStrictEqual([]);
      expect(t.p('caldari').completed).toStrictEqual([DEV.mediumHull]);
      expect(areaOf(t, 'amarr')).toStrictEqual([Z]);
      expect(t.p('amarr').devAreaCount).toBe(1);
      // Medium Hull adds a development card
      expect(t.privs.amarr.pendingCards).toBe(1);
      expect(t.last?.notices).toStrictEqual([{ to: 'amarr', text: 'Choose a new development card for your development area', kind: 'info' }]);
      expect(lines(t)).toStrictEqual(['Amarr used Research Spy: completed Medium Hull (Research Spy discarded)']);
    });

    it('works with a card a third player completed, keeping the other completed cards', () => {
      const t = spyTable();
      give(t, 'amarr', DEV.pacifist);
      give(t, 'gallente', DEV.galacticTrustFund);
      t.dispatch('amarr', spy(DEV.galacticTrustFund));
      expect(t.p('amarr').completed).toStrictEqual([DEV.pacifist, DEV.galacticTrustFund]);
      expect(t.privs.amarr.pendingCards).toBe(0);
    });

    it('triggers Technological Breakthrough\'s VP (and Lobbyist ISK for others)', () => {
      const t = spyTable();
      give(t, 'caldari', DEV.technologicalBreakthrough, DEV.lobbyist);
      const isk = t.p('caldari').res.isk;
      t.dispatch('amarr', spy(DEV.technologicalBreakthrough));
      expect(t.p('amarr').vp).toBe(1);
      expect(t.p('caldari').res.isk).toBe(isk + 1);
      expect(t.p('amarr').completed).toContain(DEV.technologicalBreakthrough);
    });

    it('still needs the prerequisite (prereq_missing)', () => {
      const t = spyTable();
      give(t, 'caldari', DEV.largeHull);
      expectRejected(t, 'amarr', spy(DEV.largeHull), 'prereq_missing');
      give(t, 'amarr', DEV.mediumHull);
      t.dispatch('amarr', spy(DEV.largeHull));
      expect(t.p('amarr').completed).toStrictEqual([DEV.mediumHull, DEV.largeHull]);
    });

    it('refuses a card nobody else completed, that you completed, or that is in your area (bad_dev)', () => {
      const t = spyTable();
      expectRejected(t, 'amarr', spy(DEV.lobbyist), 'bad_dev'); // nobody has it
      expectRejected(t, 'amarr', spy('no-such-card'), 'bad_dev');
      give(t, 'amarr', DEV.galacticTrustFund); // only the actor has it
      expectRejected(t, 'amarr', spy(DEV.galacticTrustFund), 'bad_dev');
      give(t, 'amarr', DEV.mediumHull); // both have it
      expectRejected(t, 'amarr', spy(DEV.mediumHull), 'bad_dev');
      const u = spyTable();
      setArea(u, 'amarr', [[DEV.mediumHull, 1]]); // in the actor's area
      expectRejected(u, 'amarr', spy(DEV.mediumHull), 'bad_dev');
      expectRejected(u, 'amarr', spy(DEV.researchSpy), 'bad_dev');
    });

    it('is not a use of the spy by a player who tapped it', () => {
      const t = spyTable();
      t.p('amarr').tapped.push(DEV.researchSpy);
      expectRejected(t, 'amarr', spy(DEV.mediumHull), 'tapped');
    });
  });

  describe.each([DEV.defensiveTactic, DEV.offensiveTactic, DEV.strategicReposition])('%s', (d) => {
    it('taps without payment', () => {
      const t = table();
      readyToUse(t, d);
      give(t, 'amarr', d);
      t.p('amarr').res.planetary = 1;
      t.dispatch('amarr', use(d, pay(null)));
      expect(t.p('amarr').tapped).toStrictEqual([d]);
      expect(t.p('amarr').res.planetary).toBe(1);
      expect(lines(t)).toStrictEqual([`Amarr used ${dev(d).name}`]);
    });

    it('spends 1 of the chosen material', () => {
      const t = table();
      readyToUse(t, d);
      give(t, 'amarr', d);
      Object.assign(t.p('amarr').res, { planetary: 1, moon: 2 });
      t.dispatch('amarr', use(d, pay('moon')));
      expect(t.p('amarr').res).toMatchObject({ planetary: 1, moon: 1 });
      expect(lines(t)).toStrictEqual([`Amarr used ${dev(d).name}: paid 1 moon`]);
    });

    it('refuses a payment you cannot make (insufficient), leaving it untapped', () => {
      const t = table();
      readyToUse(t, d);
      give(t, 'amarr', d);
      t.p('amarr').res.planetary = 0;
      expectRejected(t, 'amarr', use(d, pay('planetary')), 'insufficient');
    });

    it('refuses a junk material (bad_params)', () => {
      const t = table();
      readyToUse(t, d);
      give(t, 'amarr', d);
      expectRejected(t, 'amarr', use(d, { kind: 'payMaterial', material: 'pyrite' } as unknown as UseParams), 'bad_params');
      expectRejected(t, 'amarr', use(d, { kind: 'payMaterial' } as unknown as UseParams), 'bad_params');
    });
  });

  describe('Guerilla Warfare', () => {
    const d = DEV.guerillaWarfare;

    it('spends 1 of the chosen material', () => {
      const t = table();
      readyToUse(t, d);
      give(t, 'amarr', d);
      Object.assign(t.p('amarr').res, { planetary: 1, moon: 2 });
      t.dispatch('amarr', use(d, pay('moon')));
      expect(t.p('amarr').res).toMatchObject({ planetary: 1, moon: 1 });
      expect(t.p('amarr').tapped).toStrictEqual([d]);
      expect(lines(t)).toStrictEqual(['Amarr used Guerilla Warfare: paid 1 moon']);
    });

    it('needs the payment: no material is refused (bad_params), leaving it untapped', () => {
      const t = table();
      readyToUse(t, d);
      give(t, 'amarr', d);
      t.p('amarr').res.planetary = 1;
      expectRejected(t, 'amarr', use(d, pay(null)), 'bad_params');
      const r = t.tryDispatch('amarr', use(d, pay(null)));
      expect(isError(r) && r.message).toBe('Pay 1 planetary or moon material');
    });

    it('refuses a payment you cannot make (insufficient) and a junk material (bad_params)', () => {
      const t = table();
      readyToUse(t, d);
      give(t, 'amarr', d);
      t.p('amarr').res.planetary = 0;
      expectRejected(t, 'amarr', use(d, pay('planetary')), 'insufficient');
      expectRejected(t, 'amarr', use(d, { kind: 'payMaterial', material: 'pyrite' } as unknown as UseParams), 'bad_params');
      expectRejected(t, 'amarr', use(d, { kind: 'payMaterial' } as unknown as UseParams), 'bad_params');
    });
  });

  describe.each([
    [DEV.starMap, 'Star Map'],
    [DEV.sequentialJump, 'Sequential Jump'],
  ])('%s', (d, name) => {
    it('taps and reminds the actor privately', () => {
      const t = table();
      give(t, 'amarr', d);
      t.dispatch('amarr', use(d, none));
      expect(t.p('amarr').tapped).toStrictEqual([d]);
      expect(lines(t)).toStrictEqual([`Amarr used ${name}`]);
      expect(t.last?.notices).toHaveLength(1);
      expect(t.last?.notices[0]?.to).toBe('amarr');
      expect(t.last?.notices[0]?.text).toContain(name);
      expect(t.last?.notices[0]?.kind).toBe('todo');
    });
  });

  it('every development with a use keyword is usable, and none without one is', () => {
    for (const d of DEVELOPMENTS) {
      const t = table();
      readyToUse(t, d.id);
      give(t, 'amarr', d.id);
      const r = t.tryDispatch('amarr', use(d.id, { kind: 'bogus' } as unknown as UseParams));
      // keyword cards reach the params check (so they have a use); the others are refused earlier
      expect(codeOf(r), d.name).toBe(d.keyword === null ? 'not_usable' : 'bad_params');
    }
    expect(DEVELOPMENTS.filter((d) => d.keyword !== null)).toHaveLength(16);
  });
});

// ---------------------------------------------------------------------------------------------------------------

describe('secrecy', () => {
  /** Nothing about `secret` cards may be visible in public state, public log lines or notices to everyone. */
  function expectNoLeak(t: Table, r: ApplyResult, secret: DevId[]): void {
    const pub = [JSON.stringify(t.game), ...r.lines, JSON.stringify(r.notices.filter((n) => n.to === 'all'))].join('\n');
    for (const d of secret) {
      expect(pub, d).not.toContain(d);
      expect(pub, dev(d).name).not.toContain(dev(d).name);
    }
  }

  const SETUP_CARDS = [DEV.mediumHull, DEV.technologicalBreakthrough, DEV.galacticTrustFund, DEV.assemblyLine];

  it('the research action never shows the private cards', () => {
    const t = table();
    const r = t.dispatch('amarr', research([], [{ out: DEV.assemblyLine, in: X }]));
    expectNoLeak(t, r, [...SETUP_CARDS, X]);
    const u = table();
    setArea(u, 'amarr', [[DEV.mediumHull, 1]]);
    expectNoLeak(u, u.dispatch('amarr', research([X, Y])), [DEV.mediumHull, X, Y]);
  });

  it('distributing research never shows the private cards', () => {
    const t = table();
    t.privs.amarr.pendingResearch = 6;
    const r = t.dispatch('amarr', distribute({ [X]: 3, [DEV.mediumHull]: 0 }, [{ dev: X, replace: DEV.assemblyLine }]));
    expectNoLeak(t, r, [...SETUP_CARDS, X]);
  });

  it('adding a card never shows the private cards', () => {
    const t = table();
    setArea(t, 'amarr', [[DEV.mediumHull, 0]]);
    t.privs.amarr.pendingCards = 2;
    expectNoLeak(t, t.dispatch('amarr', addCard(X)), [DEV.mediumHull, X]);
    expectNoLeak(t, t.dispatch('amarr', addCard(null)), [DEV.mediumHull, X]);
  });

  it('completing reveals only the completed card, not the rest of the area', () => {
    const t = table();
    const r = t.dispatch('amarr', research([], [{ out: DEV.assemblyLine, in: X }]));
    expectNoLeak(t, r, [X]);
    t.privs.amarr.area.find((c) => c.dev === DEV.mediumHull)!.tokens = 3;
    const done = t.dispatch('amarr', complete(DEV.mediumHull));
    expect(JSON.stringify(t.game)).toContain(DEV.mediumHull);
    expect(done.lines.join('\n')).toContain('Medium Hull');
    expectNoLeak(t, done, [DEV.technologicalBreakthrough, DEV.galacticTrustFund, DEV.assemblyLine, X]);
  });

  it('manufacturing research and using a development on it stay out of public view', () => {
    const t = table();
    give(t, 'amarr', DEV.manufacturingHub);
    t.p('amarr').res.morphite = 1;
    const r = t.dispatch('amarr', use(DEV.manufacturingHub, { kind: 'manufacture', op: { output: 'research', pay: 'morphite' } }));
    expectNoLeak(t, r, SETUP_CARDS);
    expect(JSON.stringify(t.game)).not.toContain('pendingResearch');
  });
});

// ---------------------------------------------------------------------------------------------------------------

describe('state integrity', () => {
  function deepFreeze<T>(x: T): T {
    if (typeof x === 'object' && x !== null) {
      for (const v of Object.values(x)) deepFreeze(v);
      Object.freeze(x);
    }
    return x;
  }

  /** Runs `cmd` with game, private doc and command deep-frozen; it must succeed and leave the inputs untouched. */
  function expectPure(t: Table, f: FactionId, cmd: Command): ApplyResult {
    const gameBefore = structuredClone(t.game);
    const privBefore = structuredClone(t.privs[f]);
    const game = deepFreeze(structuredClone(t.game));
    const priv = deepFreeze(structuredClone(t.privs[f]));
    const ctx = deepFreeze({ actor: f, uid: uidOf(f), priv, now: NOW });
    const r = apply(game, deepFreeze(structuredClone(cmd)), ctx);
    if (isError(r)) throw new Error(`${cmd.type} should succeed, got ${r.code} (${r.message})`);
    expect(game).toStrictEqual(gameBefore);
    expect(priv).toStrictEqual(privBefore);
    expect(r.game).not.toBe(game);
    expect(Object.isFrozen(r.game)).toBe(false);
    expect(r.priv).not.toBe(priv);
    expect(Object.isFrozen(r.priv)).toBe(false);
    expect(JSON.parse(JSON.stringify(r.game))).toStrictEqual(r.game); // no undefined anywhere
    expect(JSON.parse(JSON.stringify(r.priv))).toStrictEqual(r.priv);
    return r;
  }

  it('research, distribute, addCard and completeDev never mutate their inputs', () => {
    const t = table();
    setArea(t, 'amarr', [[DEV.mediumHull, 3], [DEV.assemblyLine, 1]]);
    expectPure(t, 'amarr', research([X], [{ out: DEV.assemblyLine, in: Y }]));
    expectPure(t, 'amarr', complete(DEV.mediumHull));
    t.privs.amarr.pendingResearch = 5;
    expectPure(t, 'amarr', distribute({ [Z]: 2 }, [{ dev: Z, replace: DEV.assemblyLine }]));
    t.privs.amarr.pendingCards = 1;
    expectPure(t, 'amarr', addCard(X));
    expectPure(t, 'amarr', addCard(null));
  });

  it('useDev never mutates its inputs', () => {
    const t = table();
    give(t, 'amarr', DEV.manufacturingHub, DEV.researchSpy, DEV.dirtyPolitics, DEV.galacticTrustFund);
    give(t, 'caldari', DEV.technologicalBreakthrough);
    t.p('amarr').res.isk = 20;
    t.p('amarr').res.morphite = 1;
    t.p('caldari').vp = 1;
    setArea(t, 'amarr', [[Z, 0]]);
    expectPure(t, 'amarr', use(DEV.galacticTrustFund, none));
    expectPure(t, 'amarr', use(DEV.dirtyPolitics, target('caldari')));
    expectPure(t, 'amarr', use(DEV.manufacturingHub, { kind: 'manufacture', op: { output: 'research', pay: 'morphite' } }));
    const r = expectPure(t, 'amarr', use(DEV.researchSpy, { kind: 'dev', dev: DEV.technologicalBreakthrough }));
    expect(r.game.players.amarr?.completed).toContain(DEV.technologicalBreakthrough);
    expect(t.p('amarr').completed).not.toContain(DEV.technologicalBreakthrough);
  });

  /** A long run through every command: devAreaCount matches the area, state stays JSON-safe, counts stay whole. */
  it('keeps devAreaCount equal to the area and the state JSON-safe through a whole sequence', () => {
    const t = table('gallente');
    const check = (): void => {
      for (const f of ['amarr', 'caldari', 'gallente'] as const) {
        expect(t.p(f).devAreaCount).toBe(t.privs[f].area.length);
        expect(t.privs[f].area.length).toBeLessThanOrEqual(4);
      }
      expect(JSON.parse(JSON.stringify(t.game))).toStrictEqual(t.game);
      expect(JSON.parse(JSON.stringify(t.privs.amarr))).toStrictEqual(t.privs.amarr);
      for (const f of ['amarr', 'caldari', 'gallente'] as const) {
        for (const v of [...Object.values(t.p(f).res), t.p(f).vp, t.privs[f].pendingCards, t.privs[f].pendingResearch]) {
          expect(Number.isInteger(v) && v >= 0).toBe(true);
        }
        for (const c of t.privs[f].area) expect(Number.isInteger(c.tokens) && c.tokens >= 0).toBe(true);
      }
    };
    check();
    t.dispatch('amarr', research([], [{ out: DEV.assemblyLine, in: X }]));
    check();
    t.dispatch('amarr', { type: 'endTurn' });
    t.game.turn = { faction: 'amarr', actionTaken: null, deployable: false };
    t.privs.amarr.pendingResearch = 12;
    t.dispatch('amarr', distribute({ [DEV.mediumHull]: 3, [DEV.technologicalBreakthrough]: 4, [X]: 2 }, [{ dev: Y, replace: DEV.galacticTrustFund }]));
    check();
    expect(areaOf(t, 'amarr')).toStrictEqual([DEV.mediumHull, DEV.technologicalBreakthrough, Y, X]);
    t.dispatch('amarr', complete(DEV.mediumHull));
    check();
    t.dispatch('amarr', addCard(Z));
    check();
    t.dispatch('amarr', complete(DEV.technologicalBreakthrough));
    check();
    expect(areaOf(t, 'amarr')).toStrictEqual([Y, X, Z]);
    expect(t.p('amarr').vp).toBe(1);
    expect(t.p('amarr').completed).toStrictEqual([DEV.mediumHull, DEV.technologicalBreakthrough]);
  });
});

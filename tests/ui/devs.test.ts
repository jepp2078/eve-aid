import { describe, expect, it } from 'vitest';
import { DEV, DEVELOPMENTS } from '../../src/data/developments';
import { apply } from '../../src/engine/apply';
import { isError, type CombatState, type Command, type UseParams } from '../../src/engine/types';
import {
  areaRows,
  blockingOverlay,
  breakthroughBack,
  canComplete,
  canUse,
  completedRows,
  deckFor,
  distributeView,
  draftFor,
  EMPTY_USE,
  marketPick,
  newDistribute,
  researchCommand,
  researchHead,
  sanitizeDistribute,
  sanitizeResearch,
  sanitizeUse,
  spyTargets,
  useKind,
  useParams,
  type DistributeDraft,
} from '../../src/ui/lib/devs';
import { NOW, startedGame, uidOf, type Table } from '../engine/helpers';

const ids = (devs: { id: string }[]) => devs.map((d) => d.id);

/** Amarr's starting area: Medium Hull, Technological Breakthrough, Galactic Trust Fund, Assembly Line (0 tokens). */
function table(): Table {
  return startedGame(['amarr', 'caldari']);
}

describe('area rows', () => {
  it('marks a card ready when its tokens reach the cost', () => {
    const t = table();
    t.privs.amarr.area[0]!.tokens = 3; // Medium Hull costs 3
    t.privs.amarr.area[1]!.tokens = 1;
    const rows = areaRows(t.privs.amarr.area, t.p('amarr'));
    expect(rows.map((r) => [r.dev.id, r.tokens, r.ready, r.prereq])).toStrictEqual([
      [DEV.mediumHull, 3, true, null],
      [DEV.technologicalBreakthrough, 1, false, null],
      [DEV.galacticTrustFund, 0, false, null],
      [DEV.assemblyLine, 0, false, null],
    ]);
  });

  it('names a missing prerequisite (the card is ready but blocked)', () => {
    const t = table();
    t.privs.amarr.area[0] = { dev: DEV.largeHull, tokens: 5 };
    const [row] = areaRows(t.privs.amarr.area, t.p('amarr'));
    expect(row).toMatchObject({ ready: true, prereq: 'Needs Medium Hull completed first' });
    t.p('amarr').completed.push(DEV.mediumHull);
    expect(areaRows(t.privs.amarr.area, t.p('amarr'))[0]!.prereq).toBeNull();
  });
});

describe('when developments can be completed and used', () => {
  it('completes only on my turn in the action phase', () => {
    const t = table();
    expect(canComplete(t.game, 'amarr')).toStrictEqual({ ok: true });
    expect(canComplete(t.game, 'caldari')).toStrictEqual({ ok: false, reason: 'Not your turn: complete it on your turn (Amarr is playing)' });
    t.game.phase = 'upkeep';
    t.game.turn = null;
    expect(canComplete(t.game, 'amarr')).toStrictEqual({ ok: false, reason: 'Complete developments on your turn in the action phase' });
    // The Panel disables Complete then, because the engine refuses it (K2).
    t.privs.amarr.area[0]!.tokens = 9;
    const refused = apply(t.game, { type: 'completeDev', dev: t.privs.amarr.area[0]!.dev }, t.ctxFor(uidOf('amarr')));
    expect(isError(refused) && refused.code).toBe('wrong_phase');
    t.game.phase = 'ended';
    expect(canComplete(t.game, 'amarr')).toStrictEqual({ ok: false, reason: 'The game is over' });
  });

  it('agrees with the engine about completing', () => {
    const t = table();
    t.privs.amarr.area[0]!.tokens = 3;
    t.privs.caldari.area[0]!.tokens = 2; // Offensive Systems T1 costs 2
    const tryAs = (f: 'amarr' | 'caldari', dev: string) =>
      apply(t.game, { type: 'completeDev', dev }, { actor: f, uid: uidOf(f), priv: t.privs[f], now: NOW });
    expect(isError(tryAs('amarr', DEV.mediumHull))).toBe(false);
    expect(tryAs('caldari', DEV.offensiveSystemsT1)).toMatchObject({ code: 'not_your_turn' });
  });

  it('uses on my turn or in my combat, the tactics in combat only, Guerilla Warfare on another turn (the engine\'s timing)', () => {
    const t = table();
    expect(canUse(t.game, 'amarr', DEV.galacticTrustFund)).toStrictEqual({ ok: true });
    expect(canUse(t.game, 'caldari', DEV.galacticTrustFund)).toStrictEqual({
      ok: false,
      reason: "Galactic Trust Fund is used on your own turn or in combat (it is Amarr's turn)",
    });
    expect(canUse(t.game, 'amarr', DEV.defensiveTactic).ok).toBe(false);
    expect(canUse(t.game, 'amarr', DEV.guerillaWarfare).ok).toBe(false);
    expect(canUse(t.game, 'caldari', DEV.guerillaWarfare)).toStrictEqual({ ok: true });
    t.game.combat = { attacker: 'amarr', defender: 'caldari' } as unknown as CombatState;
    expect(canUse(t.game, 'caldari', DEV.defensiveTactic)).toStrictEqual({ ok: true });
    expect(canUse(t.game, 'caldari', DEV.galacticTrustFund)).toStrictEqual({ ok: true });
    t.game.phase = 'upkeep';
    expect(canUse(t.game, 'amarr', DEV.galacticTrustFund).ok).toBe(false);
    expect(canUse(t.game, 'caldari', DEV.pacifist)).toStrictEqual({ ok: true });
    t.game.phase = 'ended';
    expect(canUse(t.game, 'amarr', DEV.galacticTrustFund)).toStrictEqual({ ok: false, reason: 'Developments can be used in the action and upkeep phases' });
  });
});

describe('use parameters', () => {
  const expected: Record<string, UseParams['kind']> = {
    [DEV.galacticTrustFund]: 'none',
    [DEV.underdog]: 'none',
    [DEV.pacifist]: 'none',
    [DEV.starMap]: 'none',
    [DEV.sequentialJump]: 'none',
    [DEV.mineralMarket]: 'mineralMarket',
    [DEV.tradeContracts]: 'trade',
    [DEV.manufacturingHub]: 'manufacture',
    [DEV.asteroidMining]: 'mineral',
    [DEV.extractingCrew]: 'material',
    [DEV.dirtyPolitics]: 'target',
    [DEV.researchSpy]: 'dev',
    [DEV.defensiveTactic]: 'payMaterial',
    [DEV.offensiveTactic]: 'payMaterial',
    [DEV.guerillaWarfare]: 'payMaterial',
    [DEV.strategicReposition]: 'payMaterial',
  };

  it('knows the kind of every card with a keyword, and none for passive cards', () => {
    for (const d of DEVELOPMENTS) {
      if (d.keyword === null) expect(useKind(d.id), d.id).toBeNull();
      else expect(useKind(d.id), d.id).toBe(expected[d.id]);
    }
  });

  it('in a light game every usable card takes no params, except Research Spy (a card) and Dirty Politics (a target)', () => {
    expect(useKind(DEV.mineralMarket, 'light')).toBe('none');
    for (const d of DEVELOPMENTS) {
      const want = d.keyword === null ? null : d.id === DEV.researchSpy ? 'dev' : d.id === DEV.dirtyPolitics ? 'target' : 'none';
      expect(useKind(d.id, 'light'), d.id).toBe(want);
    }
  });

  it('builds params from the draft, or null while a choice is missing', () => {
    expect(useParams('none', EMPTY_USE)).toStrictEqual({ kind: 'none' });
    expect(useParams('mineralMarket', { ...EMPTY_USE, from: 'tritanium', to: 'pyrite' })).toStrictEqual({ kind: 'mineralMarket', from: 'tritanium', to: 'pyrite' });
    expect(useParams('trade', EMPTY_USE)).toStrictEqual({ kind: 'trade', op: EMPTY_USE.trade });
    expect(useParams('manufacture', EMPTY_USE)).toStrictEqual({ kind: 'manufacture', op: EMPTY_USE.manufacture });
    expect(useParams('mineral', EMPTY_USE)).toBeNull();
    expect(useParams('mineral', { ...EMPTY_USE, mineral: 'morphite' })).toStrictEqual({ kind: 'mineral', mineral: 'morphite' });
    expect(useParams('material', { ...EMPTY_USE, material: 'moon' })).toStrictEqual({ kind: 'material', material: 'moon' });
    expect(useParams('target', EMPTY_USE)).toBeNull();
    expect(useParams('target', { ...EMPTY_USE, target: 'caldari' })).toStrictEqual({ kind: 'target', faction: 'caldari' });
    expect(useParams('dev', EMPTY_USE)).toBeNull();
    expect(useParams('dev', { ...EMPTY_USE, dev: DEV.lobbyist })).toStrictEqual({ kind: 'dev', dev: DEV.lobbyist });
    expect(useParams('payMaterial', EMPTY_USE)).toStrictEqual({ kind: 'payMaterial', material: null });
    expect(useParams('payMaterial', { ...EMPTY_USE, pay: 'planetary' })).toStrictEqual({ kind: 'payMaterial', material: 'planetary' });
  });

  it('Mineral Market gives a mineral the player holds by default', () => {
    const res = { isk: 0, pyrite: 0, mexallon: 2, tritanium: 1, morphite: 0, planetary: 0, moon: 0, component: 0 };
    expect(marketPick(EMPTY_USE, res)).toStrictEqual({ from: 'mexallon', to: 'pyrite' });
    expect(marketPick({ ...EMPTY_USE, from: 'tritanium', to: 'mexallon' }, res)).toStrictEqual({ from: 'tritanium', to: 'mexallon' });
    expect(marketPick({ ...EMPTY_USE, from: 'pyrite', to: 'tritanium' }, res)).toStrictEqual({ from: 'mexallon', to: 'tritanium' });
    // Nothing held: keep the draft (the engine explains).
    expect(marketPick(EMPTY_USE, { ...res, mexallon: 0, tritanium: 0 })).toStrictEqual({ from: 'pyrite', to: 'mexallon' });
    expect(useParams('mineralMarket', { ...EMPTY_USE, ...marketPick(EMPTY_USE, res) })).toStrictEqual({ kind: 'mineralMarket', from: 'mexallon', to: 'pyrite' });
  });

  it('restores a stored draft only when it is well-formed', () => {
    expect(sanitizeUse(JSON.parse(JSON.stringify(EMPTY_USE)))).toStrictEqual(EMPTY_USE);
    const d = { ...EMPTY_USE, from: 'mexallon', mineral: 'morphite', target: 'gallente', dev: DEV.invader, pay: 'moon' };
    expect(sanitizeUse(d)).toStrictEqual(d);
    expect(sanitizeUse({ ...EMPTY_USE, from: 'gold' })).toBeNull();
    expect(sanitizeUse({ ...EMPTY_USE, dev: 'no-such-card' })).toBeNull();
    expect(sanitizeUse({ ...EMPTY_USE, target: 'jove' })).toBeNull();
    expect(sanitizeUse(null)).toBeNull();
  });
});

describe('completed developments', () => {
  it('lists each completed card with its tapped state and whether it has a use', () => {
    const t = table();
    t.p('amarr').completed.push(DEV.galacticTrustFund, DEV.lobbyist, DEV.pacifist);
    t.p('amarr').tapped.push(DEV.pacifist);
    expect(completedRows(t.p('amarr')).map((r) => [r.dev.id, r.tapped, r.usable])).toStrictEqual([
      [DEV.galacticTrustFund, false, true],
      [DEV.lobbyist, false, false],
      [DEV.pacifist, true, true],
    ]);
  });
});

describe('decks and targets', () => {
  it("my deck is every card I haven't completed, minus my area and cards already chosen", () => {
    const t = table();
    t.p('amarr').completed.push(DEV.lobbyist);
    const deck = ids(deckFor(t.p('amarr'), t.privs.amarr.area, [DEV.invader]));
    expect(deck).toHaveLength(DEVELOPMENTS.length - 1 - 4 - 1);
    for (const id of [DEV.lobbyist, DEV.mediumHull, DEV.technologicalBreakthrough, DEV.galacticTrustFund, DEV.assemblyLine, DEV.invader]) {
      expect(deck).not.toContain(id);
    }
  });

  it('Research Spy targets: completed by other players, not by me, not in my area', () => {
    const t = startedGame(['amarr', 'caldari', 'gallente']);
    t.p('caldari').completed.push(DEV.lobbyist, DEV.mediumHull, DEV.invader);
    t.p('gallente').completed.push(DEV.invader, DEV.pacifist);
    t.p('amarr').completed.push(DEV.pacifist, DEV.researchSpy);
    // Medium Hull is in Amarr's area; Pacifist is already Amarr's; Invader is held twice but listed once.
    expect(ids(spyTargets(t.game, 'amarr', t.privs.amarr.area))).toStrictEqual([DEV.invader, DEV.lobbyist]);
  });
});

describe('blocking overlays', () => {
  it('come from the docs in the order minerals, research, card', () => {
    const t = table();
    const me = () => t.p('amarr');
    expect(blockingOverlay(t.game, me(), t.privs.amarr)).toBeNull();
    t.privs.amarr.pendingCards = 1;
    expect(blockingOverlay(t.game, me(), t.privs.amarr)).toBe('card');
    t.privs.amarr.pendingResearch = 2;
    expect(blockingOverlay(t.game, me(), t.privs.amarr)).toBe('research');
    Object.assign(me().res, { pyrite: 6, mexallon: 6, morphite: 1 });
    expect(blockingOverlay(t.game, me(), t.privs.amarr)).toBe('minerals');
  });

  it('12 minerals is fine, 13 is not; in the upkeep too; never once the game is over', () => {
    const t = table();
    Object.assign(t.p('amarr').res, { pyrite: 12 });
    expect(blockingOverlay(t.game, t.p('amarr'), t.privs.amarr)).toBeNull();
    t.p('amarr').res.tritanium = 1;
    expect(blockingOverlay(t.game, t.p('amarr'), t.privs.amarr)).toBe('minerals');
    t.game.phase = 'upkeep';
    expect(blockingOverlay(t.game, t.p('amarr'), t.privs.amarr)).toBe('minerals');
    t.game.phase = 'ended';
    t.privs.amarr.pendingResearch = 3;
    expect(blockingOverlay(t.game, t.p('amarr'), t.privs.amarr)).toBeNull();
  });

  it('needs a game, a seat and the private doc', () => {
    const t = table();
    t.privs.amarr.pendingResearch = 3;
    expect(blockingOverlay(null, t.p('amarr'), t.privs.amarr)).toBeNull();
    expect(blockingOverlay(t.game, null, t.privs.amarr)).toBeNull();
    expect(blockingOverlay(t.game, t.p('amarr'), null)).toBeNull();
  });
});

describe('research action draft', () => {
  it('builds the command and its head', () => {
    expect(researchCommand({ fill: [], swap: [] })).toBeNull();
    const d = { fill: [DEV.invader], swap: [{ out: DEV.assemblyLine, in: DEV.lobbyist }] };
    expect(researchCommand(d)).toStrictEqual({ type: 'action', action: 'research', fill: [DEV.invader], swap: [{ out: DEV.assemblyLine, in: DEV.lobbyist }] });
    expect(researchHead({ fill: [DEV.invader], swap: [] })).toBe('Research 1 card');
    expect(researchHead(d)).toBe('Research 2 cards');
    expect(researchHead({ fill: [], swap: [] })).toBe('Research');
  });

  it('a light game adds or swaps cards without naming the Research action', () => {
    const swap = [{ out: DEV.assemblyLine, in: DEV.lobbyist }];
    expect(researchHead({ fill: [], swap: [] }, 'light')).toBe('Add or swap cards');
    expect(researchHead({ fill: [DEV.invader], swap: [] }, 'light')).toBe('Add 1 card');
    expect(researchHead({ fill: [], swap }, 'light')).toBe('Swap 1 card');
    expect(researchHead({ fill: [DEV.invader, DEV.underdog], swap }, 'light')).toBe('Add 2 cards · swap 1 card');
  });

  it('restores a stored draft only when it is well-formed', () => {
    const d = { fill: [DEV.invader], swap: [{ out: DEV.assemblyLine, in: DEV.lobbyist }] };
    expect(sanitizeResearch(JSON.parse(JSON.stringify(d)))).toStrictEqual(d);
    expect(sanitizeResearch({ fill: ['nope'], swap: [] })).toBeNull();
    expect(sanitizeResearch({ fill: [], swap: [{ out: DEV.invader }] })).toBeNull();
    expect(sanitizeResearch({ fill: [] })).toBeNull();
  });
});

describe('Technological Breakthrough back face down (upkeep)', () => {
  const TB = DEV.technologicalBreakthrough;
  /** Amarr completed TB; area Medium Hull + Trust Fund (two empty slots); `pending` research in an upkeep. */
  function upkeep(pending: number): Table {
    const t = table();
    t.p('amarr').completed.push(TB);
    t.privs.amarr.area = [{ dev: DEV.mediumHull, tokens: 0 }, { dev: DEV.galacticTrustFund, tokens: 0 }];
    t.p('amarr').devAreaCount = 2;
    t.privs.amarr.pendingResearch = pending;
    t.game.phase = 'upkeep';
    t.game.turn = null;
    t.game.upkeep = { emergency: false, confirmed: ['amarr'], raids: [], largeShips: [] };
    return t;
  }
  const back = { dev: TB, replace: null };

  it('is offered during upkeep to a player who completed it, with 3 research left and an empty slot', () => {
    const t = upkeep(4);
    const none = newDistribute(4);
    const view = distributeView(t.privs.amarr.area, 4, none, t.p('amarr').completed);
    expect(breakthroughBack(t.game, t.p('amarr'), view, none)).toStrictEqual({ ok: true });
    expect(breakthroughBack(t.game, t.p('caldari'), view, none)).toBeNull(); // not completed
    const poor = distributeView(t.privs.amarr.area, 2, newDistribute(2), t.p('amarr').completed);
    expect(breakthroughBack(t.game, t.p('amarr'), poor, newDistribute(2))).toStrictEqual({ ok: false, reason: 'It needs 3 research left to place.' });
    t.game.phase = 'actions';
    expect(breakthroughBack(t.game, t.p('amarr'), view, none)).toStrictEqual({
      ok: false,
      reason: 'Technological Breakthrough goes back face down during upkeep only.',
    });
  });

  it('goes into an empty slot, takes research, and the command agrees with the engine', () => {
    const t = upkeep(5);
    const d: DistributeDraft = { for: 5, alloc: { [TB]: 1 }, fetch: [back] };
    const v = distributeView(t.privs.amarr.area, 5, d, t.p('amarr').completed);
    expect(v.fetches.map((f) => [f.dev.id, f.back, f.options])).toStrictEqual([[TB, true, [null, DEV.mediumHull, DEV.galacticTrustFund]]]);
    expect(v.rows.map((r) => [r.dev.id, r.fetched, r.add])).toStrictEqual([[DEV.mediumHull, false, 0], [DEV.galacticTrustFund, false, 0], [TB, true, 1]]);
    expect([v.spent, v.remaining, v.problem]).toStrictEqual([4, 1, null]);
    expect(v.head).toBe('Technological Breakthrough back · place 1 research · discard 1');
    expect(breakthroughBack(t.game, t.p('amarr'), v, d)).toBeNull(); // already chosen
    t.dispatch('amarr', v.command as Command);
    expect(t.privs.amarr.area).toStrictEqual([{ dev: DEV.mediumHull, tokens: 0 }, { dev: DEV.galacticTrustFund, tokens: 0 }, { dev: TB, tokens: 1 }]);
    expect(t.p('amarr').completed).toStrictEqual([]);
  });

  it('with a full area it replaces a card like any fetch, and the command agrees with the engine', () => {
    const t = upkeep(3);
    t.privs.amarr.area = [
      { dev: DEV.mediumHull, tokens: 0 }, { dev: DEV.galacticTrustFund, tokens: 0 }, { dev: DEV.assemblyLine, tokens: 0 }, { dev: DEV.lobbyist, tokens: 0 },
    ];
    const none = newDistribute(3);
    const full = distributeView(t.privs.amarr.area, 3, none, t.p('amarr').completed);
    expect(breakthroughBack(t.game, t.p('amarr'), full, none)).toStrictEqual({ ok: true });
    const forced = distributeView(t.privs.amarr.area, 3, { for: 3, alloc: {}, fetch: [back] }, t.p('amarr').completed);
    expect(forced.fetches[0]!.options).toStrictEqual([DEV.mediumHull, DEV.galacticTrustFund, DEV.assemblyLine, DEV.lobbyist]);
    expect(forced.problem).toBe('Choose which card Technological Breakthrough replaces');
    expect(forced.command).toBeNull();
    const picked = distributeView(t.privs.amarr.area, 3, { for: 3, alloc: {}, fetch: [{ dev: TB, replace: DEV.lobbyist }] }, t.p('amarr').completed);
    expect(picked.problem).toBeNull();
    t.dispatch('amarr', picked.command as Command);
    expect(t.privs.amarr.area.map((c) => c.dev)).toStrictEqual([DEV.mediumHull, DEV.galacticTrustFund, DEV.assemblyLine, TB]);
  });
});

describe('distributing research', () => {
  /** Area: Medium Hull 1, Tech Breakthrough 0, Trust Fund 0 (one empty slot). */
  function three(): Table {
    const t = table();
    t.privs.amarr.area = [
      { dev: DEV.mediumHull, tokens: 1 },
      { dev: DEV.technologicalBreakthrough, tokens: 0 },
      { dev: DEV.galacticTrustFund, tokens: 0 },
    ];
    return t;
  }
  const draft = (over: Partial<DistributeDraft>): DistributeDraft => ({ ...newDistribute(5), ...over });

  it('counts what is left: pending − tokens placed − 3 per fetched card', () => {
    const t = three();
    const v0 = distributeView(t.privs.amarr.area, 5, newDistribute(5));
    expect([v0.spent, v0.remaining, v0.canFetch]).toStrictEqual([0, 5, true]);
    expect(v0.rows.map((r) => [r.dev.id, r.tokens, r.add, r.max])).toStrictEqual([
      [DEV.mediumHull, 1, 0, 5],
      [DEV.technologicalBreakthrough, 0, 0, 5],
      [DEV.galacticTrustFund, 0, 0, 5],
    ]);
    const v1 = distributeView(t.privs.amarr.area, 5, draft({ alloc: { [DEV.mediumHull]: 2 } }));
    expect([v1.spent, v1.remaining, v1.canFetch]).toStrictEqual([2, 3, true]);
    expect(v1.rows[0]).toMatchObject({ add: 2, max: 5 });
    expect(v1.rows[1]).toMatchObject({ add: 0, max: 3 });
    const v2 = distributeView(t.privs.amarr.area, 5, draft({ alloc: { [DEV.mediumHull]: 2 }, fetch: [{ dev: DEV.invader, replace: null }] }));
    expect([v2.spent, v2.remaining, v2.canFetch]).toStrictEqual([5, 0, false]);
  });

  it('a fetched card joins the area with 0 tokens and can take research', () => {
    const t = three();
    const d = draft({ alloc: { [DEV.invader]: 2 }, fetch: [{ dev: DEV.invader, replace: null }] });
    const v = distributeView(t.privs.amarr.area, 5, d);
    expect(v.rows.map((r) => [r.dev.id, r.fetched, r.add])).toStrictEqual([
      [DEV.mediumHull, false, 0],
      [DEV.technologicalBreakthrough, false, 0],
      [DEV.galacticTrustFund, false, 0],
      [DEV.invader, true, 2],
    ]);
    expect(v.remaining).toBe(0);
    expect(v.command).toStrictEqual({ type: 'distributeResearch', alloc: { [DEV.invader]: 2 }, fetch: [{ dev: DEV.invader, replace: null }] });
    expect(v.head).toBe('Fetch 1 card · place 2 research');
  });

  it('a replaced card leaves (its tokens and any research put on it are dropped)', () => {
    const t = three();
    const d = draft({ alloc: { [DEV.mediumHull]: 2 }, fetch: [{ dev: DEV.invader, replace: DEV.mediumHull }] });
    const v = distributeView(t.privs.amarr.area, 5, d);
    expect(v.rows.map((r) => r.dev.id)).toStrictEqual([DEV.invader, DEV.technologicalBreakthrough, DEV.galacticTrustFund]);
    expect([v.spent, v.remaining]).toStrictEqual([3, 2]);
    expect(v.command).toStrictEqual({ type: 'distributeResearch', alloc: {}, fetch: [{ dev: DEV.invader, replace: DEV.mediumHull }] });
    expect(v.fetches[0]!.replaced?.tokens).toBe(1);
  });

  it('a full area needs a card to replace', () => {
    const t = table(); // four cards
    const d = draft({ fetch: [{ dev: DEV.invader, replace: null }] });
    const v = distributeView(t.privs.amarr.area, 5, d);
    expect(v.fetches[0]!.options).toStrictEqual([DEV.mediumHull, DEV.technologicalBreakthrough, DEV.galacticTrustFund, DEV.assemblyLine]);
    expect(v.problem).toBe('Choose which card Invader replaces');
    expect(v.command).toBeNull();
    const ok = distributeView(t.privs.amarr.area, 5, draft({ fetch: [{ dev: DEV.invader, replace: DEV.assemblyLine }] }));
    expect(ok.problem).toBeNull();
    expect(ok.fetches[0]!.options).toStrictEqual([DEV.mediumHull, DEV.technologicalBreakthrough, DEV.galacticTrustFund, DEV.assemblyLine]);
  });

  it('an empty slot is offered while there is room', () => {
    const t = three();
    const v = distributeView(t.privs.amarr.area, 6, { for: 6, alloc: {}, fetch: [{ dev: DEV.invader, replace: null }, { dev: DEV.lobbyist, replace: null }] });
    expect(v.fetches[0]!.options[0]).toBeNull();
    expect(v.fetches[1]!.options[0]).toBe(DEV.mediumHull); // the area is full after the first fetch
    expect(v.problem).toBe('Choose which card Lobbyist replaces');
  });

  it('says what happens to leftovers', () => {
    const t = three();
    const v = distributeView(t.privs.amarr.area, 5, draft({ alloc: { [DEV.mediumHull]: 3 } }));
    expect(v.head).toBe('Place 3 research · discard 2');
    expect(distributeView(t.privs.amarr.area, 5, newDistribute(5)).head).toBe('Discard 5 research');
    expect(distributeView(t.privs.amarr.area, 5, newDistribute(5)).command).toStrictEqual({ type: 'distributeResearch', alloc: {}, fetch: [] });
  });

  it('can only fetch with 3 left and somewhere to put the card', () => {
    const t = three();
    expect(distributeView(t.privs.amarr.area, 2, newDistribute(2)).canFetch).toBe(false);
    expect(distributeView(t.privs.amarr.area, 3, newDistribute(3)).canFetch).toBe(true);
  });

  it('agrees with the engine', () => {
    const t = three();
    t.privs.amarr.pendingResearch = 5;
    const d = draft({ alloc: { [DEV.invader]: 1, [DEV.galacticTrustFund]: 1 }, fetch: [{ dev: DEV.invader, replace: DEV.mediumHull }] });
    const v = distributeView(t.privs.amarr.area, 5, d);
    t.dispatch('amarr', v.command as Command);
    expect(t.privs.amarr.area).toStrictEqual([
      { dev: DEV.invader, tokens: 1 },
      { dev: DEV.technologicalBreakthrough, tokens: 0 },
      { dev: DEV.galacticTrustFund, tokens: 1 },
    ]);
    expect(t.privs.amarr.pendingResearch).toBe(0);
  });

  it('a draft made for another amount of research starts over', () => {
    const d = draft({ alloc: { [DEV.mediumHull]: 2 } });
    expect(draftFor(d, 5)).toBe(d);
    expect(draftFor(d, 4)).toStrictEqual(newDistribute(4));
  });

  it('restores a stored draft only when it is well-formed', () => {
    const d: DistributeDraft = { for: 5, alloc: { [DEV.mediumHull]: 2 }, fetch: [{ dev: DEV.invader, replace: null }] };
    expect(sanitizeDistribute(JSON.parse(JSON.stringify(d)))).toStrictEqual(d);
    expect(sanitizeDistribute({ ...d, alloc: { [DEV.mediumHull]: -1 } })).toBeNull();
    expect(sanitizeDistribute({ ...d, alloc: { nope: 1 } })).toBeNull();
    expect(sanitizeDistribute({ ...d, fetch: [{ dev: DEV.invader }] })).toBeNull();
    expect(sanitizeDistribute({ ...d, for: 'x' })).toBeNull();
  });
});


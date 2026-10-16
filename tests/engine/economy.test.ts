import { describe, expect, it } from 'vitest';
import { DEV } from '../../src/data/developments';
import type { FactionId, Resources, StructureType } from '../../src/data/types';
import { apply } from '../../src/engine/apply';
import { buildPoints, buildStructure, applyManufactureOp, applyTradeOp } from '../../src/engine/economy';
import { isError, type ApplyResult, type BuildItem, type Command, type ManufactureOp, type RuleError, type TradeOp } from '../../src/engine/types';
import { RuleFail, type Out } from '../../src/engine/util';
import { NOW, startedGame, uidOf, type Table } from './helpers';

const none = { bp: 0, isk: 0, pyrite: false };
const sell = (item: TradeOp['item'], mineral: TradeOp['mineral'] = null): TradeOp => ({ dir: 'sell', item, mineral });
const buy = (item: TradeOp['item'], mineral: TradeOp['mineral'] = null): TradeOp => ({ dir: 'buy', item, mineral });
const trade = (...ops: TradeOp[]): Command => ({ type: 'action', action: 'trade', ops });
const make = (output: ManufactureOp['output'], pay: ManufactureOp['pay'] = 'basic'): ManufactureOp => ({ output, pay });
const manufacture = (...ops: ManufactureOp[]): Command => ({ type: 'action', action: 'manufacture', ops });
const build = (...items: BuildItem[]): Command => ({ type: 'action', action: 'build', items });
const ship = (id: string): BuildItem => ({ kind: 'ship', ship: id });
const structure = (s: StructureType, home = false, discount = none): BuildItem => ({ kind: 'structure', structure: s, home, discount });
const unlock = (mineral: 'pyrite' | 'mexallon' | 'tritanium' | 'morphite'): BuildItem => ({ kind: 'unlockBelt', mineral });
const deployable = (s: StructureType, home = false, discount = none): Command => ({
  type: 'deployableInfrastructure', structure: s, home, discount,
});
const claim: Command = { type: 'action', action: 'claim', from: null, central: false };

const newOut = (): Out => ({ lines: [], notices: [] });

/** Amarr (to act) and Caldari, rich enough for anything unless a test says otherwise. */
function table(res: Partial<Resources> = {}): Table {
  const t = startedGame(['amarr', 'caldari']);
  Object.assign(t.p('amarr').res, { isk: 30, pyrite: 0, mexallon: 0, tritanium: 0, morphite: 0, planetary: 0, moon: 0, component: 0 }, res);
  return t;
}

const give = (t: Table, f: FactionId, ...devs: string[]): void => {
  t.p(f).completed.push(...devs);
};

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

/** Rejected commands must leave the table exactly as it was. */
function expectRejected(t: Table, f: FactionId, cmd: Command, code: string): void {
  const game = structuredClone(t.game);
  const privs = structuredClone(t.privs);
  expect(codeOf(t.tryDispatch(f, cmd))).toBe(code);
  expect(t.game).toStrictEqual(game);
  expect(t.privs).toStrictEqual(privs);
}

const lines = (t: Table): string[] => t.last?.lines ?? [];

describe('trade', () => {
  it('runs the spec example: sell triple mexallon, sell moon, buy component', () => {
    const t = table({ isk: 6, mexallon: 3, morphite: 1, moon: 1 });
    t.dispatch('amarr', trade(sell('triple', 'mexallon'), sell('moon'), buy('component')));
    const r = t.p('amarr').res;
    expect(r.isk).toBe(8);
    expect(r.mexallon).toBe(0);
    expect(r.moon).toBe(0);
    expect(r.component).toBe(1);
    expect(r.morphite).toBe(1);
    expect(t.p('amarr').slots.trade).toBe(1);
    expect(t.p('amarr').cubesUsed).toBe(1);
    expect(t.game.turn?.actionTaken).toBe('trade');
  });

  it('uses the exact prices: sell/buy for every item', () => {
    const t = table({ isk: 0, component: 1, planetary: 1, moon: 1, morphite: 1, pyrite: 1, mexallon: 1, tritanium: 1 });
    t.dispatch('amarr', trade(sell('component'), sell('planetary'), sell('morphite')));
    expect(t.p('amarr').res.isk).toBe(6 + 4 + 4);
    const u = table({ isk: 49, pyrite: 0 });
    u.dispatch('amarr', trade(buy('moon'), buy('morphite'), buy('pyrite')));
    expect(u.p('amarr').res.isk).toBe(49 - 6 - 5 - 3);
    expect(u.p('amarr').res).toMatchObject({ moon: 1, morphite: 1, pyrite: 1 });
    const v = table({ isk: 0, pyrite: 1, tritanium: 1, mexallon: 1 });
    v.dispatch('amarr', trade(sell('pyrite'), sell('mexallon'), sell('tritanium')));
    expect(v.p('amarr').res.isk).toBe(3);
    const w = table({ isk: 8 });
    w.dispatch('amarr', trade(buy('triple', 'tritanium')));
    expect(w.p('amarr').res).toMatchObject({ isk: 0, tritanium: 3 });
    const x = table({ isk: 0, planetary: 0 });
    expect(codeOf(x.tryDispatch('amarr', trade(buy('planetary'))))).toBe('insufficient');
  });

  it('applies the ops in order, each validated at that point', () => {
    const t = table({ isk: 3, moon: 1 });
    t.dispatch('amarr', trade(sell('moon'), buy('component')));
    expect(t.p('amarr').res).toMatchObject({ isk: 0, moon: 0, component: 1 });
    const u = table({ isk: 3, moon: 1 });
    expectRejected(u, 'amarr', trade(buy('component'), sell('moon')), 'insufficient');
  });

  it('allows repeated ops but no more than 3', () => {
    const t = table({ isk: 0, component: 3 });
    t.dispatch('amarr', trade(sell('component'), sell('component'), sell('component')));
    expect(t.p('amarr').res).toMatchObject({ isk: 18, component: 0 });
    const u = table({ isk: 40, component: 4 });
    expectRejected(u, 'amarr', trade(sell('component'), sell('component'), sell('component'), sell('component')), 'too_many_ops');
  });

  it('rejects no ops and malformed ops without taking the cube', () => {
    const t = table({ isk: 10, mexallon: 3, pyrite: 3 });
    expectRejected(t, 'amarr', trade(), 'no_ops');
    expectRejected(t, 'amarr', { type: 'action', action: 'trade', ops: 'sell' } as unknown as Command, 'no_ops');
    expectRejected(t, 'amarr', trade(sell('triple', null)), 'bad_op');
    expectRejected(t, 'amarr', trade(sell('triple', 'morphite' as 'pyrite')), 'bad_op');
    expectRejected(t, 'amarr', trade(sell('component', 'pyrite')), 'bad_op');
    expectRejected(t, 'amarr', trade(sell('gold' as 'moon')), 'bad_op');
    expectRejected(t, 'amarr', trade(sell('constructor' as 'moon')), 'bad_op');
    expectRejected(t, 'amarr', trade({ dir: 'swap', item: 'moon', mineral: null } as unknown as TradeOp), 'bad_op');
    expectRejected(t, 'amarr', trade(null as unknown as TradeOp), 'bad_op');
    expect(t.p('amarr').cubesUsed).toBe(0);
  });

  it('lets a purchase go past 12 minerals (the discard overlay takes it back down)', () => {
    const t = table({ isk: 30, pyrite: 4, mexallon: 4, tritanium: 4 });
    t.dispatch('amarr', trade(buy('pyrite')));
    expect(t.p('amarr').res.pyrite).toBe(5);
    const u = table({ isk: 30, pyrite: 3, mexallon: 3, tritanium: 3 });
    u.dispatch('amarr', trade(buy('triple', 'pyrite'), buy('morphite')));
    expect(u.p('amarr').res).toMatchObject({ pyrite: 6, morphite: 1 });
    // the existing free discard command then brings the player back to 12
    u.dispatch('amarr', { type: 'discardMinerals', minerals: { pyrite: 1 } });
    expect(u.p('amarr').res.pyrite).toBe(5);
  });

  it('counts mineral room after earlier ops (selling makes room, buying uses it)', () => {
    const t = table({ isk: 10, pyrite: 12 });
    t.dispatch('amarr', trade(sell('pyrite'), buy('mexallon')));
    expect(t.p('amarr').res).toMatchObject({ pyrite: 11, mexallon: 1, isk: 10 + 1 - 3 });
  });

  it('does not cap non-mineral purchases', () => {
    const t = table({ isk: 30, pyrite: 12 });
    t.dispatch('amarr', trade(buy('component'), buy('moon'), buy('planetary')));
    expect(t.p('amarr').res).toMatchObject({ component: 1, moon: 1, planetary: 1 });
  });

  it('caps ISK at 49 and says how much was lost', () => {
    const t = table({ isk: 46, component: 1 });
    t.dispatch('amarr', trade(sell('component')));
    expect(t.p('amarr').res.isk).toBe(49);
    expect(lines(t)).toContain('ISK capped at 49 (3 lost)');
  });

  it('fails selling or buying what the player cannot afford, atomically', () => {
    const t = table({ isk: 5, mexallon: 2 });
    expectRejected(t, 'amarr', trade(sell('triple', 'mexallon')), 'insufficient');
    expectRejected(t, 'amarr', trade(sell('moon')), 'insufficient');
    expectRejected(t, 'amarr', trade(buy('component')), 'insufficient');
    expectRejected(t, 'amarr', trade(sell('mexallon'), buy('component')), 'insufficient');
  });

  it('is an action: your turn only, once per round, and it takes a cube', () => {
    const t = table({ isk: 10, component: 2 });
    expectRejected(t, 'caldari', trade(buy('moon')), 'not_your_turn');
    t.dispatch('amarr', trade(sell('component')));
    expect(codeOf(t.tryDispatch('amarr', trade(sell('component'))))).toBe('already_acted');
    t.dispatch('amarr', { type: 'endTurn' });
    t.dispatch('caldari', { type: 'pass' });
    expect(t.game.turn?.faction).toBe('amarr');
    expect(t.p('amarr').slots.trade).toBe(1);
    expect(codeOf(t.tryDispatch('amarr', trade(sell('component'))))).toBe('slot_full');
  });

  it('logs one line per op naming the faction', () => {
    const t = table({ isk: 6, mexallon: 3 });
    t.dispatch('amarr', trade(sell('triple', 'mexallon'), buy('component')));
    expect(lines(t)).toEqual(['Amarr sold 3 mexallon for 5 ISK', 'Amarr bought 1 component for 7 ISK']);
  });

  it('exposes applyTradeOp for other callers (Trade Contracts)', () => {
    const t = table({ isk: 0, morphite: 1 });
    const out = newOut();
    applyTradeOp(t.game, t.p('amarr'), sell('morphite'), out);
    expect(t.p('amarr').res).toMatchObject({ isk: 4, morphite: 0 });
    expect(out.lines).toHaveLength(1);
    expect(failure(() => applyTradeOp(t.game, t.p('amarr'), sell('morphite'), out)).code).toBe('insufficient');
    expect(failure(() => applyTradeOp(t.game, t.p('amarr'), sell('triple', null), out)).code).toBe('bad_op');
    t.p('amarr').res.isk = 40;
    t.p('amarr').res.pyrite = 12;
    applyTradeOp(t.game, t.p('amarr'), buy('pyrite'), out);
    expect(t.p('amarr').res.pyrite).toBe(13);
  });
});

describe('manufacture', () => {
  it('turns 1 morphite into 2 pending research', () => {
    const t = table({ morphite: 1 });
    t.dispatch('amarr', manufacture(make('research', 'morphite')));
    expect(t.p('amarr').res.morphite).toBe(0);
    expect(t.privs.amarr.pendingResearch).toBe(2);
    expect(t.p('amarr').slots.manufacture).toBe(1);
    expect(t.game.turn?.actionTaken).toBe('manufacture');
  });

  it('turns pyrite + mexallon + tritanium into 2 pending research, and stacks across ops', () => {
    const t = table({ pyrite: 1, mexallon: 1, tritanium: 1, morphite: 1 });
    t.dispatch('amarr', manufacture(make('research', 'basic'), make('research', 'morphite')));
    expect(t.p('amarr').res).toMatchObject({ pyrite: 0, mexallon: 0, tritanium: 0, morphite: 0 });
    expect(t.privs.amarr.pendingResearch).toBe(4);
  });

  it('makes 1 VP from pyrite, mexallon, tritanium and 2 morphite', () => {
    const t = table({ pyrite: 1, mexallon: 1, tritanium: 1, morphite: 2 });
    t.dispatch('amarr', manufacture(make('vp')));
    expect(t.p('amarr').res).toMatchObject({ pyrite: 0, mexallon: 0, tritanium: 0, morphite: 0 });
    expect(t.p('amarr').vp).toBe(1);
    expect(lines(t)).toContain('Ana gains 1 VP (1 total)');
  });

  it('pays Lobbyist holders when a VP is manufactured', () => {
    const t = table({ pyrite: 1, mexallon: 1, tritanium: 1, morphite: 2 });
    give(t, 'caldari', DEV.lobbyist);
    const isk = t.p('caldari').res.isk;
    t.dispatch('amarr', manufacture(make('vp')));
    expect(t.p('caldari').res.isk).toBe(isk + 1);
  });

  it('makes components, moon and planetary materials from pairs of minerals', () => {
    const t = table({ mexallon: 2, tritanium: 2, pyrite: 2 });
    t.dispatch('amarr', manufacture(make('component'), make('moon'), make('planetary')));
    expect(t.p('amarr').res).toMatchObject({ mexallon: 0, tritanium: 0, pyrite: 0, component: 1, moon: 1, planetary: 1 });
    const u = table({ mexallon: 6 });
    u.dispatch('amarr', manufacture(make('component'), make('component'), make('component')));
    expect(u.p('amarr').res).toMatchObject({ mexallon: 0, component: 3 });
  });

  it('draws a card by notice, paying basic or morphite', () => {
    const t = table({ pyrite: 1, mexallon: 1, tritanium: 1, morphite: 1 });
    t.dispatch('amarr', manufacture(make('card', 'basic'), make('card', 'morphite')));
    expect(t.last?.notices).toStrictEqual([
      { to: 'amarr', text: 'Draw an Event or Mission card', kind: 'todo' },
      { to: 'amarr', text: 'Draw an Event or Mission card', kind: 'todo' },
    ]);
    expect(t.p('amarr').res).toMatchObject({ pyrite: 0, mexallon: 0, tritanium: 0, morphite: 0 });
    expect(t.privs.amarr.pendingCards).toBe(0);
  });

  it('rejects a payment option the recipe does not have', () => {
    const t = table({ morphite: 3, mexallon: 3, pyrite: 3, tritanium: 3 });
    expectRejected(t, 'amarr', manufacture(make('component', 'morphite')), 'bad_op');
    expectRejected(t, 'amarr', manufacture(make('moon', 'morphite')), 'bad_op');
    expectRejected(t, 'amarr', manufacture(make('planetary', 'morphite')), 'bad_op');
    expectRejected(t, 'amarr', manufacture(make('vp', 'morphite')), 'bad_op');
    expectRejected(t, 'amarr', manufacture(make('gold' as 'vp')), 'bad_op');
    expectRejected(t, 'amarr', manufacture(make('vp', 'free' as 'basic')), 'bad_op');
    expectRejected(t, 'amarr', manufacture(null as unknown as ManufactureOp), 'bad_op');
    expect(t.p('amarr').cubesUsed).toBe(0);
  });

  it('allows 1 to 3 ops only', () => {
    const t = table({ mexallon: 8 });
    expectRejected(t, 'amarr', manufacture(), 'no_ops');
    expectRejected(t, 'amarr', manufacture(make('component'), make('component'), make('component'), make('component')), 'too_many_ops');
  });

  it('fails atomically when a later op cannot be paid', () => {
    const t = table({ mexallon: 2, morphite: 0 });
    expectRejected(t, 'amarr', manufacture(make('component'), make('research', 'morphite')), 'insufficient');
    expectRejected(t, 'amarr', manufacture(make('vp')), 'insufficient');
    expect(t.privs.amarr.pendingResearch).toBe(0);
  });

  it('is your turn only, and needs the private doc', () => {
    const t = table({ morphite: 1 });
    expectRejected(t, 'caldari', manufacture(make('card', 'morphite')), 'not_your_turn');
    const r = apply(t.game, manufacture(make('research', 'morphite')), { ...t.ctxFor(t.uids.amarr), priv: null });
    expect(codeOf(r)).toBe('no_private');
  });

  it('exposes applyManufactureOp for other callers (Manufacturing Hub)', () => {
    const t = table({ morphite: 1, mexallon: 2 });
    const out = newOut();
    applyManufactureOp(t.game, t.p('amarr'), make('research', 'morphite'), out, t.privs.amarr);
    expect(t.privs.amarr.pendingResearch).toBe(2);
    applyManufactureOp(t.game, t.p('amarr'), make('component'), out, t.privs.amarr);
    expect(t.p('amarr').res.component).toBe(1);
    expect(failure(() => applyManufactureOp(t.game, t.p('amarr'), make('vp'), out, t.privs.amarr)).code).toBe('insufficient');
    expect(failure(() => applyManufactureOp(t.game, t.p('amarr'), make('vp', 'morphite'), out, t.privs.amarr)).code).toBe('bad_op');
  });
});

describe('build points', () => {
  it('is 6, plus 2 with the Assembly Line', () => {
    const t = table();
    expect(buildPoints(t.p('amarr'))).toBe(6);
    give(t, 'amarr', DEV.assemblyLine);
    expect(buildPoints(t.p('amarr'))).toBe(8);
  });

  it('lets 8 BP of ships through only with the Assembly Line', () => {
    const items = [
      ship('malediction'), ship('malediction'), ship('malediction'), ship('anathema'), ship('anathema'), ship('anathema'),
      ship('heretic'), ship('heretic'),
    ];
    const t = table({ tritanium: 8, isk: 40 });
    expectRejected(t, 'amarr', build(...items), 'no_bp');
    give(t, 'amarr', DEV.assemblyLine);
    t.dispatch('amarr', build(...items));
    expect(t.p('amarr').ships).toMatchObject({ malediction: 4, anathema: 4, heretic: 2 });
  });
});

describe('build ships', () => {
  it('builds 3 small + 1 medium for 6 BP with Medium Hull (spec example)', () => {
    const t = table({ tritanium: 3, planetary: 1, moon: 1, mexallon: 1, isk: 18 });
    give(t, 'amarr', DEV.mediumHull);
    const items = [ship('malediction'), ship('malediction'), ship('malediction'), ship('zealot')];
    t.dispatch('amarr', build(...items));
    expect(t.p('amarr').res).toStrictEqual({
      isk: 0, pyrite: 0, mexallon: 0, tritanium: 0, morphite: 0, planetary: 0, moon: 0, component: 0,
    });
    expect(t.p('amarr').ships).toStrictEqual({ anathema: 1, malediction: 4, zealot: 1 });
    expect(t.p('amarr').slots.build).toBe(1);
    expect(t.game.turn?.actionTaken).toBe('build');
  });

  it('fails hull_locked for a medium ship without Medium Hull, leaving state unchanged', () => {
    const t = table({ tritanium: 3, planetary: 1, moon: 1, mexallon: 1, isk: 18 });
    expectRejected(t, 'amarr', build(ship('malediction'), ship('zealot')), 'hull_locked');
  });

  it('needs Large Hull for large ships and pays component + morphite + 8 ISK + 5 BP', () => {
    const t = table({ component: 1, morphite: 1, isk: 8 });
    expectRejected(t, 'amarr', build(ship('redeemer')), 'hull_locked');
    give(t, 'amarr', DEV.mediumHull);
    expectRejected(t, 'amarr', build(ship('redeemer')), 'hull_locked');
    give(t, 'amarr', DEV.largeHull);
    t.dispatch('amarr', build(ship('redeemer')));
    expect(t.p('amarr').res).toMatchObject({ component: 0, morphite: 0, isk: 0 });
    expect(t.p('amarr').ships.redeemer).toBe(1);
  });

  it('fails no_bp when the items add up to 7 BP', () => {
    const t = table({ tritanium: 7, isk: 40 });
    const sevenSmall = [
      ship('malediction'), ship('malediction'), ship('malediction'), ship('anathema'), ship('anathema'), ship('anathema'), ship('heretic'),
    ];
    expectRejected(t, 'amarr', build(...sevenSmall), 'no_bp');
    t.dispatch('amarr', build(...sevenSmall.slice(0, 6)));
    expect(t.p('amarr').res.tritanium).toBe(1);
  });

  it('reports no_bp ahead of resource shortages', () => {
    const t = table({ tritanium: 0, isk: 0 });
    const seven = Array.from({ length: 7 }, () => ship('heretic'));
    expectRejected(t, 'amarr', build(...seven), 'no_bp');
  });

  it('makes each additional ship of the same name 2 ISK cheaper with Mass Production', () => {
    const t = table({ tritanium: 3, isk: 8 });
    give(t, 'amarr', DEV.massProduction);
    t.dispatch('amarr', build(ship('malediction'), ship('malediction'), ship('malediction')));
    expect(t.p('amarr').res.isk).toBe(0);
    expect(t.p('amarr').ships.malediction).toBe(4);
    const u = table({ tritanium: 3, isk: 12 });
    give(u, 'amarr', DEV.massProduction);
    u.dispatch('amarr', build(ship('malediction'), ship('anathema'), ship('malediction')));
    expect(u.p('amarr').res.isk).toBe(12 - 4 - 4 - 2);
    // control: without Mass Production the same three ships cost 4 + 4 + 4
    const v = table({ tritanium: 3, isk: 11 });
    expectRejected(v, 'amarr', build(ship('malediction'), ship('malediction'), ship('malediction')), 'insufficient');
    v.p('amarr').res.isk = 12;
    v.dispatch('amarr', build(ship('malediction'), ship('malediction'), ship('malediction')));
    expect(v.p('amarr').res.isk).toBe(0);
  });

  it('does not let Mass Production discount the first ship of a name in a later build', () => {
    const t = table({ tritanium: 2, isk: 8 });
    give(t, 'amarr', DEV.massProduction);
    t.dispatch('amarr', build(ship('malediction')));
    expect(t.p('amarr').res.isk).toBe(4);
  });

  it('refuses a 6th Malediction (model limit 5), counting ships earlier in the same build', () => {
    const t = table({ tritanium: 3, isk: 30 });
    t.p('amarr').ships.malediction = 5;
    expectRejected(t, 'amarr', build(ship('malediction')), 'no_models');
    t.p('amarr').ships.malediction = 4;
    expectRejected(t, 'amarr', build(ship('malediction'), ship('malediction')), 'no_models');
    t.dispatch('amarr', build(ship('malediction')));
    expect(t.p('amarr').ships.malediction).toBe(5);
  });

  it('only builds ships of the actor faction, and known ships', () => {
    const t = table({ tritanium: 3, isk: 30 });
    expectRejected(t, 'amarr', build(ship('crow')), 'wrong_faction');
    expectRejected(t, 'amarr', build(ship('malediction'), ship('crow')), 'wrong_faction');
    expectRejected(t, 'amarr', build(ship('not-a-ship')), 'bad_ship');
    expectRejected(t, 'amarr', build(ship('__proto__')), 'bad_ship');
    expectRejected(t, 'amarr', build({ kind: 'ship' } as unknown as BuildItem), 'bad_ship');
    expect(t.p('amarr').cubesUsed).toBe(0);
  });

  it('fails an unpayable item atomically (later items are not partly applied)', () => {
    const t = table({ tritanium: 1, isk: 30 });
    expectRejected(t, 'amarr', build(ship('malediction'), ship('anathema')), 'insufficient');
    const u = table({ tritanium: 2, isk: 7 });
    expectRejected(u, 'amarr', build(ship('malediction'), ship('anathema')), 'insufficient');
  });

  it('rejects an empty or malformed item list before taking the cube', () => {
    const t = table();
    expectRejected(t, 'amarr', build(), 'no_items');
    expectRejected(t, 'amarr', { type: 'action', action: 'build', items: null } as unknown as Command, 'no_items');
    expectRejected(t, 'amarr', build({ kind: 'teleport' } as unknown as BuildItem), 'bad_item');
    expectRejected(t, 'amarr', build(null as unknown as BuildItem), 'bad_item');
    expect(t.p('amarr').cubesUsed).toBe(0);
  });

  it('logs "an" before a ship or faction name that starts with a vowel', () => {
    const t = table({ tritanium: 2, isk: 30 });
    t.dispatch('amarr', build(ship('anathema'), ship('malediction')));
    expect(lines(t)).toContain('Amarr built an Anathema (paid 4 ISK and 1 tritanium)');
    expect(lines(t)).toContain('Amarr built a Malediction (paid 4 ISK and 1 tritanium)');
    const u = startedGame(['caldari', 'amarr']);
    Object.assign(u.p('caldari').res, { tritanium: 1, isk: 30 });
    const e = u.tryDispatch('caldari', build(ship('anathema')));
    expect(isError(e) && e.message).toBe('Anathema is an Amarr ship; you can only build Caldari ships');
  });

  it('is your turn only and one build per round', () => {
    const t = table({ tritanium: 4, isk: 30 });
    expectRejected(t, 'caldari', build(ship('crow')), 'not_your_turn');
    t.dispatch('amarr', build(ship('malediction')));
    expect(codeOf(t.tryDispatch('amarr', build(ship('malediction'))))).toBe('already_acted');
  });
});

describe('build structures', () => {
  it('costs 5 BP, 1 pyrite and the structure ISK; two structures do not fit in 6 BP', () => {
    const t = table({ pyrite: 2, isk: 30 });
    expectRejected(t, 'amarr', build(structure('citadel'), structure('refinery')), 'no_bp');
    t.dispatch('amarr', build(structure('engineering')));
    expect(lines(t)).toContain('Amarr built an Engineering Complex (paid 6 ISK and 1 pyrite)');
    expect(t.p('amarr').res).toMatchObject({ pyrite: 1, isk: 24 });
    expect(t.p('amarr').structures).toStrictEqual({ engineering: 1, citadel: 0, customs: 0, refinery: 0 });
    expect(t.p('amarr').homeCitadels).toBe(0);
  });

  it('costs 6 / 5 / 4 / 4 ISK for engineering / citadel / customs / refinery', () => {
    for (const [s, cost] of [['engineering', 6], ['citadel', 5], ['customs', 4], ['refinery', 4]] as const) {
      const t = table({ pyrite: 1, isk: 20 });
      t.dispatch('amarr', build(structure(s)));
      expect(t.p('amarr').res.isk).toBe(20 - cost);
      expect(t.p('amarr').structures[s]).toBe(1);
    }
  });

  it('counts a home citadel in homeCitadels as well as in citadels', () => {
    const t = table({ pyrite: 1, isk: 10 });
    t.dispatch('amarr', build(structure('citadel', true)));
    expect(t.p('amarr').structures.citadel).toBe(1);
    expect(t.p('amarr').homeCitadels).toBe(1);
    const u = table({ pyrite: 1, isk: 10 });
    u.dispatch('amarr', build(structure('citadel', false)));
    expect(u.p('amarr').structures.citadel).toBe(1);
    expect(u.p('amarr').homeCitadels).toBe(0);
  });

  it('any structure can be built in a home system, but only a citadel counts as a home citadel', () => {
    const t = table({ pyrite: 1, isk: 10 });
    t.dispatch('amarr', build(structure('customs', true)));
    expect(t.p('amarr').structures.customs).toBe(1);
    expect(t.p('amarr').homeCitadels).toBe(0);
    expect(lines(t)).toContain('Amarr built a Customs Office at home (paid 4 ISK and 1 pyrite)');
  });

  it('a Customs Office in a slot with a 5 BP discount costs 0 BP', () => {
    const t = table({ pyrite: 1, tritanium: 6, isk: 40 });
    const six = [1, 2, 3, 4, 5, 6].map((n) => ship(n % 2 ? 'malediction' : 'anathema'));
    t.dispatch('amarr', build(structure('customs', false, { bp: 5, isk: 0, pyrite: false }), ...six));
    expect(t.p('amarr').structures.customs).toBe(1);
    expect(t.p('amarr').ships).toMatchObject({ malediction: 4, anathema: 4 });
    const u = table({ pyrite: 1, tritanium: 6, isk: 40 });
    expectRejected(u, 'amarr', build(structure('customs', false, { bp: 4, isk: 0, pyrite: false }), ...six), 'no_bp');
    expectRejected(u, 'amarr', build(structure('customs'), ship('malediction'), ship('anathema')), 'no_bp');
  });

  it('applies slot ISK and pyrite discounts', () => {
    const t = table({ pyrite: 0, isk: 10 });
    expectRejected(t, 'amarr', build(structure('engineering')), 'insufficient');
    t.dispatch('amarr', build(structure('engineering', false, { bp: 0, isk: 2, pyrite: true })));
    expect(t.p('amarr').res).toMatchObject({ pyrite: 0, isk: 6 });
    const u = table({ pyrite: 1, isk: 10 });
    u.dispatch('amarr', build(structure('refinery', false, { bp: 0, isk: 9, pyrite: false })));
    expect(u.p('amarr').res).toMatchObject({ pyrite: 0, isk: 10 });
  });

  it('Materials Efficiency takes 1 ISK off a structure (a refinery costs 3), on top of the slot discount', () => {
    const t = table({ pyrite: 1, isk: 10 });
    give(t, 'amarr', DEV.materialsEfficiency);
    t.dispatch('amarr', build(structure('refinery')));
    expect(t.p('amarr').res.isk).toBe(7);
    const u = table({ pyrite: 1, isk: 10 });
    give(u, 'amarr', DEV.materialsEfficiency);
    u.dispatch('amarr', build(structure('refinery', false, { bp: 0, isk: 3, pyrite: false })));
    expect(u.p('amarr').res.isk).toBe(10);
  });

  it('keeps 13 models per structure type across all players (no_supply)', () => {
    const t = table({ pyrite: 3, isk: 30 });
    t.p('caldari').structures.refinery = 7;
    t.p('amarr').structures.refinery = 5;
    t.dispatch('amarr', build(structure('refinery')));
    expect(t.p('amarr').structures.refinery).toBe(6);
    const u = table({ pyrite: 3, isk: 30 });
    u.p('caldari').structures.refinery = 7;
    u.p('amarr').structures.refinery = 6;
    expectRejected(u, 'amarr', build(structure('refinery')), 'no_supply');
    u.p('caldari').structures.customs = 13;
    u.dispatch('amarr', build(structure('citadel')));
    expect(u.p('amarr').structures.citadel).toBe(1);
  });

  it('counts structures earlier in the same build against the supply', () => {
    const t = table({ pyrite: 3, isk: 30 });
    t.p('caldari').structures.refinery = 7;
    t.p('amarr').structures.refinery = 5;
    const free = { bp: 5, isk: 0, pyrite: false };
    expectRejected(t, 'amarr', build(structure('refinery', false, free), structure('refinery', false, free)), 'no_supply');
    t.p('caldari').structures.refinery = 6;
    t.dispatch('amarr', build(structure('refinery', false, free), structure('refinery', false, free)));
    expect(t.p('amarr').structures.refinery).toBe(7);
  });

  it('rejects malformed structures and discounts', () => {
    const t = table({ pyrite: 1, isk: 30 });
    expectRejected(t, 'amarr', build(structure('palace' as 'citadel')), 'bad_structure');
    expectRejected(t, 'amarr', build(structure('citadel', 'yes' as unknown as boolean)), 'bad_op');
    expectRejected(t, 'amarr', build(structure('citadel', false, { bp: -1, isk: 0, pyrite: false })), 'bad_amount');
    expectRejected(t, 'amarr', build(structure('citadel', false, { bp: 0, isk: 1.5, pyrite: false })), 'bad_amount');
    expectRejected(t, 'amarr', build(structure('citadel', false, { bp: 0, isk: 0, pyrite: 'no' as unknown as boolean })), 'bad_op');
    expectRejected(t, 'amarr', build(structure('citadel', false, null as unknown as typeof none)), 'bad_op');
    expect(t.p('amarr').cubesUsed).toBe(0);
  });
});

describe('unlock home belt', () => {
  it('costs 4 BP and 5 ISK, uses a locked belt and adds a belt of the chosen colour', () => {
    const t = table({ isk: 10 });
    t.dispatch('amarr', build(unlock('mexallon')));
    expect(t.p('amarr').res.isk).toBe(5);
    expect(t.p('amarr').lockedHomeBelts).toBe(1);
    expect(t.p('amarr').belts.mexallon).toBe(1);
  });

  it('fits with 2 BP of other items but not 3', () => {
    const t = table({ isk: 30, tritanium: 3 });
    expectRejected(t, 'amarr', build(unlock('pyrite'), ship('malediction'), ship('anathema'), ship('heretic')), 'no_bp');
    t.dispatch('amarr', build(unlock('pyrite'), ship('malediction'), ship('anathema')));
    expect(t.p('amarr').res.isk).toBe(30 - 5 - 8);
  });

  it('needs a locked belt left and a real mineral', () => {
    const t = table({ isk: 30 });
    t.p('amarr').lockedHomeBelts = 0;
    expectRejected(t, 'amarr', build(unlock('pyrite')), 'no_locked_belt');
    t.p('amarr').lockedHomeBelts = 1;
    t.dispatch('amarr', build(unlock('pyrite')));
    expect(t.p('amarr').lockedHomeBelts).toBe(0);
    const u = table({ isk: 30 });
    expectRejected(u, 'amarr', build(unlock('gold' as 'pyrite')), 'bad_mineral');
    expectRejected(u, 'amarr', build(unlock('pyrite'), unlock('mexallon'), unlock('tritanium')), 'no_bp');
  });

  it('cannot unlock more belts than are locked, counting earlier items in the same build', () => {
    const t = table({ isk: 30 });
    give(t, 'amarr', DEV.assemblyLine);
    t.p('amarr').lockedHomeBelts = 1;
    expectRejected(t, 'amarr', build(unlock('pyrite'), unlock('mexallon')), 'no_locked_belt');
    t.p('amarr').lockedHomeBelts = 2;
    t.dispatch('amarr', build(unlock('pyrite'), unlock('mexallon')));
    expect(t.p('amarr').lockedHomeBelts).toBe(0);
    expect(t.p('amarr').belts).toMatchObject({ pyrite: 2, mexallon: 1 });
  });
});

describe('deployable infrastructure', () => {
  function claimed(res: Partial<Resources> = { pyrite: 1, isk: 10 }): Table {
    const t = table(res);
    give(t, 'amarr', DEV.deployableInfrastructure);
    t.dispatch('amarr', claim);
    expect(t.game.turn?.deployable).toBe(true);
    return t;
  }

  it('builds a structure after a claim ignoring BP, then closes the offer', () => {
    const t = claimed();
    t.dispatch('amarr', deployable('citadel', true));
    expect(t.p('amarr').structures.citadel).toBe(1);
    expect(t.p('amarr').homeCitadels).toBe(1);
    expect(t.p('amarr').res).toMatchObject({ pyrite: 0, isk: 5 });
    expect(t.game.turn?.deployable).toBe(false);
    expect(t.game.turn?.actionTaken).toBe('claim');
    expect(codeOf(t.tryDispatch('amarr', deployable('customs')))).toBe('no_deployable');
    expect(lines(t)).toContain('Amarr used Deployable Infrastructure');
    expect(lines(t)).toContain('Amarr built a Citadel at home (paid 5 ISK and 1 pyrite)');
  });

  it('does not cost another cube and still takes slot discounts, ME and the supply limit', () => {
    const t = claimed({ pyrite: 0, isk: 3 });
    give(t, 'amarr', DEV.materialsEfficiency);
    const cubes = t.p('amarr').cubesUsed;
    t.dispatch('amarr', deployable('refinery', false, { bp: 0, isk: 0, pyrite: true }));
    expect(t.p('amarr').cubesUsed).toBe(cubes);
    expect(t.p('amarr').res).toMatchObject({ pyrite: 0, isk: 0 });
    const u = claimed();
    u.p('caldari').structures.customs = 13;
    expectRejected(u, 'amarr', deployable('customs'), 'no_supply');
  });

  it('is unavailable without a claim, off turn, or after the turn moves on', () => {
    const t = table({ pyrite: 1, isk: 10 });
    expectRejected(t, 'amarr', deployable('customs'), 'no_deployable');
    give(t, 'amarr', DEV.deployableInfrastructure);
    t.dispatch('amarr', claim);
    expectRejected(t, 'caldari', deployable('customs'), 'not_your_turn');
    t.dispatch('amarr', { type: 'endTurn' });
    expectRejected(t, 'amarr', deployable('customs'), 'not_your_turn');
    expectRejected(t, 'caldari', deployable('customs'), 'no_deployable');
    t.dispatch('caldari', { type: 'pass' });
    expectRejected(t, 'amarr', deployable('customs'), 'no_deployable');
  });

  it('a failed attempt leaves the offer open', () => {
    const t = claimed({ pyrite: 0, isk: 10 });
    expectRejected(t, 'amarr', deployable('customs'), 'insufficient');
    expect(t.game.turn?.deployable).toBe(true);
    expectRejected(t, 'amarr', deployable('palace' as 'customs'), 'bad_structure');
    t.p('amarr').res.pyrite = 1;
    t.dispatch('amarr', deployable('customs'));
    expect(t.p('amarr').structures.customs).toBe(1);
  });
});

describe('buildStructure', () => {
  it('returns the BP cost: 5, reduced by the discount, or 0 when ignoring BP', () => {
    const t = table({ pyrite: 5, isk: 40 });
    const p = t.p('amarr');
    const out = newOut();
    expect(buildStructure(t.game, p, 'customs', false, none, false, out)).toBe(5);
    expect(buildStructure(t.game, p, 'customs', false, { bp: 2, isk: 0, pyrite: false }, false, out)).toBe(3);
    expect(buildStructure(t.game, p, 'customs', false, { bp: 9, isk: 0, pyrite: false }, false, out)).toBe(0);
    expect(buildStructure(t.game, p, 'customs', false, none, true, out)).toBe(0);
    expect(p.structures.customs).toBe(4);
    expect(p.res).toMatchObject({ pyrite: 1, isk: 40 - 16 });
  });
});

describe('economy commands overall', () => {
  function deepFreeze<T>(x: T): T {
    if (typeof x === 'object' && x !== null) {
      for (const v of Object.values(x)) deepFreeze(v);
      Object.freeze(x);
    }
    return x;
  }

  /**
   * Runs `cmd` through `apply` with the game, the actor's private doc and the command all deep-frozen (a write to any
   * of them throws), requires success, and checks the inputs still equal their pristine copies and the result is a
   * fresh, unfrozen state that differs from them.
   */
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
    expect(r.game).not.toStrictEqual(gameBefore);
    expect(Object.isFrozen(r.game)).toBe(false);
    expect(Object.isFrozen(r.game.players[f])).toBe(false);
    expect(r.priv).not.toBe(priv);
    expect(Object.isFrozen(r.priv)).toBe(false);
    return r;
  }

  it('trade never mutates its inputs', () => {
    const t = table({ isk: 6, mexallon: 3, morphite: 1, moon: 1 });
    const r = expectPure(t, 'amarr', trade(sell('triple', 'mexallon'), sell('moon'), buy('component')));
    expect(r.game.players.amarr?.res).toMatchObject({ isk: 8, component: 1 });
  });

  it('manufacture (research, vp, card, component) never mutates its inputs', () => {
    const t = table({ morphite: 3, mexallon: 3, pyrite: 1, tritanium: 1 });
    const r = expectPure(t, 'amarr', manufacture(make('research', 'morphite'), make('card', 'basic'), make('component')));
    expect(r.priv?.pendingResearch).toBe(2);
    expect(t.privs.amarr.pendingResearch).toBe(0);
    const u = table({ pyrite: 1, mexallon: 1, tritanium: 1, morphite: 2 });
    expect(expectPure(u, 'amarr', manufacture(make('vp'))).game.players.amarr?.vp).toBe(1);
  });

  it('build (ships, structure, belt unlock) never mutates its inputs', () => {
    const t = table({ tritanium: 3, pyrite: 1, isk: 40 });
    give(t, 'amarr', DEV.massProduction);
    const r = expectPure(t, 'amarr', build(ship('malediction'), ship('malediction'), ship('anathema')));
    expect(r.game.players.amarr?.ships).toMatchObject({ malediction: 3, anathema: 2 });
    expectPure(t, 'amarr', build(structure('citadel', true)));
    expectPure(t, 'amarr', build(unlock('mexallon')));
  });

  it('deployableInfrastructure never mutates its inputs', () => {
    const t = table({ pyrite: 1, isk: 10 });
    give(t, 'amarr', DEV.deployableInfrastructure);
    t.dispatch('amarr', claim);
    const r = expectPure(t, 'amarr', deployable('citadel', true));
    expect(r.game.turn?.deployable).toBe(false);
    expect(t.game.turn?.deployable).toBe(true);
    expect(r.game.players.amarr?.homeCitadels).toBe(1);
  });

  it('keeps state JSON-safe (no undefined anywhere) after each economy action', () => {
    const t = table({ tritanium: 1, isk: 10, morphite: 1 });
    t.dispatch('amarr', build(ship('malediction')));
    expect(JSON.parse(JSON.stringify(t.game))).toStrictEqual(t.game);
    expect(JSON.parse(JSON.stringify(t.privs.amarr))).toStrictEqual(t.privs.amarr);
    const u = table({ morphite: 1 });
    u.dispatch('amarr', manufacture(make('research', 'morphite')));
    expect(JSON.parse(JSON.stringify(u.game))).toStrictEqual(u.game);
    expect(JSON.parse(JSON.stringify(u.privs.amarr))).toStrictEqual(u.privs.amarr);
  });

  it('keeps counts as whole numbers and ISK within the cap', () => {
    const t = table({ isk: 49, tritanium: 1, component: 3 });
    t.dispatch('amarr', trade(sell('component'), sell('component'), sell('component')));
    expect(t.p('amarr').res.isk).toBe(49);
    for (const v of Object.values(t.p('amarr').res)) expect(Number.isInteger(v) && v >= 0).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { DEV } from '../../src/data/developments';
import {
  addRes,
  checkCount,
  clone,
  err,
  fail,
  gainVP,
  hasDev,
  mineralTotal,
  nextSeat,
  player,
  RuleFail,
  seatOrderFrom,
  spend,
  stealVP,
  withArticle,
  type Out,
} from '../../src/engine/util';
import { startedGame } from './helpers';
import { SHIPS } from '../../src/data/ships';
import { FACTION_INFO } from '../../src/data/factions';
import { STRUCTURE_NAME } from '../../src/engine/economy';
import { ACTION_LABEL, STRUCTURE_LABEL } from '../../src/ui/lib/labels';

const newOut = (): Out => ({ lines: [], notices: [] });

function failure(fn: () => unknown): { code: string; message: string } {
  try {
    fn();
  } catch (e) {
    if (e instanceof RuleFail) return e.e;
    throw e;
  }
  throw new Error('expected a RuleFail');
}

describe('errors', () => {
  it('err builds a RuleError and fail throws it wrapped in RuleFail', () => {
    expect(err('nope', 'Not allowed')).toEqual({ error: true, code: 'nope', message: 'Not allowed' });
    expect(failure(() => fail('nope', 'Not allowed'))).toEqual({ error: true, code: 'nope', message: 'Not allowed' });
  });

  it('checkCount accepts integers >= 0 only', () => {
    expect(checkCount(3, 'ISK')).toBe(3);
    expect(failure(() => checkCount(-1, 'ISK')).code).toBe('bad_amount');
    expect(failure(() => checkCount(1.5, 'ISK')).code).toBe('bad_amount');
    expect(failure(() => checkCount(Number.NaN, 'ISK')).code).toBe('bad_amount');
  });

  it('clone is a deep copy', () => {
    const a = { x: [1, 2] };
    const b = clone(a);
    b.x.push(3);
    expect(a.x).toEqual([1, 2]);
  });
});

describe('withArticle', () => {
  it('puts "an" before a vowel sound and "a" before anything else', () => {
    expect(withArticle('Ares')).toBe('an Ares');
    expect(withArticle('Engineering Complex')).toBe('an Engineering Complex');
    expect(withArticle('Ishtar')).toBe('an Ishtar');
    expect(withArticle('Omen')).toBe('an Omen');
    expect(withArticle('Extract')).toBe('an Extract');
    expect(withArticle('Crow')).toBe('a Crow');
    expect(withArticle('Move')).toBe('a Move');
    expect(withArticle('Citadel')).toBe('a Citadel');
  });

  it('is right for every ship, faction, structure and action name in the game (a spelling heuristic, checked by hand)', () => {
    /** Every name that takes "an", by how it is said; any other name takes "a". */
    const AN = new Set(['Anathema', 'Ares', 'Eris', 'Ishtar', 'Absolution', 'Astarte', 'Amarr', 'Engineering Complex', 'Extract']);
    const names = [
      ...SHIPS.map((s) => s.name),
      ...Object.values(FACTION_INFO).map((f) => f.name),
      ...Object.values(STRUCTURE_NAME),
      ...Object.values(STRUCTURE_LABEL),
      ...Object.values(ACTION_LABEL),
    ];
    expect(names).toHaveLength(32 + 4 + 4 + 4 + 7);
    for (const name of names) expect(withArticle(name), name).toBe(`${AN.has(name) ? 'an' : 'a'} ${name}`);
    expect([...AN].every((n) => names.includes(n))).toBe(true);
  });
});

describe('player', () => {
  it('returns the seated player and fails no_player otherwise', () => {
    const { game } = startedGame(['amarr', 'caldari']);
    expect(player(game, 'caldari').faction).toBe('caldari');
    expect(failure(() => player(game, 'minmatar')).code).toBe('no_player');
  });
});

describe('resources', () => {
  it('addRes caps ISK at 49 and logs what was lost', () => {
    const t = startedGame(['amarr', 'caldari']);
    const p = t.p('amarr');
    p.res.isk = 46;
    const out = newOut();
    addRes(p, 'isk', 6, out);
    expect(p.res.isk).toBe(49);
    expect(out.lines).toEqual(['ISK capped at 49 (3 lost)']);
  });

  it('addRes does not cap minerals (callers enforce the 12 limit) and rejects going below 0', () => {
    const p = startedGame(['amarr', 'caldari']).p('amarr');
    const out = newOut();
    addRes(p, 'tritanium', 14, out);
    expect(p.res.tritanium).toBe(14);
    addRes(p, 'tritanium', -4, out);
    expect(p.res.tritanium).toBe(10);
    expect(out.lines).toEqual([]);
    expect(failure(() => addRes(p, 'moon', -1, out)).code).toBe('insufficient');
    expect(p.res.moon).toBe(0);
  });

  it('spend pays a cost or fails insufficient naming the missing resource without paying anything', () => {
    const p = startedGame(['amarr', 'caldari']).p('amarr');
    p.res = { isk: 10, pyrite: 1, mexallon: 0, tritanium: 2, morphite: 0, planetary: 0, moon: 0, component: 0 };
    spend(p, { isk: 4, tritanium: 1 });
    expect(p.res).toMatchObject({ isk: 6, tritanium: 1, pyrite: 1 });
    const e = failure(() => spend(p, { isk: 5, pyrite: 1, mexallon: 1 }));
    expect(e.code).toBe('insufficient');
    expect(e.message).toContain('mexallon');
    expect(p.res).toMatchObject({ isk: 6, tritanium: 1, pyrite: 1, mexallon: 0 });
    expect(failure(() => spend(p, { isk: -3 })).code).toBe('bad_amount');
  });

  it('mineralTotal counts the four minerals only', () => {
    const p = startedGame(['amarr', 'caldari']).p('amarr');
    p.res = { isk: 9, pyrite: 2, mexallon: 3, tritanium: 1, morphite: 4, planetary: 5, moon: 5, component: 5 };
    expect(mineralTotal(p)).toBe(10);
  });

  it('hasDev checks completed developments only', () => {
    const t = startedGame(['amarr', 'caldari']);
    const p = t.p('amarr');
    expect(hasDev(p, DEV.mediumHull)).toBe(false); // in the area, not completed
    p.completed.push(DEV.mediumHull);
    expect(hasDev(p, DEV.mediumHull)).toBe(true);
  });
});

describe('gainVP', () => {
  it('adds VP and pays every other Lobbyist holder that much ISK', () => {
    const t = startedGame(['amarr', 'caldari', 'gallente']);
    t.p('amarr').completed.push(DEV.lobbyist);
    t.p('caldari').completed.push(DEV.lobbyist);
    const out = newOut();
    gainVP(t.game, 'amarr', 2, out);
    expect(t.p('amarr').vp).toBe(2);
    expect(t.p('amarr').res.isk).toBe(4); // own Lobbyist does not pay
    expect(t.p('caldari').res.isk).toBe(6);
    expect(t.p('gallente').res.isk).toBe(4);
    expect(out.lines.join('\n')).toMatch(/Lobbyist/);
  });

  it('caps Lobbyist ISK at 49', () => {
    const t = startedGame(['amarr', 'caldari']);
    t.p('caldari').completed.push(DEV.lobbyist);
    t.p('caldari').res.isk = 48;
    const out = newOut();
    gainVP(t.game, 'amarr', 3, out);
    expect(t.p('caldari').res.isk).toBe(49);
    expect(out.lines).toContain('ISK capped at 49 (2 lost)');
  });

  it('does not pay Lobbyist for zero or negative amounts; a loss floors at 0', () => {
    const t = startedGame(['amarr', 'caldari']);
    t.p('caldari').completed.push(DEV.lobbyist);
    t.p('amarr').vp = 1;
    gainVP(t.game, 'amarr', 0, newOut());
    gainVP(t.game, 'amarr', -2, newOut());
    expect(t.p('amarr').vp).toBe(0);
    expect(t.p('caldari').res.isk).toBe(4);
  });
});

describe('stealVP', () => {
  it('moves 1 VP and the gain pays Lobbyist holders', () => {
    const t = startedGame(['amarr', 'caldari', 'gallente']);
    t.p('caldari').vp = 3;
    t.p('gallente').completed.push(DEV.lobbyist);
    expect(stealVP(t.game, 'caldari', 'amarr', newOut())).toBe(true);
    expect(t.p('caldari').vp).toBe(2);
    expect(t.p('amarr').vp).toBe(1);
    expect(t.p('gallente').res.isk).toBe(5);
  });

  it('steals nothing from a player with 0 VP', () => {
    const t = startedGame(['amarr', 'caldari']);
    expect(stealVP(t.game, 'caldari', 'amarr', newOut())).toBe(false);
    expect(t.p('amarr').vp).toBe(0);
    expect(t.p('caldari').vp).toBe(0);
  });
});

describe('seats', () => {
  it('nextSeat and seatOrderFrom go clockwise and wrap', () => {
    const { game } = startedGame(['amarr', 'caldari', 'gallente']);
    expect(nextSeat(game, 'amarr')).toBe('caldari');
    expect(nextSeat(game, 'gallente')).toBe('amarr');
    expect(seatOrderFrom(game, 'caldari')).toEqual(['caldari', 'gallente', 'amarr']);
    expect(seatOrderFrom(game, 'amarr')).toEqual(['amarr', 'caldari', 'gallente']);
    expect(failure(() => nextSeat(game, 'minmatar')).code).toBe('no_player');
  });
});

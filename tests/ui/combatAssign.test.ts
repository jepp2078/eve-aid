import { describe, expect, it } from 'vitest';
import { shipsOf } from '../../src/data/ships';
import { apply } from '../../src/engine/apply';
import { isError, type Command, type RuleError } from '../../src/engine/types';
import {
  assignCommand,
  bandScroll,
  boxCounts,
  EMPTY_ASSIGN,
  firstSlot,
  fleetHead,
  issueSpot,
  laneDrafts,
  placeShip,
  removePlacement,
  sanitizeAssign,
  slotBlock,
  trayItems,
  trayLeftText,
  trayOverText,
  type Placement,
} from '../../src/ui/lib/combatAssign';
import { battle } from '../engine/combat/fixtures';
import { startedGame } from '../engine/helpers';

const lead = (ship: string, orbit: Placement['orbit']): Placement => ({ ship, orbit, role: 'leader' });
const sup = (ship: string, orbit: Placement['orbit']): Placement => ({ ship, orbit, role: 'support' });

/** The engine's answer to Amarr assigning `ships` in a fresh combat against Caldari. */
function engineError(owned: Record<string, number>, ships: Placement[]): RuleError {
  const b = battle([], [], { stopAt: 'assign' });
  Object.assign(b.t.p('amarr').ships, owned);
  const cmd: Command = { type: 'combatAssign', ships };
  const r = apply(b.t.game, cmd, b.t.ctxFor(b.t.uids.amarr));
  if (!isError(r)) throw new Error('expected a rule error');
  return r;
}

/** The same in a light game, which keeps no fleets: the box limits each ship. */
function lightEngineError(ships: Placement[]): RuleError {
  const b = battle([], [], { table: startedGame(['amarr', 'caldari'], { mode: 'light' }), stopAt: 'assign' });
  const r = apply(b.t.game, { type: 'combatAssign', ships }, b.t.ctxFor(b.t.uids.amarr));
  if (!isError(r)) throw new Error('expected a rule error');
  return r;
}

describe('trayItems', () => {
  it('lists my owned ships small → large, then by name, with placed and left counts', () => {
    const owned = { zealot: 2, anathema: 1, malediction: 3, redeemer: 1, crow: 4, heretic: 0 };
    const items = trayItems('amarr', owned, [lead('zealot', 'medium'), sup('malediction', 'medium'), sup('malediction', 'small')]);
    expect(items.map((i) => [i.ship.id, i.owned, i.placed, i.left, i.over])).toStrictEqual([
      ['anathema', 1, 0, 1, 0],
      ['malediction', 3, 2, 1, 0],
      ['zealot', 2, 1, 1, 0],
      ['redeemer', 1, 0, 1, 0],
    ]);
  });

  it('keeps a placed ship I no longer own, flagged as over', () => {
    const items = trayItems('amarr', { anathema: 1 }, [sup('anathema', 'small'), lead('zealot', 'medium'), sup('zealot', 'medium')]);
    expect(items.map((i) => [i.ship.id, i.owned, i.placed, i.left, i.over])).toStrictEqual([
      ['anathema', 1, 1, 0, 0],
      ['zealot', 0, 2, 0, 2],
    ]);
  });
});

describe('boxCounts (a light game places ships from the box)', () => {
  it('lists every ship of the faction with the models in the box, and only that faction', () => {
    expect(boxCounts('amarr')).toStrictEqual({ anathema: 5, malediction: 5, heretic: 5, zealot: 3, curse: 3, absolution: 3, redeemer: 2, paladin: 2 });
    for (const f of ['amarr', 'caldari', 'gallente', 'minmatar'] as const) {
      expect(boxCounts(f)).toStrictEqual(Object.fromEntries(shipsOf(f).map((s) => [s.id, s.qty])));
    }
  });

  it('fills the tray with the whole faction', () => {
    const items = trayItems('amarr', boxCounts('amarr'), [lead('zealot', 'medium')]);
    expect(items.map((i) => [i.ship.id, i.owned, i.left])).toStrictEqual([
      ['anathema', 5, 5],
      ['heretic', 5, 5],
      ['malediction', 5, 5],
      ['absolution', 3, 3],
      ['curse', 3, 3],
      ['zealot', 3, 2],
      ['paladin', 2, 2],
      ['redeemer', 2, 2],
    ]);
  });
});

describe('trayLeftText and trayOverText (the tray row counts)', () => {
  const item = (owned: Record<string, number>, placed: Placement[], id: string) => trayItems('amarr', owned, placed).find((i) => i.ship.id === id)!;

  it('counts my ships on the board in a full game', () => {
    expect(trayLeftText(item({ zealot: 3 }, [], 'zealot'), false)).toBe('3 of 3 left');
    expect(trayLeftText(item({ zealot: 3 }, [lead('zealot', 'medium')], 'zealot'), false)).toBe('2 of 3 left');
    expect(trayLeftText(item({ zealot: 1 }, [lead('zealot', 'medium')], 'zealot'), false)).toBe('All placed');
    const over = item({ zealot: 1 }, [lead('zealot', 'medium'), sup('zealot', 'medium')], 'zealot');
    expect(trayLeftText(over, false)).toBe('1 too many');
    expect(trayOverText(over, false)).toBe('Placed 2, you have 1');
  });

  it('counts the models in the box in a light game', () => {
    const box = boxCounts('amarr');
    expect(trayLeftText(item(box, [], 'zealot'), true)).toBe('3 in the box');
    expect(trayLeftText(item(box, [lead('zealot', 'medium')], 'zealot'), true)).toBe('2 of 3 in the box left');
    const all = [lead('redeemer', 'large'), sup('redeemer', 'large')];
    expect(trayLeftText(item(box, all, 'redeemer'), true)).toBe('All placed');
    const over = item(box, [...all, sup('redeemer', 'large')], 'redeemer');
    expect(trayLeftText(over, true)).toBe('1 too many');
    expect(trayOverText(over, true)).toBe('Placed 3, the box has 2');
  });
});

describe('placeShip and removePlacement', () => {
  it('puts a leader in place of the orbit leader (who goes back to the tray) and adds supports', () => {
    let p = placeShip([], 'heretic', 'small', 'leader');
    p = placeShip(p, 'anathema', 'small', 'support');
    p = placeShip(p, 'malediction', 'small', 'leader');
    p = placeShip(p, 'zealot', 'medium', 'leader');
    expect(p).toStrictEqual([lead('malediction', 'small'), sup('anathema', 'small'), lead('zealot', 'medium')]);
    expect(removePlacement(p, 1)).toStrictEqual([lead('malediction', 'small'), lead('zealot', 'medium')]);
    expect(removePlacement(p, 7)).toStrictEqual(p);
  });
});

describe('slotBlock', () => {
  const tray = trayItems('amarr', { anathema: 1, zealot: 1, heretic: 2 }, [lead('heretic', 'small')]);
  const item = (id: string) => tray.find((i) => i.ship.id === id) ?? null;
  const placed = [lead('heretic', 'small')];

  it('says why a slot cannot take the selected ship', () => {
    expect(slotBlock(null, 'small', 'support', placed)).toBe('Choose a ship in your tray first');
    expect(slotBlock(item('zealot'), 'small', 'leader', placed)).toBe('Zealot is a medium ship: it can only lead the medium orbit');
    expect(slotBlock(item('anathema'), 'medium', 'support', placed)).toBe('Place a leader in the medium orbit first');
  });

  it('allows a size-matched leader and a support where a leader is placed', () => {
    expect(slotBlock(item('zealot'), 'medium', 'leader', placed)).toBeNull();
    expect(slotBlock(item('anathema'), 'small', 'leader', placed)).toBeNull();
    expect(slotBlock(item('zealot'), 'small', 'support', placed)).toBeNull();
    expect(slotBlock(item('heretic'), 'small', 'support', placed)).toBeNull();
  });

  it('refuses a ship whose models are all placed', () => {
    const full = trayItems('amarr', { anathema: 1 }, [sup('anathema', 'small')]);
    expect(slotBlock(full[0]!, 'small', 'leader', [])).toBe('Every Anathema you have is placed');
    expect(slotBlock(full[0]!, 'small', 'leader', [], false)).toBe('Every Anathema you have is placed');
  });

  it('in a light game, says the box is used up', () => {
    const placed = [lead('redeemer', 'large'), sup('redeemer', 'large')];
    const redeemer = trayItems('amarr', boxCounts('amarr'), placed).find((i) => i.ship.id === 'redeemer')!;
    expect(slotBlock(redeemer, 'large', 'support', placed, true)).toBe('Every Redeemer in the box is placed');
  });
});

describe('firstSlot (scrolled into view when a ship is picked)', () => {
  it('is the free Leader slot of its size orbit, else that orbit’s Supports, else nothing', () => {
    const pick = (placed: Placement[], id: string) => trayItems('amarr', { zealot: 2, heretic: 1 }, placed).find((i) => i.ship.id === id)!;
    expect(firstSlot(pick([], 'zealot'), [])).toStrictEqual({ orbit: 'medium', role: 'leader' });
    const led = [lead('zealot', 'medium')];
    expect(firstSlot(pick(led, 'zealot'), led)).toStrictEqual({ orbit: 'medium', role: 'support' });
    const full = [lead('zealot', 'medium'), sup('zealot', 'medium')];
    expect(firstSlot(pick(full, 'zealot'), full)).toBeNull();
  });
});

describe('bandScroll (how far to scroll so a slot shows between the sticky bars)', () => {
  const band = { top: 194, bottom: 573 };
  it('is 0 when the slot is already inside the band', () => {
    expect(bandScroll({ top: 300, bottom: 348 }, band, 12)).toBe(0);
  });
  it('scrolls down to clear the footer, or up to clear the header, with a margin', () => {
    expect(bandScroll({ top: 579, bottom: 627 }, band, 12)).toBe(627 - 573 + 12);
    expect(bandScroll({ top: 150, bottom: 198 }, band, 12)).toBe(150 - 194 - 12);
  });
  it('aligns the top when the slot is taller than the band', () => {
    expect(bandScroll({ top: 600, bottom: 1100 }, band, 12)).toBe(600 - 194 - 12);
  });
});

describe('laneDrafts', () => {
  it('gives each orbit its leader and supports (with their draft index) and a status', () => {
    const p = [sup('anathema', 'small'), lead('zealot', 'medium'), sup('malediction', 'medium')];
    expect(laneDrafts(p)).toStrictEqual([
      { orbit: 'small', leader: null, supports: [{ index: 0, ship: 'anathema' }], status: 'orphaned' },
      { orbit: 'medium', leader: { index: 1, ship: 'zealot' }, supports: [{ index: 2, ship: 'malediction' }], status: 'ready' },
      { orbit: 'large', leader: null, supports: [], status: 'idle' },
    ]);
  });
});

describe('assignCommand and fleetHead', () => {
  it('is null for an empty fleet, else the placements as they are', () => {
    expect(assignCommand([])).toBeNull();
    const p = [lead('zealot', 'medium'), sup('anathema', 'medium')];
    expect(assignCommand(p)).toStrictEqual({ type: 'combatAssign', ships: p });
  });

  it('names the fleet size for the Confirm button', () => {
    expect(fleetHead([])).toBe('Confirm fleet');
    expect(fleetHead([lead('zealot', 'medium')])).toBe('Confirm fleet · 1 ship');
    expect(fleetHead([lead('zealot', 'medium'), sup('anathema', 'medium'), lead('heretic', 'small')])).toBe('Confirm fleet · 3 ships in 2 orbits');
  });
});

describe('sanitizeAssign', () => {
  it('keeps well-formed placements and drops the rest', () => {
    expect(sanitizeAssign(null)).toBeNull();
    expect(sanitizeAssign({ placements: 'x' })).toStrictEqual(EMPTY_ASSIGN);
    expect(
      sanitizeAssign({
        placements: [lead('zealot', 'medium'), { ship: 'nope', orbit: 'small', role: 'leader' }, { ship: 'anathema', orbit: 'huge', role: 'support' }, sup('anathema', 'medium'), 4],
      }),
    ).toStrictEqual({ placements: [lead('zealot', 'medium'), sup('anathema', 'medium')] });
  });
});

describe('issueSpot (where an engine placement error belongs)', () => {
  it('no_leader → the orbit (and ship) of the first unled support', () => {
    const p = [lead('zealot', 'medium'), sup('anathema', 'small')];
    const e = engineError({ zealot: 1, anathema: 1 }, p);
    expect(e.code).toBe('no_leader');
    expect(issueSpot(e.code, p, { zealot: 1, anathema: 1 })).toStrictEqual({ orbit: 'small', ship: 'anathema' });
  });

  it('not_owned → the ship placed more often than owned', () => {
    const p = [lead('zealot', 'medium'), sup('anathema', 'medium'), sup('anathema', 'medium')];
    const e = engineError({ zealot: 1, anathema: 1 }, p);
    expect(e.code).toBe('not_owned');
    expect(issueSpot(e.code, p, { zealot: 1, anathema: 1 })).toStrictEqual({ orbit: null, ship: 'anathema' });
  });

  it('no_models (a light game) → the ship placed more often than the box has', () => {
    const p = [lead('redeemer', 'large'), sup('redeemer', 'large'), sup('redeemer', 'large'), lead('zealot', 'medium')];
    const e = lightEngineError(p);
    expect([e.code, e.message]).toStrictEqual(['no_models', 'The box has 2 Redeemer']);
    expect(issueSpot(e.code, p, boxCounts('amarr'))).toStrictEqual({ orbit: null, ship: 'redeemer' });
  });

  it('bad_leader → the orbit with a wrong-size leader; two_leaders → the orbit led twice', () => {
    const wrong = [lead('zealot', 'small')];
    expect(engineError({ zealot: 1 }, wrong).code).toBe('bad_leader');
    expect(issueSpot('bad_leader', wrong, { zealot: 1 })).toStrictEqual({ orbit: 'small', ship: 'zealot' });
    const twice = [lead('heretic', 'small'), lead('anathema', 'small')];
    expect(engineError({ heretic: 1, anathema: 1 }, twice).code).toBe('two_leaders');
    expect(issueSpot('two_leaders', twice, { heretic: 1, anathema: 1 })).toStrictEqual({ orbit: 'small', ship: null });
  });

  it('anything else concerns the whole fleet', () => {
    expect(issueSpot('wait_attacker', [], {})).toStrictEqual({ orbit: null, ship: null });
  });
});

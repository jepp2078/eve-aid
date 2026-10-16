import { describe, expect, it } from 'vitest';
import { DEV } from '../../src/data/developments';
import type { Command } from '../../src/engine/types';
import { EMPTY_CONTENTS } from '../../src/ui/lib/ops';
import { upkeepPreview } from '../../src/engine/upkeep';
import {
  afterMining,
  breakthroughNote,
  defaultUpkeep,
  finalRanking,
  incomeBreakdown,
  miningText,
  mineralsAfter,
  raidOutcome,
  refineryLimits,
  researchBreakdown,
  researchLabState,
  roundSummary,
  sanitizeUpkeep,
  upkeepCommand,
  withOccupied,
  type UpkeepDraft,
} from '../../src/ui/lib/upkeep';
import { startedGame, type Table } from '../engine/helpers';

function inUpkeep(): Table {
  const t = startedGame(['amarr', 'caldari', 'gallente']);
  while (t.game.phase === 'actions') t.dispatch(t.game.turn!.faction, { type: 'pass' });
  return t;
}

describe('upkeep breakdowns', () => {
  it('income: base plus customs offices', () => {
    const t = startedGame(['amarr', 'caldari']);
    const p = t.p('amarr');
    expect(incomeBreakdown(p)).toBe('Income 4 = base 4');
    p.structures.customs = 2;
    expect(incomeBreakdown(p)).toBe('Income 8 = base 4 + 2×Customs 2');
    expect(upkeepPreview(p).income).toBe(8);
    p.completed.push(DEV.upgradedCustomsOffice);
    expect(incomeBreakdown(p)).toBe('Income 10 = base 4 + 2×Customs 3');
    expect(upkeepPreview(p).income).toBe(10);
  });

  it('research: base plus engineering complexes', () => {
    const t = startedGame(['amarr', 'caldari']);
    const p = t.p('amarr');
    expect(researchBreakdown(p)).toBe('Research 3 = base 3');
    p.structures.engineering = 1;
    expect(researchBreakdown(p)).toBe('Research 4 = base 3 + 1×Eng. Complex 1');
    expect(upkeepPreview(p).research).toBe(4);
    p.structures.engineering = 2;
    expect(researchBreakdown(p)).toBe('Research 5 = base 3 + 2×Eng. Complex 1');
    expect(upkeepPreview(p).research).toBe(5);
  });

  it('mining: one mineral per belt', () => {
    const t = startedGame(['amarr', 'caldari']);
    const p = t.p('amarr'); // pyrite belt from setup, 1 pyrite held
    expect(miningText(upkeepPreview(p))).toBe('+1 Pyrite');
    p.belts.morphite = 1;
    p.belts.pyrite = 2;
    expect(miningText(upkeepPreview(p))).toBe('+2 Pyrite, +1 Morphite');
    p.belts = { pyrite: 0, mexallon: 0, tritanium: 0, morphite: 0 };
    expect(miningText(upkeepPreview(p))).toBe('No asteroid belts');
  });
});

describe('Technological Breakthrough at the upkeep', () => {
  it('says it can go back face down after confirming, unless my confirm is the one that ends the upkeep', () => {
    const t = inUpkeep();
    expect(breakthroughNote(t.game, 'amarr', t.p('amarr'))).toBeNull();
    t.p('amarr').completed.push(DEV.technologicalBreakthrough);
    expect(breakthroughNote(t.game, 'amarr', t.p('amarr'))).toBe(
      'Technological Breakthrough: once you have confirmed, 3 of this research can turn it face down into your area (while the upkeep lasts).',
    );
    t.game.upkeep!.confirmed = ['caldari', 'gallente'];
    expect(breakthroughNote(t.game, 'amarr', t.p('amarr'))).toBe(
      'Technological Breakthrough: you confirm last, which ends the upkeep, so it can’t go back face down this time.',
    );
  });
});

describe('minerals after mining', () => {
  it('adds the belts to the holdings and counts what must be discarded', () => {
    const t = startedGame(['amarr', 'caldari']);
    const p = t.p('amarr');
    Object.assign(p.res, { pyrite: 6, mexallon: 5, morphite: 0 });
    p.belts = { pyrite: 2, mexallon: 0, tritanium: 0, morphite: 1 };
    const pre = upkeepPreview(p);
    expect(afterMining(p, pre)).toStrictEqual({ pyrite: 8, mexallon: 5, tritanium: 0, morphite: 1 });
    expect(mineralsAfter(p, pre, {})).toStrictEqual({ total: 14, over: 2 });
    expect(mineralsAfter(p, pre, { pyrite: 1, mexallon: 1 })).toStrictEqual({ total: 12, over: 0 });
  });
});

describe('the upkeep draft', () => {
  it('defaults the refinery to the most it gives', () => {
    const t = startedGame(['amarr', 'caldari']);
    const p = t.p('amarr');
    p.structures.refinery = 2;
    expect(defaultUpkeep(1, upkeepPreview(p)).refinery).toStrictEqual({ planetary: 2, moon: 0, convert: 0 });
    p.completed.push(DEV.upgradedRefinery);
    expect(defaultUpkeep(1, upkeepPreview(p))).toStrictEqual({
      round: 1,
      refinery: { planetary: 2, moon: 2, convert: 0 },
      discard: { pyrite: 0, mexallon: 0, tritanium: 0, morphite: 0 },
      raids: {},
      researchLab: false,
      occupied: EMPTY_CONTENTS,
    });
  });

  it('refinery limits: a shared total without the upgrade; each up to R and conversions from what you hold with it', () => {
    const t = startedGame(['amarr', 'caldari']);
    const p = t.p('amarr');
    p.structures.refinery = 3;
    expect(refineryLimits(p, upkeepPreview(p), { planetary: 1, moon: 0, convert: 0 })).toStrictEqual({ planetary: 3, moon: 2, convert: 0 });
    p.completed.push(DEV.upgradedRefinery);
    p.res.moon = 1;
    expect(refineryLimits(p, upkeepPreview(p), { planetary: 1, moon: 0, convert: 0 })).toStrictEqual({ planetary: 3, moon: 3, convert: 1 });
    expect(refineryLimits(p, upkeepPreview(p), { planetary: 3, moon: 3, convert: 0 })).toStrictEqual({ planetary: 3, moon: 3, convert: 3 });
  });

  it('Research Lab: offered with the card, possible with an engineering complex', () => {
    const t = startedGame(['amarr', 'caldari']);
    const p = t.p('amarr');
    expect(researchLabState(p)).toBe('none');
    p.completed.push(DEV.researchLab);
    expect(researchLabState(p)).toBe('needs_engineering');
    p.structures.engineering = 1;
    expect(researchLabState(p)).toBe('ok');
  });

  it('builds confirmUpkeep, leaving out zero discards and raids of strength 0', () => {
    const d: UpkeepDraft = {
      round: 1,
      refinery: { planetary: 1, moon: 0, convert: 0 },
      discard: { pyrite: 2, mexallon: 0, tritanium: 0, morphite: 0 },
      raids: { caldari: 4, gallente: 0 },
      researchLab: true,
      occupied: EMPTY_CONTENTS,
    };
    expect(upkeepCommand(d, true)).toStrictEqual({
      type: 'confirmUpkeep',
      refinery: { planetary: 1, moon: 0, convert: 0 },
      discard: { pyrite: 2 },
      raids: [{ target: 'caldari', strength: 4 }],
      researchLab: true,
    });
    expect(upkeepCommand(d, false)).toMatchObject({ researchLab: false });
  });

  it('is accepted by the engine', () => {
    const t = inUpkeep();
    const p = t.p('amarr');
    p.structures.refinery = 1;
    const d = { ...defaultUpkeep(1, upkeepPreview(p)), raids: { caldari: 3 } };
    t.dispatch('amarr', upkeepCommand(d, false) as Command);
    expect(t.game.upkeep?.raids).toStrictEqual([{ raider: 'amarr', target: 'caldari', strength: 3 }]);
    expect(t.p('amarr').res.planetary).toBe(1);
  });

  it('restores a stored draft only when it is well-formed', () => {
    const d: UpkeepDraft = {
      round: 2,
      refinery: { planetary: 1, moon: 1, convert: 0 },
      discard: { pyrite: 1, mexallon: 0, tritanium: 0, morphite: 0 },
      raids: { caldari: 3 },
      researchLab: true,
      occupied: { ...EMPTY_CONTENTS, belts: { ...EMPTY_CONTENTS.belts, pyrite: 1 } },
    };
    expect(sanitizeUpkeep(JSON.parse(JSON.stringify(d)))).toStrictEqual(d);
    expect(sanitizeUpkeep({ ...d, raids: { jove: 3 } })).toBeNull();
    expect(sanitizeUpkeep({ ...d, refinery: { planetary: -1, moon: 0, convert: 0 } })).toBeNull();
    expect(sanitizeUpkeep({ ...d, discard: { pyrite: 1 } })).toBeNull();
    expect(sanitizeUpkeep({ ...d, round: '2' })).toBeNull();
    // a draft stored before occupied systems existed starts with nothing occupied
    const { occupied: _gone, ...old } = d;
    expect(sanitizeUpkeep(old)?.occupied).toStrictEqual(EMPTY_CONTENTS);
  });

  it('occupied belts and structures lower the numbers, and leave the confirm out when nothing is occupied', () => {
    const t = inUpkeep();
    const p = t.p('amarr');
    p.belts = { pyrite: 2, mexallon: 1, tritanium: 0, morphite: 0 };
    p.structures = { engineering: 2, citadel: 0, customs: 1, refinery: 2 };
    p.completed.push(DEV.researchLab);
    const base = defaultUpkeep(1, upkeepPreview(p));
    expect(upkeepCommand(base, true)).not.toHaveProperty('occupied');
    const occupied = {
      belts: { ...EMPTY_CONTENTS.belts, pyrite: 1 },
      structures: { ...EMPTY_CONTENTS.structures, engineering: 2, refinery: 2, customs: 1 },
    };
    const d = withOccupied(base, p, occupied);
    expect(d.refinery).toStrictEqual({ planetary: 0, moon: 0, convert: 0 }); // both refineries occupied
    expect(researchLabState(p, occupied)).toBe('needs_engineering');
    expect(incomeBreakdown(p, occupied)).toBe('Income 4 = base 4');
    expect(researchBreakdown(p, occupied)).toBe('Research 3 = base 3');
    expect(miningText(upkeepPreview(p, { belts: { pyrite: 1 }, structures: {} }))).toBe('+1 Pyrite, +1 Mexallon');
    const cmd = upkeepCommand(d, false);
    expect(cmd).toMatchObject({ occupied: { belts: { pyrite: 1 }, structures: { engineering: 2, customs: 1, refinery: 2 } } });
    t.dispatch('amarr', cmd as Command);
    expect(t.p('amarr').res.pyrite).toBe(1 + 1); // 1 from the start + the one working belt
  });
});

describe('raid outcomes', () => {
  it('a raid succeeds when its strength beats the home defence', () => {
    const t = startedGame(['amarr', 'caldari']);
    const target = t.p('caldari');
    target.homeCitadels = 1; // defence 3
    target.vp = 2;
    expect(raidOutcome(target, 0)).toStrictEqual({ kind: 'none', text: 'No raid · defence 3' });
    expect(raidOutcome(target, 3)).toStrictEqual({ kind: 'fail', text: 'Fails: strength 3 against defence 3 (needs 4+)' });
    expect(raidOutcome(target, 4)).toStrictEqual({ kind: 'win', text: 'Succeeds: strength 4 against defence 3 · steal 1 VP' });
    target.vp = 0;
    expect(raidOutcome(target, 4)).toStrictEqual({ kind: 'win', text: 'Succeeds: strength 4 against defence 3 · they have no VP to steal' });
    target.completed.push(DEV.upgradedCitadel);
    expect(raidOutcome(target, 4).kind).toBe('fail');
  });
});

describe('round summary', () => {
  it('names the new round, the first player and the VP that changed in the upkeep', () => {
    const t = inUpkeep();
    t.p('amarr').systems = 5;
    t.dispatch('amarr', { type: 'confirmUpkeep', refinery: { planetary: 0, moon: 0, convert: 0 }, discard: {}, raids: [], researchLab: false });
    t.dispatch('caldari', { type: 'confirmUpkeep', refinery: { planetary: 0, moon: 0, convert: 0 }, discard: {}, raids: [], researchLab: false });
    const before = t.game;
    t.dispatch('gallente', { type: 'confirmUpkeep', refinery: { planetary: 0, moon: 0, convert: 0 }, discard: {}, raids: [], researchLab: false });
    // Amarr: 5 systems (+1) and the most systems (+1).
    expect(roundSummary(before, t.game)).toBe('Round 2 begins · Caldari is first player · VP: Amarr +2');
  });

  it('without VP changes, and in the final round', () => {
    const t = inUpkeep();
    const before = structuredClone(t.game);
    const after = structuredClone(t.game);
    after.phase = 'actions';
    after.round = 2;
    after.firstPlayer = 'caldari';
    expect(roundSummary(before, after)).toBe('Round 2 begins · Caldari is first player');
    after.verge = { by: 'amarr', finalRound: 2, emergencyPending: false };
    expect(roundSummary(before, after)).toBe('Round 2 begins · Caldari is first player · Final round');
  });

  it('announces the end of the game', () => {
    const t = inUpkeep();
    const before = structuredClone(t.game);
    const after = structuredClone(t.game);
    after.phase = 'ended';
    after.result = { ranking: ['gallente', 'amarr', 'caldari'], winners: ['gallente'] };
    expect(roundSummary(before, after)).toBe('Game over: Gallente wins');
    after.result = { ranking: ['gallente', 'amarr', 'caldari'], winners: ['gallente', 'amarr'] };
    expect(roundSummary(before, after)).toBe('Game over: Gallente and Amarr share the victory');
  });

  it('is silent for anything but the end of an upkeep', () => {
    const t = inUpkeep();
    const g = t.game;
    expect(roundSummary(g, g)).toBeNull();
    const back = structuredClone(g);
    const fwd = structuredClone(g);
    back.phase = 'actions';
    expect(roundSummary(back, fwd)).toBeNull(); // actions → upkeep
  });
});

describe('final ranking', () => {
  it('lists places with the tie-break values, sharing a place on a full tie', () => {
    const t = startedGame(['amarr', 'caldari', 'gallente']);
    Object.assign(t.p('amarr'), { vp: 10, systems: 3 });
    Object.assign(t.p('caldari'), { vp: 10, systems: 3 });
    Object.assign(t.p('gallente'), { vp: 10, systems: 1 });
    t.game.phase = 'ended';
    t.game.result = { ranking: ['amarr', 'caldari', 'gallente'], winners: ['amarr', 'caldari'] };
    // Starting fleets: two small ships each → strength 2.
    expect(finalRanking(t.game)).toStrictEqual([
      { faction: 'amarr', name: 'Ana', place: 1, vp: 10, systems: 3, strength: 2, winner: true },
      { faction: 'caldari', name: 'Cal', place: 1, vp: 10, systems: 3, strength: 2, winner: true },
      { faction: 'gallente', name: 'Gil', place: 3, vp: 10, systems: 1, strength: 2, winner: false },
    ]);
  });

  it('has no strength in a light game (it keeps no ships), sharing a place on a tie in VP and systems', () => {
    const t = startedGame(['amarr', 'caldari', 'gallente'], { mode: 'light' });
    Object.assign(t.p('amarr'), { vp: 10, systems: 3 });
    Object.assign(t.p('caldari'), { vp: 10, systems: 3 });
    Object.assign(t.p('gallente'), { vp: 12, systems: 1 });
    t.game.phase = 'ended';
    t.game.result = { ranking: ['gallente', 'amarr', 'caldari'], winners: ['gallente'] };
    expect(finalRanking(t.game)).toStrictEqual([
      { faction: 'gallente', name: 'Gil', place: 1, vp: 12, systems: 1, strength: null, winner: true },
      { faction: 'amarr', name: 'Ana', place: 2, vp: 10, systems: 3, strength: null, winner: false },
      { faction: 'caldari', name: 'Cal', place: 2, vp: 10, systems: 3, strength: null, winner: false },
    ]);
  });

  it('is empty without a result', () => {
    expect(finalRanking(startedGame(['amarr', 'caldari']).game)).toStrictEqual([]);
  });
});

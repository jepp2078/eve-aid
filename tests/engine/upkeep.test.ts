import { describe, expect, it } from 'vitest';
import { DEV } from '../../src/data/developments';
import type { FactionId, Mineral } from '../../src/data/types';
import { apply } from '../../src/engine/apply';
import { isError, type AdjustDelta, type ApplyResult, type Command, type GameState, type RuleError, type SystemContents } from '../../src/engine/types';
import { checkVerge, endGame, incomeParts, researchParts, startUpkeep, upkeepPreview } from '../../src/engine/upkeep';
import { gainVP, type Out } from '../../src/engine/util';
import { NOW, startedGame, uidOf, type Table } from './helpers';

/** Manual p. 24: where a raiding fleet goes, and what happens when it has nowhere to go. */
const raidText = (target: string): string =>
  `Raid on ${target}: move your raiding fleet from ${target}'s home system to an adjacent system that is explored, not a home system, not controlled by another player and free of enemy ships (no exhausted token). If there is none it is destroyed: draw 1 event per full 3 of its strength (reparations)`;

const move: Command = { type: 'action', action: 'move' };
const endTurn: Command = { type: 'endTurn' };
const pass: Command = { type: 'pass' };

interface ConfirmOpts {
  refinery?: { planetary: number; moon: number; convert: number };
  discard?: Partial<Record<Mineral, number>>;
  raids?: { target: FactionId; strength: number }[];
  researchLab?: boolean;
  occupied?: SystemContents;
}
const confirm = (o: ConfirmOpts = {}): Command => ({
  type: 'confirmUpkeep',
  refinery: o.refinery ?? { planetary: 0, moon: 0, convert: 0 },
  discard: o.discard ?? {},
  raids: o.raids ?? [],
  researchLab: o.researchLab ?? false,
  ...(o.occupied ? { occupied: o.occupied } : {}),
});
const refine = (planetary: number, moon: number, convert = 0): ConfirmOpts => ({ refinery: { planetary, moon, convert } });
const mission = (vp: number): Command => ({ type: 'missionComplete', vp });
const correction = (vp: number): Command => {
  const delta: AdjustDelta = {
    res: {}, vp, systems: 0, homeCitadels: 0, lockedHomeBelts: 0, structures: {}, belts: {}, ships: {}, central: null,
  };
  return { type: 'adjust', delta, correction: true, reason: 'miscounted' };
};

const newOut = (): Out => ({ lines: [], notices: [] });
const lines = (t: Table): string[] => t.last?.lines ?? [];
const give = (t: Table, f: FactionId, dev: string): void => {
  t.p(f).completed.push(dev);
};
/** Reads the phase through a function so TS does not narrow it from an earlier assertion. */
const phaseOf = (g: GameState): GameState['phase'] => g.phase;

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

/** Everyone passes in turn order (from the turn holder), which starts the normal upkeep. */
function passAll(t: Table): void {
  while (t.game.phase === 'actions') {
    const f = t.game.turn?.faction;
    if (f === undefined) throw new Error('no turn holder');
    t.dispatch(f, pass);
  }
  expect(t.game.phase).toBe('upkeep');
}

/** A started game already in its round-1 upkeep (Amarr first player). */
function inUpkeep(factions: FactionId[] = ['amarr', 'caldari', 'gallente']): Table {
  const t = startedGame(factions);
  passAll(t);
  return t;
}

/** Every seated faction that has not confirmed yet confirms with no choices, in seat order. */
function confirmRest(t: Table): void {
  for (const f of t.game.seats) {
    if (t.game.phase === 'upkeep' && !t.game.upkeep?.confirmed.includes(f)) t.dispatch(f, confirm());
  }
}

/** Blank mineral holdings so mining results are easy to read. */
function noMinerals(t: Table, f: FactionId): void {
  Object.assign(t.p(f).res, { pyrite: 0, mexallon: 0, tritanium: 0, morphite: 0 });
}

// ---------------------------------------------------------------------------------------------------------------

describe('upkeepPreview', () => {
  it('mines one mineral per belt, pays 4 + 2 per customs office and researches 3 + 1 per engineering complex', () => {
    const t = startedGame(['amarr', 'caldari']);
    const p = t.p('amarr');
    p.belts = { pyrite: 2, mexallon: 0, tritanium: 0, morphite: 1 };
    p.structures.customs = 1;
    p.structures.engineering = 1;
    expect(upkeepPreview(p)).toStrictEqual({
      minerals: { pyrite: 2, mexallon: 0, tritanium: 0, morphite: 1 },
      income: 6,
      research: 4,
      refineries: 0,
      upgradedRefinery: false,
    });
  });

  it('pays 3 per customs office with Upgraded Customs Office and reports refineries', () => {
    const t = startedGame(['amarr', 'caldari']);
    const p = t.p('amarr');
    p.structures.customs = 1;
    p.structures.refinery = 2;
    give(t, 'amarr', DEV.upgradedCustomsOffice);
    give(t, 'amarr', DEV.upgradedRefinery);
    const preview = upkeepPreview(p);
    expect(preview.income).toBe(7);
    expect(preview.refineries).toBe(2);
    expect(preview.upgradedRefinery).toBe(true);
  });

  it('says what makes up the income and the research (the parts the Panel explains)', () => {
    const t = startedGame(['amarr', 'caldari']);
    const p = t.p('amarr');
    p.structures.customs = 2;
    p.structures.engineering = 1;
    expect(incomeParts(p)).toStrictEqual({ base: 4, structures: 2, each: 2 });
    expect(researchParts(p)).toStrictEqual({ base: 3, structures: 1, each: 1 });
    give(t, 'amarr', DEV.upgradedCustomsOffice);
    expect(incomeParts(p)).toStrictEqual({ base: 4, structures: 2, each: 3 });
    expect(upkeepPreview(p).income).toBe(10);
  });

  it('is pure and returns a fresh minerals record', () => {
    const t = startedGame(['amarr', 'caldari']);
    const p = t.p('amarr');
    const before = structuredClone(p);
    const preview = upkeepPreview(p);
    preview.minerals.pyrite = 99;
    expect(p).toStrictEqual(before);
  });
});

describe('startUpkeep', () => {
  it('opens the upkeep with no turn holder and tells everyone to confirm on their device', () => {
    const t = startedGame(['amarr', 'caldari']);
    const out = newOut();
    startUpkeep(t.game, false, out);
    expect(t.game.phase).toBe('upkeep');
    expect(t.game.turn).toBeNull();
    expect(t.game.upkeep).toStrictEqual({ emergency: false, confirmed: [], raids: [], largeShips: [] });
    expect(out.notices).toStrictEqual([{ to: 'all', text: 'Upkeep: confirm your upkeep on your device', kind: 'info' }]);
  });

  it('an emergency upkeep clears the pending emergency', () => {
    const t = startedGame(['amarr', 'caldari']);
    t.game.verge = { by: 'caldari', finalRound: 2, emergencyPending: true };
    const out = newOut();
    startUpkeep(t.game, true, out);
    expect(t.game.upkeep).toStrictEqual({ emergency: true, confirmed: [], raids: [], largeShips: [] });
    expect(t.game.verge).toStrictEqual({ by: 'caldari', finalRound: 2, emergencyPending: false });
    expect(out.notices).toStrictEqual([
      { to: 'all', text: 'Emergency upkeep (Verge of Ascendancy, no domination): confirm your upkeep on your device', kind: 'info' },
    ]);
  });
});

describe('confirmUpkeep', () => {
  it('mines, collects income and adds research to the private doc', () => {
    const t = inUpkeep();
    const p = t.p('amarr');
    noMinerals(t, 'amarr');
    p.belts = { pyrite: 2, mexallon: 0, tritanium: 0, morphite: 1 };
    p.structures.customs = 1;
    p.structures.engineering = 1;
    t.dispatch('amarr', confirm());
    expect(t.p('amarr').res).toStrictEqual({
      isk: 10, pyrite: 2, mexallon: 0, tritanium: 0, morphite: 1, planetary: 0, moon: 0, component: 0,
    });
    expect(t.privs.amarr.pendingResearch).toBe(4);
    expect(t.privs.amarr.pendingCards).toBe(0);
    expect(t.game.upkeep).toStrictEqual({ emergency: false, confirmed: ['amarr'], raids: [], largeShips: [] });
    expect(t.game.phase).toBe('upkeep');
    expect(lines(t)).toStrictEqual([
      'Amarr confirmed upkeep: mined 2 pyrite and 1 morphite, 6 ISK income, 4 research',
    ]);
  });

  it('pays 3 ISK per customs office with Upgraded Customs Office', () => {
    const t = inUpkeep();
    t.p('amarr').structures.customs = 2;
    give(t, 'amarr', DEV.upgradedCustomsOffice);
    t.dispatch('amarr', confirm());
    expect(t.p('amarr').res.isk).toBe(4 + 4 + 6);
  });

  describe('occupied systems (manual p. 15)', () => {
    const setup = (): Table => {
      const t = inUpkeep();
      const p = t.p('amarr');
      Object.assign(p.res, { isk: 0, pyrite: 0, mexallon: 0, tritanium: 0, morphite: 0, planetary: 0, moon: 0 });
      p.belts = { pyrite: 2, mexallon: 1, tritanium: 0, morphite: 0 };
      p.structures = { engineering: 2, citadel: 0, customs: 2, refinery: 2 };
      return t;
    };

    it('lowers mining, income, research and refinery output in the preview', () => {
      const p = setup().p('amarr');
      const occ: SystemContents = { belts: { pyrite: 1 }, structures: { customs: 1, engineering: 2, refinery: 1 } };
      const pre = upkeepPreview(p, occ);
      expect(pre.minerals).toStrictEqual({ pyrite: 1, mexallon: 1, tritanium: 0, morphite: 0 });
      expect(pre.income).toBe(4 + 2);
      expect(pre.research).toBe(3);
      expect(pre.refineries).toBe(1);
      expect(incomeParts(p, occ)).toStrictEqual({ base: 4, structures: 1, each: 2 });
      expect(researchParts(p, occ)).toStrictEqual({ base: 3, structures: 0, each: 1 });
      expect(upkeepPreview(p)).toStrictEqual(upkeepPreview(p, { belts: {}, structures: {} }));
    });

    it('applies it on confirm: only the working belts and structures pay', () => {
      const t = setup();
      t.dispatch('amarr', confirm({ ...refine(1, 0), occupied: { belts: { pyrite: 1, mexallon: 1 }, structures: { customs: 1, engineering: 1, refinery: 1 } } }));
      expect(t.p('amarr').res).toMatchObject({ pyrite: 1, mexallon: 0, isk: 4 + 2, planetary: 1 });
      expect(t.privs.amarr.pendingResearch).toBe(3 + 1);
      expect(lines(t)[0]).toBe('Amarr confirmed upkeep: occupied: 1 pyrite belt, 1 mexallon belt, 1 Engineering Complex, 1 Customs Office, 1 Refinery, mined 1 pyrite, refined 1 planetary, 6 ISK income, 4 research');
    });

    it('limits the refinery picks to the working refineries', () => {
      const t = setup();
      expectRejected(t, 'amarr', confirm({ ...refine(2, 0), occupied: { belts: {}, structures: { refinery: 1 } } }), 'bad_refinery');
    });

    it('refuses more occupied than owned, and structures that pay nothing', () => {
      const t = setup();
      expectRejected(t, 'amarr', confirm({ occupied: { belts: { pyrite: 3 }, structures: {} } }), 'bad_occupied');
      expectRejected(t, 'amarr', confirm({ occupied: { belts: {}, structures: { customs: 3 } } }), 'bad_occupied');
      expectRejected(t, 'amarr', confirm({ occupied: { belts: {}, structures: { citadel: 1 } } }), 'bad_occupied');
      expectRejected(t, 'amarr', confirm({ occupied: { belts: { gold: 1 } as never, structures: {} } }), 'bad_contents');
    });

    it('an occupied engineering complex does not support the Research Lab', () => {
      const t = setup();
      t.p('amarr').completed.push(DEV.researchLab);
      t.p('amarr').structures.engineering = 1;
      expectRejected(t, 'amarr', confirm({ researchLab: true, occupied: { belts: {}, structures: { engineering: 1 } } }), 'bad_research_lab');
      t.dispatch('amarr', confirm({ researchLab: true }));
      expect(t.privs.amarr.pendingCards).toBe(1);
    });
  });

  it('caps ISK at 49 and logs the loss', () => {
    const t = inUpkeep();
    t.p('amarr').res.isk = 47;
    t.dispatch('amarr', confirm());
    expect(t.p('amarr').res.isk).toBe(49);
    expect(lines(t)).toContain('ISK capped at 49 (2 lost)');
  });

  it('refuses mining past 12 minerals without a discard (mineral_cap), and accepts the discard that fixes it', () => {
    const t = inUpkeep();
    Object.assign(t.p('amarr').res, { pyrite: 5, mexallon: 4, tritanium: 3, morphite: 0 }); // 12, belt: 1 pyrite
    expectRejected(t, 'amarr', confirm(), 'mineral_cap');
    t.dispatch('amarr', confirm({ discard: { tritanium: 1 } }));
    expect(t.p('amarr').res).toMatchObject({ pyrite: 6, mexallon: 4, tritanium: 2, morphite: 0 });
    expect(lines(t)[0]).toBe('Amarr confirmed upkeep: mined 1 pyrite, discarded 1 tritanium, 4 ISK income, 3 research');
  });

  it('counts morphite toward the cap and may discard what was just mined', () => {
    const t = inUpkeep();
    const p = t.p('amarr');
    Object.assign(p.res, { pyrite: 0, mexallon: 0, tritanium: 0, morphite: 12 });
    p.belts = { pyrite: 0, mexallon: 0, tritanium: 0, morphite: 1 };
    expectRejected(t, 'amarr', confirm(), 'mineral_cap');
    t.dispatch('amarr', confirm({ discard: { morphite: 1 } }));
    expect(t.p('amarr').res.morphite).toBe(12);
  });

  it('rejects discards it cannot make', () => {
    const t = inUpkeep();
    noMinerals(t, 'amarr'); // mines 1 pyrite
    expectRejected(t, 'amarr', confirm({ discard: { pyrite: 2 } }), 'insufficient');
    expectRejected(t, 'amarr', confirm({ discard: { gold: 1 } as Partial<Record<Mineral, number>> }), 'bad_mineral');
    expectRejected(t, 'amarr', confirm({ discard: { pyrite: -1 } }), 'bad_amount');
    expectRejected(t, 'amarr', confirm({ discard: { pyrite: 0.5 } }), 'bad_amount');
  });

  describe('refinery', () => {
    it('without Upgraded Refinery picks planetary or moon materials, one per refinery', () => {
      const t = inUpkeep();
      t.p('amarr').structures.refinery = 2;
      expectRejected(t, 'amarr', confirm(refine(2, 1)), 'bad_refinery');
      expectRejected(t, 'amarr', confirm(refine(0, 3)), 'bad_refinery');
      expectRejected(t, 'amarr', confirm(refine(1, 1, 1)), 'bad_refinery'); // conversion needs the upgrade
      t.dispatch('amarr', confirm(refine(1, 1)));
      expect(t.p('amarr').res).toMatchObject({ planetary: 1, moon: 1, component: 0 });
      expect(lines(t)[0]).toContain('refined 1 planetary and 1 moon');
    });

    it('with no refinery takes nothing', () => {
      const t = inUpkeep();
      expectRejected(t, 'amarr', confirm(refine(1, 0)), 'bad_refinery');
    });

    it('rejects negative, fractional or missing refinery counts', () => {
      const t = inUpkeep();
      t.p('amarr').structures.refinery = 2;
      expectRejected(t, 'amarr', confirm(refine(-1, 0)), 'bad_refinery');
      expectRejected(t, 'amarr', confirm(refine(0.5, 0)), 'bad_refinery');
      const missing = { ...confirm(), refinery: null } as unknown as Command;
      expectRejected(t, 'amarr', missing, 'bad_refinery');
    });

    it('with Upgraded Refinery takes both per refinery and converts 1 planetary + 1 moon into a component', () => {
      const t = inUpkeep();
      t.p('amarr').structures.refinery = 1;
      give(t, 'amarr', DEV.upgradedRefinery);
      expectRejected(t, 'amarr', confirm(refine(2, 0)), 'bad_refinery');
      expectRejected(t, 'amarr', confirm(refine(1, 1, 2)), 'bad_refinery');
      t.dispatch('amarr', confirm(refine(1, 1, 1)));
      expect(t.p('amarr').res).toMatchObject({ planetary: 0, moon: 0, component: 1 });
      expect(lines(t)[0]).toContain('refined 1 planetary and 1 moon, converted 1 planetary + 1 moon into 1 component');
    });

    it('converts only what the player holds after this upkeep', () => {
      const t = inUpkeep();
      t.p('amarr').structures.refinery = 2;
      give(t, 'amarr', DEV.upgradedRefinery);
      t.p('amarr').res.moon = 1;
      expectRejected(t, 'amarr', confirm(refine(1, 0, 2)), 'bad_refinery'); // 1 planetary, 1 moon
      t.dispatch('amarr', confirm(refine(2, 1, 2))); // 2 planetary, 2 moon
      expect(t.p('amarr').res).toMatchObject({ planetary: 0, moon: 0, component: 2 });
    });
  });

  it('Research Lab adds a pending card, but needs the development and an engineering complex', () => {
    const t = inUpkeep();
    expectRejected(t, 'amarr', confirm({ researchLab: true }), 'bad_research_lab');
    give(t, 'amarr', DEV.researchLab);
    expectRejected(t, 'amarr', confirm({ researchLab: true }), 'bad_research_lab');
    t.p('amarr').structures.engineering = 1;
    t.dispatch('amarr', confirm({ researchLab: true }));
    expect(t.privs.amarr.pendingCards).toBe(1);
    expect(t.privs.amarr.pendingResearch).toBe(4);
    expect(lines(t)[0]).toContain('a Research Lab card');
  });

  it('stores raid declarations', () => {
    const t = inUpkeep();
    t.dispatch('amarr', confirm({ raids: [{ target: 'caldari', strength: 4 }, { target: 'gallente', strength: 1 }] }));
    expect(t.game.upkeep?.raids).toStrictEqual([
      { raider: 'amarr', target: 'caldari', strength: 4 },
      { raider: 'amarr', target: 'gallente', strength: 1 },
    ]);
    expect(lines(t)[0]).toContain('raids Caldari (strength 4) and Gallente (strength 1)');
  });

  it('rejects raids on yourself, strangers, the same target twice, or with a strength that is not a positive whole number', () => {
    const t = inUpkeep();
    const raid = (target: FactionId, strength: number) => ({ target, strength });
    expectRejected(t, 'amarr', confirm({ raids: [raid('amarr', 3)] }), 'bad_raid');
    expectRejected(t, 'amarr', confirm({ raids: [raid('minmatar', 3)] }), 'bad_raid');
    expectRejected(t, 'amarr', confirm({ raids: [raid('__proto__' as FactionId, 3)] }), 'bad_raid');
    expectRejected(t, 'amarr', confirm({ raids: [raid('caldari', 3), raid('caldari', 4)] }), 'bad_raid');
    expectRejected(t, 'amarr', confirm({ raids: [raid('caldari', 0)] }), 'bad_raid');
    expectRejected(t, 'amarr', confirm({ raids: [raid('caldari', 2.5)] }), 'bad_raid');
    expectRejected(t, 'amarr', { ...confirm(), raids: null } as unknown as Command, 'bad_raid');
  });

  it('rejects a second confirm from the same player', () => {
    const t = inUpkeep();
    t.dispatch('amarr', confirm());
    expectRejected(t, 'amarr', confirm(), 'already_confirmed');
  });

  it('only works in the upkeep phase, for a seated player', () => {
    const t = startedGame(['amarr', 'caldari']);
    expectRejected(t, 'amarr', confirm(), 'wrong_phase');
    passAll(t);
    expect(codeOf(t.tryAsUid('uid-stranger', confirm()))).toBe('not_seated');
  });

  it('keeps every confirm all or nothing: a bad raid undoes the mining and income', () => {
    const t = inUpkeep();
    t.p('amarr').structures.refinery = 1;
    expectRejected(t, 'amarr', confirm({ ...refine(1, 0), raids: [{ target: 'amarr', strength: 9 }] }), 'bad_raid');
  });
});

describe('finalizeUpkeep', () => {
  it('runs when the last player confirms: next round, first player rotates, cubes, slots, passes and taps reset', () => {
    const t = startedGame(['amarr', 'caldari', 'gallente']);
    t.dispatch('amarr', move);
    t.dispatch('amarr', endTurn);
    passAll(t);
    for (const f of ['amarr', 'caldari', 'gallente'] as const) t.p(f).tapped = [DEV.galacticTrustFund];
    t.game.retreatsThisRound = ['amarr'];
    t.dispatch('amarr', confirm());
    t.dispatch('caldari', confirm());
    expect(t.game.phase).toBe('upkeep');

    const before = structuredClone(t.game);
    t.dispatch('gallente', confirm());
    const expected = structuredClone(before);
    expected.phase = 'actions';
    expected.round = 2;
    expected.firstPlayer = 'caldari';
    expected.turn = { faction: 'caldari', actionTaken: null, deployable: false };
    expected.upkeep = null;
    expected.retreatsThisRound = [];
    for (const f of ['amarr', 'caldari', 'gallente'] as const) {
      const p = expected.players[f]!;
      p.cubesUsed = 0;
      p.slots = { move: 0, claim: 0, extract: 0, manufacture: 0, trade: 0, build: 0, research: 0 };
      p.passed = false;
      p.tapped = [];
    }
    // Gallente's own upkeep (mined 1 tritanium, 4 income) lands in the same command.
    expected.players.gallente!.res.tritanium += 1;
    expected.players.gallente!.res.isk += 4;
    expect(t.game).toStrictEqual(expected);
    expect(lines(t)).toContain('Round 2 begins: Cal (Caldari) is first player and takes the first turn');
    // Keyed: on the checklist it replaces the previous round's token to-do.
    expect(t.last?.notices).toContainEqual({ to: 'all', text: 'Round 2: pass the first player token to Caldari', kind: 'todo', key: 'firstPlayer' });
  });

  it('domination: +1 each with 5+ systems, +1 more for the sole most, +1 for the central system', () => {
    const t = inUpkeep();
    t.p('amarr').systems = 6;
    t.p('caldari').systems = 5;
    t.p('gallente').systems = 4;
    t.p('gallente').central = true;
    confirmRest(t);
    expect([t.p('amarr').vp, t.p('caldari').vp, t.p('gallente').vp]).toStrictEqual([2, 1, 1]);
    expect(lines(t)).toEqual(expect.arrayContaining([
      'Domination: Amarr controls 6 systems',
      'Domination: Caldari controls 5 systems',
      'Domination: Amarr controls the most systems',
      'Domination: Gallente holds the central system',
    ]));
  });

  it('domination in a 2-player game: the central-system VP goes to the holder of the most tier 3 systems', () => {
    const t = inUpkeep(['amarr', 'caldari']);
    t.p('caldari').central = true;
    confirmRest(t);
    expect([t.p('amarr').vp, t.p('caldari').vp]).toStrictEqual([0, 1]);
    expect(lines(t)).toContain('Domination: Caldari controls the most tier 3 systems');
  });

  it('domination: a tie for the most gives no "most" VP', () => {
    const t = inUpkeep();
    t.p('amarr').systems = 5;
    t.p('caldari').systems = 5;
    confirmRest(t);
    expect([t.p('amarr').vp, t.p('caldari').vp, t.p('gallente').vp]).toStrictEqual([1, 1, 0]);
  });

  it('domination: the most systems below 5 scores nothing', () => {
    const t = inUpkeep();
    t.p('amarr').systems = 4;
    confirmRest(t);
    expect(t.p('amarr').vp).toBe(0);
  });

  it('domination pays Lobbyist holders like any other VP gain', () => {
    const t = inUpkeep();
    t.p('amarr').systems = 5;
    give(t, 'caldari', DEV.lobbyist);
    confirmRest(t);
    expect(t.p('caldari').res.isk).toBe(4 + 4 + 2); // Amarr: 5+ systems and the most, 1 VP each
  });

  it('Fleet Supremacy: +1 VP with at least one large ship', () => {
    const t = inUpkeep();
    give(t, 'amarr', DEV.fleetSupremacy);
    give(t, 'caldari', DEV.fleetSupremacy);
    t.p('amarr').ships.redeemer = 1;
    t.p('caldari').ships.cerberus = 2; // medium only
    confirmRest(t);
    expect(t.p('amarr').vp).toBe(1);
    expect(t.p('caldari').vp).toBe(0);
    expect(lines(t)).toContain('Fleet Supremacy: Amarr has a large ship');
  });

  it('an emergency upkeep skips domination but still scores Fleet Supremacy', () => {
    const t = startedGame(['amarr', 'caldari', 'gallente']);
    t.game.verge = { by: 'caldari', finalRound: 2, emergencyPending: true };
    t.dispatch('amarr', move);
    t.dispatch('amarr', endTurn);
    expect(t.game.upkeep?.emergency).toBe(true);
    t.p('amarr').systems = 7;
    t.p('amarr').central = true;
    give(t, 'gallente', DEV.fleetSupremacy);
    t.p('gallente').ships.sin = 1;
    confirmRest(t);
    expect(t.p('amarr').vp).toBe(0);
    expect(t.p('gallente').vp).toBe(1);
    expect(t.game.phase).toBe('actions');
    expect(t.game.round).toBe(2);
  });

  describe('raids', () => {
    it('strength 3 against a home with 1 citadel (strength 3) fails; strength 4 succeeds and steals 1 VP', () => {
      const t = inUpkeep();
      t.p('caldari').homeCitadels = 1;
      t.p('caldari').vp = 2;
      t.p('gallente').homeCitadels = 1;
      t.p('gallente').vp = 2;
      t.dispatch('amarr', confirm({ raids: [{ target: 'caldari', strength: 3 }, { target: 'gallente', strength: 4 }] }));
      confirmRest(t);
      expect([t.p('amarr').vp, t.p('caldari').vp, t.p('gallente').vp]).toStrictEqual([1, 2, 1]);
      expect(lines(t)).toEqual(expect.arrayContaining([
        "Amarr's raid on Caldari fails (strength 3 against 3)",
        "Amarr's raid on Gallente succeeds (strength 4 against 3)",
        'Ana steals 1 VP from Gil',
      ]));
      expect(t.last?.notices).toEqual(expect.arrayContaining([
        { to: 'amarr', text: raidText('Caldari'), kind: 'todo' },
        { to: 'amarr', text: raidText('Gallente'), kind: 'todo' },
        { to: 'gallente', text: 'Amarr stole 1 VP from you', kind: 'todo' },
      ]));
      // the failed raid takes nothing, so its target is not told
      expect(t.last?.notices.filter((n) => n.to === 'caldari')).toStrictEqual([]);
    });

    it('an undefended home (no citadels) falls to strength 3; Upgraded Citadel counts each home citadel twice', () => {
      const t = inUpkeep();
      t.p('caldari').vp = 1;
      t.p('gallente').vp = 1;
      t.p('gallente').homeCitadels = 1;
      give(t, 'gallente', DEV.upgradedCitadel);
      t.dispatch('amarr', confirm({ raids: [{ target: 'caldari', strength: 3 }, { target: 'gallente', strength: 4 }] }));
      confirmRest(t);
      expect([t.p('amarr').vp, t.p('caldari').vp, t.p('gallente').vp]).toStrictEqual([1, 0, 1]);
      expect(lines(t)).toContain("Amarr's raid on Gallente fails (strength 4 against 4)");
    });

    it('runs in seat order from the first player, so a later raider may find nothing left to steal', () => {
      const t = startedGame(['amarr', 'caldari', 'gallente'], { firstPlayer: 'caldari' });
      passAll(t);
      t.p('amarr').vp = 1;
      // Gallente confirms first but raids after Caldari (seat order from the first player).
      t.dispatch('gallente', confirm({ raids: [{ target: 'amarr', strength: 9 }] }));
      t.dispatch('caldari', confirm({ raids: [{ target: 'amarr', strength: 9 }] }));
      t.dispatch('amarr', confirm());
      expect([t.p('amarr').vp, t.p('caldari').vp, t.p('gallente').vp]).toStrictEqual([0, 1, 0]);
      expect(lines(t)).toContain('Gil steals no VP: Ana has none');
    });
  });
});

describe('verge of ascendancy', () => {
  it('reached during the actions by the current player: their turn end starts an emergency upkeep, though others have not passed', () => {
    const t = startedGame(['amarr', 'caldari', 'gallente']);
    t.p('amarr').vp = 9;
    t.dispatch('amarr', move);
    t.dispatch('amarr', mission(1));
    expect(t.game.verge).toStrictEqual({ by: 'amarr', finalRound: 2, emergencyPending: true });
    expect(t.last?.notices).toContainEqual({
      to: 'all', text: 'Amarr is on the Verge of Ascendancy — one more round (this round ends when the current turn ends)', kind: 'info',
    });
    expect(t.game.phase).toBe('actions');
    t.dispatch('amarr', endTurn);
    expect(t.game.phase).toBe('upkeep');
    expect(t.game.upkeep).toStrictEqual({ emergency: true, confirmed: [], raids: [], largeShips: [] });
    expect(t.game.verge).toStrictEqual({ by: 'amarr', finalRound: 2, emergencyPending: false });
    expect(t.p('caldari').passed).toBe(false);
    expect(t.p('gallente').passed).toBe(false);
  });

  it('reached by a non-current player waits for the current turn to end', () => {
    const t = startedGame(['amarr', 'caldari', 'gallente']);
    t.p('caldari').vp = 8;
    t.dispatch('caldari', mission(2));
    expect(t.game.verge).toStrictEqual({ by: 'caldari', finalRound: 2, emergencyPending: true });
    expect(t.game.phase).toBe('actions');
    expect(t.game.turn?.faction).toBe('amarr');
    t.dispatch('amarr', move); // the turn holder still acts
    expect(phaseOf(t.game)).toBe('actions');
    t.dispatch('amarr', endTurn);
    expect(phaseOf(t.game)).toBe('upkeep');
    expect(t.game.upkeep?.emergency).toBe(true);
  });

  it('reached during an upkeep finishes it normally: the next round is the final round', () => {
    const t = inUpkeep();
    t.p('amarr').vp = 8;
    t.p('amarr').systems = 5;
    t.p('amarr').central = true;
    confirmRest(t); // domination 5+ systems, most, central: +3
    expect(t.p('amarr').vp).toBe(11);
    expect(t.game.verge).toStrictEqual({ by: 'amarr', finalRound: 2, emergencyPending: false });
    expect(t.game.phase).toBe('actions');
    expect(t.game.round).toBe(2);
    expect(t.last?.notices).toContainEqual({ to: 'all', text: 'Amarr is on the Verge of Ascendancy — one more round', kind: 'info' });
    expect(t.last?.notices).toContainEqual({ to: 'all', text: 'Final round: the game ends after this round\'s upkeep', kind: 'info' });
  });

  it('is set only once: a later player reaching 10 changes nothing', () => {
    const t = startedGame(['amarr', 'caldari', 'gallente']);
    t.p('caldari').vp = 9;
    t.dispatch('caldari', mission(1));
    const verge = structuredClone(t.game.verge);
    expect(verge).toStrictEqual({ by: 'caldari', finalRound: 2, emergencyPending: true });
    t.p('gallente').vp = 9;
    t.dispatch('gallente', mission(3));
    expect(t.game.verge).toStrictEqual(verge);
    expect(t.last?.notices).toStrictEqual([]);
  });

  it('does nothing below 10 VP', () => {
    const t = startedGame(['amarr', 'caldari']);
    t.p('amarr').vp = 8;
    gainVP(t.game, 'amarr', 1, newOut());
    expect(t.game.verge).toBeNull();
    const out = newOut();
    checkVerge(t.game, 'amarr', out);
    expect(t.game.verge).toBeNull();
    expect(out).toStrictEqual(newOut());
  });

  it('a manual VP correction that reaches 10 sets it too', () => {
    const t = startedGame(['amarr', 'caldari']);
    t.p('caldari').vp = 7;
    t.dispatch('caldari', correction(3));
    expect(t.game.verge).toStrictEqual({ by: 'caldari', finalRound: 2, emergencyPending: true });
  });

  it('a steal that reaches 10 sets it (stealVP gains through gainVP)', () => {
    const t = inUpkeep();
    t.p('amarr').vp = 9;
    t.p('caldari').vp = 1;
    t.dispatch('amarr', confirm({ raids: [{ target: 'caldari', strength: 3 }] }));
    confirmRest(t);
    expect(t.game.verge).toStrictEqual({ by: 'amarr', finalRound: 2, emergencyPending: false });
  });
});

describe('game end', () => {
  /** Round-1 upkeep with the verge already set for round 1, so this upkeep is the last one. */
  function finalUpkeep(): Table {
    const t = inUpkeep();
    t.game.verge = { by: 'amarr', finalRound: 1, emergencyPending: false };
    return t;
  }

  it('ends after the upkeep of the final round with a ranking, tie-broken by systems', () => {
    const t = finalUpkeep();
    t.p('amarr').vp = 10;
    t.p('caldari').vp = 10;
    t.p('caldari').systems = 3;
    t.p('amarr').systems = 2;
    t.p('gallente').vp = 4;
    confirmRest(t);
    expect(t.game.phase).toBe('ended');
    expect(t.game.turn).toBeNull();
    expect(t.game.upkeep).toBeNull();
    expect(t.game.round).toBe(1);
    expect(t.game.result).toStrictEqual({ ranking: ['caldari', 'amarr', 'gallente'], winners: ['caldari'] });
    expect(lines(t)).toContain('Game over: Caldari wins');
    expect(lines(t)).toContain('Final ranking: 1. Caldari (10 VP, 3 systems, strength 2), 2. Amarr (10 VP, 2 systems, strength 2), 3. Gallente (4 VP, 0 systems, strength 2)');
    expect(t.last?.notices).toContainEqual({ to: 'all', text: 'Game over: Caldari wins', kind: 'info' });
  });

  it('breaks a VP and systems tie by total ship strength, and shares the win when everything is tied', () => {
    const t = finalUpkeep();
    for (const f of ['amarr', 'caldari', 'gallente'] as const) t.p(f).vp = 10;
    t.p('gallente').ships.sin = 1; // +5 strength
    t.p('caldari').ships.cerberus = 1; // +3
    t.p('amarr').ships.zealot = 1; // +3
    confirmRest(t);
    expect(t.game.result).toStrictEqual({ ranking: ['gallente', 'amarr', 'caldari'], winners: ['gallente'] });

    const u = finalUpkeep();
    u.p('amarr').vp = 10;
    u.p('caldari').vp = 10;
    confirmRest(u);
    expect(u.game.result).toStrictEqual({ ranking: ['amarr', 'caldari', 'gallente'], winners: ['amarr', 'caldari'] });
    expect(lines(u)).toContain('Game over: Amarr and Caldari share the victory');
  });

  it('scores domination in the final upkeep before ranking', () => {
    const t = finalUpkeep();
    t.p('amarr').vp = 10;
    t.p('caldari').vp = 10;
    t.p('caldari').systems = 5;
    confirmRest(t);
    expect(t.game.result?.winners).toStrictEqual(['caldari']);
    expect(t.p('caldari').vp).toBe(12);
  });

  it('accepts no further commands once ended', () => {
    const t = finalUpkeep();
    confirmRest(t);
    expectRejected(t, 'amarr', confirm(), 'wrong_phase');
    expectRejected(t, 'amarr', pass, 'wrong_phase');
  });

  it('endGame can be called directly and only counts seated players', () => {
    const t = startedGame(['amarr', 'caldari']);
    t.p('amarr').vp = 3;
    const out = newOut();
    endGame(t.game, out);
    expect(t.game.result).toStrictEqual({ ranking: ['amarr', 'caldari'], winners: ['amarr'] });
    expect(t.game.phase).toBe('ended');
  });
});

describe('a whole game ending', () => {
  it('verge during actions -> emergency upkeep -> final round -> final upkeep -> ended', () => {
    const t = startedGame(['amarr', 'caldari', 'gallente']);
    t.p('amarr').vp = 7;
    t.p('amarr').systems = 6;
    t.p('caldari').vp = 9;
    t.p('caldari').systems = 2;
    t.p('gallente').vp = 3;
    t.p('gallente').homeCitadels = 0;

    // Round 1: Amarr acts; Caldari completes a mission on their own turn and reaches the verge.
    t.dispatch('amarr', move);
    t.dispatch('amarr', endTurn);
    expect(t.game.turn?.faction).toBe('caldari');
    t.dispatch('caldari', mission(1));
    expect(t.game.verge).toStrictEqual({ by: 'caldari', finalRound: 2, emergencyPending: true });
    t.dispatch('caldari', move);
    t.dispatch('caldari', endTurn);

    // Emergency upkeep: Gallente never got a turn; no domination for Amarr's 6 systems; raids still run.
    expect(t.game.phase).toBe('upkeep');
    expect(t.game.upkeep?.emergency).toBe(true);
    expect(t.p('gallente').passed).toBe(false);
    t.dispatch('caldari', confirm({ raids: [{ target: 'gallente', strength: 3 }] }));
    t.dispatch('amarr', confirm());
    t.dispatch('gallente', confirm());
    expect([t.p('amarr').vp, t.p('caldari').vp, t.p('gallente').vp]).toStrictEqual([7, 11, 2]);
    expect(t.game.phase).toBe('actions');
    expect(t.game.round).toBe(2);
    expect(t.game.firstPlayer).toBe('caldari');
    expect(t.game.turn?.faction).toBe('caldari');
    expect(t.game.verge).toStrictEqual({ by: 'caldari', finalRound: 2, emergencyPending: false });
    expect(t.last?.notices).toContainEqual({ to: 'all', text: 'Final round: the game ends after this round\'s upkeep', kind: 'info' });
    for (const f of ['amarr', 'caldari', 'gallente'] as const) {
      expect(t.p(f).cubesUsed).toBe(0);
      expect(t.p(f).passed).toBe(false);
      expect(t.privs[f].pendingResearch).toBe(3);
      t.dispatch(f, { type: 'distributeResearch', alloc: { [t.privs[f].area[0]!.dev]: 3 }, fetch: [] });
    }

    // Final round: one action each, then everyone passes; a normal upkeep with domination.
    t.dispatch('caldari', move);
    t.dispatch('caldari', endTurn);
    t.dispatch('gallente', move);
    t.dispatch('gallente', endTurn);
    t.dispatch('amarr', move);
    t.dispatch('amarr', mission(1)); // 8 VP: the verge is already set and stays Caldari's
    t.dispatch('amarr', endTurn);
    passAll(t);
    expect(t.game.upkeep?.emergency).toBe(false);
    t.dispatch('amarr', confirm());
    t.dispatch('gallente', confirm());
    t.dispatch('caldari', confirm());

    // Amarr: 8 + 2 domination (6 systems, the most) = 10; Caldari 11.
    expect(t.game.phase).toBe('ended');
    expect(t.game.round).toBe(2);
    expect(t.game.verge).toStrictEqual({ by: 'caldari', finalRound: 2, emergencyPending: false });
    expect([t.p('amarr').vp, t.p('caldari').vp, t.p('gallente').vp]).toStrictEqual([10, 11, 2]);
    expect(t.game.result).toStrictEqual({ ranking: ['caldari', 'amarr', 'gallente'], winners: ['caldari'] });
    expect(JSON.parse(JSON.stringify(t.game))).toStrictEqual(t.game);
    for (const f of ['amarr', 'caldari', 'gallente'] as const) {
      expect(JSON.parse(JSON.stringify(t.privs[f]))).toStrictEqual(t.privs[f]);
      expect(t.privs[f].pendingResearch).toBe(3); // from the final upkeep
    }
  });
});

describe('purity', () => {
  function deepFreeze<T>(x: T): T {
    if (typeof x === 'object' && x !== null) {
      for (const v of Object.values(x)) deepFreeze(v);
      Object.freeze(x);
    }
    return x;
  }

  it('confirmUpkeep (including the finalising confirm) never mutates its inputs', () => {
    const t = inUpkeep(['amarr', 'caldari']);
    t.p('amarr').systems = 5;
    t.p('amarr').structures.refinery = 1;
    t.p('caldari').vp = 1;
    t.p('amarr').tapped = [DEV.galacticTrustFund];
    t.dispatch('caldari', confirm());
    const cmd = confirm({ ...refine(1, 0), raids: [{ target: 'caldari', strength: 3 }] });
    const game = deepFreeze(structuredClone(t.game));
    const pristine = structuredClone(game);
    const priv = deepFreeze(structuredClone(t.privs.amarr));
    const r = apply(game, deepFreeze(structuredClone(cmd)), { actor: 'amarr', uid: uidOf('amarr'), priv, now: NOW });
    if (isError(r)) throw new Error(r.code);
    expect(game).toStrictEqual(pristine);
    expect(r.game.phase).toBe('actions');
    expect(r.game.players.amarr?.vp).toBe(3); // raid + 5 systems + most
    expect(r.priv?.pendingResearch).toBe(3);
    expect(priv.pendingResearch).toBe(0);
  });
});

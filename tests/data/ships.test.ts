import { describe, expect, it } from 'vitest';
import { SHIPS, parseShipsCsv, ship, shipsOf } from '../../src/data/ships';
import { effectFor, type ShipEffect, type ShipEffectEntry } from '../../src/data/shipEffects';
import { FACTIONS, type AbilitySlot, type ShipId } from '../../src/data/types';

const SLOTS: AbilitySlot[] = ['basic', 'first', 'second'];

const HEADER =
  'Faction,Name,Class,Size,Qty,DIF,ATK,SUP,RED,HP,SPD,O1,O2,D1,D2,U1,U2,' +
  'Passive / Critical Leader Ability,1st Researched Ability,2nd Researched Ability,Role';

describe('ship data', () => {
  it('has 32 ships, 8 per faction', () => {
    expect(SHIPS).toHaveLength(32);
    for (const f of FACTIONS) {
      const ships = shipsOf(f);
      expect(ships).toHaveLength(8);
      expect(ships.every((s) => s.faction === f)).toBe(true);
    }
  });

  it('has unique lowercase slug ids equal to the ship name', () => {
    const ids = SHIPS.map((s) => s.id);
    expect(new Set(ids).size).toBe(32);
    for (const s of SHIPS) expect(s.id).toBe(s.name.toLowerCase());
  });

  it('reads the Malediction stat line', () => {
    expect(ship('malediction')).toMatchObject({
      id: 'malediction',
      faction: 'amarr',
      name: 'Malediction',
      cls: 'Frigate',
      size: 'small',
      qty: 5,
      dif: 3,
      atk: 3,
      sup: 1,
      red: 0,
      hp: 1,
      spd: 3,
    });
  });

  it('reads other stat lines and role text', () => {
    expect(ship('panther').dif).toBe(2);
    expect(ship('kronos')).toMatchObject({ size: 'large', qty: 2, atk: 6, sup: 2, red: 3, hp: 6, spd: 2 });
    expect(ship('zealot')).toMatchObject({ size: 'medium', cls: 'Cruiser', qty: 3 });
    expect(ship('zealot').role).toBe('Heavy Assault Cruiser: Medium orbit leader.');
  });

  it('throws on an unknown ship id', () => {
    expect(() => ship('nope')).toThrow(/nope/);
  });

  it('keeps shipsOf in CSV order and returns the same objects as ship()', () => {
    expect(shipsOf('minmatar').map((s) => s.id)).toEqual([
      'cheetah',
      'stiletto',
      'sabre',
      'vagabond',
      'huginn',
      'sleipnir',
      'panther',
      'vargur',
    ]);
    expect(shipsOf('gallente')[0]).toBe(ship('helios'));
  });

  it('contains only plain values (no undefined) and integer stats', () => {
    expect(JSON.parse(JSON.stringify(SHIPS))).toStrictEqual(SHIPS);
    for (const s of SHIPS) {
      for (const n of [s.qty, s.dif, s.atk, s.sup, s.red, s.hp, s.spd]) {
        expect(Number.isInteger(n) && n >= 0).toBe(true);
      }
    }
  });
});

describe('ship abilities', () => {
  it('derives requires from the bracketed prefix', () => {
    const paladin = ship('paladin').abilities;
    expect(paladin.find((a) => a.slot === 'first')?.requires).toEqual(['O1', 'U1']);
    expect(paladin.find((a) => a.slot === 'second')?.requires).toEqual(['O2', 'D2']);
    expect(ship('malediction').abilities.find((a) => a.slot === 'second')?.requires).toEqual(['U2']);
  });

  it('strips the tier prefix from the text', () => {
    const first = ship('paladin').abilities.find((a) => a.slot === 'first');
    expect(first?.text).toBe('Support: Adds its SUP to all other orbits.');
    const heretic = ship('heretic').abilities.find((a) => a.slot === 'first');
    expect(heretic?.requires).toEqual(['O1']);
    expect(heretic?.text).toBe('[Critical Damage] = Once per attack, you may reroll up to 2 dice.');
  });

  it('does not treat [Critical Damage] as a tier prefix', () => {
    const basic = ship('zealot').abilities.find((a) => a.slot === 'basic');
    expect(basic).toEqual({ slot: 'basic', requires: [], text: '[Critical Damage] = +1 [Aim] result.' });
  });

  it('keeps quoted ability text with commas intact', () => {
    const basic = ship('anathema').abilities.find((a) => a.slot === 'basic');
    expect(basic?.text).toBe(
      'When it reveals an unexplored system, you may draw an additional discovery token. Then, return one to the bag and keep the others.',
    );
  });

  it('omits empty ability slots', () => {
    expect(ship('anathema').abilities.map((a) => a.slot)).toEqual(['basic', 'first']);
    expect(ship('malediction').abilities.map((a) => a.slot)).toEqual(['first', 'second']);
    expect(ship('heretic').abilities.map((a) => a.slot)).toEqual(['first', 'second']);
    expect(ship('zealot').abilities.map((a) => a.slot)).toEqual(['basic', 'first']);
    expect(ship('absolution').abilities.map((a) => a.slot)).toEqual(['basic', 'first', 'second']);
  });

  it('only uses known tiers and non-empty text', () => {
    const tiers = ['O1', 'O2', 'D1', 'D2', 'U1', 'U2'];
    for (const s of SHIPS) {
      for (const a of s.abilities) {
        expect(a.text.length).toBeGreaterThan(0);
        for (const t of a.requires) expect(tiers).toContain(t);
      }
    }
  });
});

describe('parseShipsCsv', () => {
  const row = (fields: string[]) => fields.join(',');

  it('parses quoted fields containing commas, doubled quotes and CRLF line breaks', () => {
    const csv = [
      HEADER,
      row([
        'Amarr',
        'Test',
        'Frigate',
        'Small',
        '5',
        '3',
        '2',
        '1',
        '0',
        '1',
        '3',
        '',
        '',
        '1',
        '',
        '',
        '',
        '"Say ""hi"", then leave."',
        '"[D1] First, with comma."',
        '',
        '"Explorer: role, with comma."',
      ]),
      '',
    ].join('\r\n');
    const [s, ...rest] = parseShipsCsv(csv);
    expect(rest).toEqual([]);
    expect(s).toEqual({
      id: 'test',
      faction: 'amarr',
      name: 'Test',
      cls: 'Frigate',
      size: 'small',
      qty: 5,
      dif: 3,
      atk: 2,
      sup: 1,
      red: 0,
      hp: 1,
      spd: 3,
      role: 'Explorer: role, with comma.',
      abilities: [
        { slot: 'basic', requires: [], text: 'Say "hi", then leave.' },
        { slot: 'first', requires: ['D1'], text: 'First, with comma.' },
      ],
    });
  });

  it('accepts a final row without a trailing newline and plain LF', () => {
    const line = 'Caldari,Foo,Cruiser,Medium,3,2,5,1,2,3,2,,2,,,,,,,,Role.';
    expect(parseShipsCsv(`${HEADER}\n${line}`)).toHaveLength(1);
    expect(parseShipsCsv(`${HEADER}\n${line}\n`)).toHaveLength(1);
    expect(parseShipsCsv(`${HEADER}\n${line}\n`)[0]?.abilities).toEqual([]);
  });

  it('parses multi-tier prefixes', () => {
    const line = 'Caldari,Foo,Cruiser,Medium,3,2,5,1,2,3,2,,2,,,,,,[O1+U1+D2] Support: x.,,Role.';
    expect(parseShipsCsv(`${HEADER}\n${line}`)[0]?.abilities).toEqual([
      { slot: 'first', requires: ['O1', 'U1', 'D2'], text: 'Support: x.' },
    ]);
  });

  it('rejects unknown factions and sizes', () => {
    const bad = (faction: string, size: string) =>
      `${HEADER}\n${faction},Foo,Cruiser,${size},3,2,5,1,2,3,2,,2,,,,,,,,Role.`;
    expect(() => parseShipsCsv(bad('Sansha', 'Medium'))).toThrow(/faction/i);
    expect(() => parseShipsCsv(bad('Amarr', 'Huge'))).toThrow(/size/i);
  });

  it('rejects non-integer stats', () => {
    const line = 'Amarr,Foo,Cruiser,Medium,3,x,5,1,2,3,2,,2,,,,,,,,Role.';
    expect(() => parseShipsCsv(`${HEADER}\n${line}`)).toThrow(/DIF/);
  });
});

type Expected = Partial<Record<AbilitySlot, ShipEffectEntry>>;
type Role = ShipEffectEntry['role'];

const entry = (role: Role, effect: ShipEffect): ShipEffectEntry => ({ role, effect });
const reminder = (role: Role, timing: Extract<ShipEffect, { kind: 'reminder' }>['timing']) =>
  entry(role, { kind: 'reminder', timing });

// The brief's mapping, ship by ship and slot by slot.
const EXPECTED: Record<ShipId, Expected> = {};
function group(ids: ShipId[], shared: Expected, perShip: Record<ShipId, Expected> = {}) {
  for (const id of ids) EXPECTED[id] = { ...shared, ...perShip[id] };
}

group(['anathema', 'buzzard', 'helios', 'cheetah'], {
  basic: reminder('any', 'outOfCombat'),
  first: entry('any', { kind: 'evasive', atk: -2, sup: -1, dif: 2 }),
});
group(['malediction', 'crow', 'ares', 'stiletto'], {
  first: reminder('any', 'outOfCombat'),
  second: entry('any', { kind: 'enemyDifInOrbit', amount: -1 }),
});
group(
  ['heretic', 'flycatcher', 'eris', 'sabre'],
  { second: entry('any', { kind: 'noEnemyRetreatRound1' }) },
  {
    heretic: { first: reminder('leader', 'roll') },
    flycatcher: { first: reminder('leader', 'kill') },
    eris: { first: reminder('leader', 'roll') },
    sabre: { first: entry('leader', { kind: 'critDamageOnce', amount: 1 }) },
  },
);
group(
  ['zealot', 'cerberus', 'ishtar', 'vagabond'],
  { basic: entry('leader', { kind: 'critAim', perCrit: 1 }) },
  {
    zealot: { first: entry('leader', { kind: 'killBonus', aim: 1, damage: 1 }) },
    cerberus: { first: entry('leader', { kind: 'damageVsOtherOrbit', amount: 1 }) },
    ishtar: { first: entry('leader', { kind: 'aimBonus', amount: 1 }) },
    vagabond: { first: reminder('leader', 'roll') },
  },
);
group(
  ['curse', 'rook', 'lachesis', 'huginn'],
  { second: reminder('leader', 'roll') },
  {
    curse: { first: entry('any', { kind: 'curse' }) },
    rook: { first: entry('any', { kind: 'enemyAimFromOrbit', amount: -1 }) },
    lachesis: { first: entry('any', { kind: 'enemyRetreatDif', amount: -2 }) },
    huginn: { first: entry('any', { kind: 'enemyDifInOrbit', amount: -1 }) },
  },
);
group(
  ['absolution', 'nighthawk', 'astarte', 'sleipnir'],
  { basic: reminder('any', 'roll'), first: reminder('any', 'roll') },
  {
    absolution: { second: entry('any', { kind: 'stats', atk: 0, sup: 0, red: 1 }) },
    nighthawk: {
      second: entry('any', { kind: 'difWhenTargetedFrom', orbits: ['small', 'medium'], amount: 1 }),
    },
    astarte: { second: entry('any', { kind: 'healSelfRoundEnd', amount: 1 }) },
    sleipnir: { second: reminder('any', 'targeted') },
  },
);
group(
  ['redeemer', 'widow', 'sin', 'panther'],
  {
    basic: entry('leader', { kind: 'critDamage', perCrit: 1, perCritVsLarge: 2 }),
    first: reminder('any', 'outOfCombat'),
  },
  {
    redeemer: { second: entry('leader', { kind: 'suppressEnemySupportsInOrbit' }) },
    widow: { second: reminder('any', 'combatEnd') },
    sin: { second: reminder('any', 'roundEnd') },
    panther: { second: reminder('any', 'destroyed') },
  },
);
group(
  ['paladin', 'golem', 'kronos', 'vargur'],
  {
    basic: entry('leader', { kind: 'critDamage', perCrit: 1, perCritVsLarge: 1 }),
    second: entry('any', { kind: 'stats', atk: 1, sup: 1, red: 1 }),
  },
  {
    paladin: { first: entry('support', { kind: 'supToAllOrbits' }) },
    golem: { first: entry('support', { kind: 'enemyDifInOrbit', amount: -1 }) },
    kronos: { first: entry('leader', { kind: 'stayUntilRoundEnd' }) },
    vargur: { first: entry('leader', { kind: 'killZeroDif' }) },
  },
);

describe('ship effects', () => {
  it('covers exactly the 32 ships', () => {
    expect(Object.keys(EXPECTED).sort()).toEqual(SHIPS.map((s) => s.id).sort());
  });

  it('maps every ship ability to an effect and absent slots to null', () => {
    for (const s of SHIPS) {
      for (const slot of SLOTS) {
        const has = s.abilities.some((a) => a.slot === slot);
        expect(effectFor(s.id, slot) !== null, `${s.id} ${slot}`).toBe(has);
      }
    }
  });

  it('matches the specified effect and role for every ship and slot', () => {
    for (const s of SHIPS) {
      for (const slot of SLOTS) {
        expect(effectFor(s.id, slot), `${s.id} ${slot}`).toEqual(EXPECTED[s.id]?.[slot] ?? null);
      }
    }
  });

  it('classifies the headline cases', () => {
    expect(effectFor('zealot', 'basic')).toEqual({ role: 'leader', effect: { kind: 'critAim', perCrit: 1 } });
    expect(effectFor('golem', 'first')?.role).toBe('support');
    expect(effectFor('paladin', 'first')?.role).toBe('support');
    expect(effectFor('kronos', 'first')?.role).toBe('leader');
  });

  it('returns null for a ship without an ability in that slot', () => {
    expect(effectFor('anathema', 'second')).toBeNull();
    expect(effectFor('malediction', 'basic')).toBeNull();
  });

  it('throws for an unknown ship', () => {
    expect(() => effectFor('nope', 'basic')).toThrow(/nope/);
  });
});

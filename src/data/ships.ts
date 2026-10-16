import shipsCsv from './ships.csv?raw';
import { FACTIONS, type AbilitySlot, type DevTier, type FactionId, type ShipId, type Size } from './types';

export interface ShipAbility {
  slot: AbilitySlot;
  requires: DevTier[];
  text: string; // without the "[O1] " prefix
}

export interface Ship {
  id: ShipId;
  faction: FactionId;
  name: string;
  cls: string;
  size: Size;
  qty: number;
  dif: number;
  atk: number;
  sup: number;
  red: number;
  hp: number;
  spd: number;
  role: string;
  abilities: ShipAbility[];
}

const SIZES: Size[] = ['small', 'medium', 'large'];

const ABILITY_COLUMNS: [AbilitySlot, string][] = [
  ['basic', 'Passive / Critical Leader Ability'],
  ['first', '1st Researched Ability'],
  ['second', '2nd Researched Ability'],
];

// Tier prefix such as "[O1] " or "[O2+D2] ". "[Critical Damage]" is not a tier prefix.
const TIER_PREFIX = /^\[([OUD][12](?:\+[OUD][12])*)\]\s*/;

/** RFC 4180 style tokenizer: quoted fields may contain commas, line breaks and doubled quotes. */
function parseRows(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let i = 0;

  const endField = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  while (i < csv.length) {
    const c = csv[i] as string;
    if (quoted) {
      if (c === '"') {
        if (csv[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ',') {
      endField();
    } else if (c === '\r' || c === '\n') {
      if (c === '\r' && csv[i + 1] === '\n') i++;
      endRow();
    } else {
      field += c;
    }
    i++;
  }
  if (quoted) throw new Error('Unterminated quoted field in ships CSV');
  if (field !== '' || row.length > 0) endRow();

  return rows.filter((r) => r.length > 1 || (r[0] ?? '') !== '');
}

function parseAbility(slot: AbilitySlot, raw: string): ShipAbility | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const m = TIER_PREFIX.exec(trimmed);
  if (!m) return { slot, requires: [], text: trimmed };
  return {
    slot,
    requires: (m[1] as string).split('+') as DevTier[],
    text: trimmed.slice(m[0].length),
  };
}

function slugify(name: string): ShipId {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function parseShipsCsv(csv: string): Ship[] {
  const [header, ...body] = parseRows(csv);
  if (!header) return [];
  const index = new Map(header.map((h, i) => [h.trim(), i]));

  return body.map((cells, n) => {
    const where = `ships CSV row ${n + 2}`;
    const cell = (col: string): string => {
      const i = index.get(col);
      if (i === undefined) throw new Error(`Missing column "${col}" in ships CSV`);
      return (cells[i] ?? '').trim();
    };
    const int = (col: string): number => {
      const v = cell(col);
      if (!/^\d+$/.test(v)) throw new Error(`${where}: ${col} must be a non-negative integer, got "${v}"`);
      return Number(v);
    };

    const faction = cell('Faction').toLowerCase() as FactionId;
    if (!FACTIONS.includes(faction)) throw new Error(`${where}: unknown faction "${cell('Faction')}"`);
    const size = cell('Size').toLowerCase() as Size;
    if (!SIZES.includes(size)) throw new Error(`${where}: unknown size "${cell('Size')}"`);

    const name = cell('Name');
    const abilities: ShipAbility[] = [];
    for (const [slot, col] of ABILITY_COLUMNS) {
      const ability = parseAbility(slot, cell(col));
      if (ability) abilities.push(ability);
    }

    return {
      id: slugify(name),
      faction,
      name,
      cls: cell('Class'),
      size,
      qty: int('Qty'),
      dif: int('DIF'),
      atk: int('ATK'),
      sup: int('SUP'),
      red: int('RED'),
      hp: int('HP'),
      spd: int('SPD'),
      role: cell('Role'),
      abilities,
    };
  });
}

export const SHIPS: Ship[] = parseShipsCsv(shipsCsv);

const BY_ID = new Map<ShipId, Ship>(SHIPS.map((s) => [s.id, s]));

export function ship(id: ShipId): Ship {
  const found = BY_ID.get(id);
  if (!found) throw new Error(`Unknown ship: ${id}`);
  return found;
}

export function shipsOf(f: FactionId): Ship[] {
  return SHIPS.filter((s) => s.faction === f);
}

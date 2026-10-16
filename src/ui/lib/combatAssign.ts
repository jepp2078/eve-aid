/**
 * Fleet assignment: a tray of my owned ships by type with counts, and a draft of placements made
 * tap-tap (a ship in the tray, then a Leader slot or the Supports of an orbit). The engine has the last word: the
 * draft is previewed with `combatAssign`, and `issueSpot` says which lane or tray row an engine error is about, so
 * the message shows where the problem is.
 *
 * A light game keeps no fleets: the tray holds every ship of the faction, each limited to the
 * models in the box (`boxCounts`), and the counts say "in the box" instead of what I have.
 */
import { ship as shipData, shipsOf as factionShips, type Ship } from '../../data/ships';
import { ORBITS, type FactionId, type Orbit, type ShipId, type Size } from '../../data/types';
import { isOrbit, knownShip, ROLES } from '../../engine/combat/setup';
import type { Command, CombatShip } from '../../engine/types';
import { isRecord } from './drafts';

export type Role = CombatShip['role'];

/** One ship of the draft fleet, exactly as `combatAssign` takes it. */
export interface Placement {
  ship: ShipId;
  orbit: Orbit;
  role: Role;
}

export interface AssignDraft {
  placements: Placement[];
}

export const EMPTY_ASSIGN: AssignDraft = { placements: [] };

export interface TrayItem {
  ship: Ship;
  /** Models I may place: on the board (my `ships` count), or in a light game the models in the box. */
  owned: number;
  /** In the draft. */
  placed: number;
  /** Still to place: owned − placed, at least 0. */
  left: number;
  /** Placed more often than owned (after a live change), else 0. */
  over: number;
}

const SIZE_ORDER: Record<Size, number> = { small: 0, medium: 1, large: 2 };

const countOf = (placements: readonly Placement[], id: ShipId): number => placements.filter((p) => p.ship === id).length;

/** Every ship of `faction` with the number of its models in the box: what a light game's tray offers. */
export function boxCounts(faction: FactionId): Record<ShipId, number> {
  return Object.fromEntries(factionShips(faction).map((s) => [s.id, s.qty]));
}

/** My ships for the tray: every ship of `faction` I own or have placed, small → large, then A–Z. */
export function trayItems(faction: FactionId, owned: Readonly<Record<ShipId, number>>, placements: readonly Placement[]): TrayItem[] {
  return factionShips(faction)
    .map((ship) => {
      const have = Object.hasOwn(owned, ship.id) ? (owned[ship.id] as number) : 0;
      const placed = countOf(placements, ship.id);
      return { ship, owned: have, placed, left: Math.max(0, have - placed), over: Math.max(0, placed - have) };
    })
    .filter((i) => i.owned > 0 || i.placed > 0)
    .sort((a, b) => SIZE_ORDER[a.ship.size] - SIZE_ORDER[b.ship.size] || a.ship.name.localeCompare(b.ship.name));
}

/**
 * A tray row's count: "2 of 3 left" (my ships on the board), or in a light game "3 in the box" and, once some are
 * placed, "2 of 3 in the box left"; "All placed" when none are left, "1 too many" after a live change.
 */
export function trayLeftText(item: TrayItem, light: boolean): string {
  if (item.left === 0) return item.over > 0 ? `${item.over} too many` : 'All placed';
  if (!light) return `${item.left} of ${item.owned} left`;
  return item.placed === 0 ? `${item.owned} in the box` : `${item.left} of ${item.owned} in the box left`;
}

/** The warning on a row placed more often than allowed: "Placed 2, you have 1" ("…, the box has 2" in a light game). */
export function trayOverText(item: TrayItem, light: boolean): string {
  return `Placed ${item.placed}, ${light ? 'the box has' : 'you have'} ${item.owned}`;
}

/**
 * Why the selected tray ship can't go into this slot (shown on the slot), or null when it can: a leader's size must
 * match the orbit; supports need a leader in that orbit first. `light`: the tray counts the models in the box.
 */
export function slotBlock(item: TrayItem | null, orbit: Orbit, role: Role, placements: readonly Placement[], light = false): string | null {
  if (item === null) return 'Choose a ship in your tray first';
  const { name, size } = item.ship;
  if (item.left <= 0) return light ? `Every ${name} in the box is placed` : `Every ${name} you have is placed`;
  if (role === 'leader' && size !== orbit) return `${name} is a ${size} ship: it can only lead the ${size} orbit`;
  if (role === 'support' && !placements.some((p) => p.orbit === orbit && p.role === 'leader')) return `Place a leader in the ${orbit} orbit first`;
  return null;
}

/**
 * Where the picked ship most likely goes (the slot scrolled into view on a pick): the Leader slot of its own size's
 * orbit while that is free, else that orbit's Supports; null when it can't be placed.
 */
export function firstSlot(item: TrayItem, placements: readonly Placement[]): { orbit: Orbit; role: Role } | null {
  const orbit = item.ship.size;
  const led = placements.some((p) => p.orbit === orbit && p.role === 'leader');
  if (!led && slotBlock(item, orbit, 'leader', placements) === null) return { orbit, role: 'leader' };
  if (slotBlock(item, orbit, 'support', placements) === null) return { orbit, role: 'support' };
  return null;
}

/**
 * How far to scroll (px, + = down) so `rect` shows inside `band` — the strip between the sticky header and the sticky
 * action bar — with `margin` to spare: 0 when it already does; a box taller than the band is aligned to its top.
 */
export function bandScroll(rect: { top: number; bottom: number }, band: { top: number; bottom: number }, margin: number): number {
  const top = band.top + margin;
  const bottom = band.bottom - margin;
  if (rect.top < top || rect.bottom - rect.top > bottom - top) return rect.top - top;
  return rect.bottom > bottom ? rect.bottom - bottom : 0;
}

/** Places one `ship`: as leader it takes the orbit leader's place (that ship goes back to the tray); a support is added. */
export function placeShip(placements: readonly Placement[], ship: ShipId, orbit: Orbit, role: Role): Placement[] {
  const next: Placement = { ship, orbit, role };
  if (role === 'leader') {
    const at = placements.findIndex((p) => p.orbit === orbit && p.role === 'leader');
    if (at !== -1) return placements.map((p, i) => (i === at ? next : p));
  }
  return [...placements, next];
}

export function removePlacement(placements: readonly Placement[], index: number): Placement[] {
  return placements.filter((_, i) => i !== index);
}

export interface LaneDraft {
  orbit: Orbit;
  leader: { index: number; ship: ShipId } | null;
  supports: { index: number; ship: ShipId }[];
  /** `idle`: nothing here (this orbit won't attack); `orphaned`: supports without a leader (the engine refuses). */
  status: 'ready' | 'idle' | 'orphaned';
}

/** The draft by orbit, small → large, with each ship's index in the draft (for removal). */
export function laneDrafts(placements: readonly Placement[]): LaneDraft[] {
  return ORBITS.map((orbit) => {
    let leader: LaneDraft['leader'] = null;
    const supports: LaneDraft['supports'] = [];
    placements.forEach((p, index) => {
      if (p.orbit !== orbit) return;
      if (p.role === 'leader' && leader === null) leader = { index, ship: p.ship };
      else if (p.role === 'support') supports.push({ index, ship: p.ship });
    });
    const status = leader !== null ? 'ready' : supports.length > 0 ? 'orphaned' : 'idle';
    return { orbit, leader, supports, status };
  });
}

/** The command for the draft; null while nothing is placed. */
export function assignCommand(placements: readonly Placement[]): Command | null {
  if (placements.length === 0) return null;
  return { type: 'combatAssign', ships: placements.map((p) => ({ ship: p.ship, orbit: p.orbit, role: p.role })) };
}

/** Confirm's label: "Confirm fleet · 3 ships in 2 orbits". */
export function fleetHead(placements: readonly Placement[]): string {
  const n = placements.length;
  if (n === 0) return 'Confirm fleet';
  const orbits = new Set(placements.map((p) => p.orbit)).size;
  return `Confirm fleet · ${n} ${n === 1 ? 'ship' : 'ships'}${orbits > 1 ? ` in ${orbits} orbits` : ''}`;
}

/** A stored draft, or null when it is no draft at all; malformed placements are dropped. */
export function sanitizeAssign(raw: unknown): AssignDraft | null {
  if (!isRecord(raw)) return null;
  if (!Array.isArray(raw.placements)) return EMPTY_ASSIGN;
  const placements = raw.placements.flatMap((p): Placement[] => {
    if (!isRecord(p)) return [];
    const s = knownShip(p.ship);
    if (s === null || !isOrbit(p.orbit) || !ROLES.includes(p.role as Role)) return [];
    return [{ ship: s.id, orbit: p.orbit, role: p.role as Role }];
  });
  return { placements };
}

export interface IssueSpot {
  orbit: Orbit | null;
  ship: ShipId | null;
}

/**
 * Where the engine's placement error (by code) belongs in the draft: an orbit lane (a wrong-size leader, two leaders,
 * supports without a leader), a tray ship (more placed than owned, or in a light game than the box has: `owned` is
 * then the box counts), or the fleet as a whole (both null).
 */
export function issueSpot(code: string, placements: readonly Placement[], owned: Readonly<Record<ShipId, number>>): IssueSpot {
  const none: IssueSpot = { orbit: null, ship: null };
  switch (code) {
    case 'not_owned':
    case 'no_models': {
      const id = [...new Set(placements.map((p) => p.ship))].find((x) => countOf(placements, x) > (Object.hasOwn(owned, x) ? (owned[x] as number) : 0));
      return id === undefined ? none : { orbit: null, ship: id };
    }
    case 'bad_leader': {
      const p = placements.find((x) => x.role === 'leader' && knownShip(x.ship)?.size !== x.orbit);
      return p === undefined ? none : { orbit: p.orbit, ship: p.ship };
    }
    case 'two_leaders': {
      const orbit = ORBITS.find((o) => placements.filter((p) => p.orbit === o && p.role === 'leader').length > 1);
      return orbit === undefined ? none : { orbit, ship: null };
    }
    case 'no_leader': {
      const led = new Set(placements.filter((p) => p.role === 'leader').map((p) => p.orbit));
      const p = placements.find((x) => x.role === 'support' && !led.has(x.orbit));
      return p === undefined ? none : { orbit: p.orbit, ship: p.ship };
    }
    default:
      return none;
  }
}

/** "DIF 3 ATK 4 SUP 0 RED 0 HP 2" — a ship's printed key stats for tray rows. */
export function keyStats(id: ShipId): { label: string; value: number }[] {
  const s = shipData(id);
  return [
    { label: 'DIF', value: s.dif },
    { label: 'ATK', value: s.atk },
    { label: 'SUP', value: s.sup },
    { label: 'RED', value: s.red },
    { label: 'HP', value: s.hp },
  ];
}

/**
 * What a browser remembers between visits: its device id and the last game it was in. A `?as=<name>` query
 * parameter selects a separate profile (`eve:device:<name>`, `eve:session:<name>`), so one browser can hold
 * several seats in separate tabs. Small UI preferences (last name used, keep-awake) live under `eve:pref:<name>` in the
 * same profile. Falls back to memory when localStorage is unavailable.
 */
import { FACTIONS, type FactionId } from '../data/types';

export interface Session {
  code: string;
  faction: FactionId | null;
}

const MAX_PROFILE = 32;
const memory = new Map<string, string>();

function profile(): string | null {
  try {
    const name = new URLSearchParams(globalThis.location?.search ?? '').get('as')?.trim() ?? '';
    return name.length > 0 && name.length <= MAX_PROFILE ? name : null;
  } catch {
    return null;
  }
}

function key(kind: string): string {
  const p = profile();
  return p === null ? `eve:${kind}` : `eve:${kind}:${p}`;
}

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null; // e.g. blocked storage throws on access
  }
}

function read(k: string): string | null {
  try {
    const value = storage()?.getItem(k) ?? null;
    if (value !== null) return value;
  } catch {
    // fall through to the in-memory copy
  }
  return memory.get(k) ?? null;
}

/** Writes to localStorage; only when that is impossible (absent, blocked, full) does memory keep the value. */
function write(k: string, value: string | null): void {
  memory.delete(k);
  try {
    const s = storage();
    if (s !== null) {
      if (value === null) s.removeItem(k);
      else s.setItem(k, value);
      return;
    }
  } catch {
    // fall back to memory below
  }
  if (value !== null) memory.set(k, value);
}

export function loadSession(): Session | null {
  const raw = read(key('session'));
  if (raw === null) return null;
  try {
    const s = JSON.parse(raw) as Partial<Session> | null;
    if (typeof s !== 'object' || s === null || typeof s.code !== 'string' || s.code.length === 0) return null;
    const faction = s.faction ?? null;
    if (faction !== null && !FACTIONS.includes(faction)) return null;
    return { code: s.code, faction };
  } catch {
    return null;
  }
}

export function saveSession(s: Session | null): void {
  write(key('session'), s === null ? null : JSON.stringify({ code: s.code, faction: s.faction }));
}

/**
 * This browser's random id (per profile), created on first use. Uses `crypto.getRandomValues`, which, unlike
 * `crypto.randomUUID`, also exists on plain-http LAN pages.
 */
export function deviceId(): string {
  const k = key('device');
  const known = read(k);
  if (known !== null && /^[a-z0-9]{20,64}$/.test(known)) return known;
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const id = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  write(k, id);
  return id;
}

/** A small per-profile UI preference (e.g. the last name typed); null when never set. */
export function loadPref(name: string): string | null {
  return read(key(`pref:${name}`));
}

/** Stores a UI preference; null forgets it. */
export function savePref(name: string, value: string | null): void {
  write(key(`pref:${name}`), value);
}

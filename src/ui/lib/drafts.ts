/**
 * Sheet drafts in sessionStorage, one key per game, seat and sheet, so a half-built Trade survives a reload or the
 * phone sleeping. Restored values go through the sheet's sanitiser; storage errors just mean no persistence.
 */
import type { FactionId } from '../../data/types';

/** A plain object (not null, not an array): the first check of every draft sanitiser. */
export function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

export function draftKey(code: string, faction: FactionId, sheet: string): string {
  return `eve:draft:${code}:${faction}:${sheet}`;
}

export function readDraft<T>(key: string, sanitize: (raw: unknown) => T | null, fallback: T): T {
  try {
    const raw = sessionStorage.getItem(key);
    if (raw === null) return fallback;
    return sanitize(JSON.parse(raw)) ?? fallback;
  } catch {
    return fallback;
  }
}

/** Stores the draft; null forgets it. */
export function writeDraft(key: string, value: unknown): void {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // private mode or full: the draft just won't survive a reload
  }
}

/** Forgets every stored draft whose key starts with `prefix` (e.g. all of a game's combat-assignment drafts). */
export function forgetDrafts(prefix: string): void {
  try {
    const s = sessionStorage;
    const keys: string[] = [];
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i);
      if (k !== null && k.startsWith(prefix)) keys.push(k);
    }
    for (const k of keys) s.removeItem(k);
  } catch {
    // no storage: nothing was kept
  }
}

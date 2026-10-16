import { afterEach, describe, expect, it } from 'vitest';
import { draftKey, forgetDrafts, readDraft, writeDraft } from '../../src/ui/lib/drafts';

/** A Map-backed stand-in for sessionStorage (the tests run without a DOM). */
function fakeStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
  };
}

const g = globalThis as { sessionStorage?: Storage };
afterEach(() => {
  delete g.sessionStorage;
});

describe('forgetDrafts', () => {
  it('drops every draft whose key starts with the prefix, and nothing else', () => {
    g.sessionStorage = fakeStorage();
    const k = (sheet: string) => draftKey('ABC234', 'amarr', sheet);
    writeDraft(k('combat-assign:amarr-caldari-0'), { placements: [] });
    writeDraft(k('combat-assign:amarr-caldari-x1'), { placements: [] });
    writeDraft(k('combat-start'), { defender: 'caldari' });
    writeDraft(draftKey('ABC234', 'caldari', 'combat-assign:amarr-caldari-0'), { placements: [] });
    forgetDrafts(k('combat-assign:'));
    expect(readDraft(k('combat-assign:amarr-caldari-0'), (x) => x, null)).toBeNull();
    expect(readDraft(k('combat-assign:amarr-caldari-x1'), (x) => x, null)).toBeNull();
    expect(readDraft(k('combat-start'), (x) => x, null)).toStrictEqual({ defender: 'caldari' });
    expect(readDraft(draftKey('ABC234', 'caldari', 'combat-assign:amarr-caldari-0'), (x) => x, null)).toStrictEqual({ placements: [] });
  });

  it('does nothing without storage', () => {
    expect(() => forgetDrafts('eve:draft:')).not.toThrow();
  });
});

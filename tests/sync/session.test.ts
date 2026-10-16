import { afterEach, describe, expect, it, vi } from 'vitest';
import { deviceId, loadPref, loadSession, savePref, saveSession } from '../../src/sync/session';

function memoryStorage(): Storage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => void data.set(k, String(v)),
  };
}

function page(search: string) {
  const storage = memoryStorage();
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('location', { search });
  return storage;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('session', () => {
  it('keeps a random device id in localStorage', () => {
    const storage = page('');
    const id = deviceId();
    expect(id).toMatch(/^[a-z0-9]{20,64}$/);
    expect(deviceId()).toBe(id);
    expect(storage.data.get('eve:device')).toBe(id);
  });

  it('generates different ids for different browsers', () => {
    page('');
    const one = deviceId();
    page('');
    expect(deviceId()).not.toBe(one);
  });

  it('remembers the last game and forgets it on null', () => {
    const storage = page('');
    expect(loadSession()).toBeNull();
    saveSession({ code: 'ABC234', faction: 'amarr' });
    expect(loadSession()).toStrictEqual({ code: 'ABC234', faction: 'amarr' });
    saveSession({ code: 'ABC234', faction: null });
    expect(loadSession()).toStrictEqual({ code: 'ABC234', faction: null });
    saveSession(null);
    expect(loadSession()).toBeNull();
    expect(storage.data.has('eve:session')).toBe(false);
  });

  it('ignores a damaged session', () => {
    const storage = page('');
    storage.setItem('eve:session', '{"code": 5}');
    expect(loadSession()).toBeNull();
    storage.setItem('eve:session', 'not json');
    expect(loadSession()).toBeNull();
    storage.setItem('eve:session', '{"code": "ABC234", "faction": "jove"}');
    expect(loadSession()).toBeNull();
  });

  it('namespaces device and session by the ?as= profile', () => {
    const storage = page('?as=bob');
    const bob = deviceId();
    saveSession({ code: 'ABC234', faction: 'caldari' });
    expect(storage.data.get('eve:device:bob')).toBe(bob);
    expect(storage.data.get('eve:session:bob')).toBe('{"code":"ABC234","faction":"caldari"}');

    vi.stubGlobal('location', { search: '?as=ann' });
    expect(deviceId()).not.toBe(bob);
    expect(loadSession()).toBeNull();

    vi.stubGlobal('location', { search: '' });
    expect(storage.data.has('eve:device')).toBe(false);
    expect(loadSession()).toBeNull();
  });

  it('still works when localStorage is unavailable', () => {
    vi.stubGlobal('localStorage', undefined);
    vi.stubGlobal('location', { search: '' });
    const id = deviceId();
    expect(deviceId()).toBe(id);
    saveSession({ code: 'ABC234', faction: 'amarr' });
    expect(loadSession()).toStrictEqual({ code: 'ABC234', faction: 'amarr' });
  });

  it('keeps small UI preferences per profile', () => {
    const storage = page('?as=bob');
    expect(loadPref('name')).toBeNull();
    savePref('name', 'Bob');
    expect(loadPref('name')).toBe('Bob');
    expect(storage.data.get('eve:pref:name:bob')).toBe('Bob');

    vi.stubGlobal('location', { search: '' });
    expect(loadPref('name')).toBeNull();
    savePref('name', 'Ann');
    expect(storage.data.get('eve:pref:name')).toBe('Ann');

    savePref('name', null);
    expect(loadPref('name')).toBeNull();
    expect(storage.data.has('eve:pref:name')).toBe(false);
  });
});

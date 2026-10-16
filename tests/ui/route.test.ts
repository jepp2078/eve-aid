import { describe, expect, it } from 'vitest';
import { parseRoute, routeHash, type Route } from '../../src/ui/lib/route';

describe('parseRoute', () => {
  it('reads the home route from an empty or bare hash', () => {
    expect(parseRoute('')).toStrictEqual({ name: 'home' });
    expect(parseRoute('#')).toStrictEqual({ name: 'home' });
    expect(parseRoute('#/')).toStrictEqual({ name: 'home' });
  });

  it('reads host, game, rules and gallery', () => {
    expect(parseRoute('#/rules')).toStrictEqual({ name: 'rules' });
    expect(parseRoute('#/host')).toStrictEqual({ name: 'host' });
    expect(parseRoute('#/game')).toStrictEqual({ name: 'game' });
    expect(parseRoute('#/game/')).toStrictEqual({ name: 'game' });
    expect(parseRoute('#/gallery')).toStrictEqual({ name: 'gallery' });
  });

  it('reads a join link with or without a code, normalising the code', () => {
    expect(parseRoute('#/join')).toStrictEqual({ name: 'join', code: '' });
    expect(parseRoute('#/join/abc234')).toStrictEqual({ name: 'join', code: 'ABC234' });
    expect(parseRoute('#/join/ABC%C2%B7234')).toStrictEqual({ name: 'join', code: 'ABC234' });
    expect(parseRoute('#/join/ABC·234')).toStrictEqual({ name: 'join', code: 'ABC234' });
  });

  it('survives a malformed escape in the hash', () => {
    expect(parseRoute('#/join/%E0%A4%A').name).toBe('join');
  });

  it('reads the big-screen table flag', () => {
    expect(parseRoute('#/table?big')).toStrictEqual({ name: 'table', big: true, code: '' });
    expect(parseRoute('#/table?big=1')).toStrictEqual({ name: 'table', big: true, code: '' });
    expect(parseRoute('#/table')).toStrictEqual({ name: 'table', big: false, code: '' });
  });

  it('reads the big-screen table game code, normalised', () => {
    expect(parseRoute('#/table?big&code=abc234')).toStrictEqual({ name: 'table', big: true, code: 'ABC234' });
    expect(parseRoute('#/table?code=ABC%C2%B7234&big')).toStrictEqual({ name: 'table', big: true, code: 'ABC234' });
    expect(parseRoute('#/table?big&code=')).toStrictEqual({ name: 'table', big: true, code: '' });
  });

  it('falls back to home for anything unknown', () => {
    expect(parseRoute('#/nowhere')).toStrictEqual({ name: 'home' });
    expect(parseRoute('#nothing')).toStrictEqual({ name: 'home' });
  });
});

describe('routeHash', () => {
  it('writes every route back to a hash that parses to the same route', () => {
    const routes: Route[] = [
      { name: 'home' },
      { name: 'host' },
      { name: 'join', code: '' },
      { name: 'join', code: 'ABC234' },
      { name: 'game' },
      { name: 'table', big: true, code: '' },
      { name: 'table', big: true, code: 'ABC234' },
      { name: 'table', big: false, code: '' },
      { name: 'rules' },
      { name: 'gallery' },
    ];
    for (const r of routes) expect(parseRoute(routeHash(r))).toStrictEqual(r);
    expect(routeHash({ name: 'join', code: 'ABC234' })).toBe('#/join/ABC234');
    expect(routeHash({ name: 'table', big: true, code: '' })).toBe('#/table?big');
    expect(routeHash({ name: 'table', big: true, code: 'ABC234' })).toBe('#/table?big&code=ABC234');
    expect(routeHash({ name: 'home' })).toBe('#/');
  });
});

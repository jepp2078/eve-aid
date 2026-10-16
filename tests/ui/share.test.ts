import { describe, expect, it } from 'vitest';
import { bestShareUrl, isLoopbackHost, joinUrl, otherShareUrls } from '../../src/ui/lib/share';

const LAN = ['http://192.168.0.162:5180', 'http://10.0.0.7:5180'];

describe('isLoopbackHost', () => {
  it('recognises the addresses only this machine can open', () => {
    for (const h of ['localhost', 'app.localhost', '127.0.0.1', '127.1.2.3', '::1', '[::1]']) expect(isLoopbackHost(h)).toBe(true);
    for (const h of ['192.168.0.162', '10.0.0.7', 'laptop.local', '']) expect(isLoopbackHost(h)).toBe(false);
  });
});

describe('bestShareUrl', () => {
  it("prefers the host's first LAN url when this page runs on the laptop itself", () => {
    expect(bestShareUrl(LAN, 'http://localhost:5180')).toBe('http://192.168.0.162:5180');
    expect(bestShareUrl(LAN, 'http://127.0.0.1:5180')).toBe('http://192.168.0.162:5180');
    expect(bestShareUrl(LAN, 'http://[::1]:5180')).toBe('http://192.168.0.162:5180');
  });

  it('keeps the address this device used when it is not a loopback address', () => {
    expect(bestShareUrl(LAN, 'http://10.0.0.7:5180')).toBe('http://10.0.0.7:5180');
    expect(bestShareUrl([], 'http://laptop.local:5180')).toBe('http://laptop.local:5180');
  });

  it('falls back to this page when the host lists nothing', () => {
    expect(bestShareUrl([], 'http://localhost:5180')).toBe('http://localhost:5180');
  });

  it('drops trailing slashes', () => {
    expect(bestShareUrl(['http://192.168.0.162:5180/'], 'http://localhost:5180')).toBe('http://192.168.0.162:5180');
  });
});

describe('otherShareUrls', () => {
  it('lists the remaining addresses without the chosen one', () => {
    expect(otherShareUrls(LAN, 'http://192.168.0.162:5180')).toStrictEqual(['http://10.0.0.7:5180']);
    expect(otherShareUrls(['http://192.168.0.162:5180/'], 'http://192.168.0.162:5180')).toStrictEqual([]);
  });
});

describe('joinUrl', () => {
  it('points at the join route with the code', () => {
    expect(joinUrl('http://192.168.0.162:5180', 'ABC234')).toBe('http://192.168.0.162:5180/#/join/ABC234');
    expect(joinUrl('http://192.168.0.162:5180/', 'ABC234')).toBe('http://192.168.0.162:5180/#/join/ABC234');
  });
});

import { describe, expect, it } from 'vitest';
import { qrMatrix, qrPath } from '../../src/ui/lib/qr';

describe('qrPath', () => {
  it('draws one rectangle per horizontal run of dark modules', () => {
    expect(
      qrPath([
        [true, true, false],
        [false, true, true],
        [true, false, true],
      ]),
    ).toBe('M0 0h2v1h-2z M1 1h2v1h-2z M0 2h1v1h-1z M2 2h1v1h-1z');
  });

  it('draws nothing for an all-light matrix', () => {
    expect(qrPath([[false, false]])).toBe('');
  });
});

describe('qrMatrix', () => {
  it('encodes a join link as a square matrix with finder patterns in three corners', () => {
    const m = qrMatrix('http://192.168.0.162:5180/#/join/ABC234');
    const n = m.length;
    expect(n).toBeGreaterThanOrEqual(21);
    expect(m.every((row) => row.length === n)).toBe(true);
    // Finder pattern corners are dark; the module just inside the separator ring is light.
    for (const [r, c] of [
      [0, 0],
      [0, n - 1],
      [n - 1, 0],
    ] as const) expect(m[r]![c]).toBe(true);
    expect(m[1]![1]).toBe(false);
  });
});

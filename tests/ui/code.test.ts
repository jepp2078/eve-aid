import { describe, expect, it } from 'vitest';
import { CODE_LENGTH, extractCode, formatCode, isCompleteCode, normalizeCode } from '../../src/ui/lib/code';

describe('normalizeCode', () => {
  it('upper-cases and drops separators and spaces', () => {
    expect(normalizeCode('abc234')).toBe('ABC234');
    expect(normalizeCode('ABC·234')).toBe('ABC234');
    expect(normalizeCode(' abc-234 ')).toBe('ABC234');
  });

  it('drops characters the code alphabet never uses (I, O, 0, 1)', () => {
    expect(normalizeCode('IO01AB')).toBe('AB');
    expect(normalizeCode('io')).toBe('');
  });

  it('stops at six characters', () => {
    expect(CODE_LENGTH).toBe(6);
    expect(normalizeCode('ABCDEFGH')).toBe('ABCDEF');
  });
});

describe('extractCode', () => {
  it('finds the code in a pasted join link', () => {
    expect(extractCode('http://192.168.0.162:5180/#/join/abc234')).toBe('ABC234');
    expect(extractCode('http://192.168.0.162:5180/?as=a#/join/ABC%C2%B7234')).toBe('ABC234');
  });

  it('treats any other text as a typed code', () => {
    expect(extractCode('xyz 789')).toBe('XYZ789');
    expect(extractCode('ABC·234')).toBe('ABC234');
  });
});

describe('formatCode', () => {
  it('splits a code after the third character with a middle dot', () => {
    expect(formatCode('ABC234')).toBe('ABC·234');
    expect(formatCode('ABCD')).toBe('ABC·D');
  });

  it('leaves three characters or fewer alone', () => {
    expect(formatCode('AB')).toBe('AB');
    expect(formatCode('ABC')).toBe('ABC');
    expect(formatCode('')).toBe('');
  });
});

describe('isCompleteCode', () => {
  it('is true only for six alphabet characters', () => {
    expect(isCompleteCode('ABC234')).toBe(true);
    expect(isCompleteCode('ABC23')).toBe(false);
    expect(isCompleteCode('abc234')).toBe(false);
    expect(isCompleteCode('ABC231')).toBe(false);
  });
});

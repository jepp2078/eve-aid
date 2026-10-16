import { describe, expect, it } from 'vitest';
import { keepRepeating, stepValue } from '../../src/ui/lib/stepper';

describe('stepValue', () => {
  it('steps from the given value within the limits', () => {
    expect(stepValue(3, 1, { min: 0, max: 12, step: 1 })).toBe(4);
    expect(stepValue(3, -1, { min: 0, max: 12, step: 1 })).toBe(2);
    expect(stepValue(3, 1, { min: 0, max: 12, step: 5 })).toBe(8);
  });

  it('clamps to the limits and says null when nothing would change', () => {
    expect(stepValue(11, 1, { min: 0, max: 12, step: 5 })).toBe(12);
    expect(stepValue(12, 1, { min: 0, max: 12, step: 1 })).toBeNull();
    expect(stepValue(0, -1, { min: 0, max: 12, step: 1 })).toBeNull();
  });

  it('always starts from the value the parent holds, so a rejected change is not built upon', () => {
    // The parent refused 4 and still shows 3: the next step proposes 4 again, not 5.
    expect(stepValue(3, 1, { min: 0, max: 12, step: 1 })).toBe(4);
  });
});

describe('keepRepeating', () => {
  it('continues while the parent accepted the last proposed value', () => {
    expect(keepRepeating(4, 4)).toBe(true);
  });

  it('stops when the parent rejected or changed the last proposed value', () => {
    expect(keepRepeating(3, 4)).toBe(false);
    expect(keepRepeating(6, 4)).toBe(false);
  });

  it('continues when nothing was proposed yet', () => {
    expect(keepRepeating(3, null)).toBe(true);
  });
});

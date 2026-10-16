/** Stepper arithmetic, kept pure: every step starts from the value the parent currently holds. */

export interface StepLimits {
  min: number;
  max: number;
  step: number;
}

/** The value one step up (`dir` 1) or down (-1) from `value`, clamped; null when the limit leaves it unchanged. */
export function stepValue(value: number, dir: 1 | -1, { min, max, step }: StepLimits): number | null {
  const next = Math.min(max, Math.max(min, value + dir * step));
  return next === value ? null : next;
}

/**
 * Whether hold-to-repeat should go on: only while the parent took the last proposed value (`proposed`). A parent
 * that refused it (or set something else) stops the repeat instead of being flooded.
 */
export function keepRepeating(value: number, proposed: number | null): boolean {
  return proposed === null || value === proposed;
}

/**
 * A −/+ stepper with 48 px buttons and the value in the middle. Holding a button repeats (after 400 ms, then every
 * 80 ms) until released, the limit is reached or the parent refuses a value; a keyboard or assistive-tech click steps
 * once. It is fully controlled: every step starts from `value`, never from a value the parent did not accept.
 */
import { useEffect, useId, useLayoutEffect, useRef, type MouseEvent, type PointerEvent, type ReactNode } from 'react';
import { Icon } from '../icons';
import { keepRepeating, stepValue, type StepLimits } from '../lib/stepper';

export interface StepperProps {
  value: number;
  onChange: (value: number) => void;
  /** Accessible name, also shown as a label unless `hideLabel`. */
  label: string;
  hideLabel?: boolean;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  /** How the value is shown (default: the number). */
  format?: (value: number) => ReactNode;
}

const HOLD_DELAY_MS = 400;
const REPEAT_MS = 80;

export function Stepper({ value, onChange, label, hideLabel = false, min = 0, max = Number.POSITIVE_INFINITY, step = 1, disabled = false, format }: StepperProps) {
  const id = useId();
  /** The value the parent holds now (read by the repeat timer); never ahead of the parent. */
  const valueRef = useRef(value);
  /** The last value proposed by a held button, to notice a parent that refuses it. */
  const proposed = useRef<number | null>(null);
  const timers = useRef<{ hold: ReturnType<typeof setTimeout> | null; repeat: ReturnType<typeof setInterval> | null }>({ hold: null, repeat: null });
  /** A pointer press stepped already; its trailing click must not step again. */
  const pressed = useRef(false);
  const onChangeRef = useRef(onChange);
  const limits = useRef<StepLimits>({ min, max, step });

  useLayoutEffect(() => {
    valueRef.current = value;
    onChangeRef.current = onChange;
    limits.current = { min, max, step };
  });

  const stop = () => {
    const t = timers.current;
    if (t.hold !== null) clearTimeout(t.hold);
    if (t.repeat !== null) clearInterval(t.repeat);
    t.hold = null;
    t.repeat = null;
    proposed.current = null;
  };
  useEffect(() => stop, []);

  /** Proposes one step from the parent's current value; false when the limit stops it. */
  const stepBy = (dir: 1 | -1): boolean => {
    const next = stepValue(valueRef.current, dir, limits.current);
    if (next === null) return false;
    proposed.current = next;
    onChangeRef.current(next);
    return true;
  };

  const press = (dir: 1 | -1) => (e: PointerEvent<HTMLButtonElement>) => {
    if (disabled || e.button !== 0) return;
    stop();
    pressed.current = true;
    if (!stepBy(dir)) return;
    timers.current.hold = setTimeout(() => {
      timers.current.repeat = setInterval(() => {
        if (!keepRepeating(valueRef.current, proposed.current) || !stepBy(dir)) stop();
      }, REPEAT_MS);
    }, HOLD_DELAY_MS);
  };

  const click = (dir: 1 | -1) => (e: MouseEvent<HTMLButtonElement>) => {
    // A pointer press already stepped. Keyboard clicks (detail 0) and assistive-tech clicks have no press before them.
    const fromPress = e.detail !== 0 && pressed.current;
    pressed.current = false;
    if (!fromPress) stepBy(dir);
  };

  const buttonProps = (dir: 1 | -1) => ({
    type: 'button' as const,
    className: 'stepper-btn',
    disabled: disabled || (dir === -1 ? value <= min : value >= max),
    onPointerDown: press(dir),
    onPointerUp: stop,
    onPointerLeave: stop,
    onPointerCancel: stop,
    onClick: click(dir),
    onContextMenu: (e: MouseEvent) => e.preventDefault(),
  });

  return (
    <div className="stepper" role="group" aria-labelledby={id}>
      <span id={id} className={hideLabel ? 'sr-only' : 'stepper-label'}>
        {label}
      </span>
      <div className="stepper-controls">
        <button {...buttonProps(-1)} aria-label={`Decrease ${label}`}>
          <Icon name="minus" />
        </button>
        <output className="stepper-value num" aria-live="polite">
          {format ? format(value) : value}
        </output>
        <button {...buttonProps(1)} aria-label={`Increase ${label}`}>
          <Icon name="plus" />
        </button>
      </div>
    </div>
  );
}

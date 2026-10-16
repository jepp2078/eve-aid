/**
 * The dice pad (the most important control in the app): one large button per face the orbit's dice
 * can show, drawn like the physical die (white faces on light tiles, black faces on dark tiles with a light border).
 * A tap adds one (count badge); "−" beside the badge takes one away; a long press opens a 0–10 strip for that face,
 * and "Enter numbers" switches every face to a number field (the visible alternative to the long press). Under the
 * grid: "Undo last tap" and "Clear". Above it, the pool meter ("6 of 8 dice entered · 2 blank") and the extra-die
 * buttons for card effects. Counts never exceed the pool (per colour and in total); the model is `lib/dicePad`. The
 * pad announces nothing itself: the attack panel keeps one polite live summary (`padSummary`).
 */
import { useEffect, useId, useRef, useState, type PointerEvent } from 'react';
import { DieFace, FACE_LABEL, Icon } from '../../icons';
import {
  addExtra,
  clearPad,
  entered,
  faceMax,
  PAD_FACES,
  padMeter,
  setFace,
  STRIP_MAX,
  tapFace,
  undoTap,
  type DieColor,
  type PadDraft,
  type PadFace,
  type PadLimits,
} from '../../lib/dicePad';

/** A press this long opens the 0–10 strip instead of adding a die. */
const LONG_PRESS_MS = 450;

const SHORT_FACE: Record<PadFace, string> = {
  aim: 'Aim',
  aim2: '2× Aim',
  aimDamage: 'Aim + Damage',
  damage: 'Damage',
  damage2: '2× Damage',
  crit: 'Crit',
};

export interface DicePadProps {
  /** The die colours this orbit rolls. */
  colours: DieColor[];
  /** The pool as rolled (before extra dice): per colour, of either colour. */
  pool: { white: number; black: number; choice: number };
  draft: PadDraft;
  limits: PadLimits;
  onChange: (next: PadDraft) => void;
  disabled?: boolean;
}

export function DicePad({ colours, pool, draft, limits, onChange, disabled = false }: DicePadProps) {
  const [strip, setStrip] = useState<{ die: DieColor; face: PadFace } | null>(null);
  const [numbers, setNumbers] = useState(false);
  const meter = padMeter(draft.counts, limits);
  const e = entered(draft.counts);
  const canUndo = draft.history.length > 0;

  return (
    <section className="pad" aria-label="Dice pad">
      <div className="pad-meter">
        <p className="pad-meter-text num">
          <Icon name="dice" size="1.25rem" />
          <span>
            <strong>{meter.entered}</strong> of {meter.total} dice entered · <strong>{meter.blank}</strong> blank
          </span>
        </p>
        <div className="pad-extra" role="group" aria-label="Extra dice for card effects">
          {colours.map((die) => (
            <span key={die} className="pad-extra-item">
              {draft.extra[die] > 0 && (
                <button type="button" className="btn btn-ghost pad-extra-minus" disabled={disabled} onClick={() => onChange(addExtra(draft, die, -1))}>
                  <Icon name="minus" size="1rem" />
                  <span className="sr-only">Remove an extra {die} die</span>
                </button>
              )}
              <button type="button" className="btn btn-secondary pad-extra-btn" disabled={disabled} onClick={() => onChange(addExtra(draft, die, 1))}>
                <Icon name="plus" size="1rem" />
                <span>
                  1 {die}
                  <span className="sr-only"> die for a card effect</span>
                  {draft.extra[die] > 0 && <span className="num"> ({draft.extra[die]} added)</span>}
                </span>
              </button>
            </span>
          ))}
        </div>
      </div>
      {colours.map((die) => {
        const fromPool = die === 'white' ? pool.white : pool.black;
        const extra = draft.extra[die];
        const parts = [String(fromPool), pool.choice > 0 ? `${pool.choice} of either colour` : null, extra > 0 ? `${extra} extra` : null].filter((x) => x !== null);
        return (
          <div key={die} className="pad-group">
            <h4 className="pad-group-title num">
              {die === 'white' ? 'White dice' : 'Black dice'}
              {colours.length > 1 && `: ${e[die]} of ${limits[die]}`}
              {parts.length > 1 && <span className="muted"> ({parts.join(' + ')})</span>}
            </h4>
            <div className="pad-grid">
              {PAD_FACES[die].map((face) => (
                <FaceTile
                  key={face}
                  die={die}
                  face={face}
                  count={draft.counts[die][face] ?? 0}
                  max={faceMax(draft.counts, limits, die, face)}
                  numbers={numbers}
                  disabled={disabled}
                  stripOpen={strip?.die === die && strip.face === face}
                  onTap={() => onChange(tapFace(draft, limits, die, face))}
                  onSet={(n) => onChange(setFace(draft, limits, die, face, n))}
                  onLongPress={() => setStrip({ die, face })}
                />
              ))}
            </div>
            {strip !== null && strip.die === die && (
              <CountStrip
                die={die}
                face={strip.face}
                value={draft.counts[die][strip.face] ?? 0}
                max={faceMax(draft.counts, limits, die, strip.face)}
                onPick={(n) => {
                  onChange(setFace(draft, limits, die, strip.face, n));
                  setStrip(null);
                }}
                onClose={() => setStrip(null)}
              />
            )}
          </div>
        );
      })}
      <div className="pad-tools">
        <button type="button" className="btn btn-ghost" disabled={disabled || !canUndo} onClick={() => onChange(undoTap(draft))}>
          <Icon name="undo" size="1.1rem" />
          Undo last tap
        </button>
        <button type="button" className="btn btn-ghost" disabled={disabled || e.total === 0} onClick={() => onChange(clearPad(draft))}>
          <Icon name="close" size="1.1rem" />
          Clear
        </button>
        <button type="button" className="btn btn-ghost" aria-pressed={numbers} onClick={() => setNumbers((n) => !n)}>
          <Icon name={numbers ? 'dice' : 'edit'} size="1.1rem" />
          {numbers ? 'Tap faces' : 'Enter numbers'}
        </button>
      </div>
    </section>
  );
}

interface FaceTileProps {
  die: DieColor;
  face: PadFace;
  count: number;
  /** Highest count allowed now (the pool's room). */
  max: number;
  numbers: boolean;
  disabled: boolean;
  stripOpen: boolean;
  onTap: () => void;
  onSet: (n: number) => void;
  onLongPress: () => void;
}

function FaceTile({ die, face, count, max, numbers, disabled, stripOpen, onTap, onSet, onLongPress }: FaceTileProps) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The long press fired: the click that ends this press must not also add a die. */
  const longPressed = useRef(false);
  const inputId = useId();
  const full = count >= max;
  const name = `${die === 'white' ? 'White' : 'Black'} ${FACE_LABEL[face].toLowerCase()}`;
  useEffect(() => () => clearTimer(), []);

  function clearTimer() {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }
  const down = (ev: PointerEvent<HTMLButtonElement>) => {
    if (ev.button !== 0 || disabled) return;
    longPressed.current = false;
    clearTimer();
    timer.current = setTimeout(() => {
      timer.current = null;
      longPressed.current = true;
      onLongPress();
    }, LONG_PRESS_MS);
  };

  const cls = ['pad-face', `is-${die}`, count > 0 && 'has-count', stripOpen && 'is-strip'].filter(Boolean).join(' ');
  if (numbers) {
    return (
      <div className={cls}>
        <label className="pad-face-body" htmlFor={inputId}>
          <DieFace face={face} die={die} size="2.25rem" title={null} />
          <span className="pad-face-label">{SHORT_FACE[face]}</span>
        </label>
        <input
          id={inputId}
          className="input pad-face-input num"
          type="number"
          inputMode="numeric"
          min={0}
          max={Math.max(count, max)}
          value={count}
          disabled={disabled}
          aria-label={`${name}: how many`}
          onChange={(e) => onSet(Number.parseInt(e.target.value || '0', 10) || 0)}
          onFocus={(e) => e.target.select()}
        />
      </div>
    );
  }
  return (
    <div className={cls}>
      <button
        type="button"
        className="pad-face-btn"
        disabled={disabled}
        aria-disabled={full || undefined}
        aria-label={`${name}: ${count}${full ? ', pool full' : ''}. Tap to add one, hold for more`}
        onPointerDown={down}
        onPointerUp={clearTimer}
        onPointerLeave={clearTimer}
        onPointerCancel={clearTimer}
        onContextMenu={(e) => e.preventDefault()}
        onClick={() => {
          if (longPressed.current) {
            longPressed.current = false;
            return;
          }
          if (!full) onTap();
        }}
      >
        <DieFace face={face} die={die} size="2.5rem" title={null} />
        <span className="pad-face-label">{SHORT_FACE[face]}</span>
        {count > 0 && (
          <span className="pad-count num" aria-hidden="true">
            {count}
          </span>
        )}
      </button>
      {count > 0 && (
        <button type="button" className="pad-minus" disabled={disabled} aria-label={`One ${name.toLowerCase()} fewer`} onClick={() => onSet(count - 1)}>
          <Icon name="minus" size="1.1rem" />
        </button>
      )}
    </div>
  );
}

/** The 0–10 strip for one face (from a long press): counts above the pool's room are disabled. */
function CountStrip({ die, face, value, max, onPick, onClose }: { die: DieColor; face: PadFace; value: number; max: number; onPick: (n: number) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]')?.focus();
  }, [face]);
  return (
    <div className="pad-strip" ref={ref} role="group" aria-label={`How many ${die} ${FACE_LABEL[face].toLowerCase()} faces`}>
      <div className="pad-strip-head">
        <DieFace face={face} die={die} size="1.75rem" title={null} />
        <span>
          {SHORT_FACE[face]} ({die}): how many?
        </span>
        <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
          <Icon name="close" size="1.25rem" />
        </button>
      </div>
      <div className="pad-strip-nums">
        {Array.from({ length: STRIP_MAX + 1 }, (_, n) => (
          <button key={n} type="button" className="pad-strip-n num" aria-pressed={n === value} disabled={n > Math.max(value, max)} onClick={() => onPick(n)}>
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}

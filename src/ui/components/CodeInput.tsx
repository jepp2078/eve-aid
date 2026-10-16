/**
 * The 6-character room code as six boxes (`ABC·234`). One real input sits over the boxes, so typing auto-advances,
 * backspace goes back, and pasting a code or a whole join link fills everything. Lowercase is accepted; separators
 * and the never-used I, O, 0, 1 are dropped (with a hint, so a dropped character isn't a mystery).
 */
import { Fragment, useId, useState, type ClipboardEvent } from 'react';
import { Icon } from '../icons';
import { CODE_LENGTH, extractCode, normalizeCode } from '../lib/code';

export interface CodeInputProps {
  value: string;
  onChange: (code: string) => void;
  /** Called once all six characters are in. */
  onComplete?: (code: string) => void;
  autoFocus?: boolean;
  /** Error text shown under the boxes. */
  error?: string | null;
  label?: string;
}

export function CodeInput({ value, onChange, onComplete, autoFocus = false, error = null, label = 'Game code' }: CodeInputProps) {
  const id = useId();
  const [focused, setFocused] = useState(autoFocus);
  const [dropped, setDropped] = useState(false);

  const set = (next: string) => {
    onChange(next);
    if (next.length === CODE_LENGTH && next !== value) onComplete?.(next);
  };

  const onInput = (raw: string) => {
    const next = normalizeCode(raw);
    const typed = raw.replace(/[\s·.\-–—_]/g, '').slice(0, CODE_LENGTH + 1);
    setDropped(typed.length > next.length && next.length < CODE_LENGTH);
    set(next);
  };

  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    setDropped(false);
    set(extractCode(e.clipboardData.getData('text')));
  };

  const keepCaretAtEnd = (el: HTMLInputElement) => {
    const end = el.value.length;
    if (el.selectionStart !== end || el.selectionEnd !== end) el.setSelectionRange(end, end);
  };

  const active = Math.min(value.length, CODE_LENGTH - 1);
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  return (
    <div className="field">
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      <div className={error !== null ? 'code-input is-invalid' : 'code-input'}>
        <input
          id={id}
          className="code-native"
          value={value}
          onChange={(e) => onInput(e.target.value)}
          onPaste={onPaste}
          onFocus={(e) => {
            setFocused(true);
            keepCaretAtEnd(e.currentTarget);
          }}
          onBlur={() => setFocused(false)}
          onSelect={(e) => keepCaretAtEnd(e.currentTarget)}
          autoFocus={autoFocus}
          maxLength={CODE_LENGTH + 2}
          inputMode="text"
          autoCapitalize="characters"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="go"
          aria-invalid={error !== null}
          aria-describedby={error !== null ? errorId : dropped ? hintId : undefined}
        />
        <div className="code-boxes" aria-hidden="true">
          {Array.from({ length: CODE_LENGTH }, (_, i) => (
            <Fragment key={i}>
              {i === 3 && <span className="code-sep">·</span>}
              <span className={focused && i === active ? 'code-box is-active' : 'code-box'}>{value[i] ?? ''}</span>
            </Fragment>
          ))}
        </div>
      </div>
      {error !== null ? (
        <p id={errorId} className="field-error" role="alert">
          <Icon name="danger" size="1rem" />
          {error}
        </p>
      ) : (
        dropped && (
          <p id={hintId} className="field-hint">
            Codes never use I, O, 0 or 1.
          </p>
        )
      )}
    </div>
  );
}

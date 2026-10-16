/**
 * The shared frame of every Panel sheet: a bottom sheet whose header names the action, the cube it takes
 * ("Cube 4 · −5 ISK") and links to its rules; the body holds the operation builder; the sticky footer shows a live
 * before→after preview (computed by running the engine locally on a copy) or the rule error, and a Confirm button
 * named after the consequence ("Build Heretic · −4 ISK · −1 Trit") that sends exactly one command.
 *
 * Also the sheet kit: `usePreview`, `useSheetDraft` (sessionStorage per sheet; live updates never reset it) and the
 * small controls the sheets share (`Segmented`, `Tiles`, `Toggle`, `StepRow`).
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { RefId } from '../../../data/reference';
import type { ResourceKey } from '../../../data/types';
import type { Command } from '../../../engine/types';
import { BottomSheet } from '../../components/BottomSheet';
import { radioKeys, tabStop } from '../../components/radio';
import { RulesLink } from '../../components/RulesLink';
import { Stepper } from '../../components/Stepper';
import { useCommand, useMe } from '../../hooks';
import { Icon, ResourceIcon, type IconName } from '../../icons';
import { draftKey, readDraft, writeDraft } from '../../lib/drafts';
import { changeText, consequence, isCapWarning, previewCommand, type Change, type Preview, type PreviewOk } from '../../lib/preview';

/* ------------------------------------------------------------------ hooks */

/**
 * The engine's answer to `cmd` on the current game and my private doc (recomputed on every live update, so a draft
 * that became invalid shows the rule error). Null while there is no command or no game.
 */
export function usePreview(cmd: Command | null, iskNet: number | null = null): Preview | null {
  const { game, priv, faction, uid } = useMe();
  const key = cmd === null ? null : JSON.stringify(cmd);
  return useMemo(() => {
    if (key === null || game === null || faction === null) return null;
    return previewCommand({ game, priv, faction, uid, now: Date.now() }, JSON.parse(key) as Command, iskNet);
  }, [key, game, priv, faction, uid, iskNet]);
}

type SetDraft<T> = (next: T | ((d: T) => T)) => void;

/**
 * A sheet's draft: local state, restored from and saved to sessionStorage per game, seat and sheet. Game updates
 * never touch it; `reset` (after a successful Confirm) goes back to `fallback`. `fallback` must be a stable value.
 */
export function useSheetDraft<T>(sheet: string, fallback: T, sanitize: (raw: unknown) => T | null): [T, SetDraft<T>, () => void] {
  const { code, faction } = useMe();
  const key = code !== null && faction !== null ? draftKey(code, faction, sheet) : null;
  const [state, setState] = useState(() => ({ key, value: key === null ? fallback : readDraft(key, sanitize, fallback) }));
  let current = state;
  if (state.key !== key) {
    current = { key, value: key === null ? fallback : readDraft(key, sanitize, fallback) };
    setState(current);
  }
  useEffect(() => {
    if (current.key !== null) writeDraft(current.key, current.value);
  }, [current.key, current.value]);
  const set = useCallback<SetDraft<T>>(
    (next) => setState((s) => ({ key: s.key, value: typeof next === 'function' ? (next as (d: T) => T)(s.value) : next })),
    [],
  );
  const reset = useCallback(() => setState((s) => ({ key: s.key, value: fallback })), [fallback]);
  return [current.value, set, reset];
}

/* ------------------------------------------------------------------ the frame */

export interface ActionSheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  icon: IconName;
  /** "Cube 4 · −5 ISK" under the title (omit for free follow-ups and adjustments). */
  cube?: string | null;
  /** The `?` rules link target. */
  section: RefId;
  /** What Confirm sends; null while the draft is incomplete (then `hint` explains). */
  command: Command | null;
  /** The command's uncapped ISK change, so the preview can say how much the 49 cap swallows. */
  iskNet?: number | null;
  /** Confirm's verb phrase ("Build 3 ships"); the preview's main deltas are appended. */
  head: string;
  /** Confirm's whole label when the deltas would only repeat it (e.g. "Place 3 research · discard 2"). */
  confirmLabel?: string;
  /** Shown in the preview area while `command` is null. */
  hint?: string;
  /** Snackbar text after success (default: the Confirm label). */
  done?: string;
  /** After sending: whether it was applied, and the preview it was confirmed with. */
  onDone?: (ok: boolean, preview: PreviewOk) => void;
  /** Footer content above the preview (e.g. the BP meter). */
  footerTop?: ReactNode;
  /** Replaces the preview and Confirm (e.g. "Open Combat tab"). */
  footer?: ReactNode;
  /**
   * The preview of `command`, when the sheet already computes it for its body (Claim shows the rival's side);
   * otherwise the frame computes it itself, only while open.
   */
  preview?: Preview | null;
  size?: 'auto' | 'full';
  /**
   * A rules-mandated step (pending research, a card to add, minerals over 12): it can't be closed, says "Required by
   * the rules" under the title, and leaves the tab bar usable.
   */
  blocking?: boolean;
  /** A secondary choice (e.g. "Skip"), placed just above Confirm so the primary stays bottom-most, as in every footer. */
  footerSecondary?: ReactNode;
  children: ReactNode;
}

export function ActionSheet(props: ActionSheetProps) {
  const { open, onClose, title, icon, cube = null, section, command, iskNet = null, head, hint, done, onDone, footerTop, footer, size = 'auto', blocking = false, footerSecondary, children } = props;
  // A closed sheet computes nothing; a sheet that passes its own preview is not computed twice.
  const own = usePreview(open && props.preview === undefined ? command : null, iskNet);
  const preview = props.preview === undefined ? own : props.preview;
  const { run, disabled } = useCommand();
  const label = props.confirmLabel ?? (preview?.ok ? consequence(head, preview.changes) : head);

  const confirm = async () => {
    if (command === null || preview === null || !preview.ok) return;
    const ok = await run(command, { label: done ?? label });
    onDone?.(ok, preview);
  };

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      size={size}
      blocking={blocking}
      title={
        <span className="as-title">
          <span className="as-name">
            <Icon name={icon} size="1.25rem" />
            {title}
          </span>
          {cube !== null && <span className="as-cube num">{cube}</span>}
          {blocking && (
            <span className="as-mandated">
              <Icon name="reference" size="1em" />
              Required by the rules
            </span>
          )}
        </span>
      }
      headerExtra={<RulesLink section={section} />}
      footer={
        <div className="as-footer">
          {footer ?? (
            <>
              {footerTop}
              <PreviewRow preview={preview} hint={hint} />
              {footerSecondary}
              <button
                type="button"
                className="btn btn-primary btn-lg btn-block as-confirm"
                disabled={disabled || command === null || preview === null || !preview.ok}
                onClick={() => void confirm()}
              >
                {label}
              </button>
            </>
          )}
        </div>
      }
    >
      <div className="as-body">{children}</div>
    </BottomSheet>
  );
}

function ChangeChip({ c }: { c: Change }) {
  const warn = isCapWarning(c);
  const resKey: ResourceKey | 'vp' | null = c.kind === 'res' ? c.key : c.kind === 'iskCap' ? 'isk' : null;
  return (
    <li className={warn ? 'as-chip is-warn' : 'as-chip'}>
      {warn ? <Icon name="warn" size="1em" /> : resKey !== null ? <ResourceIcon kind={resKey} title={null} size="1em" /> : null}
      <span className="num">{changeText(c)}</span>
    </li>
  );
}

/** The before→after row, the rule error (danger, icon + words), or a hint while the draft is incomplete. */
export function PreviewRow({ preview, hint }: { preview: Preview | null; hint?: string }) {
  if (preview === null) {
    return (
      <p className="as-hint" aria-live="polite">
        <Icon name="info" size="1.1rem" />
        <span>{hint ?? 'Make a choice above'}</span>
      </p>
    );
  }
  if (!preview.ok) {
    return (
      <p className="as-error" aria-live="polite">
        <Icon name="danger" size="1.1rem" />
        <span>
          <strong>Not possible:</strong> {preview.error.message}
        </span>
      </p>
    );
  }
  const shown = preview.changes.filter((c) => c.kind !== 'count' || c.id !== 'cubes' || preview.changes.length === 1);
  return (
    <div className="as-preview" aria-live="polite">
      {shown.length === 0 ? (
        <p className="as-hint">
          <Icon name="check" size="1.1rem" />
          <span>No change to your resources</span>
        </p>
      ) : (
        <ul className="as-changes" aria-label="After confirming">
          {shown.map((c, i) => (
            <ChangeChip key={i} c={c} />
          ))}
        </ul>
      )}
      {preview.mineralsOver > 0 && (
        <p className="as-warn">
          <Icon name="warn" size="1.1rem" />
          <span>
            Over the 12-mineral limit: you will discard {preview.mineralsOver}.
          </span>
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ shared controls */

export interface Option<T extends string> {
  value: T;
  label: string;
  icon?: ReactNode;
  /** A second line (price, "2 left"). */
  note?: string;
  /** A small count pill after the label (e.g. items in a Build tab). */
  count?: number;
  disabled?: boolean;
}

/** A segmented radio group (Sell | Buy, Basic minerals | Morphite) with arrow keys. */
export function Segmented<T extends string>({ label, options, value, onChange }: { label: string; options: Option<T>[]; value: T; onChange: (v: T) => void }) {
  const values = options.map((o) => o.value);
  const enabled = (v: T) => !options.find((o) => o.value === v)?.disabled;
  return (
    <div className="seg" role="radiogroup" aria-label={label} onKeyDown={radioKeys(values, value, onChange, enabled)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          data-value={o.value}
          tabIndex={tabStop(values, value, o.value, enabled)}
          disabled={o.disabled}
          className={o.value === value ? 'seg-btn is-selected' : 'seg-btn'}
          onClick={() => onChange(o.value)}
        >
          {o.icon}
          <span>{o.label}</span>
          {o.count !== undefined && o.count > 0 && <span className="seg-count num">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

/**
 * A grid of tiles acting as one radio group: `stack` puts the icon above the name and note, `row` beside them (for
 * longer names in two columns).
 */
export function Tiles<T extends string>({
  label,
  options,
  value,
  onChange,
  columns = 4,
  layout = 'stack',
}: {
  label: string;
  options: Option<T>[];
  value: T | null;
  onChange: (v: T) => void;
  columns?: 2 | 3 | 4;
  layout?: 'stack' | 'row';
}) {
  const values = options.map((o) => o.value);
  const enabled = (v: T) => !options.find((o) => o.value === v)?.disabled;
  return (
    <div className={`tiles tiles-${columns} tiles-${layout}`} role="radiogroup" aria-label={label} onKeyDown={radioKeys(values, value, onChange, enabled)}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            data-value={o.value}
            tabIndex={tabStop(values, value, o.value, enabled)}
            disabled={o.disabled}
            className={on ? 'tile is-selected' : 'tile'}
            onClick={() => onChange(o.value)}
          >
            {o.icon}
            <span className="tile-text">
              <span className="tile-name">{o.label}</span>
              {o.note !== undefined && <span className="tile-note num">{o.note}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** A labelled on/off switch row (44 px+), with the state in words. */
export function Toggle({ label, note, checked, onChange, disabled = false }: { label: string; note?: string; checked: boolean; onChange: (on: boolean) => void; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} className="toggle-row" onClick={() => onChange(!checked)} disabled={disabled}>
      <span className="toggle-text">
        <span className="toggle-label">{label}</span>
        {note !== undefined && <span className="toggle-note">{note}</span>}
      </span>
      <span className={checked ? 'switch is-on' : 'switch'} aria-hidden="true">
        <span className="switch-word">{checked ? 'Yes' : 'No'}</span>
        <span className="switch-knob" />
      </span>
    </button>
  );
}

/** A stepper on one row with an optional icon and an "after" note (e.g. "12 → 15"). Driven by local draft state. */
export function StepRow({
  label,
  icon,
  value,
  onChange,
  min = 0,
  max,
  note,
  format,
}: {
  label: string;
  icon?: ReactNode;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  note?: ReactNode;
  format?: (v: number) => ReactNode;
}) {
  return (
    <div className="step-row">
      <span className="step-row-label">
        {icon}
        <span className="step-row-text">
          <span>{label}</span>
          {note !== undefined && note !== null && <span className="step-row-note num">{note}</span>}
        </span>
      </span>
      <Stepper label={label} hideLabel value={value} onChange={onChange} min={min} max={max} format={format} />
    </div>
  );
}

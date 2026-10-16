/**
 * Small pieces every combat stage shares:
 *   - `StageLayout`: the stage's panel (status, forms) and the board side by side on wide screens, stacked on phones,
 *     with an optional sticky footer;
 *   - `CombatFooter`: the stage's primary action in the thumb zone, above the tab bar (publishes its height as
 *     `--cf-h` so toasts sit above it);
 *   - `CombatPreview`: the engine's verdict on the draft command (a hint, the rule error with icon + words, or ✓ and
 *     a summary), the only gate of the primary button;
 *   - `CheckRow`: a local checklist tick ("Strategy card chosen face down");
 *   - `ShipDetailSheet`: a ship's card plus its numbers in this battle;
 *   - `PoolInfo`: "Pool 5 ⓘ", expanding to how the pool adds up and which dice to roll;
 *   - `VerdictLine`: a draft attack's verdict above its primary button, with a tone icon;
 *   - `ReminderStrip` / `Reminders`: ability and strategy-card reminders as source chips that unfold, or as notices.
 */
import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ship as shipData } from '../../../data/ships';
import type { FactionId } from '../../../data/types';
import type { CombatShip, CombatState, GameState, Side } from '../../../engine/types';
import { BottomSheet } from '../../components/BottomSheet';
import { NamedText } from '../../components/CardName';
import { CardText } from '../../components/CardText';
import { ShipCard } from '../../components/ShipCard';
import { Icon } from '../../icons';
import type { DicePool } from '../../../engine/combat/abilities';
import { difOrbit, lineText, poolBreakdown, poolDice, tokenStats } from '../../lib/combatBoard';
import type { ToolSection, VerdictTone } from '../../lib/combatFight';
import type { Preview } from '../../lib/preview';

/** What every stage view gets from CombatScreen's router. */
export interface StageProps {
  game: GameState;
  c: CombatState;
  /** This device's seat (null: no seat). */
  faction: FactionId | null;
  /** The side this device fights on; null for spectators. */
  side: Side | null;
  /** The read-only board, ready to place (a stage may render its own CombatBoard instead). */
  board: ReactNode;
  /** Opens the combat tools ("More") at a section, e.g. from a Widow or Panther reminder. */
  openTools?: (section?: ToolSection) => void;
}

const VERDICT_ICON = { miss: 'close', blocked: 'info', hit: 'check', kill: 'danger' } as const;

/** The verdict of a draft attack above its primary button ("LOCKED · 1 DAMAGE · Crow DESTROYED"), with a tone icon. */
export function VerdictLine({ tone, text, live = true }: { tone: VerdictTone; text: string; live?: boolean }) {
  return (
    <p className={`cb-verdict-line is-${tone}`} aria-live={live ? 'polite' : undefined}>
      <Icon name={VERDICT_ICON[tone]} size="1.1rem" />
      <span>
        <NamedText text={text} />
      </span>
    </p>
  );
}

/**
 * The reminders strip of an attack: one chip per reminder, named by its source
 * ("Heretic", "Offensive Tactic"); a tap unfolds its text below the chips.
 */
export function ReminderStrip({ items, label = 'Reminders' }: { items: readonly string[]; label?: string }) {
  const [open, setOpen] = useState<string | null>(null);
  const id = useId();
  if (items.length === 0) return null;
  const shown = items.find((t) => t === open) ?? null;
  return (
    <div className="cb-strip">
      <p className="cb-strip-label">
        <Icon name="info" size="1.1rem" />
        {label}
      </p>
      <div className="chip-row">
        {items.map((t) => (
          <button key={t} type="button" className={t === shown ? 'chip is-selected' : 'chip'} aria-expanded={t === shown} aria-controls={id} onClick={() => setOpen(t === shown ? null : t)}>
            {t.split(':')[0]}
            <Icon name={t === shown ? 'chevronUp' : 'chevronDown'} size="1em" />
          </button>
        ))}
      </div>
      {shown !== null && (
        <div className="notice notice-info cb-reminder" id={id}>
          <Icon name="info" size="1.25rem" />
          <CardText text={shown} ship terms={false} />
        </div>
      )}
    </div>
  );
}

/**
 * Reminder texts (ship abilities, strategy cards) as info notices, with their card tokens drawn as icons; `action`
 * adds a button under them (e.g. "Open combat tools").
 */
export function Reminders({ items, title, action }: { items: readonly string[]; title?: string; action?: ReactNode }) {
  if (items.length === 0) return null;
  return (
    <div className="cb-reminders">
      {title !== undefined && <h3 className="cb-reminders-title">{title}</h3>}
      {items.map((text) => (
        <div key={text} className="notice notice-info cb-reminder">
          <Icon name="info" size="1.25rem" />
          <CardText text={text} ship terms={false} />
        </div>
      ))}
      {action}
    </div>
  );
}

export function StageLayout({ panel, main, footer }: { panel: ReactNode; main?: ReactNode; footer?: ReactNode }) {
  return (
    <>
      <div className="cb-layout">
        <div className="cb-panel">{panel}</div>
        {main !== undefined && <div className="cb-main">{main}</div>}
      </div>
      {footer}
    </>
  );
}

/** Sticky above the tab bar; its live height goes to `--cf-h` (TabShell adds it to the toast inset). */
export function CombatFooter({ label, children }: { label: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const root = document.documentElement;
    const set = () => root.style.setProperty('--cf-h', `${el.offsetHeight}px`);
    set();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(set);
    ro?.observe(el);
    return () => {
      ro?.disconnect();
      root.style.removeProperty('--cf-h');
    };
  }, []);
  return (
    <div className="cb-footer" role="region" aria-label={label} ref={ref}>
      <div className="cb-footer-inner">{children}</div>
    </div>
  );
}

/**
 * The engine's answer to the draft: a hint while there is no command, the rule error, or ✓ + `ok`. `live: false`
 * when the stage has its own live summary (the attack panel).
 */
export function CombatPreview({ preview, hint, ok, live = true }: { preview: Preview | null; hint: string; ok: string; live?: boolean }) {
  const polite = live ? 'polite' : undefined;
  if (preview === null) {
    return (
      <p className="as-hint" aria-live={polite}>
        <Icon name="info" size="1.1rem" />
        <span>{hint}</span>
      </p>
    );
  }
  if (!preview.ok) {
    return (
      <p className="as-error" aria-live={polite}>
        <Icon name="danger" size="1.1rem" />
        <span>
          <strong>Not possible:</strong> {preview.error.message}
        </span>
      </p>
    );
  }
  return (
    <p className="cb-ok" aria-live={polite}>
      <Icon name="check" size="1.1rem" />
      <span>{ok}</span>
    </p>
  );
}

/**
 * "Pool 5 ⓘ": a 44 px pill that expands, in place, to how the pool adds up and which dice to roll. Put it in a
 * wrapping flex row (a lane or side header); the breakdown takes a line of its own.
 */
export function PoolInfo({ pool }: { pool: DicePool }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <>
      <button type="button" className="cb-pool" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        <span className="num">Pool {pool.total}</span>
        <Icon name="info" size="1.1rem" />
        <span className="sr-only">: how it adds up</span>
      </button>
      {open && (
        <ul className="cb-why cb-pool-why" id={id}>
          <li className="num is-mod">{poolBreakdown(pool)}</li>
          <li>Roll {poolDice(pool)}</li>
        </ul>
      )}
    </>
  );
}

export function CheckRow({ checked, onChange, children }: { checked: boolean; onChange: (on: boolean) => void; children: ReactNode }) {
  return (
    <label className={checked ? 'check-item is-done' : 'check-item'}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="check-box" aria-hidden="true">
        {checked && <Icon name="check" size="1rem" />}
      </span>
      <span>{children}</span>
    </label>
  );
}

/**
 * A battle ship's numbers in this battle (each with its breakdown), then its card. `uid` stays set while the sheet
 * closes, so the content doesn't vanish during the exit animation.
 */
export function ShipDetailSheet({ game, c, uid, open, onClose }: { game: GameState; c: CombatState; uid: string | null; open: boolean; onClose: () => void }) {
  const live: CombatShip | null = uid === null ? null : (c.ships.find((s) => s.uid === uid) ?? null);
  const t = live === null ? null : tokenStats(game, c, live, difOrbit(c, live));
  return (
    <BottomSheet open={open && live !== null} onClose={onClose} title={live === null ? 'Ship' : shipData(live.ship).name}>
      {live !== null && t !== null && (
        <div className="stack">
          <section className="card stack-sm" aria-labelledby="cb-detail-battle">
            <h3 id="cb-detail-battle">In this battle</h3>
            <ul className="cb-why">
              {[t.dif, t.atk, t.sup, t.red].map((l) => (
                <li key={l.label} className="num">
                  {lineText(l)}
                </li>
              ))}
              <li className="num">
                HP {t.hp} · {t.damage} damage · {Math.max(0, t.hp - t.damage)} left
              </li>
              {t.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </section>
          <ShipCard ship={shipData(live.ship)} headingLevel={3} />
        </div>
      )}
    </BottomSheet>
  );
}

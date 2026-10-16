/**
 * An attack's result: who attacked whom from which orbit, the verdict in large type
 * ("LOCKED · 3 DAMAGE · Rifter DESTROYED", "MISSED (2/3 aims)") with an icon and words, and the breakdown underneath.
 * Undo is the snackbar's (and the Table log's). Collapsed, it is one line above the next attack that expands in place.
 * Open or folded follows `collapsed` (an earlier strike folds when a newer one lands), unless the player tapped it
 * open or shut since `collapsed` last changed. After a kill, the attacker sees its "when it destroys" reminders
 * (Flycatcher).
 */
import { useState } from 'react';
import { killReminders, resultBreakdown, resultOpen, resultTarget, verdict, type ResultToggle, type ToolSection, type VerdictTone } from '../../lib/combatFight';
import type { AttackResult, CombatState, GameState, Side } from '../../../engine/types';
import { ship as shipData } from '../../../data/ships';
import { ShipName } from '../../components/CardName';
import { FactionGlyph, Icon, type IconName } from '../../icons';
import { ORBIT_SHORT, SIDE_SHORT } from '../../lib/combatBoard';
import { factionName } from '../../lib/labels';
import { Reminders } from './CombatParts';

const TONE_ICON: Record<VerdictTone, IconName> = { miss: 'close', blocked: 'info', hit: 'check', kill: 'danger' };

export interface ResultCardProps {
  game: GameState;
  c: CombatState;
  r: AttackResult;
  /** The viewer's side (kill reminders for the attacker). */
  mySide: Side | null;
  /** Start as the one-line summary. */
  collapsed?: boolean;
  /** "Last attack", "Your attack" … */
  title?: string;
  /** Opens the combat tools (for a kill reminder such as the Flycatcher's extra damage). */
  openTools?: (section?: ToolSection) => void;
}

export function ResultCard({ game, c, r, mySide, collapsed = false, title = 'Last attack', openTools }: ResultCardProps) {
  // The player's own fold or unfold, remembered with the `collapsed` it was made under (see `resultOpen`).
  const [toggled, setToggled] = useState<ResultToggle | null>(null);
  const open = resultOpen(toggled, collapsed);
  const setOpen = (o: boolean) => setToggled({ open: o, under: collapsed });
  const t = resultTarget(c, r);
  const name = t === null ? 'the target' : shipData(t.ship).name;
  const v = verdict(r, name);
  const att = c.sides[r.side].faction;
  const def = t === null ? null : c.sides[t.side].faction;
  const step = `${ORBIT_SHORT[r.orbit]}·${SIDE_SHORT[r.side]}`;
  const killNotes = r.side === mySide ? killReminders(game, c, r) : [];

  if (!open) {
    return (
      <button type="button" className={`cb-result-line is-${v.tone}`} aria-expanded={false} onClick={() => setOpen(true)}>
        <Icon name="chevronRight" size="1.1rem" />
        <span className="cb-result-line-text">
          <span className="muted">
            {title} · {step}
          </span>{' '}
          <FactionGlyph faction={att} size="0.9em" /> {factionName(att)} → {name}: <strong>{v.head}</strong>
        </span>
      </button>
    );
  }
  return (
    <section className={`card stack-sm cb-result is-${v.tone}`} aria-label={`${title}: ${v.head}`}>
      <header className="cb-result-head">
        <span className="cb-result-title">
          {title} · {step}
        </span>
        {collapsed && (
          <button type="button" className="btn btn-ghost cb-result-fold" aria-expanded={true} onClick={() => setOpen(false)}>
            <Icon name="chevronUp" size="1.1rem" />
            <span className="sr-only">Collapse</span>
          </button>
        )}
      </header>
      <p className="cb-result-who">
        <span data-faction={att} className="cb-result-faction">
          <FactionGlyph faction={att} size="1em" /> {factionName(att)}
        </span>{' '}
        → {def !== null && <FactionGlyph faction={def} size="1em" />} {def !== null ? `${factionName(def)}'s ` : ''}
        {t === null ? name : <ShipName ship={shipData(t.ship)} />} <span className="muted">({t?.orbit ?? r.orbit} orbit)</span>
      </p>
      <p className="cb-verdict" aria-live="polite">
        <Icon name={TONE_ICON[v.tone]} size="1.5rem" />
        <span>{v.head}</span>
      </p>
      <ul className="cb-why">
        {resultBreakdown(r, name).map((line, i) => (
          <li key={i} className={i < 2 ? 'num is-mod' : 'num'}>
            {line}
          </li>
        ))}
      </ul>
      <Reminders
        items={killNotes}
        action={
          openTools === undefined ? undefined : (
            <button type="button" className="btn btn-secondary" onClick={() => openTools('damage')}>
              <Icon name="more" size="1.1rem" />
              Adjust damage
            </button>
          )
        }
      />
    </section>
  );
}

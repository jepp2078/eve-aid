/**
 * One ship on the orbit board: faction glyph and name (a tap opens its ship card), Leader/Support, Evasive and
 * Destroyed/Removed tags (icon + word), then its effective DIF ATK SUP RED (a ▲/▼ marks a value that differs from
 * the card) and HP as damage pips with "left/total". The ⓘ button expands, in place, how each number is made
 * ("DIF 5 = 3 base + 2 evasive (D1)"), plus effects that depend on the attacking orbit.
 *
 * Values come from the engine (`tokenStats` rebuilds effStats/effDif with their sources). DIF is taken against the
 * enemy orbit attacking right now, if any (`difOrbit`); otherwise orbit-dependent effects show as notes.
 *
 * For Task 15b: `selected` highlights the token (a chosen target), `dimmed` greys it with a reason (untargetable),
 * and `action` adds controls at the bottom (a Target button).
 */
import { useId, useState, type ReactNode } from 'react';
import { ship as shipData } from '../../../data/ships';
import { ShipName } from '../../components/CardName';
import type { Orbit } from '../../../data/types';
import type { CombatShip, CombatState, GameState } from '../../../engine/types';
import { FactionGlyph, Icon } from '../../icons';
import { difOrbit, lineText, modified, tokenStats, type StatLine } from '../../lib/combatBoard';

export interface ShipTokenProps {
  game: GameState;
  c: CombatState;
  s: CombatShip;
  /** The enemy orbit attacking this ship now (orbit-dependent DIF). Default: `difOrbit(c, s)`. */
  fromOrbit?: Orbit | null;
  /** Opens the ship card; without it the name is plain text. */
  onDetails?: (s: CombatShip) => void;
  /** Highlighted (e.g. the chosen target). */
  selected?: boolean;
  /** Greyed, with this reason shown (e.g. "Protected by Vanguard Ship"). */
  dimmed?: string | null;
  /** Extra controls at the bottom of the token. */
  action?: ReactNode;
}

function Stat({ l }: { l: StatLine }) {
  const dir = l.value > l.base ? 'up' : l.value < l.base ? 'down' : null;
  return (
    <div className={dir === null ? 'tok-stat' : `tok-stat is-${dir}`}>
      <dt>{l.label}</dt>
      <dd className="num">
        {l.value}
        {dir !== null && (
          <>
            <span aria-hidden="true">{dir === 'up' ? '▲' : '▼'}</span>
            <span className="sr-only">{` (card ${l.base})`}</span>
          </>
        )}
      </dd>
    </div>
  );
}

/** HP as pips: damaged boxes filled, then "left/total". */
export function HpPips({ hp, damage }: { hp: number; damage: number }) {
  const dealt = Math.min(hp, Math.max(0, damage));
  return (
    <span className="tok-hp">
      <span className="tok-pips" aria-hidden="true">
        {Array.from({ length: hp }, (_, i) => (
          <span key={i} className={i < dealt ? 'tok-pip is-hit' : 'tok-pip'} />
        ))}
      </span>
      <span className="num">
        {hp - dealt}/{hp}
      </span>
      <span className="sr-only">{` hull points left${dealt > 0 ? `, ${dealt} damage` : ''}`}</span>
    </span>
  );
}

export function ShipToken({ game, c, s, fromOrbit, onDetails, selected = false, dimmed = null, action }: ShipTokenProps) {
  const [why, setWhy] = useState(false);
  const whyId = useId();
  const data = shipData(s.ship);
  const faction = c.sides[s.side].faction;
  const t = tokenStats(game, c, s, fromOrbit === undefined ? difOrbit(c, s) : fromOrbit);
  const stats = [t.dif, t.atk, t.sup, t.red];
  const cls = ['tok', s.role === 'leader' && 'is-leader', s.destroyed && 'is-destroyed', s.removed && 'is-removed', selected && 'is-selected', dimmed !== null && 'is-dimmed']
    .filter(Boolean)
    .join(' ');

  return (
    <article className={cls} data-faction={faction} aria-label={`${data.name}, ${s.role}`}>
      <div className="tok-head">
        <FactionGlyph faction={faction} size="1rem" />
        {onDetails === undefined ? (
          <span className="tok-name">
            <ShipName ship={data} />
          </span>
        ) : (
          <button type="button" className="tok-name tok-name-btn" onClick={() => onDetails(s)} aria-haspopup="dialog">
            {data.name}
          </button>
        )}
        <span className="tok-tags">
          {s.role === 'leader' ? (
            <span className="tag tok-lead">
              <Icon name="crown" size="1em" />
              Leader
            </span>
          ) : (
            <span className="tag">Support</span>
          )}
          {s.evasive && (
            <span className="tag tag-accent">
              <Icon name="eyeOff" size="1em" />
              Evasive
            </span>
          )}
          {s.removed ? (
            <span className="tag">
              <Icon name="close" size="1em" />
              Removed
            </span>
          ) : (
            s.destroyed && (
              <span className="tag tag-danger">
                <Icon name="danger" size="1em" />
                Destroyed
              </span>
            )
          )}
        </span>
        <button
          type="button"
          className="icon-btn tok-info"
          aria-expanded={why}
          aria-controls={whyId}
          aria-label={`How ${data.name}'s numbers are made`}
          onClick={() => setWhy((w) => !w)}
        >
          <Icon name="info" size="1.25rem" />
        </button>
      </div>
      <dl className="tok-stats">
        {stats.map((l) => (
          <Stat key={l.label} l={l} />
        ))}
        <div className="tok-stat">
          <dt>HP</dt>
          <dd>
            <HpPips hp={t.hp} damage={t.damage} />
          </dd>
        </div>
      </dl>
      {why && (
        <ul className="cb-why tok-why" id={whyId}>
          {stats.map((l) => (
            <li key={l.label} className={modified(l) ? 'num is-mod' : 'num'}>
              {lineText(l)}
            </li>
          ))}
          <li className="num">
            HP {t.hp} · {t.damage} damage · {Math.max(0, t.hp - t.damage)} left
          </li>
          {t.notes.map((n) => (
            <li key={n} className="is-mod">
              {n}
            </li>
          ))}
        </ul>
      )}
      {dimmed !== null && (
        <p className="tok-reason">
          <Icon name="lock" size="1em" />
          <span>{dimmed}</span>
        </p>
      )}
      {action}
    </article>
  );
}

/**
 * The ships browser (faction chips with glyph + colour + name, size chips, sort by size or name → ShipCards) and the
 * developments browser (category chips → static DevCards with cost, keyword, a tappable prerequisite and, in a game,
 * who has completed each card). Every card has a "View card" link to the printed card's photo, where there is one.
 */
import { DEVELOPMENTS } from '../../../data/developments';
import { SHIPS, type Ship } from '../../../data/ships';
import { FACTIONS, type DevId, type FactionId, type Size } from '../../../data/types';
import type { GameState } from '../../../engine/types';
import { radioKeys, tabStop } from '../../components/radio';
import { DevCard } from '../../components/DevCard';
import { FactionBadge } from '../../components/FactionBadge';
import { ShipCard } from '../../components/ShipCard';
import { FactionGlyph } from '../../icons';
import { CATEGORY_LABEL, factionName, SIZE_LABEL } from '../../lib/labels';
import { anchorOf, type CategoryFilter, type ShipSort, type SizeFilter } from '../../lib/refNav';
import { CATEGORY_ORDER, devsByCategory } from '../../lib/setup';
import { cardLevel, H } from './H';


const SIZES: SizeFilter[] = ['all', 'small', 'medium', 'large'];
const SORTS: ShipSort[] = ['size', 'name'];
const SIZE_RANK: Record<Size, number> = { small: 0, medium: 1, large: 2 };

export function shipsFor(faction: FactionId, size: SizeFilter, sort: ShipSort): Ship[] {
  const list = SHIPS.filter((s) => s.faction === faction && (size === 'all' || s.size === size));
  return sort === 'name' ? [...list].sort((a, b) => a.name.localeCompare(b.name)) : [...list].sort((a, b) => SIZE_RANK[a.size] - SIZE_RANK[b.size]);
}

interface ChipGroupProps<T extends string> {
  label: string;
  values: readonly T[];
  value: T;
  onChange: (v: T) => void;
  text: (v: T) => string;
  className?: string;
}

/** A row of radio chips with arrow-key movement. */
function ChipGroup<T extends string>({ label, values, value, onChange, text, className }: ChipGroupProps<T>) {
  return (
    <div className={className === undefined ? 'chip-row' : `chip-row ${className}`} role="radiogroup" aria-label={label} onKeyDown={radioKeys(values, value, onChange)}>
      {values.map((v) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          tabIndex={tabStop(values, value, v)}
          data-value={v}
          className={value === v ? 'chip is-selected' : 'chip'}
          onClick={() => onChange(v)}
        >
          {text(v)}
        </button>
      ))}
    </div>
  );
}

export interface ShipsBrowserProps {
  faction: FactionId;
  size: SizeFilter;
  sort: ShipSort;
  onChange: (next: { faction?: FactionId; size?: SizeFilter; sort?: ShipSort }) => void;
  level: number;
  mark: string | null;
  flash: string | null;
}

export function ShipsBrowser({ faction, size, sort, onChange, level, mark, flash }: ShipsBrowserProps) {
  const ships = shipsFor(faction, size, sort);
  return (
    <div className="ships-browser stack">
      <div className="faction-chips" role="radiogroup" aria-label="Faction" onKeyDown={radioKeys(FACTIONS, faction, (f) => onChange({ faction: f }))}>
        {FACTIONS.map((f) => (
          <button
            key={f}
            type="button"
            role="radio"
            aria-checked={faction === f}
            tabIndex={tabStop(FACTIONS, faction, f)}
            data-value={f}
            data-faction={f}
            className={faction === f ? 'faction-chip is-selected' : 'faction-chip'}
            onClick={() => onChange({ faction: f })}
          >
            <FactionGlyph faction={f} size="1.15em" />
            <span className="faction-chip-name">{factionName(f)}</span>
          </button>
        ))}
      </div>
      <div className="ship-filters">
        <ChipGroup label="Size" values={SIZES} value={size} onChange={(v) => onChange({ size: v })} text={(v) => (v === 'all' ? 'All sizes' : SIZE_LABEL[v])} />
        <ChipGroup label="Sort by" className="sort-group" values={SORTS} value={sort} onChange={(v) => onChange({ sort: v })} text={(v) => (v === 'size' ? 'By size' : 'By name')} />
      </div>
      <p className="sr-only" role="status">
        {ships.length} {factionName(faction)} ships
      </p>
      <ul className="ship-list">
        {ships.map((s) => {
          const anchor = anchorOf({ kind: 'ship', id: s.id });
          return (
            <li key={s.id} data-anchor={anchor} className={flash === anchor ? 'is-flash' : undefined}>
              <ShipCard ship={s} headingLevel={cardLevel(level)} mark={mark} viewCard />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export interface DevsBrowserProps {
  category: CategoryFilter;
  onCategory: (c: CategoryFilter) => void;
  onDev: (id: DevId) => void;
  game: GameState | null;
  level: number;
  mark: string | null;
  flash: string | null;
}

const CATEGORIES: CategoryFilter[] = ['all', ...CATEGORY_ORDER];

export function DevsBrowser({ category, onCategory, onDev, game, level, mark, flash }: DevsBrowserProps) {
  const groups = devsByCategory(DEVELOPMENTS).filter((g) => category === 'all' || g.category === category);
  return (
    <div className="devs-browser stack">
      <ChipGroup
        label="Category"
        className="chip-scroll"
        values={CATEGORIES}
        value={category}
        onChange={onCategory}
        text={(c) => (c === 'all' ? 'All' : CATEGORY_LABEL[c])}
      />
      {groups.map((g) => (
        <section key={g.category} className="stack-sm">
          <H level={level} className="caps faint">
            {CATEGORY_LABEL[g.category]}
          </H>
          {g.devs.map((d) => {
            const anchor = anchorOf({ kind: 'dev', id: d.id });
            const by = game === null ? [] : game.seats.filter((f) => game.players[f]?.completed.includes(d.id) === true);
            return (
              <div key={d.id} data-anchor={anchor} className={flash === anchor ? 'is-flash' : undefined}>
                <DevCard dev={d} headingLevel={cardLevel(level + 1)} mark={mark} onPrerequisite={onDev} viewCard>
                  {by.length > 0 && (
                    <span className="completed-by">
                      <span className="small muted">Completed by</span>
                      {by.map((f) => (
                        <FactionBadge key={f} faction={f} variant="chip" size="sm" />
                      ))}
                    </span>
                  )}
                </DevCard>
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}

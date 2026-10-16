/**
 * Four large faction tiles (dim fill, stripe, glyph, name) as a radio group. Each tile says whether the seat is
 * free, held by someone (their name; can be taken over), this device's, or not in this game.
 */
import { FACTIONS, type FactionId } from '../../data/types';
import { FactionGlyph, Icon } from '../icons';
import { factionName } from '../lib/labels';
import { radioKeys, tabStop } from './radio';

export interface FactionTile {
  faction: FactionId;
  status: 'free' | 'taken' | 'mine' | 'closed';
  /** The seated player's name (taken or mine). */
  player?: string;
}

const STATUS_TEXT: Record<FactionTile['status'], string> = {
  free: 'Free',
  taken: 'Taken',
  mine: 'You',
  closed: 'Not in this game',
};

export function FactionTiles({ tiles, value, onChange, label }: { tiles: FactionTile[]; value: FactionId | null; onChange: (f: FactionId) => void; label: string }) {
  const by = new Map(tiles.map((t) => [t.faction, t]));
  const usable = (f: FactionId) => {
    const s = by.get(f)?.status;
    return s === 'free' || s === 'taken';
  };
  return (
    <div className="faction-tiles" role="radiogroup" aria-label={label} onKeyDown={radioKeys(FACTIONS, value, onChange, usable)}>
      {FACTIONS.map((f) => {
        const t = by.get(f) ?? { faction: f, status: 'closed' as const };
        const checked = value === f;
        return (
          <button
            key={f}
            type="button"
            role="radio"
            aria-checked={checked}
            data-value={f}
            data-faction={f}
            data-status={t.status}
            tabIndex={tabStop(FACTIONS, value, f, usable)}
            disabled={!usable(f)}
            className={checked ? 'faction-tile is-selected' : 'faction-tile'}
            onClick={() => onChange(f)}
          >
            <FactionGlyph faction={f} size="2rem" />
            <span className="faction-tile-name">{factionName(f)}</span>
            <span className="faction-tile-status">
              {t.status === 'taken' || t.status === 'mine' ? (
                <>
                  <Icon name="user" size="1em" />
                  <span className="truncate">{t.player ?? STATUS_TEXT[t.status]}</span>
                  {t.status === 'mine' && <span className="fb-you">You</span>}
                </>
              ) : (
                STATUS_TEXT[t.status]
              )}
            </span>
            {checked && (
              <span className="tile-check" aria-hidden="true">
                <Icon name="check" size="1.1rem" />
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

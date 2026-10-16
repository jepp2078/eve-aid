/** Faction identity: glyph + name in the faction tint (never colour alone), optionally with the player's name. */
import type { FactionId } from '../../data/types';
import { FactionGlyph } from '../icons';
import { factionName } from '../lib/labels';

export interface FactionBadgeProps {
  faction: FactionId;
  /** The player's name, shown after the faction. */
  player?: string;
  /** `chip`: on the faction's dim fill. */
  variant?: 'plain' | 'chip';
  size?: 'sm' | 'md' | 'lg';
  /** Adds a "You" tag. */
  you?: boolean;
}

export function FactionBadge({ faction, player, variant = 'plain', size = 'md', you = false }: FactionBadgeProps) {
  return (
    <span className={`faction-badge fb-${variant} fb-${size}`} data-faction={faction}>
      <FactionGlyph faction={faction} />
      <span className="fb-name">{factionName(faction)}</span>
      {player !== undefined && <span className="fb-player truncate">{player}</span>}
      {you && <span className="fb-you">You</span>}
    </span>
  );
}

/**
 * The ~44 px strip under the header: whose turn it is and what the game waits on ("Caldari · Ann · choosing
 * action", "Upkeep · 2 of 4 confirmed"). On this device's turn it becomes a "Your turn" bar in the faction colour
 * (one pulse, no loop). Tapping it opens Table.
 */
import type { FactionId } from '../../data/types';
import type { GameState } from '../../engine/types';
import { FactionGlyph, Icon } from '../icons';
import { turnStatus } from '../lib/turn';

export function TurnStrip({ game, me, onOpen }: { game: GameState; me: FactionId | null; onOpen?: () => void }) {
  const s = turnStatus(game, me);
  if (s.kind === 'idle') return null;
  const lead = s.faction !== null ? <FactionGlyph faction={s.faction} size="1.25rem" /> : <Icon name={s.kind === 'upkeep' ? 'hourglass' : 'crown'} size="1.25rem" />;
  const body = (
    <>
      {lead}
      <span className="turn-text">
        <strong className="turn-title">{s.title}</strong>
        <span className="turn-detail">{s.detail}</span>
      </span>
      {s.round > 0 && <span className="turn-round caps num">R{s.round}</span>}
      {onOpen !== undefined && <Icon name="chevronRight" size="1.25rem" className="turn-chevron" />}
    </>
  );
  const className = `turn-strip turn-${s.kind}`;
  const faction = s.faction ?? undefined;
  return onOpen === undefined ? (
    <div className={className} data-faction={faction} role="status">
      {body}
    </div>
  ) : (
    <button type="button" className={className} data-faction={faction} onClick={onOpen} aria-label={`${s.title}: ${s.detail}. Round ${s.round}. Open Table`}>
      {body}
    </button>
  );
}

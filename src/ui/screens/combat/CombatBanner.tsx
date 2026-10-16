/**
 * The persistent banner for the two players in a combat, under the turn strip on every tab but Combat:
 * "◆ Minmatar attacks you · Assign your fleet  [Open ›]". Warn-coloured with the combat icon while the combat waits for this device, calm otherwise; it stays until the combat is over.
 */
import { useMe } from '../../hooks';
import { FactionGlyph, Icon } from '../../icons';
import { combatBanner } from '../../lib/combat';

export function CombatBanner({ onOpen }: { onOpen: () => void }) {
  const { game, faction } = useMe();
  const info = game === null ? null : combatBanner(game, faction);
  if (info === null) return null;
  return (
    <div className={info.urgent ? 'cb-banner is-urgent' : 'cb-banner'} role="status">
      <Icon name="combat" size="1.25rem" className="cb-banner-icon" />
      <p className="cb-banner-text">
        <span className="cb-banner-title" data-faction={info.enemy}>
          <FactionGlyph faction={info.enemy} size="0.9em" /> {info.title}
        </span>
        <span className="cb-banner-detail">{info.detail}</span>
      </p>
      <button type="button" className="btn btn-secondary cb-banner-btn" onClick={onOpen}>
        Open
        <Icon name="chevronRight" size="1.1rem" />
      </button>
    </div>
  );
}

/**
 * The Panel of a light game: the board takes the actions and keeps ISK, minerals, ships and cubes; the app records what
 * they gave. The final ranking once the game is over, VP and systems, the Verge of Ascendancy banner, notices to act on
 * at the table, the record grid in the action phase (in the upkeep phase my light upkeep takes its place, with its
 * Confirm in the thumb zone), the free actions, my developments and the turn controls. No Board counts, Move follow-ups
 * or Deployable Infrastructure. The rules-mandated steps (research to place, a card to add) block the Panel as
 * overlays, as in a full game.
 *
 * Every sheet is always mounted here at a fixed place, so a live update never resets an open sheet's draft; sheets
 * only open and close.
 */
import { useState } from 'react';
import type { DevId } from '../../../data/types';
import { useFeedback } from '../../components/Toast';
import { useMe } from '../../hooks';
import { Icon, type IconName } from '../../icons';
import { lightStatus } from '../../lib/actions';
import { blockingOverlay } from '../../lib/devs';
import { briefReason, canLightClaim } from '../../lib/light';
import { FreeActions } from './ActionBar';
import { AdjustSheet, MissionSheet } from './AdjustSheet';
import { DevelopmentsSection } from './DevelopmentsSection';
import { FinalRanking, VergeBanner } from './FinalRanking';
import { GainVpSheet, LightClaimSheet, ResearchTokensSheet } from './LightSheets';
import { LightUpkeepBar, LightUpkeepCard, useLightUpkeepForm } from './LightUpkeep';
import { NoticesStack } from './NoticesStack';
import { PanelOverlays } from './Overlays';
import { LightTop } from './PanelTop';
import { ResearchSheet } from './ResearchSheet';
import { TurnControls } from './TurnControls';
import { UseDevSheet } from './UseDevSheet';

type SheetId = 'gainVp' | 'claim' | 'research' | 'cards' | 'adjust' | 'mission' | 'use';
type GridSheet = Extract<SheetId, 'gainVp' | 'claim' | 'research' | 'cards'>;

interface RecordButtonProps {
  icon: IconName;
  label: string;
  note: string;
  /** Why it can't be recorded now: the button stays visible, dimmed, and a tap says why. */
  off?: string;
  onClick: () => void;
}

function RecordButton({ icon, label, note, off, onClick }: RecordButtonProps) {
  return (
    <button
      type="button"
      className={off === undefined ? 'ab-btn' : 'ab-btn is-off'}
      aria-disabled={off !== undefined}
      aria-label={off === undefined ? undefined : `${label}. ${off}`}
      onClick={onClick}
    >
      <Icon name={icon} size="1.5rem" />
      <span className="ab-text">
        <span className="ab-label">{label}</span>
        <span className={off === undefined ? 'small faint' : 'small'}>{note}</span>
      </span>
    </button>
  );
}

/**
 * What the board gave, in the action phase (where the engine takes all four): VP, a system claimed (on my turn only;
 * otherwise dimmed with the reason's first words, "Not your turn" or "You passed this round", and a tap toasts all of
 * it), research tokens, and cards added to or swapped in my area.
 */
function LightGrid({ onOpen }: { onOpen: (s: GridSheet) => void }) {
  const { game, faction, me } = useMe();
  const { toast } = useFeedback();
  if (game === null || faction === null || me === null) return null;

  const mine = game.phase === 'actions' && game.turn?.faction === faction;
  const claim = canLightClaim(game, faction);

  return (
    <section className="ab" aria-labelledby="light-ab-title">
      <h2 id="light-ab-title" className="sr-only">
        Record
      </h2>
      <p className={mine ? 'ab-status is-mine' : 'ab-status'}>
        <Icon name={me.passed ? 'pass' : mine ? 'play' : 'hourglass'} size="1.1rem" />
        <span>{lightStatus(game, faction)}</span>
      </p>
      <div className="ab-grid is-light">
        <RecordButton icon="vp" label="Gain VP" note="card, discovery, other" onClick={() => onOpen('gainVp')} />
        {claim.ok ? (
          <RecordButton icon="claim" label="Claim system" note="from the map or a rival" onClick={() => onOpen('claim')} />
        ) : (
          <RecordButton icon="claim" label="Claim system" note={briefReason(claim.reason)} off={claim.reason} onClick={() => toast(claim.reason, 'info')} />
        )}
        <RecordButton icon="research" label="Research tokens" note="place them on your cards" onClick={() => onOpen('research')} />
        <RecordButton icon="devCard" label="Cards" note="add or swap in your area" onClick={() => onOpen('cards')} />
      </div>
    </section>
  );
}

export function LightPanel() {
  const { game, faction, me, priv } = useMe();
  const [sheet, setSheet] = useState<SheetId | null>(null);
  // The card the Use sheet is for (kept after closing, so the sheet can animate out with its content).
  const [using, setUsing] = useState<DevId | null>(null);
  // My open light upkeep: the card sits in the grid's place, its Confirm in the thumb zone.
  const upkeep = useLightUpkeepForm();
  const close = () => setSheet(null);
  // A rules-mandated step takes over the Panel: any open sheet closes (its draft is kept) so the tab bar stays usable.
  const blocked = blockingOverlay(game, me, priv) !== null;
  if (blocked && sheet !== null) setSheet(null);

  if (game === null || faction === null || me === null) return null;
  const ended = game.phase === 'ended';

  return (
    <div className="screen-body panel">
      <h1 className="sr-only">Panel</h1>
      <FinalRanking />
      <LightTop me={me} seats={game.seats.length} />
      <VergeBanner />
      <NoticesStack />
      {game.phase === 'upkeep' ? <LightUpkeepCard form={upkeep} /> : game.phase === 'actions' && <LightGrid onOpen={setSheet} />}
      {!ended && <FreeActions onMission={() => setSheet('mission')} onAdjust={() => setSheet('adjust')} />}
      <DevelopmentsSection
        onUse={(id) => {
          setUsing(id);
          setSheet('use');
        }}
      />
      <TurnControls />
      {upkeep !== null && <LightUpkeepBar form={upkeep} />}

      <GainVpSheet open={sheet === 'gainVp'} onClose={close} />
      <LightClaimSheet open={sheet === 'claim'} onClose={close} />
      <ResearchTokensSheet open={sheet === 'research'} onClose={close} />
      <ResearchSheet open={sheet === 'cards'} onClose={close} />
      <AdjustSheet open={sheet === 'adjust'} onClose={close} />
      <MissionSheet open={sheet === 'mission'} onClose={close} />
      <UseDevSheet open={sheet === 'use'} onClose={close} dev={using} />
      <PanelOverlays />
    </div>
  );
}

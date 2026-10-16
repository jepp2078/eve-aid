/**
 * The Panel tab (my faction): the final ranking once the game is over, the resource block, the Verge of Ascendancy
 * banner, notices to act on at the table, the Move follow-ups and Deployable Infrastructure offers while they
 * apply, the action grid (or my upkeep while the phase is `upkeep`), the free actions, my developments, the board
 * counts, and the turn controls in the thumb zone. Rules-mandated steps (minerals over 12, research to place, a card
 * to add) block the Panel as overlays derived from my docs.
 *
 * Every sheet is always mounted here at a fixed place, so a live update never resets an open sheet's draft; sheets
 * only open and close. A light game has its own Panel (`LightPanel`).
 */
import { useState } from 'react';
import type { ActionType, DevId } from '../../../data/types';
import { useMe } from '../../hooks';
import { blockingOverlay } from '../../lib/devs';
import { ActionBar, FreeActions } from './ActionBar';
import { AdjustSheet, MissionSheet } from './AdjustSheet';
import { BuildSheet, DeployableCard, DeployableSheet } from './BuildSheet';
import { ClaimSheet } from './ClaimSheet';
import { CountsSection } from './CountsSection';
import { DevelopmentsSection } from './DevelopmentsSection';
import { ExtractSheet } from './ExtractSheet';
import { FinalRanking, VergeBanner } from './FinalRanking';
import { LightPanel } from './LightPanel';
import { ManufactureSheet } from './ManufactureSheet';
import { inMoveFollowUps, MoveFollowUpsCard, MoveSheet, type MoveTab } from './MoveSheet';
import { NoticesStack } from './NoticesStack';
import { PanelOverlays } from './Overlays';
import { PanelTop } from './PanelTop';
import { ResearchSheet } from './ResearchSheet';
import { TradeSheet } from './TradeSheet';
import { TurnControls } from './TurnControls';
import { UpkeepBar, UpkeepSheet, useUpkeepForm } from './UpkeepSheet';
import { UseDevSheet } from './UseDevSheet';

type SheetId = ActionType | 'deploy' | 'adjust' | 'mission' | 'use';

export interface PanelScreenProps {
  /** Switch to the Combat tab (the battle in progress). */
  onOpenCombat: () => void;
  /** Open the Start combat sheet (mounted by TabShell). */
  onStartCombat: () => void;
}

export function PanelScreen(props: PanelScreenProps) {
  const { game } = useMe();
  return game?.mode === 'light' ? <LightPanel /> : <FullPanel {...props} />;
}

function FullPanel({ onOpenCombat, onStartCombat }: PanelScreenProps) {
  const { game, faction, me, priv } = useMe();
  const [sheet, setSheet] = useState<SheetId | null>(null);
  const [moveTab, setMoveTab] = useState<MoveTab>('discovery');
  // The card the Use sheet is for (kept after closing, so the sheet can animate out with its content).
  const [using, setUsing] = useState<DevId | null>(null);
  // My open upkeep: the form sits in the action area, its Confirm in the thumb zone.
  const upkeep = useUpkeepForm();
  const close = () => setSheet(null);
  // A rules-mandated step takes over the Panel: any open sheet closes (its draft is kept) so the tab bar stays usable.
  const blocked = blockingOverlay(game, me, priv) !== null;
  if (blocked && sheet !== null) setSheet(null);

  if (game === null || faction === null || me === null) return null;
  const following = inMoveFollowUps(game, faction);
  const deployable = game.phase === 'actions' && game.turn?.faction === faction && game.turn.deployable;
  const ended = game.phase === 'ended';

  const openAction = (a: ActionType) => {
    if (a === 'move') setMoveTab('discovery');
    setSheet(a);
  };

  return (
    <div className="screen-body panel">
      <h1 className="sr-only">Panel</h1>
      <FinalRanking />
      <PanelTop me={me} />
      <VergeBanner />
      <NoticesStack />
      {following && (
        <MoveFollowUpsCard
          combatOn={game.combat !== null}
          onOpen={(t) => {
            // "Start combat" opens the Start combat sheet directly (or the battle already running).
            if (t === 'combat') {
              if (game.combat === null) onStartCombat();
              else onOpenCombat();
              return;
            }
            setMoveTab(t);
            setSheet('move');
          }}
        />
      )}
      {deployable && <DeployableCard onOpen={() => setSheet('deploy')} />}
      {game.phase === 'upkeep' ? <UpkeepSheet form={upkeep} /> : !ended && <ActionBar onOpen={openAction} />}
      {!ended && <FreeActions onMission={() => setSheet('mission')} onAdjust={() => setSheet('adjust')} />}
      <DevelopmentsSection
        onUse={(id) => {
          setUsing(id);
          setSheet('use');
        }}
      />
      <CountsSection />
      <TurnControls />
      {upkeep !== null && <UpkeepBar form={upkeep} />}

      <MoveSheet open={sheet === 'move'} onClose={close} tab={moveTab} onTab={setMoveTab} onDeployable={() => setSheet('deploy')} onOpenCombat={onOpenCombat} onStartCombat={onStartCombat} />
      <ClaimSheet open={sheet === 'claim'} onClose={close} onDeployable={() => setSheet('deploy')} />
      <ExtractSheet open={sheet === 'extract'} onClose={close} />
      <TradeSheet open={sheet === 'trade'} onClose={close} />
      <ManufactureSheet open={sheet === 'manufacture'} onClose={close} />
      <BuildSheet open={sheet === 'build'} onClose={close} />
      <ResearchSheet open={sheet === 'research'} onClose={close} />
      <DeployableSheet open={sheet === 'deploy'} onClose={close} />
      <AdjustSheet open={sheet === 'adjust'} onClose={close} />
      <MissionSheet open={sheet === 'mission'} onClose={close} />
      <UseDevSheet open={sheet === 'use'} onClose={close} dev={using} />
      <PanelOverlays />
    </div>
  );
}

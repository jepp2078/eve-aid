/**
 * The Combat tab. Without a combat: what a combat is and, on my turn, "Start combat". With
 * one: who attacks whom and where, the sticky step rail, then the current stage's view from `STAGE_VIEWS`:
 *   - assign: my fleet assignment (AssignOrbits) when it's my go; otherwise a status card ("Waiting for the attacker")
 *     and the board;
 *   - start: my start-of-combat choices (StartChoices) until I'm ready; otherwise status + board;
 *   - retreat: the retreat prompt for the side being asked, whom the combat waits for for everyone else (RetreatPrompt);
 *   - attack: the attack card with the dice pad for the side whose step it is, the overflow picker after a kill, and
 *     whose attack it is plus the newest result for everyone else (AttackPanel, OverflowPicker, ResultCard);
 *   - realign: placing the ships that lost their leader (RealignPanel);
 *   - end: the winner, strengths, rewards and Finish (CombatEnd).
 * Players outside the combat only ever get status cards, results and the read-only board. The header's "More" opens
 * the combat tools (manual damage, destroy, add ships; Cancel combat for any seated player).
 *
 * A stage view is a component taking `StageProps` in `STAGE_VIEWS` (below). It gets the game, the combat, my seat and
 * side (null for spectators), a ready read-only `board` and `openTools`; it renders `<StageLayout panel main footer />`
 * (footer = `<CombatFooter>` for the primary action).
 */
import { useCallback, useEffect, useRef, useState, type ComponentType } from 'react';
import type { CombatState } from '../../../engine/types';
import { FactionBadge } from '../../components/FactionBadge';
import { RulesLink } from '../../components/RulesLink';
import { useMe } from '../../hooks';
import { Icon } from '../../icons';
import { combatSide, combatTask, sideChoicesSummary, whereText } from '../../lib/combat';
import { toolSections, type ToolSection } from '../../lib/combatFight';
import { factionName } from '../../lib/labels';
import { STAGE_LABEL } from '../../lib/table';
import { AssignOrbits } from './AssignOrbits';
import { AttackStage } from './AttackPanel';
import { CombatBoard } from './CombatBoard';
import { EndStage } from './CombatEnd';
import { StageLayout, type StageProps } from './CombatParts';
import { CombatTools } from './CombatTools';
import { Status } from './FightParts';
import { RealignStage } from './RealignPanel';
import { RetreatStage } from './RetreatPrompt';
import { StartChoices } from './StartChoices';
import { StepRail } from './StepRail';

export interface CombatScreenProps {
  /** Opens the Start combat sheet (mounted by TabShell). */
  onStartCombat: () => void;
}

/** The view for each combat stage. */
const STAGE_VIEWS: Record<CombatState['stage'], ComponentType<StageProps>> = {
  assign: AssignStage,
  start: StartStage,
  retreat: RetreatStage,
  attack: AttackStage,
  realign: RealignStage,
  end: EndStage,
};

export function CombatScreen({ onStartCombat }: CombatScreenProps) {
  const { game, faction } = useMe();
  const [tools, setTools] = useState<{ open: boolean; section: ToolSection }>({ open: false, section: 'damage' });
  const openTools = useCallback((section: ToolSection = 'damage') => setTools({ open: true, section }), []);
  // A new task or attack step brings its panel (and the newest result) into view.
  const c0 = game?.combat ?? null;
  const view = c0 === null ? null : `${c0.round}:${c0.stage}:${combatTask(c0, faction)}:${c0.step?.orbit ?? ''}-${c0.step?.side ?? ''}`;
  const firstView = useRef(true);
  useEffect(() => {
    if (firstView.current) {
      firstView.current = false;
      return;
    }
    if (view !== null) window.scrollTo({ top: 0, behavior: 'instant' });
  }, [view]);
  if (game === null) return null;
  const c = game.combat;
  if (c === null) return <NoCombat onStartCombat={onStartCombat} />;

  const side = combatSide(c, faction);
  const Stage = STAGE_VIEWS[c.stage];
  const board = <CombatBoard game={game} c={c} mySide={side} />;
  const hasTools = toolSections(c, side, faction !== null).length > 0;
  return (
    <div className="screen-body combat-screen">
      <CombatHeader c={c} side={side} onMore={hasTools ? () => openTools(side === null ? 'cancel' : 'damage') : null} />
      <StepRail c={c} />
      <Stage game={game} c={c} faction={faction} side={side} board={board} openTools={openTools} />
      {hasTools && (
        <CombatTools
          game={game}
          c={c}
          faction={faction}
          side={side}
          open={tools.open}
          section={tools.section}
          onSection={(section) => setTools((t) => ({ ...t, section }))}
          onClose={() => setTools((t) => ({ ...t, open: false }))}
        />
      )}
    </div>
  );
}

function CombatHeader({ c, side, onMore }: { c: CombatState; side: StageProps['side']; onMore: (() => void) | null }) {
  const role = side === null ? "You're watching" : side === 'attacker' ? "You're the attacker" : "You're the defender";
  return (
    <header className="cb-head">
      <div className="title-row">
        <h1 className="cb-title">
          <FactionBadge faction={c.attacker} size="sm" />
          <span className="cb-title-verb">attacks</span>
          <FactionBadge faction={c.defender} size="sm" />
        </h1>
        <span className="cb-head-actions">
          {onMore !== null && (
            <button type="button" className="btn btn-ghost cb-more" aria-haspopup="dialog" onClick={onMore}>
              <Icon name="more" size="1.25rem" />
              More
            </button>
          )}
          <RulesLink section="combat" />
        </span>
      </div>
      <p className="small muted">
        {whereText(c)} · {role}
      </p>
    </header>
  );
}

function NoCombat({ onStartCombat }: CombatScreenProps) {
  const { game, faction } = useMe();
  const mine = game !== null && game.phase === 'actions' && game.turn?.faction === faction;
  return (
    <div className="screen-body stack">
      <div className="title-row">
        <h1>Combat</h1>
        <RulesLink section="combat" label="Combat rules" />
      </div>
      <section className="card stack-sm">
        <p>
          <strong>No combat right now.</strong>
        </p>
        <p className="muted">
          A battle starts when a fleet moves into a system with enemy ships, on the attacker's turn. Both players then place their fleets in three orbits and
          everyone can follow it here.
        </p>
        {mine ? (
          <button type="button" className="btn btn-primary btn-lg btn-block" onClick={onStartCombat}>
            <Icon name="combat" />
            Start combat
          </button>
        ) : (
          <p className="as-hint">
            <Icon name="info" size="1.1rem" />
            <span>{game?.phase === 'actions' && game.turn !== null ? `Only ${factionName(game.turn.faction)} can start a combat now (their turn).` : 'Combats start during the action phase.'}</span>
          </p>
        )}
      </section>
    </div>
  );
}

function AssignStage(props: StageProps) {
  const { c, faction, board } = props;
  const task = combatTask(c, faction);
  if (task === 'assign') return <AssignOrbits {...props} />;
  const a = factionName(c.attacker);
  const d = factionName(c.defender);
  const panel =
    task === 'waitAttacker' ? (
      <Status title={`Waiting for ${a}`}>
        <p>{a} places their fleet first. Your fleet assignment opens as soon as they're done.</p>
        <p className="notice notice-info">
          <Icon name="reference" size="1.25rem" />
          <span>Meanwhile, choose a strategy card face down.</span>
        </p>
      </Status>
    ) : task === 'waitAssign' ? (
      <Status title={`Waiting for ${d}`}>
        <p>Your fleet is placed. {d} places theirs now.</p>
      </Status>
    ) : (
      <Status icon="eye" title={STAGE_LABEL.assign}>
        <p>
          {c.sides.attacker.assigned ? `${d} is placing their fleet.` : `${a} is placing their fleet first.`} Only {a} and {d} act here; you can follow along.
        </p>
      </Status>
    );
  return <StageLayout panel={panel} main={board} />;
}

function StartStage(props: StageProps) {
  const { c, faction, board } = props;
  const task = combatTask(c, faction);
  if (task === 'choices') return <StartChoices {...props} />;
  const waiting = (['attacker', 'defender'] as const).filter((s) => !c.sides[s].ready).map((s) => factionName(c.sides[s].faction));
  const a = factionName(c.attacker);
  const aChoices = c.sides.attacker.ready ? (
    <p className="small muted">
      {a}'s choices: {sideChoicesSummary(c, 'attacker')}
    </p>
  ) : null;
  const panel =
    task === 'waitAttackerChoices' ? (
      <Status title={`Waiting for ${a}`}>
        <p>{a} makes their start-of-combat choices first. Yours open as soon as they're done.</p>
        <p className="notice notice-info">
          <Icon name="reference" size="1.25rem" />
          <span>Meanwhile, reveal your strategy card.</span>
        </p>
      </Status>
    ) : task === 'waitChoices' ? (
      <Status title={`Waiting for ${waiting.join(' and ')}`}>
        <p>Your start-of-combat choices are in. Round 1 begins when {waiting.join(' and ')} is ready.</p>
        {aChoices}
      </Status>
    ) : (
      <Status icon="eye" title={STAGE_LABEL.start}>
        <p>Strategy cards are revealed; waiting for {waiting.join(' and ')} to make their start-of-combat choices.</p>
        {aChoices}
      </Status>
    );
  return <StageLayout panel={panel} main={board} />;
}

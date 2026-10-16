/**
 * The retreat decisions at the start of each round: the attacker answers,
 * then the defender (not asked once the attacker retreats). Only the side being asked sees the prompt — two labelled
 * buttons with the consequence spelled out ("Retreat: round 2 becomes the last round; you don't attack; your ships
 * get +1 DIF; you lose the combat"), Retreat disabled with the engine's reason when an enemy destroyer forbids it in
 * round 1. Everyone else sees whom the combat waits for. Above it: how the battle stands (losses, damage) and, after a
 * round, the round-end reminders (Sin).
 */
import type { Command } from '../../../engine/types';
import { useCommand } from '../../hooks';
import { FactionGlyph, Icon } from '../../icons';
import { retreatAskedSide } from '../../lib/combat';
import { battleSoFar, retreatConsequence } from '../../lib/combatFight';
import { SIDES } from '../../lib/combatBoard';
import { factionName } from '../../lib/labels';
import { usePreview } from '../panel/ActionSheet';
import { CombatFooter, StageLayout, type StageProps } from './CombatParts';
import { FightNotes, LastResult, Status } from './FightParts';

const STAY: Command = { type: 'combatRetreat', retreat: false };
const RETREAT: Command = { type: 'combatRetreat', retreat: true };

export function RetreatStage(props: StageProps) {
  const { c, side, board } = props;
  const asked = retreatAskedSide(c);
  const mine = side === asked;
  const askedName = factionName(c.sides[asked].faction);
  const { run, disabled } = useCommand();
  const stay = usePreview(mine ? STAY : null);
  const retreat = usePreview(mine ? RETREAT : null);

  // How the battle stands, once there is something to tell (after round 1, or after manual changes).
  const happened = c.round > 1 || c.ships.some((s) => s.damage > 0 || s.destroyed);
  const standing = happened && (
    <section className="card stack-sm" aria-labelledby="cb-standing">
      <h2 id="cb-standing">The battle so far</h2>
      <ul className="cb-standing">
        {SIDES.map((s) => {
          const f = c.sides[s].faction;
          const so = battleSoFar(c, s);
          return (
            <li key={s} data-faction={f}>
              <span className="cb-standing-name">
                <FactionGlyph faction={f} size="1em" /> {factionName(f)}
                {s === side && <span className="fb-you">You</span>}
              </span>
              <span className="small">
                {so.lost} · {so.damage}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );

  let panel;
  if (mine) {
    const consequence = retreatConsequence(props.game, c, asked).join('; ');
    const blocked = retreat !== null && !retreat.ok ? retreat.error.message : null;
    panel = (
      <section className="card stack-sm cb-retreat" aria-labelledby="cb-retreat-title">
        <h2 id="cb-retreat-title">Retreat or fight on?</h2>
        <p>
          <strong>Fight on:</strong> {asked === 'attacker' ? `${factionName(c.defender)} decides next, then the round's attacks begin.` : "the round's attacks begin."}
        </p>
        <p>
          <strong>Retreat:</strong> {consequence}.
        </p>
        {blocked !== null && (
          <p className="as-error">
            <Icon name="lock" size="1.1rem" />
            <span>
              <strong>You can't retreat now:</strong> {blocked}
            </span>
          </p>
        )}
      </section>
    );
  } else {
    panel = (
      <Status icon={side === null ? 'eye' : 'hourglass'} title={`Waiting for ${askedName} to decide on retreat`}>
        <p>
          {side === 'defender' && asked === 'attacker'
            ? `You decide after them. If ${askedName} retreats, this round is their last and they don't attack.`
            : "Then the round's attacks begin."}
        </p>
      </Status>
    );
  }

  const footer = mine ? (
    <CombatFooter label="Retreat decision">
      {/* The primary action sits bottom-most, in the same place as every other combat stage's. */}
      <button
        type="button"
        className="btn btn-secondary btn-block"
        disabled={disabled || retreat === null || !retreat.ok}
        onClick={() => void run(RETREAT, { label: `${askedName} retreats: round ${c.round} is the last round` })}
      >
        Retreat
      </button>
      <button
        type="button"
        className="btn btn-primary btn-lg btn-block"
        disabled={disabled || stay === null || !stay.ok}
        onClick={() => void run(STAY, { label: `${askedName} fights on` })}
      >
        Fight on · round {c.round}
      </button>
    </CombatFooter>
  ) : undefined;

  return (
    <StageLayout
      panel={
        <>
          <LastResult {...props} collapsed />
          {panel}
          {standing}
          <FightNotes {...props} />
        </>
      }
      main={board}
      footer={footer}
    />
  );
}

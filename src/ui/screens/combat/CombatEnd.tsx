/**
 * The end of a combat: the winner banner with why ("Strength 4 against 1",
 * "Amarr retreated"), each side's strength broken down (ships by size, home system, citadels, Guerilla Warfare —
 * equal to the engine's), what finishing does to each faction (VP, insurance, reparations, losses, the escape move),
 * the prompts to settle first (Widow: destroy an opposing small ship; a lost Panther; round-end effects), and the
 * "Fleet cannot escape" switch with its consequence. Either fighting side finishes (`combatFinish`); afterwards the
 * Panel, the Table and the notices take over. Everyone else sees the same summary.
 */
import { useState } from 'react';
import type { FactionId } from '../../../data/types';
import { reminders } from '../../../engine/combat/abilities';
import { computeOutcome, survivors } from '../../../engine/combat/end';
import type { Command } from '../../../engine/types';
import { RulesLink } from '../../components/RulesLink';
import { useCommand } from '../../hooks';
import { FactionGlyph, Icon, ResourceIcon } from '../../icons';
import { nameList } from '../../../engine/combat/setup';
import { finishText, noEscapeEffect, outcomeReason, rewardLines, strengthParts, strengthText, type RewardLine } from '../../lib/combatFight';
import { SIDES } from '../../lib/combatBoard';
import { factionName } from '../../lib/labels';
import { TAKE_OVER_HINT } from '../../lib/table';
import { Toggle, usePreview } from '../panel/ActionSheet';
import { CombatFooter, CombatPreview, Reminders, StageLayout, type StageProps } from './CombatParts';
import { FightNotes, LastResult } from './FightParts';

const KIND_ICON: Record<RewardLine['kind'], 'vp' | 'isk' | 'reference' | 'close' | 'move'> = {
  vp: 'vp',
  isk: 'isk',
  cards: 'reference',
  lost: 'close',
  move: 'move',
};

export function EndStage(props: StageProps) {
  const { game, c, side, board, openTools } = props;
  const [noEscape, setNoEscape] = useState(false);
  const { run, disabled } = useCommand();
  const o = c.outcome ?? computeOutcome(game, c);
  const esc = noEscapeEffect(game, c, o);
  const cmd: Command | null = side === null ? null : { type: 'combatFinish', noEscape: noEscape && esc !== null };
  const preview = usePreview(cmd);
  const winner = c.sides[o.winner].faction;
  const lines = rewardLines(game, c, o, noEscape && esc !== null);
  const byFaction = SIDES.map((s) => c.sides[s].faction).map((f) => ({ f, lines: lines.filter((l) => l.faction === f) }));
  const settle = SIDES.flatMap((s) => reminders(game, c, s, 'combatEnd').map((t) => `${factionName(c.sides[s].faction)}'s ${t}`));

  const panel = (
    <>
      <section className="card stack-sm cb-winner" data-faction={winner} aria-labelledby="cb-winner-title">
        <p className="caps muted">Combat over</p>
        <h2 id="cb-winner-title" className="cb-winner-title">
          <FactionGlyph faction={winner} size="1.1em" />
          {factionName(winner)} wins
          {o.winner === side && <span className="fb-you">You</span>}
        </h2>
        <p className="cb-winner-why">{outcomeReason(c, o)}</p>
        <ul className="cb-strength">
          {SIDES.map((s) => {
            const f = c.sides[s].faction;
            const parts = strengthParts(game, c, s);
            const alive = survivors(c, s);
            return (
              <li key={s} data-faction={f}>
                <span className="cb-strength-head">
                  <span className="cb-strength-name">
                    <FactionGlyph faction={f} size="1em" /> {factionName(f)}
                  </span>
                  <span className="cb-strength-total num">{o.strength[s]}</span>
                </span>
                <span className="small num">Strength {strengthText(parts)}</span>
                <span className="small muted">{alive.length === 0 ? 'No ships left' : `Survivors: ${nameList(alive.map((x) => x.ship))}`}</span>
              </li>
            );
          })}
        </ul>
        <RulesLink section="strength" label="Combat strength" />
      </section>

      <Reminders
        title="Before you finish"
        items={settle}
        action={
          side !== null && openTools !== undefined ? (
            <button type="button" className="btn btn-secondary" onClick={() => openTools('damage')}>
              <Icon name="more" size="1.1rem" />
              Open combat tools
            </button>
          ) : undefined
        }
      />
      <FightNotes {...props} />

      <section className="card stack-sm" aria-labelledby="cb-rewards-title">
        <div className="title-row">
          <h2 id="cb-rewards-title">When the combat is finished</h2>
          <RulesLink section="combat-rewards" />
        </div>
        {byFaction.map(({ f, lines: ls }) => (
          <div key={f} className="cb-rewards" data-faction={f}>
            <h3 className="cb-rewards-name">
              <FactionGlyph faction={f} size="1em" /> {factionName(f)}
            </h3>
            {ls.length === 0 ? (
              <p className="small muted">Nothing changes.</p>
            ) : (
              <ul>
                {ls.map((l) => (
                  <li key={l.text} className="cb-reward">
                    <RewardIcon kind={l.kind} />
                    <span>{l.text}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
        <p className="small muted">Then both players discard the strategy cards used.</p>
        {esc !== null && side !== null && (
          <>
            <Toggle
              label={`${factionName(esc.faction)}'s fleet cannot escape`}
              note="No adjacent explored system that no other player controls and that has no enemy ships"
              checked={noEscape}
              onChange={setNoEscape}
            />
            <p className={noEscape ? 'notice notice-warn' : 'small muted'}>
              {noEscape && <Icon name="warn" size="1.25rem" />}
              <span>
                {noEscape ? '' : 'If so: '}
                {escapeText(esc.faction, esc.ships.length, nameList(esc.ships), esc.extraCards, esc.extraIsk)}
              </span>
            </p>
          </>
        )}
      </section>
      <LastResult {...props} collapsed />
    </>
  );

  const footer =
    side === null ? undefined : (
      <CombatFooter label="Finish the combat">
        <CombatPreview preview={preview} hint="" ok={finishText(game, winner)} />
        <button
          type="button"
          className="btn btn-primary btn-lg btn-block"
          disabled={disabled || cmd === null || !preview?.ok}
          onClick={() => cmd !== null && void run(cmd, { label: `Combat finished: ${factionName(winner)} wins` })}
        >
          Finish combat
        </button>
      </CombatFooter>
    );

  const watching =
    side === null ? (
      <>
        <p className="as-hint">
          <Icon name="eye" size="1.1rem" />
          <span>
            Waiting for {factionName(c.attacker)} or {factionName(c.defender)} to finish the combat.
          </span>
        </p>
        <p className="hint-line">
          <Icon name="info" size="1.1rem" />
          <span>{TAKE_OVER_HINT}</span>
        </p>
      </>
    ) : null;

  return (
    <StageLayout
      panel={
        <>
          {watching}
          {panel}
        </>
      }
      main={board}
      footer={footer}
    />
  );
}

function escapeText(f: FactionId, n: number, names: string, cards: number, isk: number): string {
  const extra = [cards > 0 ? `${cards} more Event ${cards === 1 ? 'card' : 'cards'} for reparations` : null, isk > 0 ? `+${isk} ISK insurance` : null].filter((x) => x !== null);
  return `${factionName(f)}'s ${n === 1 ? 'surviving ship' : `${n} surviving ships`} (${names}) ${n === 1 ? 'is' : 'are'} destroyed too${extra.length > 0 ? `: ${extra.join(', ')}` : ''}.`;
}

function RewardIcon({ kind }: { kind: RewardLine['kind'] }) {
  const name = KIND_ICON[kind];
  if (name === 'vp' || name === 'isk') return <ResourceIcon kind={name} size="1.25rem" title={null} />;
  return <Icon name={name} size="1.25rem" />;
}

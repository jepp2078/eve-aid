/**
 * Pieces the fighting stages share:
 *   - `Status`: what the combat waits for (icon + title + text), with how to take over a seat whose phone died;
 *   - `LastResult`: the newest attack result, full or as one line;
 *   - `FightNotes`: my side's prompts that the app does not automate — a lost ship's "when destroyed" ability (Panther:
 *     add up to two small ships; dismissable on this device) and, after a round, the round-end abilities (Sin) — each
 *     with a button to the combat tools.
 */
import type { ReactNode } from 'react';
import { reminders } from '../../../engine/combat/abilities';
import { ship as shipData } from '../../../data/ships';
import { Icon } from '../../icons';
import { isRecord } from '../../lib/drafts';
import { attackChain, lossReminders } from '../../lib/combatFight';
import { TAKE_OVER_HINT } from '../../lib/table';
import { useSheetDraft } from '../panel/ActionSheet';
import { Reminders, type StageProps } from './CombatParts';
import { ResultCard } from './ResultCard';

/**
 * A status card: what is happening and who the combat waits for. It ends with the way out when that device is gone
 * (take the seat over from another device), since a combat waits on one specific seat at every stage.
 */
export function Status({ icon = 'hourglass', title, children }: { icon?: 'hourglass' | 'eye' | 'combat' | 'dice'; title: string; children?: ReactNode }) {
  return (
    <section className="card stack-sm cb-status" aria-live="polite">
      <h2 className="cb-status-title">
        <Icon name={icon} size="1.25rem" />
        {title}
      </h2>
      {children}
      <p className="hint-line">
        <Icon name="info" size="1.1rem" />
        <span>{TAKE_OVER_HINT}</span>
      </p>
    </section>
  );
}

/**
 * The newest attack: its roll and any overflow strikes after it. The last one is shown in full (or as one line when
 * `collapsed`, above the viewer's own next attack); the earlier ones always as one line.
 */
export function LastResult({ game, c, side, openTools, collapsed = false }: StageProps & { collapsed?: boolean }) {
  const chain = attackChain(c.results);
  if (chain.length === 0) return null;
  const base = c.results.length - chain.length;
  return (
    <div className="cb-results">
      {chain.map((r, i) => (
        // Keyed by position and content, so an undone-and-redone result starts afresh; a strike that is no longer the
        // newest folds by its `collapsed` prop (ResultCard follows it until the player toggles).
        <ResultCard
          key={`${base + i}:${r.side}:${r.orbit}:${r.target}:${r.aims}:${r.damage}`}
          game={game}
          c={c}
          r={r}
          mySide={side}
          collapsed={collapsed || i < chain.length - 1}
          title={i === 0 ? 'Last attack' : 'Overflow'}
          openTools={openTools}
        />
      ))}
    </div>
  );
}

interface Dismissed {
  ids: string[];
}
const NONE: Dismissed = { ids: [] };
const sanitizeDismissed = (raw: unknown): Dismissed | null =>
  isRecord(raw) && Array.isArray(raw.ids) ? { ids: raw.ids.filter((x): x is string => typeof x === 'string') } : null;

/** My side's prompts for effects the app leaves to the players (see the file comment). */
export function FightNotes({ game, c, side, openTools }: StageProps) {
  const [dismissed, setDismissed] = useSheetDraft(`combat-loss:${c.attacker}-${c.defender}`, NONE, sanitizeDismissed);
  if (side === null) return null;
  const losses = lossReminders(game, c, side).filter((l) => !dismissed.ids.includes(idOf(c, l.uid)));
  const afterRound = (c.stage === 'retreat' && c.round > 1) || (c.stage === 'realign' && c.retreatAsked.length === 2);
  const roundEnd = afterRound ? reminders(game, c, side, 'roundEnd') : [];
  const tools = (label: string, section: 'damage' | 'add') =>
    openTools === undefined ? undefined : (
      <button type="button" className="btn btn-secondary" onClick={() => openTools(section)}>
        <Icon name="more" size="1.1rem" />
        {label}
      </button>
    );
  return (
    <>
      {losses.map((l) => (
        <Reminders
          key={l.uid}
          title={`Your ${shipData(c.ships.find((s) => s.uid === l.uid)?.ship ?? 'panther').name} was destroyed`}
          items={[l.text]}
          action={
            <div className="cb-reminder-actions">
              {tools('Add small ships', 'add')}
              <button type="button" className="btn btn-ghost" onClick={() => setDismissed((d) => ({ ids: [...d.ids, idOf(c, l.uid)] }))}>
                Done
              </button>
            </div>
          }
        />
      ))}
      <Reminders title={`Round ${c.round - (c.stage === 'retreat' ? 1 : 0)} ended`} items={roundEnd} action={tools('Adjust damage', 'damage')} />
    </>
  );
}

/** A lost ship's prompt is dismissed per ship (uid and type, since uids restart in every combat). */
function idOf(c: StageProps['c'], uid: string): string {
  return `${uid}:${c.ships.find((s) => s.uid === uid)?.ship ?? ''}`;
}

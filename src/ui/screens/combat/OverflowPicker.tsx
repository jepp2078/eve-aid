/**
 * Overflow after a kill (rule interpretation 4): the attacking side sends the remaining aims and
 * damage to another enemy ship in the destroyed ship's orbit, or stops. Only the attacking side gets the picker:
 * "1 aim + 2 damage carry over — choose the next target in the Small orbit". Each reachable ship (the engine's
 * candidates) shows what the carry would do to it (from the engine's preview); the others say why they are out of
 * reach. "Stop" is always available. A kill can chain into another overflow.
 */
import { useState } from 'react';
import { ship as shipData } from '../../../data/ships';
import type { Command } from '../../../engine/types';
import { InterpretationLink } from '../../components/RulesLink';
import { useCommand } from '../../hooks';
import { FactionGlyph, Icon } from '../../icons';
import { overflowRows, verdict, type OverflowRow } from '../../lib/combatFight';
import { SIZE_LABEL } from '../../lib/labels';
import type { Preview } from '../../lib/preview';
import { usePreview } from '../panel/ActionSheet';
import { CombatBoard } from './CombatBoard';
import { CombatFooter, CombatPreview, StageLayout, VerdictLine, type StageProps } from './CombatParts';
import { FightNotes, LastResult } from './FightParts';
import { HpPips } from './ShipToken';

const STOP: Command = { type: 'combatOverflow', target: null };

/** What the carry would do to the picked ship, from the engine's preview: its new result's verdict. */
function previewVerdict(p: Preview | null, name: string): ReturnType<typeof verdict> | null {
  if (p === null || !p.ok) return null;
  const results = p.result.game.combat?.results ?? [];
  const r = results[results.length - 1];
  return r === undefined ? null : verdict(r, name);
}

export function OverflowPicker(props: StageProps) {
  const { game, c, side } = props;
  const [picked, setPicked] = useState<string | null>(null);
  const { run, disabled } = useCommand();
  const rows = overflowRows(game, c);
  const pick = rows.find((r) => r.s.uid === picked && r.reach) ?? null;
  const send: Command | null = pick === null ? null : { type: 'combatOverflow', target: pick.s.uid };
  const preview = usePreview(send);
  const stop = usePreview(STOP);
  const o = c.attack?.overflow ?? null;
  const dead = c.ships.find((s) => s.uid === c.attack?.target);
  if (o === null || dead === undefined || side === null) return null;
  const pickName = pick === null ? '' : shipData(pick.s.ship).name;
  const v = pick === null ? null : previewVerdict(preview, pickName);

  const panel = (
    <>
      <LastResult {...props} />
      <section className="card stack-sm cb-overflow" aria-labelledby="cb-overflow-title">
        <h2 id="cb-overflow-title">Remaining damage</h2>
        <p className="cb-overflow-carry num">
          <strong>
            {o.aims} {o.aims === 1 ? 'aim' : 'aims'} + {o.damage} damage
          </strong>{' '}
          carry over{o.zeroDif ? ' (DIF counts as 0)' : ''} — choose the next target in the {SIZE_LABEL[dead.orbit].toLowerCase()} orbit, or stop.
        </p>
        <InterpretationLink n={4} />
        {rows.length === 0 ? (
          <p className="as-hint">
            <Icon name="info" size="1.1rem" />
            <span>No other enemy ship is left in that orbit.</span>
          </p>
        ) : (
          <ul className="cb-targets" aria-label="Ships in that orbit">
            {rows.map((row) => (
              <li key={row.s.uid}>
                <OverflowChip c={c} row={row} selected={row.s.uid === picked} busy={disabled} onPick={() => setPicked(row.s.uid === picked ? null : row.s.uid)} />
              </li>
            ))}
          </ul>
        )}
      </section>
      <FightNotes {...props} />
    </>
  );

  const footer = (
    <CombatFooter label="Remaining damage">
      {v !== null ? <VerdictLine tone={v.tone} text={v.head} /> : <CombatPreview preview={preview} hint="Pick a ship in reach, or stop" ok={`Send to ${pickName}`} />}
      {/* The primary action sits bottom-most, in the same place as every other combat stage's. */}
      <button type="button" className="btn btn-secondary btn-block" disabled={disabled || !stop?.ok} onClick={() => void run(STOP, { label: 'Let the remaining damage go' })}>
        Stop · let it go
      </button>
      <button
        type="button"
        className="btn btn-primary btn-lg btn-block"
        disabled={disabled || send === null || !preview?.ok}
        onClick={() => {
          if (send === null) return;
          void run(send, { label: `Overflow: ${v?.head ?? pickName}` }).then((ok) => ok && setPicked(null));
        }}
      >
        {pick === null ? 'Send the remaining damage' : `Send to ${pickName}`}
      </button>
    </CombatFooter>
  );

  const board = <CombatBoard game={game} c={c} mySide={side} focus={dead.orbit} token={(s) => (s.uid === picked ? { selected: true } : undefined)} />;
  return <StageLayout panel={panel} main={board} footer={footer} />;
}

function OverflowChip({ c, row, selected, busy, onPick }: { c: StageProps['c']; row: OverflowRow; selected: boolean; busy: boolean; onPick: () => void }) {
  const preview = usePreview(row.reach ? { type: 'combatOverflow', target: row.s.uid } : null);
  const name = shipData(row.s.ship).name;
  const faction = c.sides[row.s.side].faction;
  const outcome = previewVerdict(preview, name)?.head ?? null;
  return (
    <div className={['cb-target', selected && 'is-selected', !row.reach && 'is-blocked'].filter(Boolean).join(' ')} data-faction={faction}>
      <button type="button" className="cb-target-btn" aria-pressed={selected} disabled={busy || !row.reach} onClick={onPick}>
        <span className="cb-target-top">
          <FactionGlyph faction={faction} size="1rem" />
          <span className="cb-target-name">{name}</span>
          <span className="cb-target-meta">{row.s.role === 'leader' ? 'Leader' : 'Support'}</span>
          {selected && (
            <span className="tag tag-accent">
              <Icon name="aim" size="1em" />
              Next target
            </span>
          )}
        </span>
        <span className="cb-target-stats num">
          <span>
            DIF <strong>{row.dif}</strong>
          </span>
          <span>
            RED <strong>{row.red}</strong>
          </span>
          <HpPips hp={row.hp} damage={row.hp - row.hpLeft} />
        </span>
        {row.reach ? (
          outcome !== null && (
            <span className="cb-target-outcome">
              <Icon name="chevronRight" size="1em" />
              {outcome}
            </span>
          )
        ) : (
          <span className="cb-target-reason">
            <Icon name="lock" size="1em" />
            {row.why}
          </span>
        )}
      </button>
    </div>
  );
}

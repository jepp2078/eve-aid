/**
 * Re-aligning orbits that lost their leader (manual p.30 step 8): for each such orbit, either one
 * size-matched support is promoted to lead it (the others stay), or all of its supports move to other orbits that
 * have a leader. Tap-tap like the fleet assignment: tap a ship, then where it goes (unavailable places say why;
 * promoting a ship keeps the orbit's other supports in place on its own). The engine previews the placement and has the last word; the attacker goes first.
 * Everyone else sees whom the combat waits for.
 */
import { useState } from 'react';
import { ship as shipData } from '../../../data/ships';
import { leaderOf } from '../../../engine/combat/abilities';
import { needsRealign } from '../../../engine/combat/flow';
import type { CombatShip } from '../../../engine/types';
import { useCommand } from '../../hooks';
import { FactionGlyph, Icon } from '../../icons';
import { combatTask, realignTurn } from '../../lib/combat';
import {
  EMPTY_REALIGN,
  placeRealign,
  realignCommand,
  realignDraftName,
  realignMoves,
  realignSlots,
  sanitizeRealign,
  unplaceRealign,
  type RealignMove,
  type RealignSlot,
} from '../../lib/combatFight';
import { factionName, SIZE_LABEL } from '../../lib/labels';
import { usePreview, useSheetDraft } from '../panel/ActionSheet';
import { CombatFooter, CombatPreview, StageLayout, type StageProps } from './CombatParts';
import { FightNotes, LastResult, Status } from './FightParts';

export function RealignStage(props: StageProps) {
  if (combatTask(props.c, props.faction) === 'realign') return <RealignPanel {...props} />;
  const { c, side, board } = props;
  const turn = realignTurn(c);
  const who = turn === null ? null : factionName(c.sides[turn].faction);
  const mineLater = side !== null && side !== turn && needsRealign(c, side).length > 0;
  const panel = (
    <>
      <LastResult {...props} collapsed />
      <Status icon={side === null ? 'eye' : 'hourglass'} title={who === null ? 'Re-aligning orbits' : `Waiting for ${who} to re-align`}>
        <p>
          {who ?? 'A side'} places the ships that lost their leader: promoting one of them to lead (the others stay), or moving all of them to support other orbits that have a leader.
          {mineLater ? ' You re-align after them (the attacker goes first).' : ''}
        </p>
      </Status>
      <FightNotes {...props} />
    </>
  );
  return <StageLayout panel={panel} main={board} />;
}

/** "Lead the small orbit", "Lead the small orbit instead of Crow", "Support the medium orbit (led by Zealot)". */
function slotText(s: RealignSlot, uid: string, moves: readonly RealignMove[], c: StageProps['c'], side: CombatShip['side']): string {
  const drafted = moves.find((m) => m.orbit === s.orbit && m.role === 'leader' && m.uid !== uid);
  const draftedName = drafted === undefined ? null : shipName(c, drafted.uid);
  if (s.role === 'leader') return `Lead the ${s.orbit} orbit${draftedName === null ? '' : ` instead of ${draftedName}`}`;
  const leader = leaderOf(c, side, s.orbit);
  const by = leader !== null ? shipData(leader.ship).name : draftedName;
  return `Support the ${s.orbit} orbit${by === null ? '' : ` (led by ${by})`}`;
}

const shipName = (c: StageProps['c'], uid: string): string => {
  const s = c.ships.find((x) => x.uid === uid);
  return s === undefined ? 'another ship' : shipData(s.ship).name;
};

function RealignPanel(props: StageProps) {
  const { c, side, board } = props;
  const name = side === null ? 'combat-realign:none' : realignDraftName(c, side);
  const [draft, setDraft] = useSheetDraft(name, EMPTY_REALIGN, sanitizeRealign);
  const [picked, setPicked] = useState<string | null>(null);
  const { run, disabled } = useCommand();
  const cmd = side === null ? null : realignCommand(c, side, draft);
  const preview = usePreview(cmd);
  if (side === null) return null;
  const must = needsRealign(c, side);
  const all = realignMoves(c, side, draft);
  const moveOf = (uid: string): RealignMove | undefined => all.find((m) => m.uid === uid);
  const placed = must.filter((s) => moveOf(s.uid) !== undefined).length;

  const place = (move: RealignMove) => {
    setDraft((d) => placeRealign(c, side, d, move));
    setPicked(null);
  };

  const panel = (
    <>
      <LastResult {...props} collapsed />
      <section className="card stack-sm cb-realign" aria-labelledby="cb-realign-title">
        <h2 id="cb-realign-title">Re-align your orbits</h2>
        <p className="muted small">
          These ships lost their leader. For each orbit, either promote one ship of its size to lead it (the others stay), or move all of its ships to support other orbits that have a leader. Tap a ship, then where it goes.
        </p>
        <ul className="cb-realign-list">
          {must.map((s) => {
            const data = shipData(s.ship);
            const m = moveOf(s.uid);
            const open = picked === s.uid;
            return (
              <li key={s.uid} className="stack-sm">
                <button type="button" className={open ? 'cb-tray-item is-selected' : 'cb-tray-item'} aria-pressed={open} aria-expanded={open} onClick={() => setPicked(open ? null : s.uid)}>
                  <span className="cb-tray-top">
                    <FactionGlyph faction={data.faction} size="1rem" />
                    <span className="cb-tray-name">{data.name}</span>
                    <span className="tag">{SIZE_LABEL[data.size]}</span>
                    <span className="cb-tray-left">{m === undefined ? 'Not placed' : m.role === 'leader' ? `Leads the ${m.orbit} orbit` : m.orbit === s.orbit ? `Stays in the ${m.orbit} orbit` : `Supports the ${m.orbit} orbit`}</span>
                  </span>
                  <span className="cb-tray-stats">Was supporting the {s.orbit} orbit</span>
                </button>
                {open && (
                  <div className="cb-realign-slots" role="group" aria-label={`Where ${data.name} goes`}>
                    {realignSlots(c, side, draft, s.uid).map((slot) =>
                      slot.block === null ? (
                        <button key={`${slot.orbit}-${slot.role}`} type="button" className="cb-slot" onClick={() => place({ uid: s.uid, orbit: slot.orbit, role: slot.role })}>
                          <Icon name={slot.role === 'leader' ? 'crown' : 'plus'} size="1.25rem" />
                          <span>{slotText(slot, s.uid, draft.moves, c, side)}</span>
                        </button>
                      ) : (
                        <p key={`${slot.orbit}-${slot.role}`} className="cb-slot-blocked">
                          <Icon name="lock" size="1em" />
                          <span>{slot.block}</span>
                        </p>
                      ),
                    )}
                    {draft.moves.some((x) => x.uid === s.uid) && (
                      <button type="button" className="btn btn-ghost" onClick={() => setDraft((d) => unplaceRealign(c, side, d, s.uid))}>
                        <Icon name="close" size="1.1rem" />
                        Take {data.name} back
                      </button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>
      <FightNotes {...props} />
    </>
  );

  const footer = (
    <CombatFooter label="Re-align">
      <CombatPreview preview={preview} hint={`Place every ship: ${placed} of ${must.length} placed`} ok={`Ready: ${must.length} ${must.length === 1 ? 'ship' : 'ships'} placed`} />
      <button
        type="button"
        className="btn btn-primary btn-lg btn-block"
        disabled={disabled || cmd === null || !preview?.ok}
        onClick={() => cmd !== null && void run(cmd, { label: `Re-aligned ${must.length} ${must.length === 1 ? 'ship' : 'ships'}` })}
      >
        Re-align · {placed} of {must.length} placed
      </button>
    </CombatFooter>
  );
  return <StageLayout panel={panel} main={board} footer={footer} />;
}

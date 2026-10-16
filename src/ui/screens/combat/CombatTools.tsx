/**
 * The combat tools behind "More": manual changes for effects the app leaves to
 * the players — damage ± and "mark destroyed" on any ship still on the board (Sin, Flycatcher, Widow, corrections),
 * and adding up to two of my small ships (Panther) — for the two fighting sides once the rounds have begun; and
 * "Cancel combat" for any seated player at any time (it ends the combat with no rewards, so it asks first). Every
 * change is one logged command with the usual Undo, and each button is enabled only when the engine accepts it.
 */
import { useState } from 'react';
import { ship as shipData } from '../../../data/ships';
import { ORBITS, type Orbit, type ShipId } from '../../../data/types';
import { addAllowance, PANTHER_ADD } from '../../../engine/combat/flow';
import { sideOf, nameList } from '../../../engine/combat/setup';
import type { Command, CombatShip } from '../../../engine/types';
import { BottomSheet } from '../../components/BottomSheet';
import { ConfirmSheet } from '../../components/ConfirmSheet';
import { useCommand } from '../../hooks';
import { FactionGlyph, Icon } from '../../icons';
import { SIDES } from '../../lib/combatBoard';
import type { ToolSection } from '../../lib/combatFight';
import { addableShips, addCommand, toolSections } from '../../lib/combatFight';
import { factionName, SIZE_LABEL } from '../../lib/labels';
import { Segmented, StepRow, usePreview } from '../panel/ActionSheet';
import { CombatPreview, type StageProps } from './CombatParts';
import { HpPips } from './ShipToken';

export interface CombatToolsProps extends Pick<StageProps, 'game' | 'c' | 'faction' | 'side'> {
  open: boolean;
  section: ToolSection;
  onSection: (s: ToolSection) => void;
  onClose: () => void;
}

const SECTION_LABEL: Record<ToolSection, string> = { damage: 'Damage', add: 'Add ships', cancel: 'Cancel' };

export function CombatTools({ game, c, faction, side, open, section, onSection, onClose }: CombatToolsProps) {
  const [confirm, setConfirm] = useState(false);
  const { run, disabled } = useCommand();
  const sections = toolSections(c, side, faction !== null);
  const current = sections.includes(section) ? section : (sections[0] ?? 'cancel');

  return (
    <>
      <BottomSheet open={open} onClose={onClose} title="Combat tools">
        <div className="stack">
          {sections.length > 1 && (
            <Segmented label="Tool" options={sections.map((s) => ({ value: s, label: SECTION_LABEL[s] }))} value={current} onChange={onSection} />
          )}
          {current === 'damage' && <DamageTool c={c} disabled={disabled} run={run} />}
          {current === 'add' && side !== null && faction !== null && <AddTool game={game} c={c} faction={faction} disabled={disabled} run={run} />}
          {current === 'cancel' && (
            <section className="stack-sm" aria-labelledby="cb-cancel-title">
              <h3 id="cb-cancel-title">Cancel the combat</h3>
              <p>
                The combat ends at once: no winner, no rewards, no losses, and ship counts stay as they are. Use it when it was started by mistake or can't go
                on (a fighting player's phone is gone).
              </p>
              <button
                type="button"
                className="btn btn-danger btn-block"
                disabled={disabled}
                onClick={() => {
                  onClose();
                  setConfirm(true);
                }}
              >
                <Icon name="close" size="1.1rem" />
                Cancel combat…
              </button>
            </section>
          )}
        </div>
      </BottomSheet>
      <ConfirmSheet
        open={confirm}
        title="Cancel this combat?"
        confirmLabel="Cancel combat"
        cancelLabel="Keep the combat"
        tone="danger"
        busy={disabled}
        onCancel={() => setConfirm(false)}
        onConfirm={() => {
          setConfirm(false);
          void run({ type: 'combatCancel' }, { label: `Combat cancelled: ${factionName(c.attacker)} against ${factionName(c.defender)}` });
        }}
      >
        <p>
          {factionName(c.attacker)} against {factionName(c.defender)} ends with no winner and no rewards. Ships destroyed in this combat are not taken off the
          Panel counts, and the attacks so far are lost. You can undo it right after.
        </p>
      </ConfirmSheet>
    </>
  );
}

type Run = ReturnType<typeof useCommand>['run'];

/** Damage ± and "mark destroyed": pick a ship on the board, then the change. */
function DamageTool({ c, disabled, run }: { c: StageProps['c']; disabled: boolean; run: Run }) {
  const [picked, setPicked] = useState<string | null>(null);
  const ship = c.ships.find((s) => s.uid === picked && !s.removed) ?? null;
  return (
    <section className="stack-sm" aria-labelledby="cb-damage-title">
      <h3 id="cb-damage-title">Damage and destroy</h3>
      <p className="small muted">For effects the app doesn't apply itself (Sin, Flycatcher, Widow) and corrections. Each change is logged and can be undone.</p>
      {SIDES.map((side) => {
        const f = c.sides[side].faction;
        const ships = c.ships.filter((s) => s.side === side && !s.removed);
        return (
          <div key={side} className="stack-sm" data-faction={f}>
            <h4 className="cb-tools-side">
              <FactionGlyph faction={f} size="1em" /> {factionName(f)}
            </h4>
            <div className="chip-row">
              {ships.map((s) => (
                <button key={s.uid} type="button" className={s.uid === picked ? 'chip is-selected' : 'chip'} aria-pressed={s.uid === picked} onClick={() => setPicked(s.uid === picked ? null : s.uid)}>
                  {shipData(s.ship).name}
                  <span className="num muted">
                    {Math.max(0, shipData(s.ship).hp - s.damage)}/{shipData(s.ship).hp}
                  </span>
                  {s.destroyed && <Icon name="danger" size="1em" title="Destroyed" />}
                </button>
              ))}
            </div>
          </div>
        );
      })}
      {ship === null ? (
        <p className="as-hint">
          <Icon name="info" size="1.1rem" />
          <span>Pick a ship to change.</span>
        </p>
      ) : (
        <ShipChanges c={c} s={ship} disabled={disabled} run={run} />
      )}
    </section>
  );
}

function ShipChanges({ c, s, disabled, run }: { c: StageProps['c']; s: CombatShip; disabled: boolean; run: Run }) {
  const minus: Command = { type: 'combatDamage', ship: s.uid, delta: -1 };
  const plus: Command = { type: 'combatDamage', ship: s.uid, delta: 1 };
  const kill: Command = { type: 'combatDestroy', ship: s.uid };
  const pMinus = usePreview(minus);
  const pPlus = usePreview(plus);
  const pKill = usePreview(kill);
  const data = shipData(s.ship);
  const who = `${factionName(c.sides[s.side].faction)}'s ${data.name}`;
  return (
    <div className="card card-raised stack-sm cb-tools-ship">
      <p className="cb-tools-ship-head">
        <strong>{who}</strong> <span className="muted">· {SIZE_LABEL[s.orbit].toLowerCase()} orbit</span>
        {s.destroyed && (
          <span className="tag tag-danger">
            <Icon name="danger" size="1em" />
            Destroyed
          </span>
        )}
      </p>
      <HpPips hp={data.hp} damage={s.damage} />
      <div className="cb-tools-actions">
        <button type="button" className="btn btn-secondary" disabled={disabled || !pMinus?.ok} onClick={() => void run(minus, { label: `${who}: −1 damage` })}>
          <Icon name="minus" size="1.1rem" />1 damage
        </button>
        <button type="button" className="btn btn-secondary" disabled={disabled || !pPlus?.ok} onClick={() => void run(plus, { label: `${who}: +1 damage` })}>
          <Icon name="plus" size="1.1rem" />1 damage
        </button>
        <button type="button" className="btn btn-secondary cb-tools-kill" disabled={disabled || !pKill?.ok} onClick={() => void run(kill, { label: `${who} marked destroyed` })}>
          <Icon name="danger" size="1.1rem" />
          Mark destroyed
        </button>
      </div>
    </div>
  );
}

/** Panther: up to two of my small ships join the battle per destroyed Panther (supports, or the leader of an empty small orbit). */
function AddTool({ game, c, faction, disabled, run }: { game: StageProps['game']; c: StageProps['c']; faction: NonNullable<StageProps['faction']>; disabled: boolean; run: Run }) {
  const [picks, setPicks] = useState<Partial<Record<ShipId, number>>>({});
  const [orbit, setOrbit] = useState<Orbit>('small');
  const rows = addableShips(game, faction);
  const side = sideOf(c, faction);
  const room = side === null ? 0 : addAllowance(game, c, side);
  const total = Object.values(picks).reduce<number>((sum, v) => sum + (v ?? 0), 0);
  const cmd = addCommand(picks, orbit);
  const preview = usePreview(cmd);
  const names = cmd === null || cmd.type !== 'combatAddShips' ? '' : nameList(cmd.ships);
  return (
    <section className="stack-sm" aria-labelledby="cb-add-title">
      <h3 id="cb-add-title">Add small ships</h3>
      <p className="small muted">
        Panther: when it is destroyed, you may add up to {PANTHER_ADD} small ships to an orbit of your choice, once per Panther. They join as supports (or lead an empty small orbit)
        {game.mode === 'light' ? '.' : ' and count on your Panel.'}
      </p>
      {rows.map(({ ship, left }) => {
        const n = picks[ship.id] ?? 0;
        return (
          <StepRow
            key={ship.id}
            label={ship.name}
            icon={<FactionGlyph faction={faction} size="1rem" />}
            note={`${left} left in the box`}
            value={n}
            min={0}
            max={Math.min(left, n + room - total)}
            onChange={(v) => setPicks((p) => ({ ...p, [ship.id]: v }))}
          />
        );
      })}
      <p className="field-label">To the orbit</p>
      <Segmented label="To the orbit" options={ORBITS.map((o) => ({ value: o, label: SIZE_LABEL[o] }))} value={orbit} onChange={setOrbit} />
      <CombatPreview preview={preview} hint={room === 0 ? 'Needs a destroyed Panther (U2) that has not added its ships yet' : `Pick up to ${room} ${room === 1 ? 'ship' : 'ships'}`} ok={`${names} join the ${orbit} orbit`} />
      <button
        type="button"
        className="btn btn-primary btn-block"
        disabled={disabled || cmd === null || !preview?.ok || c.stage === 'assign'}
        onClick={() =>
          cmd !== null &&
          void run(cmd, { label: `Added ${names} to the ${orbit} orbit` }).then((ok) => {
            if (ok) setPicks({});
          })
        }
      >
        {total === 0 ? 'Add ships' : `Add ${names} to the ${orbit} orbit`}
      </button>
    </section>
  );
}

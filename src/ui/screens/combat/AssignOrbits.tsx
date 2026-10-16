/**
 * Fleet assignment: a tray of my ships on the board, by type with "n of m left" and key stats (in a
 * light game, which keeps no fleets, every ship of my faction with "n in the box"); tap a ship, then a slot — the
 * Leader slot of an orbit (only a ship of that size; another leader goes back to the tray) or its Supports (once the
 * orbit has a leader). Each lane shows what is placed, "No leader — this orbit won't attack",
 * and for the defender what the attacker placed there. The draft is previewed by the engine (`combatAssign`); its
 * error shows in the lane or tray row it concerns and above Confirm. Confirm sends the fleet.
 *
 * The draft is local (sessionStorage per game, seat and combat), so live updates never reset it; it outlives Confirm
 * so that Undo restores it.
 */
import { useEffect, useRef, useState } from 'react';
import { ship as shipData } from '../../../data/ships';
import { ShipName } from '../../components/CardName';
import { type Orbit, type ShipId } from '../../../data/types';
import { dicePool, opponent } from '../../../engine/combat/abilities';
import { useCommand } from '../../hooks';
import { FactionGlyph, Icon } from '../../icons';
import {
  assignCommand,
  bandScroll,
  boxCounts,
  EMPTY_ASSIGN,
  firstSlot,
  fleetHead,
  issueSpot,
  keyStats,
  laneDrafts,
  placeShip,
  removePlacement,
  sanitizeAssign,
  slotBlock,
  trayItems,
  trayLeftText,
  trayOverText,
  type Role,
  type TrayItem,
} from '../../lib/combatAssign';
import { assignDraftName } from '../../lib/combat';
import { fleetLine, ORBIT_DICE } from '../../lib/combatBoard';
import { factionName, SIZE_LABEL } from '../../lib/labels';
import { prefersReducedMotion } from '../../lib/motion';
import { usePreview, useSheetDraft } from '../panel/ActionSheet';
import { CombatFooter, CombatPreview, PoolInfo, StageLayout, type StageProps } from './CombatParts';

/** Space kept between a scrolled-to slot and the sticky bars (px). */
const SCROLL_MARGIN = 12;

export function AssignOrbits({ game, c, faction, side }: StageProps) {
  // Named by the enemy's fleet, so it holds while I draft, through my Confirm and an Undo of it (which brings my
  // placements back). TabShell drops it once the combat is over.
  const [draft, setDraft] = useSheetDraft(side === null ? 'combat-assign:none' : assignDraftName(c, side), EMPTY_ASSIGN, sanitizeAssign);
  const [selected, setSelected] = useState<ShipId | null>(null);
  const { run, disabled } = useCommand();
  // A pick scrolls its most likely slot into view (the lanes sit below the tray on phones).
  const lanesRef = useRef<HTMLDivElement>(null);
  const scrollTo = useRef<string | null>(null);
  useEffect(() => {
    const target = scrollTo.current;
    scrollTo.current = null;
    if (target === null) return;
    // Measured live (the action bar has just grown by the "Placing …" line): the strip between the sticky rail and
    // the sticky action bar.
    const frame = requestAnimationFrame(() => {
      const el = lanesRef.current?.querySelector(`[data-slot="${target}"]`);
      if (!el) return;
      const band = {
        top: document.querySelector('.cb-rail')?.getBoundingClientRect().bottom ?? 0,
        bottom: document.querySelector('.cb-footer')?.getBoundingClientRect().top ?? window.innerHeight,
      };
      const dy = bandScroll(el.getBoundingClientRect(), band, SCROLL_MARGIN);
      if (dy !== 0) window.scrollBy({ top: dy, behavior: prefersReducedMotion() ? 'instant' : 'smooth' });
    });
    return () => cancelAnimationFrame(frame);
  }, [selected]);
  const placements = draft.placements;
  const cmd = assignCommand(placements);
  const preview = usePreview(cmd);
  if (faction === null || side === null) return null;
  // A light game keeps no fleets: the box limits each ship (the engine refuses more with `no_models`).
  const light = game.mode === 'light';
  const owned = light ? boxCounts(faction) : (game.players[faction]?.ships ?? {});
  const tray = trayItems(faction, owned, placements);
  const pick = tray.find((i) => i.ship.id === selected) ?? null;
  const issue = preview !== null && !preview.ok ? issueSpot(preview.error.code, placements, owned) : null;
  const errorText = preview !== null && !preview.ok ? preview.error.message : null;
  // With a valid draft, the engine's own placement gives each orbit's dice pool.
  const placed = preview?.ok ? preview.result.game.combat : null;
  const enemy = opponent(side);

  const put = (orbit: Orbit, role: Role) => {
    if (pick === null || slotBlock(pick, orbit, role, placements) !== null) return;
    const next = placeShip(placements, pick.ship.id, orbit, role);
    setDraft({ placements: next });
    if (trayItems(faction, owned, next).find((i) => i.ship.id === pick.ship.id)?.left === 0) setSelected(null);
  };
  const pickShip = (item: TrayItem) => {
    if (selected === item.ship.id) return setSelected(null);
    const slot = firstSlot(item, placements);
    scrollTo.current = slot === null ? null : `${slot.orbit}-${slot.role}`;
    setSelected(item.ship.id);
  };
  const remove = (index: number) => setDraft((d) => ({ placements: removePlacement(d.placements, index) }));

  const confirm = async () => {
    if (cmd === null || preview === null || !preview.ok) return;
    if (await run(cmd, { label: `Fleet assigned: ${placements.length} ${placements.length === 1 ? 'ship' : 'ships'}` })) setSelected(null);
  };

  const panel = (
    <section className="card stack-sm cb-tray" aria-labelledby="cb-tray-title">
      <h2 id="cb-tray-title">Your ships</h2>
      <p className="muted small"><strong>Every ship you have in this system fights:</strong> take them all off the board and place each one here (the app can't see where your ships are). Tap a ship, then a slot in an orbit. Each orbit takes one leader of its own size; any ship can support an orbit that has a leader.</p>
      {tray.length === 0 ? (
        <p className="notice notice-warn">
          <Icon name="warn" size="1.25rem" />
          <span>You have no ships on the board. If that's wrong, correct your Board counts on the Panel.</span>
        </p>
      ) : (
        <ul className="cb-tray-list">
          {tray.map((item) => (
            <li key={item.ship.id}>
              <TrayRow item={item} light={light} selected={item.ship.id === selected} issue={issue?.ship === item.ship.id && issue.orbit === null} onTap={() => pickShip(item)} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );

  const main = (
    <div className="cb-assign-lanes" ref={lanesRef}>
      {laneDrafts(placements).map((lane) => {
        const pool = placed === null ? null : dicePool(game, placed, side, lane.orbit);
        const theirs = fleetLine(c, enemy, lane.orbit);
        const leaderBlock = slotBlock(pick, lane.orbit, 'leader', placements, light);
        const supportBlock = slotBlock(pick, lane.orbit, 'support', placements, light);
        return (
          <section key={lane.orbit} className={issue?.orbit === lane.orbit ? 'cb-lane has-issue' : 'cb-lane'} aria-labelledby={`cb-assign-${lane.orbit}`}>
            <header className="cb-lane-head">
              <h3 id={`cb-assign-${lane.orbit}`}>{SIZE_LABEL[lane.orbit]} orbit</h3>
              <span className="cb-lane-dice">{ORBIT_DICE[lane.orbit]}</span>
              {pool !== null && pool.parts.length > 0 && <PoolInfo pool={pool} />}
            </header>
            {c.sides[enemy].assigned && (
              <p className="cb-enemy" data-faction={c.sides[enemy].faction}>
                <FactionGlyph faction={c.sides[enemy].faction} size="1rem" />
                <span>
                  <span className="cb-enemy-name">{factionName(c.sides[enemy].faction)}:</span> {theirs ?? 'nothing here'}
                </span>
              </p>
            )}
            <div className="cb-slots">
              <h4 className="cb-slot-title">
                Leader <span className="muted">({lane.orbit} ship)</span>
              </h4>
              {lane.leader !== null && <Placed ship={lane.leader.ship} orbit={lane.orbit} role="leader" onRemove={() => remove(lane.leader!.index)} />}
              <Slot
                pick={pick}
                block={leaderBlock}
                quiet={lane.leader !== null}
                text={pick === null ? '' : lane.leader === null ? `Place ${pick.ship.name} as leader` : `Replace with ${pick.ship.name}`}
                empty={lane.leader === null ? `Empty · choose a ${lane.orbit} ship in your tray` : null}
                slot={`${lane.orbit}-leader`}
                onPlace={() => put(lane.orbit, 'leader')}
              />
            </div>
            <div className="cb-slots">
              <h4 className="cb-slot-title">Supports</h4>
              {lane.supports.map((s) => (
                <Placed key={s.index} ship={s.ship} orbit={lane.orbit} role="support" onRemove={() => remove(s.index)} />
              ))}
              <Slot
                pick={pick}
                block={supportBlock}
                quiet={lane.leader === null}
                text={pick === null ? '' : `Add ${pick.ship.name} as support`}
                empty={lane.supports.length === 0 ? 'None' : null}
                slot={`${lane.orbit}-support`}
                onPlace={() => put(lane.orbit, 'support')}
              />
            </div>
            {lane.status !== 'ready' && (
              <p className={lane.status === 'orphaned' ? 'cb-noleader is-warn' : 'cb-noleader'}>
                <Icon name={lane.status === 'orphaned' ? 'warn' : 'info'} size="1.1rem" />
                <span>No leader — this orbit won't attack</span>
              </p>
            )}
            {issue?.orbit === lane.orbit && errorText !== null && (
              <p className="as-error">
                <Icon name="danger" size="1.1rem" />
                <span>{errorText}</span>
              </p>
            )}
          </section>
        );
      })}
    </div>
  );

  const footer = (
    <CombatFooter label="Fleet assignment">
      {pick !== null && (
        <div className="cb-picking">
          <span>
            Placing <strong>{pick.ship.name}</strong> <span className="muted">({pick.ship.size})</span>: tap Leader or Supports in an orbit
          </span>
          <button type="button" className="btn btn-ghost" onClick={() => setSelected(null)}>
            Done
          </button>
        </div>
      )}
      <CombatPreview preview={preview} hint="Place every ship you have in this system" ok={`Ready: ${placements.length} ${placements.length === 1 ? 'ship' : 'ships'} placed`} />
      <button type="button" className="btn btn-primary btn-lg btn-block" disabled={disabled || cmd === null || preview === null || !preview.ok} onClick={() => void confirm()}>
        {fleetHead(placements)}
      </button>
    </CombatFooter>
  );

  return <StageLayout panel={panel} main={main} footer={footer} />;
}

function TrayRow({ item, light, selected, issue, onTap }: { item: TrayItem; light: boolean; selected: boolean; issue: boolean; onTap: () => void }) {
  const done = item.left === 0;
  const cls = ['cb-tray-item', selected && 'is-selected', done && 'is-done', issue && 'has-issue'].filter(Boolean).join(' ');
  return (
    <button type="button" className={cls} aria-pressed={selected} onClick={onTap} disabled={done && !selected}>
      <span className="cb-tray-top">
        <FactionGlyph faction={item.ship.faction} size="1rem" />
        <span className="cb-tray-name">{item.ship.name}</span>
        <span className="tag">{SIZE_LABEL[item.ship.size]}</span>
        <span className="cb-tray-left num">{trayLeftText(item, light)}</span>
      </span>
      <span className="cb-tray-stats num">
        {keyStats(item.ship.id)
          .map((s) => `${s.label} ${s.value}`)
          .join(' · ')}
      </span>
      {item.over > 0 && (
        <span className="cb-tray-warn">
          <Icon name="warn" size="1em" />
          {trayOverText(item, light)}
        </span>
      )}
    </button>
  );
}

function Placed({ ship, orbit, role, onRemove }: { ship: ShipId; orbit: Orbit; role: Role; onRemove: () => void }) {
  const s = shipData(ship);
  return (
    <div className="cb-placed" data-faction={s.faction}>
      <FactionGlyph faction={s.faction} size="1rem" />
      <span className="cb-placed-name">
        <ShipName ship={s} />
      </span>
      <span className="cb-placed-meta num">
        {SIZE_LABEL[s.size]} · {role === 'leader' ? `ATK ${s.atk}` : `SUP ${s.sup}`}
      </span>
      <button type="button" className="icon-btn" aria-label={`Remove ${s.name} from the ${orbit} orbit`} onClick={onRemove}>
        <Icon name="close" size="1.25rem" />
      </button>
    </div>
  );
}

/**
 * A slot's tap target while a ship is picked: a button when it fits, else the reason — unless `quiet` (a filled
 * leader slot, or the supports of an orbit without a leader, where the leader slot and the lane note already say it).
 * Without a pick: the empty text, if any.
 */
function Slot({
  pick,
  block,
  quiet,
  text,
  empty,
  slot,
  onPlace,
}: {
  pick: TrayItem | null;
  block: string | null;
  quiet: boolean;
  text: string;
  empty: string | null;
  /** "small-leader", "medium-support": the scroll target of a pick. */
  slot: string;
  onPlace: () => void;
}) {
  if (pick === null) return empty === null ? null : <p className="cb-slot-empty">{empty}</p>;
  if (block === null) {
    return (
      <button type="button" className="cb-slot" data-slot={slot} onClick={onPlace}>
        <Icon name="plus" size="1.25rem" />
        <span>{text}</span>
      </button>
    );
  }
  if (quiet) return null;
  return (
    <p className="cb-slot-blocked">
      <Icon name="lock" size="1em" />
      <span>{block}</span>
    </p>
  );
}

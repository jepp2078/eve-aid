/**
 * The orbit board: three lanes (Small · Medium · Large; columns on wide screens), each with both sides — the
 * attacker above the defender — as faction glyph + name + role, the side's dice pool in that orbit ("Pool 5", ⓘ for
 * how it adds up and which dice to roll), its leader and supports as ShipTokens, and "No leader — this orbit won't attack"
 * where that side has no leader. Removed ships are listed in one line per side. The current attacking orbit's lane is
 * highlighted. Read-only; Task 15b passes `token` to make tokens targets.
 */
import { useState } from 'react';
import { ORBITS, type Orbit } from '../../../data/types';
import { dicePool, leaderOf } from '../../../engine/combat/abilities';
import { nameList } from '../../../engine/combat/setup';
import type { CombatShip, CombatState, GameState, Side } from '../../../engine/types';
import { FactionGlyph, Icon } from '../../icons';
import { ORBIT_DICE, SIDES } from '../../lib/combatBoard';
import { factionName, SIZE_LABEL } from '../../lib/labels';
import { PoolInfo, ShipDetailSheet } from './CombatParts';
import { ShipToken, type ShipTokenProps } from './ShipToken';

export type TokenExtras = Partial<Pick<ShipTokenProps, 'selected' | 'dimmed' | 'action' | 'fromOrbit'>>;

export interface CombatBoardProps {
  game: GameState;
  c: CombatState;
  /** The viewer's side ("You" on it); null for spectators. */
  mySide: Side | null;
  /** Per-token extras (Task 15b: targets). */
  token?: (s: CombatShip) => TokenExtras | undefined;
  /** The lane to highlight; default: the orbit attacking now. */
  focus?: Orbit | null;
}

export function CombatBoard({ game, c, mySide, token, focus }: CombatBoardProps) {
  const [detail, setDetail] = useState<{ uid: string | null; open: boolean }>({ uid: null, open: false });
  const current = focus === undefined ? (c.stage === 'attack' ? (c.step?.orbit ?? null) : null) : focus;
  const onDetails = (s: CombatShip) => setDetail({ uid: s.uid, open: true });

  return (
    <section className="cb-board" aria-label="Orbit board">
      {ORBITS.map((orbit) => (
        <section key={orbit} className={orbit === current ? 'cb-lane is-current' : 'cb-lane'} aria-labelledby={`cb-lane-${orbit}`}>
          <header className="cb-lane-head">
            <h3 id={`cb-lane-${orbit}`}>{SIZE_LABEL[orbit]} orbit</h3>
            <span className="cb-lane-dice">{ORBIT_DICE[orbit]}</span>
            {orbit === current && (
              <span className="tag tag-accent">
                <Icon name="play" size="1em" />
                Attacking now
              </span>
            )}
          </header>
          {SIDES.map((side) => (
            <LaneSide key={side} game={game} c={c} side={side} orbit={orbit} you={side === mySide} token={token} onDetails={onDetails} />
          ))}
        </section>
      ))}
      <ShipDetailSheet game={game} c={c} uid={detail.uid} open={detail.open} onClose={() => setDetail((d) => ({ ...d, open: false }))} />
    </section>
  );
}

interface LaneSideProps {
  game: GameState;
  c: CombatState;
  side: Side;
  orbit: Orbit;
  you: boolean;
  token?: (s: CombatShip) => TokenExtras | undefined;
  onDetails: (s: CombatShip) => void;
}

function LaneSide({ game, c, side, orbit, you, token, onDetails }: LaneSideProps) {
  const faction = c.sides[side].faction;
  const here = c.ships.filter((s) => s.side === side && s.orbit === orbit);
  const present = here.filter((s) => !s.removed).sort((a, b) => (a.role === b.role ? 0 : a.role === 'leader' ? -1 : 1));
  const removed = here.filter((s) => s.removed);
  const assigned = c.sides[side].assigned;
  const leader = leaderOf(c, side, orbit);
  const pool = leader === null ? null : dicePool(game, c, side, orbit);

  return (
    <div className="cb-side" data-faction={faction}>
      <div className="cb-side-head">
        <FactionGlyph faction={faction} size="1rem" />
        <span className="cb-side-name">{factionName(faction)}</span>
        <span className="cb-side-role">{side}</span>
        {you && <span className="fb-you">You</span>}
        {pool !== null && <PoolInfo pool={pool} />}
      </div>
      {!assigned ? (
        <p className="cb-empty">Not placed yet</p>
      ) : (
        <>
          {leader === null && (
            <p className={present.length > 0 ? 'cb-noleader is-warn' : 'cb-noleader'}>
              <Icon name={present.length > 0 ? 'warn' : 'info'} size="1.1rem" />
              <span>No leader — this orbit won't attack</span>
            </p>
          )}
          {present.length > 0 && (
            <ul className="cb-tokens">
              {present.map((s) => (
                <li key={s.uid}>
                  <ShipToken game={game} c={c} s={s} onDetails={onDetails} {...token?.(s)} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {removed.length > 0 && (
        <p className="cb-removed">
          <Icon name="close" size="1em" />
          <span>Removed: {nameList(removed.map((s) => s.ship))}</span>
        </p>
      )}
    </div>
  );
}

/**
 * The end of the game on the Panel. `VergeBanner` (while `game.verge` is set and the game runs): who is on the Verge
 * of Ascendancy, which round is the final one, and whether the current round ends early with an emergency upkeep.
 * `FinalRanking` (phase `ended`): the winners, then every player's place with the tie-break values (VP, then
 * non-home systems, then total ship strength; a light game keeps no ships, so it has no strength column); a full tie
 * shares the place and the victory.
 */
import type { GameState } from '../../../engine/types';
import { FactionBadge } from '../../components/FactionBadge';
import { RulesLink } from '../../components/RulesLink';
import { useMe } from '../../hooks';
import { Icon } from '../../icons';
import { andList, factionName } from '../../lib/labels';
import { finalRanking } from '../../lib/upkeep';

/** On the Panel and Table it reads the open game; the big screen (outside a game) passes `game`. */
export function VergeBanner({ game: shown }: { game?: GameState } = {}) {
  const { game: open } = useMe();
  const game = shown ?? open;
  if (game === null || game.verge === null || game.phase === 'ended') return null;
  const { by, finalRound, emergencyPending } = game.verge;
  const final = game.round >= finalRound;
  let detail: string;
  if (emergencyPending) detail = `This round ends after the current turn: emergency upkeep (no domination), then round ${finalRound} is the final round.`;
  else if (!final) detail = `Round ${finalRound} is the final round.`;
  else detail = game.phase === 'upkeep' ? `Round ${finalRound} is the final round: the game ends with this upkeep.` : `This is the final round (round ${finalRound}): the game ends after its upkeep.`;
  return (
    <section className="verge" aria-labelledby="verge-title">
      <Icon name="warn" size="1.5rem" className="verge-icon" />
      <div className="verge-text">
        <h2 id="verge-title" className="verge-title">
          Verge of Ascendancy: {factionName(by)}
        </h2>
        <p>{detail}</p>
      </div>
      <RulesLink section="victory" />
    </section>
  );
}

export function FinalRanking() {
  const { game, faction } = useMe();
  if (game === null || game.phase !== 'ended' || game.result === null) return null;
  const rows = finalRanking(game);
  const light = game.mode === 'light';
  const winners = game.result.winners;
  const names = andList(winners.map(factionName));
  return (
    <section className="final card" aria-labelledby="final-title">
      <div className="title-row">
        <h2 id="final-title" className="final-title">
          <Icon name="crown" size="1.5rem" />
          Game over
        </h2>
        <RulesLink section="victory" />
      </div>
      <p className="final-verdict">{winners.length === 1 ? `${names} wins` : `${names} share the victory`}</p>
      <table className="final-table">
        <caption className="sr-only">Final ranking</caption>
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">Player</th>
            <th scope="col" className="num-col">
              VP
            </th>
            <th scope="col" className="num-col">
              Systems
            </th>
            {!light && (
              <th scope="col" className="num-col">
                Strength
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.faction} className={r.winner ? 'is-winner' : undefined} data-faction={r.faction}>
              <td className="num">{r.place}</td>
              <th scope="row">
                <span className="final-who">
                  <FactionBadge faction={r.faction} player={r.name} you={r.faction === faction} size="sm" />
                  {r.winner && (
                    <span className="tag tag-accent final-win">
                      <Icon name="crown" size="1em" />
                      Winner
                    </span>
                  )}
                </span>
              </th>
              <td className="num num-col">{r.vp}</td>
              <td className="num num-col">{r.systems}</td>
              {!light && <td className="num num-col">{r.strength}</td>}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="small muted">
        {light
          ? 'Ties go to the most systems; a full tie shares the victory.'
          : 'Ties go to the most systems, then the most total ship strength; a full tie shares the victory.'}
      </p>
    </section>
  );
}

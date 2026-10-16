/**
 * The action grid: seven actions in two columns, each with its remaining slot pips. Actions are enabled only on my
 * turn before acting; unavailable ones stay visible, and a tap says why ("Not your turn: Amarr is playing", "The
 * Build slot is used this round"). A status line above says what the game expects of me. Below it, the free
 * actions that are always available: a completed mission, an event card played, and the manual adjustment.
 */
import { SLOT_LIMIT } from '../../../data/costs';
import type { ActionType } from '../../../data/types';
import { useFeedback } from '../../components/Toast';
import { useCommand, useMe } from '../../hooks';
import { Icon, type IconName } from '../../icons';
import { actionAvailability, ACTIONS, cubeCostLabel, slotsLeft } from '../../lib/actions';
import { ACTION_LABEL, factionName } from '../../lib/labels';

function Pips({ left, limit }: { left: number; limit: number }) {
  return (
    <span className="ab-pips" aria-hidden="true">
      {Array.from({ length: limit }, (_, i) => (
        <span key={i} className={i < left ? 'ab-pip is-free' : 'ab-pip'} />
      ))}
    </span>
  );
}

function statusLine(phase: string, mine: boolean, acted: ActionType | null, passed: boolean, other: string | null, cubes: number): { icon: IconName; text: string } {
  if (phase === 'upkeep') return { icon: 'hourglass', text: 'Upkeep: actions resume next round' };
  if (phase === 'ended') return { icon: 'crown', text: 'The game is over' };
  if (passed) return { icon: 'pass', text: 'You passed this round' };
  if (mine && acted !== null) return { icon: 'check', text: `${ACTION_LABEL[acted]} done: end your turn below` };
  if (mine) return { icon: 'play', text: `Your turn: choose an action · ${cubeCostLabel(cubes)}` };
  return { icon: 'hourglass', text: other === null ? 'Waiting for the next turn' : `${other} is playing; your actions open on your turn` };
}

export function ActionBar({ onOpen }: { onOpen: (a: ActionType) => void }) {
  const { game, faction, me } = useMe();
  const { toast } = useFeedback();
  if (game === null || faction === null || me === null) return null;

  const turn = game.turn;
  const mine = game.phase === 'actions' && turn?.faction === faction;
  const other = turn !== null && turn.faction !== faction ? factionName(turn.faction) : null;
  const status = statusLine(game.phase, mine, mine ? (turn?.actionTaken ?? null) : null, me.passed, other, me.cubesUsed);

  return (
    <section className="ab" aria-labelledby="ab-title">
      <h2 id="ab-title" className="sr-only">
        Actions
      </h2>
      <p className={mine && turn?.actionTaken === null ? 'ab-status is-mine' : 'ab-status'}>
        <Icon name={status.icon} size="1.1rem" />
        <span>{status.text}</span>
      </p>
      <div className="ab-grid">
        {ACTIONS.map((a) => {
          const av = actionAvailability(game, faction, a);
          const limit = SLOT_LIMIT[a];
          const left = slotsLeft(me, a);
          return (
            <button
              key={a}
              type="button"
              className={av.ok ? 'ab-btn' : 'ab-btn is-off'}
              aria-disabled={!av.ok}
              aria-label={`${ACTION_LABEL[a]}, ${left} of ${limit} ${limit === 1 ? 'slot' : 'slots'} left${av.ok ? '' : `. ${av.reason}`}`}
              onClick={() => (av.ok ? onOpen(a) : toast(av.reason, 'info'))}
            >
              <Icon name={a} size="1.5rem" />
              <span className="ab-text">
                <span className="ab-label">{ACTION_LABEL[a]}</span>
                <Pips left={left} limit={limit} />
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

/** Missions, events and the pencil: free, any time, on any turn. */
export function FreeActions({ onMission, onAdjust }: { onMission: () => void; onAdjust: () => void }) {
  const { run, disabled } = useCommand();
  return (
    <section className="free" aria-labelledby="free-title">
      <h2 id="free-title" className="caps faint">
        Any time
      </h2>
      <div className="free-grid">
        <button type="button" className="free-btn" onClick={onMission} disabled={disabled}>
          <Icon name="vp" size="1.25rem" />
          <span>Mission done</span>
        </button>
        <button type="button" className="free-btn" onClick={() => void run({ type: 'eventPlayed' }, { label: 'Event card played' })} disabled={disabled}>
          <Icon name="play" size="1.25rem" />
          <span>Event played</span>
        </button>
        <button type="button" className="free-btn" onClick={onAdjust} disabled={disabled}>
          <Icon name="edit" size="1.25rem" />
          <span>Adjust</span>
        </button>
      </div>
    </section>
  );
}

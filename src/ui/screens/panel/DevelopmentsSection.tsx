/**
 * My developments on the Panel.
 *
 * "Researching (private)" sits behind a privacy curtain (research #8): by default only card backs with their research
 * progress show (and "Ready to complete"), never a name. The eye reveals the names for 20 s; press-and-hold on the
 * cards peeks while held; the page going to the background hides them at once. Revealed, each card shows its text,
 * tokens against cost and, once ready, Complete (on my turn in the action phase; a missing prerequisite or the wrong
 * moment disables it with the reason).
 *
 * "Completed (public)" lists my completed cards: Use for an untapped card with a keyword (free, once per round, in
 * the card's timing: my turn or combat, per card), "Used this round" for a tapped one, which dims with its icon turned 90°, like the
 * physical card. A card's text unfolds under its name.
 */
import { useEffect, useReducer, useRef, useState, type PointerEvent } from 'react';
import type { DevId } from '../../../data/types';
import { CardText } from '../../components/CardText';
import { CardPhotoButton, PhotoHoverName } from '../../components/CardPhoto';
import { DevCard } from '../../components/DevCard';
import { RulesLink } from '../../components/RulesLink';
import { useFeedback } from '../../components/Toast';
import { useCommand, useMe } from '../../hooks';
import { Icon } from '../../icons';
import { allowsSelection, curtain, HIDDEN, isRevealed, secondsLeft, type Curtain } from '../../lib/curtain';
import { AREA_SIZE, areaRows, canComplete, canUse, completedRows, type AreaRow } from '../../lib/devs';
import { devCardText } from '../../lib/cardText';
import { KEYWORD_LABEL } from '../../lib/labels';

/** Press-and-hold this long on the card backs to peek. */
const HOLD_MS = 350;

/** The curtain's state, ticking once a second while a timed reveal runs, and hidden when the page is. */
function useCurtain() {
  const [state, dispatch] = useReducer((s: Curtain, e: Parameters<typeof curtain>[1]) => curtain(s, e), HIDDEN);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (state.mode !== 'shown') return;
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      dispatch({ type: 'tick', now: t });
    }, 1000);
    return () => clearInterval(id);
  }, [state]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') dispatch({ type: 'pageHidden' });
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  // Press-and-hold: a timer starts the peek; releasing anywhere (the cards re-render under the finger) ends it.
  const hold = useRef<{ timer: ReturnType<typeof setTimeout> | null; end: (() => void) | null }>({ timer: null, end: null });
  const stopHold = () => {
    const h = hold.current;
    if (h.timer !== null) clearTimeout(h.timer);
    if (h.end !== null) {
      window.removeEventListener('pointerup', h.end);
      window.removeEventListener('pointercancel', h.end);
    }
    hold.current = { timer: null, end: null };
  };
  useEffect(() => stopHold, []);

  const onPointerDown = (e: PointerEvent<HTMLElement>) => {
    if (state.mode !== 'hidden' || e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button, a, summary')) return;
    stopHold();
    const end = () => {
      stopHold();
      dispatch({ type: 'holdEnd' });
    };
    hold.current = {
      timer: setTimeout(() => {
        hold.current.timer = null;
        dispatch({ type: 'holdStart' });
      }, HOLD_MS),
      end,
    };
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  };

  const toggle = () => {
    const t = Date.now();
    setNow(t);
    dispatch(state.mode === 'shown' ? { type: 'hide' } : { type: 'reveal', now: t });
  };

  return { revealed: isRevealed(state), selectable: allowsSelection(state), peeking: state.mode === 'peek', seconds: secondsLeft(state, now), toggle, onPointerDown };
}

/** Research on a card against its cost, as a bar and "2 / 3 research". */
function DevProgress({ tokens, cost }: { tokens: number; cost: number }) {
  const ready = tokens >= cost;
  return (
    <div className={ready ? 'dev-progress is-ready' : 'dev-progress'}>
      <span className="dev-progress-bar" role="progressbar" aria-valuemin={0} aria-valuemax={cost} aria-valuenow={Math.min(tokens, cost)} aria-label="Research">
        <span className="dev-progress-fill" style={{ width: `${Math.min(100, (tokens / cost) * 100)}%` }} />
      </span>
      <span className="dev-progress-text num">
        {tokens} / {cost} <span className="dev-progress-unit">research</span>
      </span>
    </div>
  );
}

function ReadyTag({ row }: { row: AreaRow }) {
  if (!row.ready) return null;
  return row.prereq === null ? (
    <span className="tag tag-ok">
      <Icon name="check" size="1em" />
      Ready to complete
    </span>
  ) : (
    <span className="tag">
      <Icon name="lock" size="1em" />
      Ready, needs a prerequisite
    </span>
  );
}

/** Complete, disabled with the reason underneath while the engine would refuse it (upkeep, another's turn, prerequisite). */
function CompleteButton({ row }: { row: AreaRow }) {
  const { game, faction } = useMe();
  const { run, disabled } = useCommand();
  if (game === null || faction === null) return null;
  const when = canComplete(game, faction);
  const reason = row.prereq ?? (when.ok ? null : when.reason);
  const reasonId = `dev-reason-${row.dev.id}`;
  return (
    <div className="dev-complete">
      <button
        type="button"
        className="btn btn-primary btn-block"
        disabled={disabled || reason !== null}
        aria-describedby={reason === null ? undefined : reasonId}
        onClick={() => void run({ type: 'completeDev', dev: row.dev.id }, { label: `Completed ${row.dev.name}` })}
      >
        <Icon name="check" />
        Complete {row.dev.name}
      </button>
      {reason !== null && (
        <p className="dev-reason small" id={reasonId}>
          <Icon name="info" size="1.1em" />
          <span>{reason}</span>
        </p>
      )}
    </div>
  );
}

export function DevelopmentsSection({ onUse }: { onUse: (id: DevId) => void }) {
  const { game, faction, me, priv } = useMe();
  const { toast } = useFeedback();
  const { revealed, selectable, peeking, seconds, toggle, onPointerDown } = useCurtain();
  if (game === null || faction === null || me === null) return null;

  const area = priv?.area ?? [];
  const rows = areaRows(area, me);
  const empty = Math.max(0, AREA_SIZE - area.length);
  const done = completedRows(me);
  const ended = game.phase === 'ended';

  return (
    <section className="devs" aria-labelledby="devs-title">
      <div className="title-row">
        <h2 id="devs-title" className="devs-title">
          <Icon name="devCard" size="1.25rem" />
          Developments
        </h2>
        <RulesLink section="research" />
      </div>

      <div className="devs-block">
        <h3 className="devs-sub">
          <Icon name="lock" size="1.1rem" />
          <span className="devs-sub-text">Researching (private)</span>
          <span className="devs-count num" aria-label={`${area.length} of ${AREA_SIZE} slots`}>
            {area.length}/{AREA_SIZE}
          </span>
        </h3>
        {area.length > 0 && (
          <div className="devs-curtain">
            <p className="small muted devs-curtain-note" aria-live="polite">
              {revealed ? (peeking ? 'Showing while you hold' : `Only you can see these. Hiding in ${seconds ?? 0} s`) : 'Names hidden from the table. Hold a card to peek.'}
            </p>
            <button type="button" className="btn btn-ghost devs-eye" aria-pressed={revealed} onClick={toggle}>
              <Icon name={revealed ? 'eyeOff' : 'eye'} />
              {revealed ? 'Hide' : 'Show names'}
            </button>
          </div>
        )}

        {/* While peeking the finger is still down: keep the phone's long-press (selection, callout, menu) off, or it
            cancels the hold. Only a timed reveal lets the text be selected. */}
        <div className={selectable ? 'dev-area is-selectable' : 'dev-area'} onPointerDown={onPointerDown} onContextMenu={selectable ? undefined : (e) => e.preventDefault()}>
          {revealed ? (
            <ul className="dev-area-list">
              {rows.map((r) => (
                <li key={r.dev.id}>
                  <DevCard dev={r.dev} headingLevel={4} viewCard>
                    <div className="dev-progress-row">
                      <DevProgress tokens={r.tokens} cost={r.dev.cost} />
                      <ReadyTag row={r} />
                    </div>
                    {r.ready && !ended && <CompleteButton row={r} />}
                  </DevCard>
                </li>
              ))}
              {Array.from({ length: empty }, (_, i) => (
                <li key={`empty-${i}`} className="dev-empty">
                  Empty slot
                </li>
              ))}
            </ul>
          ) : (
            <ol className="dev-backs" aria-label="Development area, names hidden">
              {rows.map((r, i) => (
                <li key={i} className={r.ready ? 'dev-back is-ready' : 'dev-back'}>
                  <span className="dev-back-art" aria-hidden="true">
                    <Icon name="devCard" size="1.75rem" />
                  </span>
                  <div className="dev-back-main">
                    <span className="dev-back-title">Card {i + 1}</span>
                    <DevProgress tokens={r.tokens} cost={r.dev.cost} />
                    <ReadyTag row={r} />
                  </div>
                </li>
              ))}
              {Array.from({ length: empty }, (_, i) => (
                <li key={`empty-${i}`} className="dev-empty">
                  Empty slot
                </li>
              ))}
            </ol>
          )}
        </div>
        {/* A light game has no Research action: the Panel's Cards button adds cards. */}
        {area.length < AREA_SIZE && !ended && <p className="small faint">{game.mode === 'light' ? 'The Cards button fills empty slots.' : 'The Research action fills empty slots.'}</p>}
      </div>

      <div className="devs-block">
        <h3 className="devs-sub">
          <Icon name="devCard" size="1.1rem" />
          <span>Completed (public)</span>
          <span className="num faint">{done.length}</span>
        </h3>
        {done.length === 0 ? (
          <p className="small muted">None yet. Complete a card once its research reaches the cost.</p>
        ) : (
          <ul className="done-list">
            {done.map((r) => (
              <li key={r.dev.id} className={r.tapped ? 'done-row is-tapped' : 'done-row'}>
                <Icon name="devCard" size="1.5rem" className="done-icon" />
                <details className="done-details">
                  <summary className="done-summary">
                    <PhotoHoverName card={{ kind: 'dev', dev: r.dev }} className="done-name">
                      {r.dev.name}
                    </PhotoHoverName>
                    <span className="dev-keyword">{r.dev.keyword === null ? 'Passive' : KEYWORD_LABEL[r.dev.keyword]}</span>
                  </summary>
                  <CardText text={devCardText(r.dev)} className="done-text" />
                  <CardPhotoButton card={{ kind: 'dev', dev: r.dev }} />
                </details>
                {r.usable &&
                  !ended &&
                  (r.tapped ? (
                    <span className="tag done-used">
                      <Icon name="clockwise" size="1em" />
                      Used this round
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-secondary done-use"
                      aria-disabled={!canUse(game, faction, r.dev.id).ok}
                      aria-label={`Use ${r.dev.name}`}
                      onClick={() => {
                        const can = canUse(game, faction, r.dev.id);
                        if (can.ok) onUse(r.dev.id);
                        else toast(can.reason, 'info');
                      }}
                    >
                      Use
                    </button>
                  ))}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

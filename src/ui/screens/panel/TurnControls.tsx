/**
 * Turn controls in the thumb zone (sticky above the tab bar) while it is my turn: before acting, Pass (secondary,
 * confirmed with consequence wording); after acting, End turn (primary). If the engine would refuse to end the turn
 * (a battle still on, research to place), the reason shows above the button with an icon; if it would refuse the
 * pass (a combat still open), the Pass confirmation says why and can't be confirmed. A light game records no action:
 * Pass (secondary) and End turn (primary) sit side by side from the start of my turn, End turn with the engine's
 * reason above it when it would refuse, and the Pass confirmation has no cube wording. The bar publishes its live
 * height as `--tc-h`, which TabShell adds to the toast inset, so a snackbar never covers it, however tall it gets.
 */
import { useLayoutEffect, useRef, useState } from 'react';
import { MAX_CUBES } from '../../../data/costs';
import { ConfirmSheet } from '../../components/ConfirmSheet';
import { useCommand, useMe } from '../../hooks';
import { Icon } from '../../icons';
import { turnControlsVisible } from '../../lib/actions';
import { usePreview } from './ActionSheet';

const END_TURN = { type: 'endTurn' } as const;
const PASS = { type: 'pass' } as const;

export function TurnControls() {
  const { game, faction, me } = useMe();
  const { run, disabled } = useCommand();
  const [confirmPass, setConfirmPass] = useState(false);
  const visible = turnControlsVisible(game, faction);
  const light = game?.mode === 'light';
  const acted = visible && game?.turn?.actionTaken !== null;
  // A light game never takes an action in the app: End turn is offered from the start.
  const endPreview = usePreview(acted || (visible && light) ? END_TURN : null);
  const blocked = endPreview !== null && !endPreview.ok ? endPreview.error.message : null;
  const passPreview = usePreview(visible && !acted && confirmPass ? PASS : null);
  const passBlocked = passPreview !== null && !passPreview.ok ? passPreview.error.message : null;
  const unused = me === null ? 0 : MAX_CUBES - me.cubesUsed;
  const barRef = useRef<HTMLDivElement>(null);

  // Publish the bar's height (0 when hidden) so toasts sit above it.
  useLayoutEffect(() => {
    const el = barRef.current;
    const root = document.documentElement;
    if (el === null) return;
    const set = () => root.style.setProperty('--tc-h', `${el.offsetHeight}px`);
    set();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(set);
    ro?.observe(el);
    return () => {
      ro?.disconnect();
      root.style.removeProperty('--tc-h');
    };
  }, [visible]);

  return (
    <>
      {visible && (
        <div className="tc" role="region" aria-label="Turn controls" ref={barRef}>
          <div className="tc-inner">
            {blocked !== null && (
              <p className="tc-reason">
                <Icon name="warn" size="1.1rem" />
                <span>{blocked}</span>
              </p>
            )}
            {light ? (
              <div className="tc-row">
                <button type="button" className="btn btn-secondary" disabled={disabled} onClick={() => setConfirmPass(true)}>
                  <Icon name="pass" />
                  Pass…
                </button>
                <button type="button" className="btn btn-primary tc-end" disabled={disabled || blocked !== null} onClick={() => void run(END_TURN)}>
                  <Icon name="endTurn" />
                  End turn
                </button>
              </div>
            ) : acted ? (
              <button type="button" className="btn btn-primary btn-lg btn-block" disabled={disabled || blocked !== null} onClick={() => void run(END_TURN)}>
                <Icon name="endTurn" />
                End turn
              </button>
            ) : (
              <div className="tc-row">
                <span className="tc-text">Choose an action above, or</span>
                <button type="button" className="btn btn-secondary" disabled={disabled} onClick={() => setConfirmPass(true)}>
                  <Icon name="pass" />
                  Pass…
                </button>
              </div>
            )}
          </div>
        </div>
      )}
      <ConfirmSheet
        open={confirmPass}
        title="Pass for this round?"
        confirmLabel="Pass for this round"
        cancelLabel="Keep playing"
        busy={disabled || passBlocked !== null}
        onCancel={() => setConfirmPass(false)}
        onConfirm={() => {
          setConfirmPass(false);
          void run(PASS);
        }}
      >
        {passBlocked !== null && (
          <p className="as-warn">
            <Icon name="warn" size="1.1rem" />
            <span>{passBlocked}</span>
          </p>
        )}
        <p>
          You take no more turns this round{!light && unused > 0 ? ` and your ${unused} unused ${unused === 1 ? 'cube stays' : 'cubes stay'} unused` : ''}. Free effects, missions and
          events stay available.
        </p>
      </ConfirmSheet>
    </>
  );
}

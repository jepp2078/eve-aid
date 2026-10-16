/**
 * To-dos addressed to me or to everyone ("Draw an Event or Mission card", "Pass the first player token", "Amarr took
 * one of your systems"), pinned at the top of the Panel as checklist cards until ticked. The host keeps them until
 * their command is undone, however long ago it was (`useTodos`), and a newer "pass the first player token" replaces the
 * older one. `info` notices (combat stage prompts, the upkeep starting, the verge) are not listed: they are toasted on
 * arrival and kept in the log. Ticks are remembered on this device profile per game (`useNoticeTicks`, shared with the
 * Setup screen's checklist); ticking shows the usual snackbar with Undo. Notices never block anything.
 */
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { loadPref, savePref } from '../../../sync/session';
import { useFeedback } from '../../components/Toast';
import { NamedText } from '../../components/CardName';
import { useMe, useTodos } from '../../hooks';
import { Icon } from '../../icons';
import { noticesPref, panelTodos, parseTicks, serializeTicks, withTick } from '../../lib/notices';

function readTicks(code: string | null): Set<string> {
  return code === null ? new Set() : parseTicks(loadPref(noticesPref(code)));
}

export interface NoticeTicks {
  ticks: ReadonlySet<string>;
  /** Ticks or unticks a notice and saves at once; `listed` (the notices on screen) prunes ids no longer shown. */
  setTick: (id: string, on: boolean, listed?: readonly string[]) => void;
}

/** This device profile's ticked notices for game `code` (re-read when the code changes). */
export function useNoticeTicks(code: string | null): NoticeTicks {
  const [state, setState] = useState(() => ({ code, ticks: readTicks(code) }));
  let current = state;
  if (state.code !== code) {
    current = { code, ticks: readTicks(code) };
    setState(current);
  }
  // The newest ticks for handlers that run later (the snackbar's Undo) or twice before a re-render.
  const latest = useRef(current);
  useLayoutEffect(() => {
    latest.current = current;
  });
  const setTick = useCallback((id: string, on: boolean, listed?: readonly string[]) => {
    const { code: c, ticks } = latest.current;
    if (c === null) return;
    const next = withTick(ticks, id, on);
    savePref(noticesPref(c), listed === undefined ? JSON.stringify([...next]) : serializeTicks(next, listed));
    latest.current = { code: c, ticks: next };
    setState(latest.current);
  }, []);
  return { ticks: current.ticks, setTick };
}

export function NoticesStack() {
  const { code, faction } = useMe();
  const todos = useTodos(code);
  const { snackbar } = useFeedback();
  const { ticks, setTick } = useNoticeTicks(code);

  if (code === null || faction === null) return null;
  const notices = panelTodos(todos);
  const listed = notices.map((n) => n.id);
  const open = notices.filter((n) => !ticks.has(n.id));
  if (open.length === 0) return null;

  return (
    <section className="notices" aria-labelledby="notices-title">
      <h2 id="notices-title" className="notices-title">
        <Icon name="check" size="1.1rem" />
        To do at the table
      </h2>
      <ul className="checklist">
        {open.map((n) => (
          <li key={n.id}>
            <label className="check-item notice-item">
              <input
                type="checkbox"
                checked={false}
                onChange={() => {
                  setTick(n.id, true, listed);
                  snackbar(`Done: ${n.text}`, { label: 'Undo', onAction: () => setTick(n.id, false) });
                }}
              />
              <span className="check-box" aria-hidden="true" />
              <span className="notice-text">
                <NamedText text={n.text} />
              </span>
              {n.toAll && <span className="tag">Everyone</span>}
            </label>
          </li>
        ))}
      </ul>
    </section>
  );
}

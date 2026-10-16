/**
 * The action log: the newest entries first, grouped by round. Each entry shows the acting faction's glyph and its
 * lines, with the notices this device may see (to me or to everyone) as secondary text. Undone entries are struck
 * through and say "Undone". The newest undoable entry (always the last item of `game.history`) carries Undo:
 * enabled when the change touched no private data or this device made it, otherwise disabled with a hint naming the
 * device that can. Without `onUndo` the list is read-only. Development card and ship names in the lines and notices
 * show their card on hover or tap.
 */
import type { FactionId } from '../../data/types';
import type { HistoryItem } from '../../engine/types';
import type { LogEntry } from '../../sync/store';
import { FactionGlyph, Icon } from '../icons';
import { NamedText } from './CardName';
import { factionName } from '../lib/labels';
import { groupLog, LOG_LIMIT, undoInfo, visibleNotices } from '../lib/log';

export interface LogListProps {
  /** As `useLog` gives it: oldest first. */
  log: readonly LogEntry[];
  /** `game.history`: decides which entry Undo reverts and who may undo it. */
  history: readonly HistoryItem[];
  me: FactionId | null;
  /** Undo the given (newest undoable) entry; omit for a read-only log. */
  onUndo?: (entry: LogEntry) => void;
  /** Undo is in flight or changes are paused (host unreachable). */
  undoDisabled?: boolean;
  limit?: number;
}

export function LogList({ log, history, me, onUndo, undoDisabled = false, limit = LOG_LIMIT }: LogListProps) {
  const groups = groupLog(log, limit);
  const undo = onUndo === undefined ? null : undoInfo(history, me);
  if (groups.length === 0) return <p className="muted">Nothing has happened yet.</p>;
  return (
    <div className="log">
      {groups.map((g) => (
        <section key={g.key} className="log-group" aria-label={g.title}>
          <h3 className="log-round caps">{g.title}</h3>
          <ol className="log-list">
            {g.entries.map((e) => {
              const notices = visibleNotices(e, me);
              const canUndo = undo !== null && undo.seq === e.seq && !e.undone;
              const hintId = `log-undo-hint-${e.seq}`;
              return (
                <li key={e.seq} className={e.undone ? 'log-entry is-undone' : 'log-entry'} data-faction={e.actor ?? undefined}>
                  <span className="log-who">
                    {e.actor === null ? <Icon name="info" size="1.1rem" /> : <FactionGlyph faction={e.actor} size="1.1rem" />}
                  </span>
                  <div className="log-body">
                    {e.actor !== null && <span className="sr-only">{factionName(e.actor)}: </span>}
                    <ul className="log-lines">
                      {e.lines.map((line, i) => (
                        <li key={i} className={i === 0 ? 'log-line is-first' : 'log-line'}>
                          <NamedText text={line} />
                        </li>
                      ))}
                    </ul>
                    {notices.length > 0 && (
                      <ul className="log-notices">
                        {notices.map((n, i) => (
                          <li key={i} className="log-notice">
                            <Icon name="chevronRight" size="1em" />
                            <span>
                              <span className="log-notice-to">{n.to === 'all' ? 'Everyone' : 'You'}:</span> <NamedText text={n.text} />
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {e.undone && (
                      <span className="tag log-undone-tag">
                        <Icon name="undo" size="1em" />
                        Undone
                      </span>
                    )}
                    {canUndo && (
                      <div className="log-undo">
                        <button
                          type="button"
                          className="btn btn-secondary log-undo-btn"
                          disabled={!undo.allowed || undoDisabled}
                          aria-describedby={hintId}
                          onClick={() => onUndo?.(e)}
                        >
                          <Icon name="undo" />
                          Undo
                        </button>
                        <p id={hintId} className={undo.allowed ? 'log-undo-hint' : 'log-undo-hint is-blocked'}>
                          {!undo.allowed && <Icon name="lock" size="1em" />}
                          {undo.hint}
                        </p>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}

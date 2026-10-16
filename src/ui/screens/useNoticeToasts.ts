/**
 * Notices to me (or to everyone) that arrive from another device while the app is open, e.g. a rival took one of my
 * systems, raided me, or attacked me, or the upkeep began: one toast (plus a haptic tick for the ones addressed to me
 * alone). To-dos also wait on the Panel's checklist; `info` notices get only this toast and the log. Notices already
 * in the log when the shell opened are not toasted again.
 * Mounted once, in TabShell, before `useRoundSummary`: when an upkeep ends both fire, and the round summary (which
 * says the same and more) wins the single toast slot.
 */
import { useEffect, useRef } from 'react';
import { useFeedback } from '../components/Toast';
import { buzz, useLog, useMe } from '../hooks';
import { arrivedNotices, newestSeq, noticeToast } from '../lib/log';

/** The whole log window the host sends, so a burst of entries can't hide a notice. */
const WINDOW = 50;

export function useNoticeToasts(): void {
  const { code, game, faction } = useMe();
  const log = useLog(code, WINDOW);
  const { toast } = useFeedback();
  /** The newest seq already looked at, per game; starts at the game's logSeq when the shell opens. */
  const seen = useRef<{ code: string; seq: number } | null>(null);

  useEffect(() => {
    if (code === null || game === null || faction === null) return;
    const s = seen.current;
    if (s === null || s.code !== code) {
      seen.current = { code, seq: game.logSeq };
      return;
    }
    const fresh = arrivedNotices(log, s.seq, faction);
    s.seq = newestSeq(log, s.seq);
    const t = noticeToast(fresh);
    if (t === null) return;
    toast(t.text, t.personal ? 'warn' : 'info');
    if (t.personal) buzz();
  }, [code, game, faction, log, toast]);
}

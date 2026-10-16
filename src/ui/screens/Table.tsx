/**
 * The Table tab: everyone's public state and the log.
 *   - Phase card: "Round 3 · Actions" (or "… · Upkeep · 2/4 confirmed", with a "Scorekeeper" tag in a light game), whose
 *     turn it is, and for everyone but the turn holder "Force next turn" behind a confirmation that names the
 *     consequence.
 *   - The verge banner and, once the game is over, the final ranking (the Panel's own components).
 *   - "Combat in progress" with a link to the Combat tab.
 *   - One row per seat in clockwise order, two lines: faction stripe, glyph, name and status tags (NOW, First player,
 *     Passed, upkeep, Winner) with VP (largest); then ISK, cubes, the central system and the board counts (systems,
 *     developments, structures). The active row has a thick faction border and "▶ NOW" (never colour alone); passed
 *     rows dim and say "Passed". A tap expands the public detail (completed developments only).
 *     A light game's board keeps the ISK, cubes and structures: its second line is systems, the central system, the
 *     completed developments ("done") and the cards still in the development area ("hidden"), and the expanded detail
 *     lists the completed developments only.
 *   - The log (last 30 entries) with Undo on the newest undoable entry.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { FactionId } from '../../data/types';
import type { GameState, PlayerPublic } from '../../engine/types';
import type { LogEntry } from '../../sync/store';
import { ConfirmSheet } from '../components/ConfirmSheet';
import { NamedText } from '../components/CardName';
import { FactionBadge } from '../components/FactionBadge';
import { LogList } from '../components/LogList';
import { RulesLink } from '../components/RulesLink';
import { useFeedback } from '../components/Toast';
import { useCommand, useConnection, useLog, useMe, useUndo } from '../hooks';
import { FactionGlyph, Icon, ResourceIcon, type IconName } from '../icons';
import { centralWords, factionName, RESOURCE_LABEL } from '../lib/labels';
import { LOG_LIMIT } from '../lib/log';
import { combatText, forceCopy, forceOutcome, phaseText, rowStatus, seatDetail, seatedFactions, TAKE_OVER_HINT, type ForceCopy, type SeatTag } from '../lib/table';
import { turnStatus } from '../lib/turn';
import { FinalRanking, VergeBanner } from './panel/FinalRanking';
import { CubeTrack } from './panel/PanelTop';

const TAG_ICON: Record<SeatTag['kind'], IconName> = {
  now: 'play',
  first: 'first',
  passed: 'pass',
  upkeepDone: 'check',
  upkeepWaiting: 'hourglass',
  winner: 'crown',
};

const TAG_CLASS: Record<SeatTag['kind'], string> = {
  now: 'tag tbl-tag-now',
  first: 'tag',
  passed: 'tag',
  upkeepDone: 'tag tag-ok',
  upkeepWaiting: 'tag',
  winner: 'tag tag-accent',
};

export function SeatTags({ tags }: { tags: readonly SeatTag[] }) {
  if (tags.length === 0) return null;
  return (
    <span className="tbl-tags">
      {tags.map((t) => (
        <span key={t.kind} className={TAG_CLASS[t.kind]}>
          <Icon name={TAG_ICON[t.kind]} size="1em" />
          {t.label}
        </span>
      ))}
    </span>
  );
}

export function TableScreen({ onOpenCombat }: { onOpenCombat: () => void }) {
  const { code, game, faction } = useMe();
  const log = useLog(code, LOG_LIMIT);
  const undo = useUndo();
  const { paused } = useConnection();
  const [undoBusy, setUndoBusy] = useState(false);
  const [open, setOpen] = useState<ReadonlySet<FactionId>>(() => new Set());

  if (code === null || game === null) return null;

  const toggle = (f: FactionId) =>
    setOpen((cur) => {
      const next = new Set(cur);
      if (!next.delete(f)) next.add(f);
      return next;
    });

  const onUndo = async (e: LogEntry) => {
    setUndoBusy(true);
    try {
      await undo(e.lines[0], e.seq); // the host refuses if something newer happened meanwhile
    } finally {
      setUndoBusy(false);
    }
  };

  const combat = combatText(game);

  return (
    <div className="screen-body stack table-screen">
      <h1 className="sr-only">Table</h1>
      {game.phase === 'ended' ? <FinalRanking /> : <PhaseCard game={game} me={faction} />}
      <VergeBanner />
      {combat !== null && game.phase !== 'ended' && (
        <section className="tbl-combat" aria-labelledby="tbl-combat-title">
          <Icon name="combat" size="1.5rem" className="tbl-combat-icon" />
          <div className="tbl-combat-text">
            <h2 id="tbl-combat-title" className="tbl-combat-title">
              Combat in progress
            </h2>
            <p>{combat}</p>
          </div>
          <button type="button" className="btn btn-secondary" onClick={onOpenCombat}>
            Open Combat
            <Icon name="chevronRight" size="1.25rem" />
          </button>
        </section>
      )}
      <section className="stack-sm" aria-labelledby="tbl-seats-title">
        <h2 id="tbl-seats-title" className="tbl-section-title">
          Players <span className="faint small">clockwise from the top seat</span>
        </h2>
        <ul className="tbl-seats">
          {seatedFactions(game).map((f) => (
            <SeatRow key={f} game={game} f={f} p={game.players[f]!} you={f === faction} open={open.has(f)} onToggle={() => toggle(f)} />
          ))}
        </ul>
      </section>
      <section className="stack-sm" aria-labelledby="tbl-log-title">
        <h2 id="tbl-log-title" className="tbl-section-title">
          Log
        </h2>
        <LogList log={log} history={game.history} me={faction} onUndo={(e) => void onUndo(e)} undoDisabled={undoBusy || paused} />
      </section>
    </div>
  );
}

interface ForceState {
  /** The turn holder the sheet is about. */
  holder: FactionId;
  /** The words shown when Confirm was pressed (frozen while the command is in flight); null before that. */
  sent: ForceCopy | null;
}

const sameCopy = (a: ForceCopy | null, b: ForceCopy | null): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * Round and phase, whose turn it is (or who the upkeep waits for); "Force next turn" for everyone but the turn
 * holder. The first player is the "First player" tag on its seat row. Once the game is over the final ranking takes
 * this card's place.
 */
function PhaseCard({ game, me }: { game: GameState; me: FactionId | null }) {
  const { uid } = useMe();
  const { run, busy, disabled } = useCommand();
  const { toast } = useFeedback();
  const [force, setForce] = useState<ForceState | null>(null);
  const [lastCopy, setLastCopy] = useState<ForceCopy | null>(null);
  const turn = game.phase === 'actions' ? game.turn : null;
  const status = turnStatus(game, me);
  const canForce = turn !== null && me !== null && turn.faction !== me;

  // The sheet is about one holder's turn: if the turn moves on before Confirm, it closes instead of switching targets.
  const stale = force !== null && force.sent === null && (!canForce || turn?.faction !== force.holder);
  useEffect(() => {
    if (!stale) return;
    setForce(null);
    toast('The turn moved on; nothing was skipped', 'info');
  }, [stale, toast]);

  const asking = force !== null && force.sent === null && !stale;
  // The consequence comes from the engine itself, on a copy of the live game, while the question is open.
  const outcome = useMemo(() => (asking && me !== null ? forceOutcome(game, me, uid) : null), [asking, game, me, uid]);
  const live = outcome === null ? null : forceCopy(game, outcome);
  if (live !== null && !sameCopy(live, lastCopy)) setLastCopy(live); // keeps the words during the closing animation
  const copy = force?.sent ?? live ?? lastCopy;

  const confirm = () => {
    if (force === null || live === null) return;
    const sent = live;
    setForce({ holder: force.holder, sent });
    // Names the holder: if their turn ends while this is on its way, the host skips nobody (`stale_turn`).
    void run({ type: 'forceAdvance', expected: force.holder }, { label: sent.done }).then((ok) => {
      setForce((cur) => (cur?.sent !== sent ? cur : ok ? null : { holder: cur.holder, sent: null }));
    });
  };

  const waiting = game.phase === 'upkeep' && game.upkeep !== null ? seatedFactions(game).filter((f) => !game.upkeep!.confirmed.includes(f)) : [];
  const section = game.phase === 'upkeep' ? 'upkeep' : 'turn';

  return (
    <section className="tbl-phase" aria-labelledby="tbl-phase-title">
      <div className="title-row">
        <h2 id="tbl-phase-title" className="tbl-phase-title">
          {phaseText(game)}
          {game.mode === 'light' && (
            <>
              {' '}
              <span className="tag">Scorekeeper</span>
            </>
          )}
        </h2>
        <RulesLink section={section} />
      </div>
      {turn !== null && (
        <p className={status.kind === 'mine' ? 'tbl-turn is-mine' : 'tbl-turn'} data-faction={turn.faction}>
          <Icon name="play" size="1.1rem" className="tbl-turn-mark" />
          <FactionGlyph faction={turn.faction} size="1.1rem" />
          <strong className="tbl-turn-title">{status.title}</strong>
          <span className="tbl-turn-detail">{status.detail}</span>
        </p>
      )}
      {waiting.length > 0 && (
        <p className="tbl-waiting">
          <Icon name="hourglass" size="1.1rem" />
          <span>Waiting for:</span>
          {waiting.map((f) => (
            <FactionBadge key={f} faction={f} player={game.players[f]?.name} variant="chip" size="sm" />
          ))}
        </p>
      )}
      {waiting.length > 0 && (
        <p className="hint-line">
          <Icon name="info" size="1.1rem" />
          <span>{TAKE_OVER_HINT}</span>
        </p>
      )}
      {canForce && (
        <button type="button" className="btn btn-secondary tbl-force" disabled={disabled} onClick={() => setForce({ holder: turn.faction, sent: null })}>
          <Icon name="endTurn" />
          Force next turn
        </button>
      )}
      <ConfirmSheet
        open={force !== null && !stale}
        title={copy?.title ?? ''}
        confirmLabel={copy?.confirm ?? ''}
        cancelLabel={copy?.cancel ?? ''}
        busy={busy || disabled || force?.sent != null || outcome?.kind === 'error' || outcome?.kind === 'combat'}
        onCancel={() => setForce(null)}
        onConfirm={confirm}
      >
        {copy !== null && (
          <div className="tbl-force-body">
            <p>{copy.where}</p>
            <p className="tbl-force-next">{copy.next}</p>
            <p>{copy.note}</p>
            {copy.hint !== null && (
              <p className="hint-line">
                <Icon name="info" size="1.1rem" />
                <span>{copy.hint}</span>
              </p>
            )}
          </div>
        )}
      </ConfirmSheet>
    </section>
  );
}

/** One seat: identity, VP, ISK, cubes, systems, central, status (light: VP, systems, central, cards); tap for the public detail. */
function SeatRow({ game, f, p, you, open, onToggle }: { game: GameState; f: FactionId; p: PlayerPublic; you: boolean; open: boolean; onToggle: () => void }) {
  const s = rowStatus(game, f);
  const light = game.mode === 'light';
  const detail = seatDetail(p, game.mode);
  const central = centralWords(game.seats.length);
  const systems = p.systems === 1 ? 'system' : 'systems';
  const detailId = `tbl-seat-${f}`;
  const cls = ['tbl-seat', s.active && 'is-active', s.dimmed && 'is-passed', open && 'is-open'].filter(Boolean).join(' ');
  return (
    <li className={cls} data-faction={f}>
      <button type="button" className="tbl-seat-btn" aria-expanded={open} aria-controls={detailId} onClick={onToggle}>
        <span className="tbl-seat-top">
          <FactionGlyph faction={f} size="1.25rem" />
          <span className="tbl-who">
            <span className="tbl-faction">{factionName(f)}</span>
            <span className="tbl-player truncate">{p.name}</span>
            {you && <span className="fb-you">You</span>}
            <SeatTags tags={s.tags} />
          </span>
          <span className="tbl-vp">
            <span className="tbl-vp-num num">{p.vp}</span>
            <span className="tbl-unit">VP</span>
          </span>
          <Icon name={open ? 'chevronUp' : 'chevronDown'} size="1.1rem" className="tbl-chevron" />
        </span>
        <span className="tbl-stats">
          {light ? (
            <span className="tbl-counts is-light" title={`${p.systems} ${systems} · ${p.central ? `${central.name.toLowerCase()} · ` : ''}${detail.summary}`}>
              <Count icon="claim" n={p.systems} label={systems} shown />
              {p.central && <Count icon="central" n={null} label={central.count} shown />}
              <Count icon="devCard" n={detail.devs.length} label="done" shown />
              <Count icon="eyeOff" n={p.devAreaCount} label="hidden" shown />
            </span>
          ) : (
            <>
              <span className="tbl-stat">
                <ResourceIcon kind="isk" size="1.1rem" title={null} />
                <span className="tbl-stat-num num">{p.res.isk}</span>
                <span className="tbl-unit">{RESOURCE_LABEL.isk}</span>
              </span>
              <CubeTrack used={p.cubesUsed} compact />
              {p.central && (
                <span className="tag tag-accent">
                  <Icon name="central" size="1em" />
                  {central.tag}
                </span>
              )}
              <span className="tbl-counts" title={`${p.systems} ${systems} · ${detail.summary}`}>
                <Count icon="claim" n={p.systems} label={systems} />
                <Count icon="devCard" n={detail.devs.length} label={detail.devs.length === 1 ? 'development' : 'developments'} />
                <Count icon="structure" n={detail.structureCount} label={detail.structureCount === 1 ? 'structure' : 'structures'} />
              </span>
            </>
          )}
        </span>
      </button>
      {open && (
        <div id={detailId} className="tbl-detail">
          <dl className="count-list">
            <DetailRow
              label="Developments"
              empty="None completed"
              items={detail.devs.map((d) => (d.tapped ? `${d.name} (used this round)` : d.name))}
              render={(item) => <NamedText text={item} />}
            />
            {!light && (
              <>
                <DetailRow label={central.name} empty={p.central ? 'Yes' : 'No'} items={[]} />
                <DetailRow
                  label="Resources"
                  empty="None"
                  items={detail.stock.map((r) => `${RESOURCE_LABEL[r.kind]} ${r.count}`)}
                  render={(item, i) => (
                    <span className="tbl-res">
                      <ResourceIcon kind={detail.stock[i]!.kind} size="1rem" title={null} />
                      {item}
                    </span>
                  )}
                />
                <DetailRow
                  label="Structures"
                  empty="None"
                  items={detail.structures.map((st) =>
                    st.type === 'citadel' && detail.homeCitadels > 0 ? `${st.label} ${st.count} (${detail.homeCitadels} at home)` : `${st.label} ${st.count}`,
                  )}
                />
                <DetailRow
                  label="Belts"
                  empty="None"
                  items={[
                    ...detail.belts.map((b) => `${RESOURCE_LABEL[b.mineral]} ${b.count}`),
                    ...(detail.lockedHomeBelts > 0 ? [`${detail.lockedHomeBelts} home locked`] : []),
                  ]}
                />
                <DetailRow label="Ships" empty="None" items={detail.ships.map((sh) => `${sh.name} ×${sh.count}`)} render={(item) => <NamedText text={item} />} />
              </>
            )}
          </dl>
        </div>
      )}
    </li>
  );
}

/** One line of a seat's public detail: a label and a list of items (or the `empty` text), each drawn by `render`. */
function DetailRow({ label, items, empty, render }: { label: string; items: readonly string[]; empty: string; render?: (item: string, i: number) => ReactNode }) {
  return (
    <div className="count-row">
      <dt>{label}</dt>
      <dd className="num">
        {items.length === 0 ? (
          empty
        ) : (
          <ul className="tbl-detail-list">
            {items.map((item, i) => (
              <li key={item}>{render === undefined ? item : render(item, i)}</li>
            ))}
          </ul>
        )}
      </dd>
    </div>
  );
}

/**
 * A board count in the collapsed row: icon and number. The word is in the row's title and for screen readers, or
 * shown beside the number in a light game's row (`shown`); without a number (`n` null) it is the icon and the word.
 */
function Count({ icon, n, label, shown = false }: { icon: IconName; n: number | null; label: string; shown?: boolean }) {
  return (
    <span className="tbl-count">
      <Icon name={icon} size="1rem" />
      {n !== null && <span className="num">{n}</span>}
      <span className={shown ? 'small faint' : 'sr-only'}> {label}</span>
    </span>
  );
}

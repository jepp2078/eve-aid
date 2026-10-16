/**
 * The rules-mandated steps that block my Panel until done, rendered purely from my public and private docs (so a
 * reload, or opening the app on another device of mine, brings them back): minerals above 12 → choose discards;
 * pending research → distribute it; a card owed → add one or skip. When several apply they come in that order. Each
 * is a full-height sheet without a close button, marked "Required by the rules"; the tab bar stays usable so the
 * player can look at the Table or the Reference meanwhile. The overlays show card names: they need decisions about
 * the cards and come right after the player's own command.
 */
import { useState } from 'react';
import { MINERAL_CAP } from '../../../data/costs';
import { DEV, dev as devById } from '../../../data/developments';
import { DevName } from '../../components/CardName';
import { MINERALS, type DevId, type Mineral } from '../../../data/types';
import { useCommand, useMe } from '../../hooks';
import { Icon, ResourceIcon } from '../../icons';
import {
  AREA_SIZE,
  blockingOverlay,
  breakthroughBack,
  deckFor,
  distributeView,
  draftFor,
  FETCH_COST,
  newDistribute,
  sanitizeDistribute,
  type DistributeDraft,
  type FetchPick,
} from '../../lib/devs';
import { isRecord } from '../../lib/drafts';
import { RESOURCE_LABEL } from '../../lib/labels';
import { mineralSum } from '../../lib/preview';
import { ActionSheet, StepRow, useSheetDraft } from './ActionSheet';
import { DevPicker, DevPickerSheet } from './DevPicker';

const noop = () => {};
const research = (n: number) => `${n} research`;

/** `n`, or the last positive value it had: keeps an overlay's title ("Distribute 5 research") while it slides away. */
function useLastPositive(n: number): number {
  const [last, setLast] = useState(n);
  if (n > 0 && n !== last) setLast(n);
  return n > 0 ? n : last;
}

/* ------------------------------------------------------------------ minerals over 12 */

interface DiscardDraft {
  /** The total it was made for (a different total starts over). */
  for: number;
  minerals: Record<Mineral, number>;
}
const NO_MINERALS: Record<Mineral, number> = { pyrite: 0, mexallon: 0, tritanium: 0, morphite: 0 };
const NO_DISCARD: DiscardDraft = { for: 0, minerals: NO_MINERALS };
const small = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x) && x >= 0 && x <= 99;

function sanitizeDiscard(raw: unknown): DiscardDraft | null {
  if (!isRecord(raw) || !small(raw.for) || !isRecord(raw.minerals)) return null;
  const minerals = { ...NO_MINERALS };
  for (const m of MINERALS) {
    const n = raw.minerals[m];
    if (!small(n)) return null;
    minerals[m] = n;
  }
  return { for: raw.for, minerals };
}

function MineralDiscardOverlay({ open }: { open: boolean }) {
  const { me } = useMe();
  const [stored, setDraft, reset] = useSheetDraft<DiscardDraft>('discard', NO_DISCARD, sanitizeDiscard);
  const total = me === null ? 0 : mineralSum(me);
  const over = Math.max(0, total - MINERAL_CAP);
  const shownOver = useLastPositive(over);
  if (me === null) return null;
  const draft = stored.for === total ? stored : { for: total, minerals: NO_MINERALS };
  // What is discarded: the draft, never more than I hold (the counter and the command use the same numbers).
  const discard = Object.fromEntries(MINERALS.map((m) => [m, Math.min(draft.minerals[m], me.res[m])])) as Record<Mineral, number>;
  const chosen = MINERALS.reduce((n, m) => n + discard[m], 0);
  const left = over - chosen;
  const minerals = Object.fromEntries(MINERALS.filter((m) => discard[m] > 0).map((m) => [m, discard[m]]));
  const title = `Discard ${shownOver} ${shownOver === 1 ? 'mineral' : 'minerals'}`;

  return (
    <ActionSheet
      open={open}
      onClose={noop}
      blocking
      title={title}
      icon="minus"
      section="upkeep"
      size="full"
      command={left === 0 && over > 0 ? { type: 'discardMinerals', minerals } : null}
      head={title}
      hint={left > 0 ? `Choose ${left} more to discard` : left < 0 ? `Remove ${-left} from the discard` : `Down to ${MINERAL_CAP}`}
      onDone={(ok) => ok && reset()}
    >
      <p>
        You hold <strong className="num">{total}</strong> minerals; you may keep at most {MINERAL_CAP} (morphite counts). Choose which {over} go back to
        the supply.
      </p>
      <p className={left === 0 ? 'ov-left is-done' : 'ov-left'} aria-live="polite">
        <Icon name={left === 0 ? 'check' : 'minus'} size="1.1rem" />
        <span className="num">{left === 0 ? `Down to ${MINERAL_CAP}` : left > 0 ? `${left} more to discard` : `${-left} too many`}</span>
      </p>
      <div className="step-list">
        {MINERALS.filter((m) => me.res[m] > 0).map((m) => {
          const n = discard[m];
          return (
            <StepRow
              key={m}
              label={RESOURCE_LABEL[m]}
              icon={<ResourceIcon kind={m} title={null} size="1.25rem" />}
              value={n}
              max={Math.min(me.res[m], n + Math.max(0, left))}
              onChange={(v) => setDraft({ for: total, minerals: { ...draft.minerals, [m]: v } })}
              note={`Keep ${me.res[m] - n} of ${me.res[m]}`}
            />
          );
        })}
      </div>
    </ActionSheet>
  );
}

/* ------------------------------------------------------------------ pending research */

const EMPTY_DIST: DistributeDraft = newDistribute(0);
const TB = DEV.technologicalBreakthrough;

function ResearchDistributeOverlay({ open }: { open: boolean }) {
  const { game, me, priv } = useMe();
  const [stored, setStored, reset] = useSheetDraft<DistributeDraft>('distribute', EMPTY_DIST, sanitizeDistribute);
  const [picking, setPicking] = useState(false);
  if (!open && picking) setPicking(false);
  const pending = priv?.pendingResearch ?? 0;
  const shownPending = useLastPositive(pending);
  if (game === null || me === null || priv === null) return null;
  const area = priv.area;
  const draft = draftFor(stored, pending);
  const view = distributeView(area, pending, draft, me.completed);
  const back = breakthroughBack(game, me, view, draft);
  const set = (next: DistributeDraft) => setStored(next);
  const setFetch = (i: number, f: FetchPick | null) =>
    set({ ...draft, fetch: f === null ? draft.fetch.filter((_, j) => j !== i) : draft.fetch.map((x, j) => (j === i ? f : x)) });
  const deck = deckFor(me, area, draft.fetch.map((f) => f.dev));
  const roomNow = view.rows.length < AREA_SIZE;

  return (
    <ActionSheet
      open={open}
      onClose={noop}
      blocking
      title={`Distribute ${research(shownPending)}`}
      icon="research"
      section="research"
      size="full"
      command={view.command}
      head={view.head}
      confirmLabel={view.head}
      hint={view.problem ?? undefined}
      onDone={(ok) => ok && reset()}
    >
      <p>
        Place your new research on the cards in your development area now, or spend {FETCH_COST} to fetch a new card. <strong>Research left over is discarded.</strong>
      </p>
      <p className={view.remaining === 0 ? 'ov-left is-done' : 'ov-left'} aria-live="polite">
        <Icon name={view.remaining === 0 ? 'check' : 'research'} size="1.1rem" />
        <span className="num">
          {view.remaining} of {pending} left to place
        </span>
      </p>

      <h3 className="sub-title">
        <Icon name="lock" size="1em" /> Your development area (private)
      </h3>
      {view.rows.length === 0 && <p className="small muted">Your area is empty: fetch a card to place research on it.</p>}
      <div className="step-list">
        {view.rows.map((r) => {
          const after = r.tokens + r.add;
          return (
            <StepRow
              key={r.dev.id}
              label={r.dev.name}
              value={r.add}
              max={r.max}
              onChange={(v) => set({ ...draft, alloc: { ...draft.alloc, [r.dev.id]: v } })}
              note={
                <>
                  {r.fetched && <span className="tag tag-accent ov-new">New</span>} {after} / {r.dev.cost}
                  {after >= r.dev.cost ? ' · ready' : ''}
                </>
              }
            />
          );
        })}
      </div>

      {view.fetches.length > 0 && <h3 className="sub-title">Fetched cards ({FETCH_COST} research each)</h3>}
      {view.fetches.map((f, i) => (
        <fieldset key={`${f.dev.id}-${i}`} className="op-row">
          <legend className="op-legend">
            <span>
              {f.back ? (
                <>
                  <DevName dev={f.dev} /> back face down
                </>
              ) : (
                <>
                  Fetch <DevName dev={f.dev} />
                </>
              )}
            </span>
          </legend>
          <button type="button" className="icon-btn op-remove" onClick={() => setFetch(i, null)} aria-label={f.back ? `Keep ${f.dev.name} completed` : `Don't fetch ${f.dev.name}`}>
            <Icon name="close" size="1.25rem" />
          </button>
          <div className="pick-list" role="radiogroup" aria-label={`Where ${f.dev.name} goes`}>
            {f.options.map((o) => {
              const on = f.replace === o;
              return (
                <button key={o ?? 'empty'} type="button" role="radio" aria-checked={on} className={on ? 'pick is-selected' : 'pick'} onClick={() => setFetch(i, { dev: f.dev.id, replace: o })}>
                  <span className="pick-main">{o === null ? 'Into an empty slot' : `Replace ${devById(o).name}`}</span>
                  {o !== null && <span className="pick-note num">{area.find((c) => c.dev === o)?.tokens ?? 0} tokens</span>}
                  {on && <Icon name="check" size="1.1rem" className="pick-check" />}
                </button>
              );
            })}
          </div>
          {f.replaced !== null && f.replaced.tokens > 0 && (
            <p className="as-warn">
              <Icon name="warn" size="1.1rem" />
              <span>
                {devById(f.replaced.dev).name}’s {f.replaced.tokens} research {f.replaced.tokens === 1 ? 'token is' : 'tokens are'} discarded.
              </span>
            </p>
          )}
        </fieldset>
      ))}
      <button type="button" className="btn btn-secondary btn-block" aria-disabled={!view.canFetch} onClick={() => view.canFetch && setPicking(true)}>
        <Icon name="plus" />
        Fetch new card ({FETCH_COST})
      </button>
      {!view.canFetch && (
        <p className="small faint">{view.remaining < FETCH_COST ? `Fetching needs ${FETCH_COST} research left to place.` : 'No slot left to fill or replace.'}</p>
      )}
      {back !== null && (
        <>
          <button
            type="button"
            className="btn btn-secondary btn-block"
            aria-disabled={!back.ok}
            onClick={() => back.ok && set({ ...draft, fetch: [...draft.fetch, { dev: TB, replace: null }] })}
          >
            <Icon name="research" />
            {devById(TB).name} back face down ({FETCH_COST})
          </button>
          <p className="small faint">
            {back.ok ? `Your completed ${devById(TB).name} goes back into your area with 0 tokens, to complete (and score) again.` : back.reason}
          </p>
        </>
      )}
      {view.remaining > 0 && (
        <p className="as-warn">
          <Icon name="warn" size="1.1rem" />
          <span>{research(view.remaining)} left over will be discarded.</span>
        </p>
      )}
      <DevPickerSheet
        open={picking}
        onClose={() => setPicking(false)}
        title={`Fetch a card (${FETCH_COST} research)`}
        devs={deck}
        onPick={(id: DevId) => set({ ...draft, fetch: [...draft.fetch, { dev: id, replace: null }] })}
        confirm={(d) => `Fetch ${d.name}`}
        intro={
          <p className="muted small">
            {!roomNow ? 'Your area is full: choose which card it replaces next.' : area.length === 0 ? 'It goes into an empty slot.' : 'It goes into an empty slot; you can make it replace a card instead.'}
          </p>
        }
      />
    </ActionSheet>
  );
}

/* ------------------------------------------------------------------ a card to add */

const NO_PICK = { dev: null as DevId | null };
const sanitizePick = (raw: unknown): { dev: DevId | null } | null => (isRecord(raw) && (raw.dev === null || typeof raw.dev === 'string') ? { dev: raw.dev as DevId | null } : null);

function AddCardOverlay({ open }: { open: boolean }) {
  const { me, priv } = useMe();
  const { run, disabled } = useCommand();
  const [draft, setDraft, reset] = useSheetDraft('addcard', NO_PICK, sanitizePick);
  const n = useLastPositive(priv?.pendingCards ?? 0);
  if (me === null || priv === null) return null;
  const full = priv.area.length >= AREA_SIZE;
  const deck = deckFor(me, priv.area);
  const chosen = deck.find((d) => d.id === draft.dev) ?? null;

  return (
    <ActionSheet
      open={open}
      onClose={noop}
      blocking
      title={n === 1 ? 'Add a development card' : `Add development cards (${n})`}
      icon="devCard"
      section="research"
      size="full"
      command={chosen === null || full ? null : { type: 'addCard', dev: chosen.id }}
      head={chosen === null ? 'Add a card' : `Add ${chosen.name}`}
      hint={full ? 'Your area is full: skip this card' : 'Choose a card from your deck'}
      onDone={(ok) => ok && reset()}
      footerSecondary={
        <button
          type="button"
          className="btn btn-secondary btn-block"
          disabled={disabled}
          onClick={() => void run({ type: 'addCard', dev: null }, { label: 'Skipped a new development card' }).then((ok) => ok && reset())}
        >
          Skip this card
        </button>
      }
    >
      <p>
        You may add a card from your deck to an empty slot of your development area, with no research on it.
        {n > 1 ? ` You have ${n} to add, one at a time.` : ''}
      </p>
      {full ? (
        <p className="notice notice-info">
          <Icon name="info" size="1.25rem" />
          <span>Your development area is full ({AREA_SIZE} cards), so this card is skipped.</span>
        </p>
      ) : (
        <DevPicker devs={deck} value={chosen?.id ?? null} onChange={(dev) => setDraft({ dev })} label="Category" />
      )}
    </ActionSheet>
  );
}

/* ------------------------------------------------------------------ which one */

/** Mounts the three overlays (stable identity) and opens the one the docs call for. */
export function PanelOverlays() {
  const { game, me, priv } = useMe();
  const which = blockingOverlay(game, me, priv);
  return (
    <>
      <MineralDiscardOverlay open={which === 'minerals'} />
      <ResearchDistributeOverlay open={which === 'research'} />
      <AddCardOverlay open={which === 'card'} />
    </>
  );
}

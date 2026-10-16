/**
 * The Research action: fill empty slots of my development area with cards from my deck (cards I haven't completed
 * and that aren't in my area) and/or swap cards in progress for new ones. A swapped-out card goes back to the deck
 * and its research tokens are discarded; the sheet says so per card. Cards are chosen in a full-height picker with
 * category chips; the card being swapped out is never offered (it is in my area). The sheet shows card names: the
 * player opened it. In a light game it is "Add or swap cards": no action, no cube, any time in the action and upkeep
 * phases.
 */
import { useState } from 'react';
import { dev as devById } from '../../../data/developments';
import { DevName } from '../../components/CardName';
import type { DevId } from '../../../data/types';
import { useMe } from '../../hooks';
import { Icon } from '../../icons';
import { cubeCostLabel } from '../../lib/actions';
import { AREA_SIZE, deckFor, NO_RESEARCH, researchCommand, researchHead, sanitizeResearch, type ResearchDraft } from '../../lib/devs';
import { ActionSheet, useSheetDraft } from './ActionSheet';
import { DevPickerSheet } from './DevPicker';

type Picking = { kind: 'fill' } | { kind: 'swap'; out: DevId } | null;

const tokensText = (n: number) => `${n} research ${n === 1 ? 'token' : 'tokens'}`;

export function ResearchSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { game, me, priv } = useMe();
  const [draft, setDraft, reset] = useSheetDraft<ResearchDraft>('research', NO_RESEARCH, sanitizeResearch);
  const [picking, setPicking] = useState<Picking>(null);
  // Closed from outside (an overlay took over the Panel): the nested picker must not pop up next time.
  if (!open && picking !== null) setPicking(null);
  if (me === null) return null;
  const light = game?.mode === 'light';

  const area = priv?.area ?? [];
  const free = Math.max(0, AREA_SIZE - area.length);
  const taken = [...draft.fill, ...draft.swap.map((s) => s.in)];
  const deck = deckFor(me, area, taken);
  const swapOf = (out: DevId) => draft.swap.find((s) => s.out === out) ?? null;
  const pick = (id: DevId) => {
    if (picking === null) return;
    if (picking.kind === 'fill') setDraft((d) => ({ ...d, fill: [...d.fill, id] }));
    else {
      const out = picking.out;
      setDraft((d) => ({ ...d, swap: [...d.swap.filter((s) => s.out !== out), { out, in: id }] }));
    }
  };
  const swappedOut = draft.swap.reduce((n, s) => n + (area.find((c) => c.dev === s.out)?.tokens ?? 0), 0);
  // Swaps of cards that left the area since (completed, or changed on another device): shown so they can be dropped.
  const stale = draft.swap.filter((s) => !area.some((c) => c.dev === s.out));
  const close = () => {
    setPicking(null);
    onClose();
  };

  return (
    <ActionSheet
      open={open}
      onClose={close}
      title={light ? 'Add or swap cards' : 'Research'}
      icon="research"
      cube={light ? null : cubeCostLabel(me.cubesUsed)}
      section="research"
      size="full"
      command={researchCommand(draft)}
      head={researchHead(draft, game?.mode)}
      hint="Fill an empty slot or swap a card"
      onDone={(ok) => {
        if (!ok) return;
        reset();
        close();
      }}
    >
      <p className="muted small">Fill empty slots with new cards and/or swap cards in progress. A swapped-out card goes back to your deck and its research tokens are discarded.</p>
      <h3 className="sub-title">
        <Icon name="lock" size="1em" /> Your development area (private)
      </h3>
      <ul className="rs-list">
        {area.map((c) => {
          const d = devById(c.dev);
          const s = swapOf(c.dev);
          return (
            <li key={c.dev} className={s === null ? 'rs-row' : 'rs-row is-swapped'}>
              <div className="rs-main">
                <span className={s === null ? 'rs-name' : 'rs-name is-out'}>
                  <DevName dev={d} />
                </span>
                <span className="rs-note num">
                  {c.tokens} / {d.cost} research
                </span>
                {s !== null && (
                  <>
                    <span className="rs-in">
                      <Icon name="swap" size="1em" /> Swap in{' '}
                      <strong>
                        <DevName dev={devById(s.in)} />
                      </strong>
                    </span>
                    {c.tokens > 0 && (
                      <span className="rs-warn">
                        <Icon name="warn" size="1em" />
                        {tokensText(c.tokens)} discarded
                      </span>
                    )}
                  </>
                )}
              </div>
              {s === null ? (
                <button type="button" className="btn btn-secondary rs-btn" onClick={() => setPicking({ kind: 'swap', out: c.dev })} aria-label={`Swap ${d.name}`}>
                  <Icon name="swap" />
                  Swap…
                </button>
              ) : (
                <button type="button" className="btn btn-ghost rs-btn" onClick={() => setDraft((x) => ({ ...x, swap: x.swap.filter((y) => y.out !== c.dev) }))}>
                  Keep
                </button>
              )}
            </li>
          );
        })}
        {stale.map((x) => (
          <li key={`stale-${x.out}`} className="rs-row is-swapped">
            <div className="rs-main">
              <span className="rs-name is-out">
                <DevName dev={devById(x.out)} />
              </span>
              <span className="rs-warn">
                <Icon name="warn" size="1em" />
                No longer in your area
              </span>
            </div>
            <button type="button" className="btn btn-ghost rs-btn" onClick={() => setDraft((d) => ({ ...d, swap: d.swap.filter((y) => y.out !== x.out) }))}>
              Drop
            </button>
          </li>
        ))}
        {draft.fill.map((id) => (
          <li key={`fill-${id}`} className="rs-row is-new">
            <div className="rs-main">
              <span className="rs-name">
                <DevName dev={devById(id)} />
              </span>
              <span className="rs-note">
                <span className="tag tag-accent">
                  <Icon name="plus" size="1em" />
                  New
                </span>{' '}
                <span className="num">0 / {devById(id).cost} research</span>
              </span>
            </div>
            <button type="button" className="btn btn-ghost rs-btn" onClick={() => setDraft((x) => ({ ...x, fill: x.fill.filter((y) => y !== id) }))} aria-label={`Remove ${devById(id).name}`}>
              Remove
            </button>
          </li>
        ))}
        {Array.from({ length: Math.max(0, free - draft.fill.length) }, (_, i) => (
          <li key={`slot-${i}`} className="rs-row is-empty">
            <span className="rs-main muted">Empty slot</span>
            <button type="button" className="btn btn-secondary rs-btn" onClick={() => setPicking({ kind: 'fill' })}>
              <Icon name="plus" />
              Fill…
            </button>
          </li>
        ))}
      </ul>
      {swappedOut > 0 && (
        <p className="as-warn">
          <Icon name="warn" size="1.1rem" />
          <span>Swapping discards {tokensText(swappedOut)}.</span>
        </p>
      )}
      <DevPickerSheet
        open={picking !== null}
        onClose={() => setPicking(null)}
        title={picking?.kind === 'swap' ? `Swap out ${devById(picking.out).name}` : 'Fill an empty slot'}
        devs={deck}
        onPick={pick}
        confirm={(d) => (picking?.kind === 'swap' ? `Swap in ${d.name}` : `Add ${d.name}`)}
        intro={<p className="muted small">Your deck: cards you haven’t completed and that aren’t in your area.</p>}
      />
    </ActionSheet>
  );
}

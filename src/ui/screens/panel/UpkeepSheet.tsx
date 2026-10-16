/**
 * My upkeep, in place of the action grid while the phase is `upkeep` and I haven't confirmed: every computed number
 * with its breakdown ("Income 10 = base 4 + 2×Customs 3"), the minerals the belts bring against the 12 cap with
 * discard steppers when over, the refinery split (planetary / moon, plus conversions with Upgraded Refinery), the
 * Research Lab when I have it, and raids on the other players' homes (fleet strength against their defence). The
 * live preview from the engine and Confirm sit in `UpkeepBar`, sticky in the thumb zone like the turn controls;
 * `useUpkeepForm` holds the state both share. Once confirmed: who the table is still waiting for. A light game's upkeep
 * (`LightUpkeep`) reuses the numbered step, the waiting card and the Confirm bar.
 *
 * `useRoundSummary` toasts what the finished upkeep did (new round, first player, VP changes) on every device;
 * the player whose confirm finished it already read that in their own snackbar.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { MINERAL_CAP } from '../../../data/costs';
import { MINERALS, type FactionId } from '../../../data/types';
import type { Command } from '../../../engine/types';
import { upkeepPreview, type UpkeepPreview } from '../../../engine/upkeep';
import { FactionBadge } from '../../components/FactionBadge';
import { RulesLink } from '../../components/RulesLink';
import { useFeedback } from '../../components/Toast';
import { useCommand, useMe } from '../../hooks';
import { Icon, ResourceIcon } from '../../icons';
import { RESOURCE_LABEL, STRUCTURE_LABEL } from '../../lib/labels';
import { hasContents, STRUCTURE_TYPES } from '../../lib/ops';
import { consequence, mineralSum, type Preview } from '../../lib/preview';
import {
  afterMining,
  breakthroughNote,
  defaultUpkeep,
  incomeBreakdown,
  previewWith,
  miningText,
  mineralsAfter,
  raidOutcome,
  refineryLimits,
  researchBreakdown,
  researchLabState,
  type ResearchLabState,
  roundSummary,
  sanitizeUpkeep,
  upkeepCommand,
  withOccupied,
  type UpkeepDraft,
} from '../../lib/upkeep';
import { PreviewRow, StepRow, Toggle, usePreview, useSheetDraft } from './ActionSheet';
import { ContentsFields } from './ContentsFields';

/** Raiding fleet strength the stepper allows (5 large ships is 25). */
const MAX_RAID = 30;

/** Toasts the summary of a finished upkeep ("Round 2 begins · Caldari is first player · VP: Amarr +2"). */
export function useRoundSummary(): void {
  const { game, faction } = useMe();
  const { toast } = useFeedback();
  const prev = useRef(game);
  useEffect(() => {
    const before = prev.current;
    prev.current = game;
    if (before === null || game === null || before === game) return;
    const text = roundSummary(before, game);
    // The confirm that finished the upkeep was mine: my snackbar already says this.
    if (text === null || game.history[game.history.length - 1]?.actor === faction) return;
    toast(text, 'info');
  }, [game, faction, toast]);
}

/** A numbered step of the upkeep card (also the light upkeep's). */
export function UpkeepStep({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section className="uk-step" aria-labelledby={`uk-step-${n}`}>
      <h3 id={`uk-step-${n}`} className="uk-step-title">
        <span className="uk-step-n num" aria-hidden="true">
          {n}
        </span>
        {title}
      </h3>
      {children}
    </section>
  );
}

/** Once I have confirmed (a full or a light upkeep): who the table is still waiting for, and my raids. */
export function UpkeepWaiting() {
  const { game, faction } = useMe();
  if (game === null || game.upkeep === null) return null;
  const confirmed = game.upkeep.confirmed;
  const waiting = game.seats.filter((f) => game.players[f] !== undefined && !confirmed.includes(f));
  const raids = game.upkeep.raids.filter((r) => r.raider === faction);
  // A light game records only the raids that succeeded at the table, with no strength.
  const light = game.mode === 'light';
  return (
    <section className="uk card" aria-labelledby="uk-title">
      <div className="title-row">
        <h2 id="uk-title" className="uk-title">
          <Icon name="check" size="1.25rem" className="uk-ok" />
          Upkeep confirmed
        </h2>
        <RulesLink section="upkeep" />
      </div>
      <p className="uk-waiting">
        <Icon name="hourglass" size="1.1rem" />
        <span>Waiting for:</span>
        {waiting.map((f) => (
          <FactionBadge key={f} faction={f} player={game.players[f]?.name} variant="chip" size="sm" />
        ))}
      </p>
      {raids.length > 0 && (
        <p className="small muted">
          Your raids: {raids.map((r) => `${game.players[r.target]?.name ?? r.target}${light ? '' : ` (strength ${r.strength})`}`).join(', ')}. They resolve when everyone has confirmed.
        </p>
      )}
      <p className="small muted">Missions, events and developments stay available meanwhile.</p>
    </section>
  );
}

type SetDraft = (next: UpkeepDraft | ((d: UpkeepDraft) => UpkeepDraft)) => void;

/** My open upkeep: its draft, the `confirmUpkeep` it makes and the engine's preview of it. */
export interface UpkeepForm {
  draft: UpkeepDraft;
  setDraft: SetDraft;
  pre: UpkeepPreview;
  lab: ResearchLabState;
  cmd: Command;
  preview: Preview | null;
}

/**
 * The upkeep form's state, shared by the form (in the action area) and its Confirm bar (in the thumb zone). Null
 * unless the phase is `upkeep` and I haven't confirmed. The draft lives in sessionStorage per round.
 */
export function useUpkeepForm(): UpkeepForm | null {
  const { game, faction, me } = useMe();
  const round = game?.round ?? 0;
  // The draft's defaults come from the board as it is (nothing occupied); the preview below takes the occupied ones out.
  const owned = useMemo(() => (me === null ? null : upkeepPreview(me)), [me]);
  const refineries = owned?.refineries ?? 0;
  const upgradedRefinery = owned?.upgradedRefinery ?? false;
  // The draft's starting point for this round (stable while the refinery count stays the same). Its key changes when
  // the upkeep starts, so the defaults are taken from the board at that moment (not from earlier in the round).
  const fallback = useMemo(() => defaultUpkeep(round, { refineries, upgradedRefinery }), [round, refineries, upgradedRefinery]);
  const [draft, setDraft] = useSheetDraft<UpkeepDraft>(`upkeep:${round}:${game?.phase === 'upkeep' ? 'open' : 'later'}`, fallback, sanitizeUpkeep);
  const open = game !== null && faction !== null && me !== null && game.phase === 'upkeep' && game.upkeep !== null && !game.upkeep.confirmed.includes(faction);
  const pre = useMemo(() => (me === null ? null : previewWith(me, draft.occupied)), [me, draft.occupied]);
  const lab = me === null ? 'none' : researchLabState(me, draft.occupied);
  const cmd = open ? upkeepCommand(draft, lab === 'ok') : null;
  const preview = usePreview(cmd);
  if (!open || pre === null || cmd === null) return null;
  return { draft, setDraft, pre, lab, cmd, preview };
}

/** Confirm (with the before→after preview) in the thumb zone, above the tab bar, while my upkeep (full or light) is open. */
export function UpkeepBar({ form }: { form: Pick<UpkeepForm, 'cmd' | 'preview'> }) {
  const { game } = useMe();
  const { run, disabled } = useCommand();
  const [bar, setBar] = useState<HTMLDivElement | null>(null);

  // Publish the bar's height so toasts sit above it (TabShell adds --uk-h to the inset).
  useLayoutEffect(() => {
    const el = bar;
    const root = document.documentElement;
    if (el === null) return;
    const set = () => root.style.setProperty('--uk-h', `${el.offsetHeight}px`);
    set();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(set);
    ro?.observe(el);
    return () => {
      ro?.disconnect();
      root.style.removeProperty('--uk-h');
    };
  }, [bar]);

  const { cmd, preview } = form;
  const label = preview?.ok ? consequence('Confirm upkeep', preview.changes) : 'Confirm upkeep';
  // The confirm that finishes the upkeep says what it did (the other devices get the same as a toast).
  const done = game !== null && preview?.ok && preview.result.game.phase !== 'upkeep' ? (roundSummary(game, preview.result.game) ?? label) : label;
  return (
    <div className="tc uk-bar" role="region" aria-label="Confirm upkeep" ref={setBar}>
      <div className="tc-inner">
        <PreviewRow preview={preview} />
        <button type="button" className="btn btn-primary btn-lg btn-block as-confirm" disabled={disabled || preview === null || !preview.ok} onClick={() => void run(cmd, { label: done })}>
          <Icon name="check" />
          {label}
        </button>
      </div>
    </div>
  );
}

/** My upkeep in place of the action grid (`form` from `useUpkeepForm`), or who we wait for once confirmed. */
export function UpkeepSheet({ form }: { form: UpkeepForm | null }) {
  const { game, faction, me } = useMe();
  if (game === null || faction === null || me === null || game.upkeep === null) return null;
  if (form === null) return game.upkeep.confirmed.includes(faction) ? <UpkeepWaiting /> : null;
  const { draft, setDraft, pre, lab } = form;

  const mined = afterMining(me, pre);
  const { total, over } = mineralsAfter(me, pre, draft.discard);
  const discarding = MINERALS.reduce((n, m) => n + draft.discard[m], 0);
  const limits = refineryLimits(me, pre, draft.refinery);
  const setRefinery = (k: keyof UpkeepDraft['refinery'], v: number) => setDraft((d) => ({ ...d, refinery: { ...d.refinery, [k]: v } }));
  const rivals = game.seats.filter((f): f is FactionId => f !== faction && game.players[f] !== undefined);
  const breakthrough = breakthroughNote(game, faction, me);
  let n = 0;

  return (
    <section className="uk card" aria-labelledby="uk-title">
      <div className="title-row">
        <h2 id="uk-title" className="uk-title">
          <Icon name="hourglass" size="1.25rem" />
          Upkeep · round {game.round}
        </h2>
        <RulesLink section="upkeep" />
      </div>
      {game.upkeep.emergency && (
        <p className="notice notice-warn">
          <Icon name="warn" size="1.25rem" />
          <span>Emergency upkeep (Verge of Ascendancy): no domination this time.</span>
        </p>
      )}
      <p className="small muted">Everyone does this at the same time. Confirm when your board matches.</p>

      <UpkeepStep n={++n} title="Occupied systems">
        <p className="small muted">
          A system with enemy ships in it pays nothing this upkeep: no minerals from its belts and no bonus from its structures. Count what is occupied right now.
        </p>
        <ContentsFields
          value={draft.occupied}
          onChange={(occupied) => setDraft((d) => withOccupied(d, me, occupied))}
          structures={STRUCTURE_TYPES.filter((s) => s !== 'citadel')}
          maxBelts={me.belts}
          maxStructures={me.structures}
          beltLabel={(m) => `Occupied ${RESOURCE_LABEL[m]} belts`}
          structureLabel={(s) => `Occupied ${STRUCTURE_LABEL[s]}`}
        />
        {!hasContents(draft.occupied) && <p className="small muted">None: leave it as it is.</p>}
      </UpkeepStep>

      <UpkeepStep n={++n} title="Mine minerals">
        <p className="uk-line">
          <span className="num">{miningText(pre)}</span>
        </p>
        <p className="uk-line num">
          Minerals {mineralSum(me)} → {total}/{MINERAL_CAP}
          {over > 0 && (
            <span className="tag tag-warn">
              <Icon name="warn" size="1em" />
              Discard {over} more
            </span>
          )}
        </p>
        {(over > 0 || discarding > 0) && (
          <>
            <p className="small muted">Keep at most {MINERAL_CAP} minerals (morphite counts): choose what goes back.</p>
            <div className="step-list">
              {MINERALS.filter((m) => mined[m] > 0).map((m) => (
                <StepRow
                  key={m}
                  label={`Discard ${RESOURCE_LABEL[m]}`}
                  icon={<ResourceIcon kind={m} title={null} size="1.25rem" />}
                  value={draft.discard[m]}
                  max={Math.min(mined[m], draft.discard[m] + over)}
                  onChange={(v) => setDraft((d) => ({ ...d, discard: { ...d.discard, [m]: v } }))}
                  note={`Keep ${mined[m] - draft.discard[m]} of ${mined[m]}`}
                />
              ))}
            </div>
          </>
        )}
      </UpkeepStep>

      {pre.refineries > 0 && (
        <UpkeepStep n={++n} title="Refinery">
          <p className="small muted">
            {pre.upgradedRefinery
              ? `Upgraded Refinery: ${pre.refineries === 1 ? 'your refinery gives' : `each of your ${pre.refineries} refineries gives`} planetary and moon, and can turn 1 planetary + 1 moon into a component.`
              : pre.refineries === 1
                ? 'Your refinery gives one material of its system: planetary or moon.'
                : `Each of your ${pre.refineries} refineries gives one material of its system: split them.`}
          </p>
          <div className="step-list">
            <StepRow
              label="Planetary"
              icon={<ResourceIcon kind="planetary" title={null} size="1.25rem" />}
              value={draft.refinery.planetary}
              max={Math.max(draft.refinery.planetary, limits.planetary)}
              onChange={(v) => setRefinery('planetary', v)}
            />
            <StepRow
              label="Moon"
              icon={<ResourceIcon kind="moon" title={null} size="1.25rem" />}
              value={draft.refinery.moon}
              max={Math.max(draft.refinery.moon, limits.moon)}
              onChange={(v) => setRefinery('moon', v)}
            />
            {pre.upgradedRefinery && (
              <StepRow
                label="Convert to components"
                icon={<ResourceIcon kind="component" title={null} size="1.25rem" />}
                value={draft.refinery.convert}
                max={Math.max(draft.refinery.convert, limits.convert)}
                onChange={(v) => setRefinery('convert', v)}
                note="Each: 1 planetary + 1 moon"
              />
            )}
          </div>
        </UpkeepStep>
      )}

      <UpkeepStep n={++n} title="Income">
        <p className="uk-line num">
          <ResourceIcon kind="isk" title={null} size="1.1rem" />
          {incomeBreakdown(me, draft.occupied)}
        </p>
      </UpkeepStep>

      <UpkeepStep n={++n} title="Research">
        <p className="uk-line num">
          <Icon name="research" size="1.1rem" />
          {researchBreakdown(me, draft.occupied)}
        </p>
        <p className="small muted">You place it on your cards right after confirming.</p>
        {breakthrough !== null && (
          <p className="hint-line">
            <Icon name="info" size="1.1rem" />
            <span>{breakthrough}</span>
          </p>
        )}
        {lab !== 'none' && (
          <Toggle
            label="Research Lab: add a development card"
            note={lab === 'ok' ? 'Upgraded Eng. Complex – Research Lab' : 'Needs an engineering complex'}
            checked={lab === 'ok' && draft.researchLab}
            disabled={lab !== 'ok'}
            onChange={(researchLab) => setDraft((d) => ({ ...d, researchLab }))}
          />
        )}
      </UpkeepStep>

      {rivals.length > 0 && (
        <UpkeepStep n={++n} title="Raids">
          <div className="title-row">
            <p className="small muted">A fleet of yours in another player’s home system raids it: enter that fleet’s strength.</p>
            <RulesLink section="raids" />
          </div>
          <ul className="uk-raids">
            {rivals.map((f) => {
              const target = game.players[f]!;
              const s = draft.raids[f] ?? 0;
              const out = raidOutcome(target, s);
              return (
                <li key={f} className="uk-raid">
                  <div className="uk-raid-head">
                    <FactionBadge faction={f} player={target.name} />
                  </div>
                  <StepRow
                    label={`Raiding fleet strength on ${target.name}`}
                    value={s}
                    max={MAX_RAID}
                    onChange={(v) => setDraft((d) => ({ ...d, raids: { ...d.raids, [f]: v } }))}
                    format={(v) => (v === 0 ? 'None' : v)}
                  />
                  <p className={`uk-raid-out is-${out.kind}`}>
                    <Icon name={out.kind === 'win' ? 'check' : out.kind === 'fail' ? 'close' : 'info'} size="1.1em" />
                    <span>{out.text}</span>
                  </p>
                </li>
              );
            })}
          </ul>
        </UpkeepStep>
      )}

    </section>
  );
}

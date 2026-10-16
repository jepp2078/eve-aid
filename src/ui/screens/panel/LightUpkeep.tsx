/**
 * My light upkeep, in place of the record grid while the phase is `upkeep` and I haven't confirmed. The board does the
 * mining, refining and income, so the card lists those steps to tick as I go (the ticks stay on this phone and are
 * never sent); then what the app tracks: the research I gained (and the Research Lab card, for holders), the rivals
 * whose raids I won at the table, and Fleet Supremacy's large ship (holders only). Confirm sits in the same thumb-zone
 * bar as a full upkeep's (`UpkeepBar`); `useLightUpkeepForm` holds the state both share. Once confirmed: who the table
 * is still waiting for, as in a full game.
 */
import { useCallback, useMemo } from 'react';
import type { FactionId } from '../../../data/types';
import type { Command } from '../../../engine/types';
import { FactionBadge } from '../../components/FactionBadge';
import { RulesLink } from '../../components/RulesLink';
import { useMe } from '../../hooks';
import { Icon } from '../../icons';
import {
  BASE_RESEARCH,
  BOARD_STEPS,
  defaultLightUpkeep,
  lightUpkeepCan,
  lightUpkeepCommand,
  MAX_GAINED_RESEARCH,
  sanitizeLightUpkeep,
  type LightUpkeepDraft,
} from '../../lib/light';
import type { Preview } from '../../lib/preview';
import { breakthroughNote } from '../../lib/upkeep';
import { CheckRow } from '../combat/CombatParts';
import { StepRow, Toggle, usePreview, useSheetDraft } from './ActionSheet';
import { UpkeepBar, UpkeepStep, UpkeepWaiting } from './UpkeepSheet';

type Edit = (f: (d: LightUpkeepDraft) => LightUpkeepDraft) => void;

/** My open light upkeep: its draft, the cards I hold, my rivals, the `lightUpkeep` it makes and the engine's preview. */
export interface LightUpkeepForm {
  draft: LightUpkeepDraft;
  edit: Edit;
  can: { lab: boolean; supremacy: boolean };
  /** The seated rivals, in seat order: the raid chips. */
  rivals: FactionId[];
  cmd: Command;
  preview: Preview | null;
}

const NO_CARDS = { lab: false, supremacy: false };

/**
 * The light upkeep form's state, shared by the card (in the grid's place) and its Confirm bar (in the thumb zone). Null
 * unless the phase is `upkeep` and I haven't confirmed. The draft lives in sessionStorage; one from another round's
 * upkeep is set aside, whether read back after a reload or still held by a Panel that stayed open.
 */
export function useLightUpkeepForm(): LightUpkeepForm | null {
  const { game, faction, me } = useMe();
  const round = game?.round ?? 0;
  const fallback = useMemo(() => defaultLightUpkeep(round), [round]);
  const [stored, setStored] = useSheetDraft<LightUpkeepDraft>('lightUpkeep', fallback, (raw) => sanitizeLightUpkeep(raw, round));
  const draft = stored.round === round ? stored : fallback;
  const edit = useCallback<Edit>((f) => setStored((d) => f(d.round === round ? d : fallback)), [setStored, round, fallback]);

  const open = game !== null && faction !== null && me !== null && game.phase === 'upkeep' && game.upkeep !== null && !game.upkeep.confirmed.includes(faction);
  const rivals = game === null ? [] : game.seats.filter((f) => f !== faction && game.players[f] !== undefined);
  const can = me === null ? NO_CARDS : lightUpkeepCan(me);
  // Raids on the rivals still seated, in seat order.
  const cmd = open ? lightUpkeepCommand({ ...draft, raids: rivals.filter((f) => draft.raids.includes(f)) }, can) : null;
  const preview = usePreview(cmd);
  if (!open || cmd === null) return null;
  return { draft, edit, can, rivals, cmd, preview };
}

/** Confirm (with the preview) in the thumb zone while my light upkeep is open: the full upkeep's bar. */
export function LightUpkeepBar({ form }: { form: LightUpkeepForm }) {
  return <UpkeepBar form={form} />;
}

/** My light upkeep in place of the record grid (`form` from `useLightUpkeepForm`), or who we wait for once confirmed. */
export function LightUpkeepCard({ form }: { form: LightUpkeepForm | null }) {
  const { game, faction, me } = useMe();
  if (game === null || faction === null || me === null || game.upkeep === null) return null;
  if (form === null) return game.upkeep.confirmed.includes(faction) ? <UpkeepWaiting /> : null;
  const { draft, edit, can, rivals } = form;
  const emergency = game.upkeep.emergency;
  const breakthrough = breakthroughNote(game, faction, me);
  const tick = (i: number, on: boolean) => edit((d) => ({ ...d, ticks: on ? [...d.ticks.filter((x) => x !== i), i] : d.ticks.filter((x) => x !== i) }));
  const raid = (f: FactionId) => edit((d) => ({ ...d, raids: d.raids.includes(f) ? d.raids.filter((x) => x !== f) : [...d.raids, f] }));
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
      {emergency && (
        <p className="notice notice-warn">
          <Icon name="warn" size="1.25rem" />
          <span>Emergency upkeep (Verge of Ascendancy): no domination this time.</span>
        </p>
      )}
      <p className="small muted">Everyone does this on the board at the same time. Tick as you go, then confirm.</p>

      <UpkeepStep n={++n} title="On the board">
        <ul className="checklist">
          {BOARD_STEPS.map((text, i) => (
            <li key={text}>
              <CheckRow checked={draft.ticks.includes(i)} onChange={(on) => tick(i, on)}>
                {text}
              </CheckRow>
            </li>
          ))}
        </ul>
        <p className="small faint">Ticks stay on this phone.</p>
      </UpkeepStep>

      <UpkeepStep n={++n} title="Research">
        <div className="step-list">
          <StepRow
            label="Research gained"
            icon={<Icon name="research" size="1.25rem" />}
            value={draft.research}
            max={MAX_GAINED_RESEARCH}
            onChange={(research) => edit((d) => ({ ...d, research }))}
          />
        </div>
        <p className="small muted">Base {BASE_RESEARCH} + 1 per engineering complex you control. You place it on your cards right after confirming.</p>
        {breakthrough !== null && (
          <p className="hint-line">
            <Icon name="info" size="1.1rem" />
            <span>{breakthrough}</span>
          </p>
        )}
        {can.lab && (
          <Toggle
            label="Research Lab: add a development card"
            note="If you control an engineering complex"
            checked={draft.researchLab}
            onChange={(researchLab) => edit((d) => ({ ...d, researchLab }))}
          />
        )}
      </UpkeepStep>

      {rivals.length > 0 && (
        <UpkeepStep n={++n} title="Raids">
          <div className="title-row">
            <p className="small muted">Compare your raiding fleet with their defence at the table. Pick each raid that succeeded: it steals 1 VP.</p>
            <RulesLink section="raids" />
          </div>
          <div className="chip-row" role="group" aria-label="Raids that succeeded">
            {rivals.map((f) => {
              const on = draft.raids.includes(f);
              return (
                <button key={f} type="button" aria-pressed={on} className={on ? 'chip is-selected' : 'chip'} onClick={() => raid(f)}>
                  <FactionBadge faction={f} size="sm" />
                </button>
              );
            })}
          </div>
        </UpkeepStep>
      )}

      {can.supremacy && (
        <UpkeepStep n={++n} title="Fleet Supremacy">
          <Toggle label="I have a large ship on the board" note="+1 VP" checked={draft.largeShip} onChange={(largeShip) => edit((d) => ({ ...d, largeShip }))} />
        </UpkeepStep>
      )}

      <p className="hint-line">
        <Icon name="info" size="1.1rem" />
        <span>
          {emergency
            ? 'When everyone has confirmed: raids steal VP and cards untap.'
            : 'When everyone has confirmed: raids steal VP, cards untap and domination scores from the systems counts.'}
        </span>
      </p>
    </section>
  );
}

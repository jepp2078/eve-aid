/**
 * Build: tabs Ships · Structures · Belt over one draft that becomes a single `build` command. Ships of my faction
 * are listed affordable-first, with hull locks, model limits and the shortfall; each name opens its ship card.
 * Structures take an optional slot discount (BP, ISK, pyrite waived) and, for citadels, a home toggle. A locked
 * home belt can be unlocked by colour. The footer meters build points (`BP 4/6`, 8 with Assembly Line), and a cost
 * breakdown shows how every number is made (Mass Production, Materials Efficiency, slot discounts).
 *
 * `StructurePicker` is shared with `DeployableSheet`, the free structure build that Deployable Infrastructure
 * offers right after a claim (no BP).
 */
import { useState } from 'react';
import { BASE_BP, MASS_PRODUCTION_ISK, MATERIALS_EFFICIENCY_ISK, STRUCTURE_COST, UNLOCK_BELT_COST } from '../../../data/costs';
import { DEV } from '../../../data/developments';
import { MINERALS, type Mineral, type StructureType } from '../../../data/types';
import type { Command, GameState } from '../../../engine/types';
import { Meter } from '../../components/ResourceBar';
import { MineralPicker } from '../../components/MineralPicker';
import { ShipCard } from '../../components/ShipCard';
import { Stepper } from '../../components/Stepper';
import { useMe } from '../../hooks';
import { Icon } from '../../icons';
import { cubeCost, cubeCostLabel } from '../../lib/actions';
import {
  bpUsed,
  buildBudget,
  buildHead,
  buildItems,
  costLines,
  EMPTY_BUILD,
  newStructure,
  sanitizeBuild,
  shipCostText,
  shipOptions,
  structureCost,
  STRUCTURES,
  structuresLeft,
  type BuildDraft,
  type ShipOption,
  type StructureDraft,
} from '../../lib/build';
import { SIZE_LABEL, STRUCTURE_LABEL } from '../../lib/labels';
import { ActionSheet, Segmented, StepRow, Tiles, Toggle, useSheetDraft, type Option } from './ActionSheet';

type BuildTab = 'ships' | 'structures' | 'belt';

/* ------------------------------------------------------------------ structure picker */

export interface StructurePickerProps {
  value: StructureDraft;
  onChange: (s: StructureDraft) => void;
  game: GameState;
  materialsEfficiency: boolean;
  /** Deployable Infrastructure: no build points. */
  ignoreBp?: boolean;
  /** Prefix for accessible names when several pickers are on screen. */
  name?: string;
}

function discountSummary(s: StructureDraft): string {
  const d = s.discount;
  const parts = [d.bp > 0 && `−${d.bp} BP`, d.isk > 0 && `−${d.isk} ISK`, d.pyrite && 'pyrite waived'].filter(Boolean);
  return parts.length === 0 ? 'none' : parts.join(', ');
}

/** Structure type (with models left), citadel home toggle, slot discount and the resulting cost lines. */
export function StructurePicker({ value, onChange, game, materialsEfficiency, ignoreBp = false, name = 'Structure' }: StructurePickerProps) {
  const options: Option<StructureType>[] = STRUCTURES.map((s) => {
    const left = structuresLeft(game, s);
    return { value: s, label: STRUCTURE_LABEL[s], note: `${STRUCTURE_COST[s].isk} ISK · ${left} left`, disabled: left === 0 && value.structure !== s };
  });
  const cost = structureCost(value, { materialsEfficiency, ignoreBp });
  const setDiscount = (d: Partial<StructureDraft['discount']>) => onChange({ ...value, discount: { ...value.discount, ...d } });
  const base = STRUCTURE_COST[value.structure];
  return (
    <div className="structure-picker">
      <Tiles
        label={`${name}: type`}
        options={options}
        value={value.structure}
        onChange={(structure) => onChange({ ...value, structure, home: structure === 'citadel' && !ignoreBp ? value.home : false })}
        columns={2}
      />
      {/* A system just claimed (Deployable Infrastructure) is never a home system. */}
      {value.structure === 'citadel' && !ignoreBp && (
        <Toggle label="In my home system" note="Home citadels defend all your home systems against raids" checked={value.home} onChange={(home) => onChange({ ...value, home })} />
      )}
      <details className="disc">
        <summary className="disc-summary">
          <span>
            Slot discount: <strong>{discountSummary(value)}</strong>
          </span>
          <Icon name="chevronDown" size="1.1rem" className="disc-chevron" />
        </summary>
        <div className="disc-body">
          <p className="muted small">Some structure slots print a discount. Enter what this slot shows.</p>
          <div className="step-list">
            {!ignoreBp && <StepRow label="BP off" value={value.discount.bp} onChange={(bp) => setDiscount({ bp })} max={base.bp} />}
            <StepRow label="ISK off" value={value.discount.isk} onChange={(isk) => setDiscount({ isk })} max={base.isk} />
          </div>
          <Toggle label="Pyrite waived" checked={value.discount.pyrite} onChange={(pyrite) => setDiscount({ pyrite })} />
        </div>
      </details>
      <ul className="cost-lines" aria-label="Cost">
        {cost.lines.map((l, i) => (
          <li key={i} className="num">
            {l}
          </li>
        ))}
        {materialsEfficiency && <li className="faint small">Materials Efficiency: −{MATERIALS_EFFICIENCY_ISK} ISK on every structure</li>}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ ships */

function ShipRow({ o, count, onCount }: { o: ShipOption; count: number; onCount: (n: number) => void }) {
  const [card, setCard] = useState(false);
  const s = o.ship;
  const cardId = `ship-card-${s.id}`;
  return (
    <li className={o.locked !== null ? 'ship-row is-locked' : 'ship-row'}>
      <div className="ship-row-main">
        <div className="ship-row-info">
          <button type="button" className="ship-row-name" aria-expanded={card} aria-controls={cardId} onClick={() => setCard(!card)}>
            <span>{s.name}</span>
            <Icon name={card ? 'chevronUp' : 'chevronDown'} size="1rem" />
          </button>
          <span className="ship-row-meta">
            {SIZE_LABEL[s.size]} · {s.cls}
          </span>
          <span className="ship-row-cost num">{shipCostText(s)}</span>
          <span className="ship-row-badges">
            {o.locked !== null ? (
              <span className="tag">
                <Icon name="lock" size="1em" />
                {o.locked}
              </span>
            ) : (
              <span className="tag num">
                {o.owned} of {s.qty} on board
              </span>
            )}
            {o.locked === null && o.short.length > 0 && (
              <span className="tag tag-warn">
                <Icon name="warn" size="1em" />
                Needs {o.short.join(', ')}
              </span>
            )}
            {o.affordable && (
              <span className="tag tag-ok">
                <Icon name="check" size="1em" />
                Affordable
              </span>
            )}
          </span>
        </div>
        <div className="ship-row-step">
          <Stepper label={`${s.name} to build`} hideLabel value={count} onChange={onCount} max={o.locked !== null ? count : Math.max(count, o.left)} />
        </div>
      </div>
      {card && (
        <div id={cardId} className="ship-row-card">
          <ShipCard ship={s} headingLevel={4} viewCard />
        </div>
      )}
    </li>
  );
}

/* ------------------------------------------------------------------ build sheet */

export function BuildSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { game, me } = useMe();
  const [draft, setDraft, reset] = useSheetDraft<BuildDraft>('build', EMPTY_BUILD, sanitizeBuild);
  const [tab, setTab] = useState<BuildTab>('ships');
  if (game === null || me === null) return null;

  const budget = buildBudget(me);
  const used = bpUsed(draft);
  const items = buildItems(draft);
  const cmd: Command | null = items.length === 0 ? null : { type: 'action', action: 'build', items };
  const ships = shipOptions(me, budget, cubeCost(me.cubesUsed));
  const shipCount = Object.values(draft.ships).reduce((a, b) => a + b, 0);
  const materialsEff = me.completed.includes(DEV.materialsEfficiency);
  const mass = me.completed.includes(DEV.massProduction);
  const lines = costLines(me, draft, me.cubesUsed);
  const tabs: Option<BuildTab>[] = [
    { value: 'ships', label: 'Ships', count: shipCount },
    { value: 'structures', label: 'Structures', count: draft.structures.length },
    { value: 'belt', label: 'Belt', count: draft.belts.length },
  ];

  return (
    <ActionSheet
      open={open}
      onClose={onClose}
      title="Build"
      icon="build"
      cube={cubeCostLabel(me.cubesUsed)}
      section="build"
      size="full"
      command={cmd}
      head={buildHead(draft)}
      hint="Add ships, a structure or a belt unlock"
      onDone={(ok) => {
        if (!ok) return;
        reset();
        onClose();
      }}
      footerTop={
        <div className="bp-meter">
          <span className="bp-label num">
            <Icon name="bp" size="1.1rem" />
            BP {used}/{budget}
          </span>
          <Meter value={used} max={budget} label="Build points" />
        </div>
      }
    >
      <Segmented label="What to build" options={tabs} value={tab} onChange={setTab} />
      {budget > BASE_BP && <p className="small muted">Assembly Line: {budget} build points per Build action.</p>}

      {tab === 'ships' && (
        <section aria-label="Ships">
          {mass && <p className="notice notice-info small">Mass Production: each further ship of the same name in this build costs {MASS_PRODUCTION_ISK} ISK less.</p>}
          <ul className="ship-list">
            {ships.map((o) => (
              <ShipRow
                key={o.ship.id}
                o={o}
                count={draft.ships[o.ship.id] ?? 0}
                onCount={(n) =>
                  setDraft((d) => {
                    const next = { ...d.ships, [o.ship.id]: n };
                    if (n === 0) delete next[o.ship.id];
                    return { ...d, ships: next };
                  })
                }
              />
            ))}
          </ul>
        </section>
      )}

      {tab === 'structures' && (
        <section aria-label="Structures" className="stack-sm">
          {draft.structures.length === 0 && <p className="muted">No structures in this build yet. Each costs 5 BP, 1 pyrite and ISK.</p>}
          {draft.structures.map((s, i) => (
            <fieldset key={i} className="op-row">
              <legend className="op-legend">
                <span>Structure {i + 1}</span>
              </legend>
              <button
                type="button"
                className="icon-btn op-remove"
                aria-label={`Remove structure ${i + 1}`}
                onClick={() => setDraft((d) => ({ ...d, structures: d.structures.filter((_, j) => j !== i) }))}
              >
                <Icon name="close" size="1.25rem" />
              </button>
              <StructurePicker
                value={s}
                name={`Structure ${i + 1}`}
                game={game}
                materialsEfficiency={materialsEff}
                onChange={(next) => setDraft((d) => ({ ...d, structures: d.structures.map((x, j) => (j === i ? next : x)) }))}
              />
            </fieldset>
          ))}
          <button type="button" className="btn btn-secondary btn-block" onClick={() => setDraft((d) => ({ ...d, structures: [...d.structures, newStructure()] }))}>
            <Icon name="plus" />
            Add a structure
          </button>
        </section>
      )}

      {tab === 'belt' && (
        <section aria-label="Home asteroid belts" className="stack-sm">
          <p className="muted small">
            Locked home belts: <span className="num">{me.lockedHomeBelts}</span>. Unlocking one costs {UNLOCK_BELT_COST.bp} BP and {UNLOCK_BELT_COST.isk} ISK; it gives
            minerals in upkeep.
          </p>
          {draft.belts.map((m, i) => (
            <fieldset key={i} className="op-row">
              <legend className="op-legend">
                <span>Belt {i + 1}: which colour is under the token?</span>
              </legend>
              <button type="button" className="icon-btn op-remove" aria-label={`Remove belt ${i + 1}`} onClick={() => setDraft((d) => ({ ...d, belts: d.belts.filter((_, j) => j !== i) }))}>
                <Icon name="close" size="1.25rem" />
              </button>
              <MineralPicker
                label={`Belt ${i + 1} colour`}
                value={m}
                options={MINERALS}
                onChange={(next: Mineral) => setDraft((d) => ({ ...d, belts: d.belts.map((x, j) => (j === i ? next : x)) }))}
              />
            </fieldset>
          ))}
          {me.lockedHomeBelts === 0 ? (
            <p className="notice notice-ok">
              <Icon name="check" size="1.1rem" />
              <span>All your home belts are unlocked.</span>
            </p>
          ) : (
            draft.belts.length < me.lockedHomeBelts && (
              <button type="button" className="btn btn-secondary btn-block" onClick={() => setDraft((d) => ({ ...d, belts: [...d.belts, 'pyrite'] }))}>
                <Icon name="plus" />
                Unlock a home belt
              </button>
            )
          )}
        </section>
      )}

      {lines.length > 0 && (
        <section className="cost-breakdown" aria-labelledby="build-cost">
          <h3 id="build-cost" className="sub-title">
            Cost
          </h3>
          <ul className="cost-lines">
            {lines.map((l, i) => (
              <li key={i} className="num">
                {l}
              </li>
            ))}
          </ul>
          <button type="button" className="btn-link" onClick={reset}>
            Clear this build
          </button>
        </section>
      )}
    </ActionSheet>
  );
}

/* ------------------------------------------------------------------ deployable infrastructure */

const FIRST_DEPLOY = newStructure();
const sanitizeDeploy = (raw: unknown): StructureDraft | null => sanitizeBuild({ structures: [raw] })?.structures[0] ?? null;

/** Deployable Infrastructure: right after a claim, build one structure there, paying its cost but no build points. */
export function DeployableSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { game, me } = useMe();
  const [draft, setDraft, reset] = useSheetDraft<StructureDraft>('deploy', FIRST_DEPLOY, sanitizeDeploy);
  if (game === null || me === null) return null;
  return (
    <ActionSheet
      open={open}
      onClose={onClose}
      title="Deployable Infrastructure"
      icon="build"
      section="build"
      command={{ type: 'deployableInfrastructure', structure: draft.structure, home: false, discount: { ...draft.discount } }}
      head={`Deploy ${STRUCTURE_LABEL[draft.structure]}`}
      onDone={(ok) => {
        if (!ok) return;
        reset();
        onClose();
      }}
    >
      <p>You just claimed a system: build one structure there now. You pay its cost but no build points, and no cube.</p>
      <StructurePicker value={draft} onChange={setDraft} game={game} materialsEfficiency={me.completed.includes(DEV.materialsEfficiency)} ignoreBp />
    </ActionSheet>
  );
}

/** On the Panel while the Deployable Infrastructure offer is open (this turn, after a claim). */
export function DeployableCard({ onOpen }: { onOpen: () => void }) {
  return (
    <section className="card follow" aria-labelledby="deploy-title">
      <h2 id="deploy-title" className="follow-title">
        <Icon name="build" size="1.25rem" />
        Deployable Infrastructure
      </h2>
      <p className="small muted">Build one structure in the system you just claimed, without build points.</p>
      <button type="button" className="btn btn-secondary btn-block" onClick={onOpen}>
        Build a structure there
      </button>
    </section>
  );
}

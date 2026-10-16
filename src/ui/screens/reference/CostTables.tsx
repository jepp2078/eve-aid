/**
 * The cost tables and the dice faces, drawn from the rows `data/reference.ts` builds out of costs.ts and dice.ts
 * (never retyped). Each table fits a 360 px screen: long cells wrap, nothing scrolls sideways.
 */
import { Fragment, useId, type ComponentType } from 'react';
import { BASE_BP, ISK_CAP, MINERAL_CAP } from '../../../data/costs';
import { dev } from '../../../data/developments';
import {
  buildRows,
  COST_TABLES,
  cubeRows,
  diceFaces,
  manufactureRows,
  payParts,
  refSection,
  slotRows,
  tradeRows,
  type BuildRow,
  type CostId,
  type ManufactureRow,
  type RefView,
} from '../../../data/reference';
import type { Resources } from '../../../data/types';
import { useRulesNav } from '../../components/RulesLink';
import { DevName } from '../../components/CardName';
import { DieFace, FACE_LABEL, Icon, ResourceIcon, type IconName } from '../../icons';
import { ACTION_LABEL, RESOURCE_LABEL } from '../../lib/labels';
import { H } from './H';

/** "1 ◆ Pyrite + 4 ⬡ ISK": each part an icon, its amount and its name. */
export function CostList({ pay }: { pay: Partial<Resources> }) {
  const parts = payParts(pay);
  return (
    <span className="cost-list">
      {parts.map((p, i) => (
        <Fragment key={p.key}>
          {i > 0 && <span className="cost-plus">+</span>}
          <span className="cost-item">
            <span className="num">{p.n}</span>
            <ResourceIcon kind={p.key} title={null} size="1.15em" />
            <span>{RESOURCE_LABEL[p.key]}</span>
          </span>
        </Fragment>
      ))}
    </span>
  );
}

export function TradeTable() {
  return (
    <table className="ref-table trade-table">
      <caption className="ref-caption">Up to 3 operations per Trade action. Prices in ISK.</caption>
      <colgroup>
        <col />
        <col className="col-num" />
        <col className="col-num" />
      </colgroup>
      <thead>
        <tr>
          <th scope="col">Goods</th>
          <th scope="col" className="cell-num">
            Sell <span className="th-sub">you get</span>
          </th>
          <th scope="col" className="cell-num">
            Buy <span className="th-sub">you pay</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {tradeRows().map((r) => (
          <tr key={r.id}>
            <th scope="row">
              <span className="goods-icons" aria-hidden="true">
                {r.count === 3 && <span className="num">3×</span>}
                {r.items.map((i) => (
                  <ResourceIcon key={i} kind={i} title={null} size="1.15em" />
                ))}
              </span>
              <span>{r.label}</span>
            </th>
            <td className="cell-num num">{r.sell}</td>
            <td className="cell-num num">{r.buy}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function MakeCell({ row }: { row: ManufactureRow }) {
  const icon =
    row.output === 'research' ? (
      <Icon name="research" size="1.15em" />
    ) : row.output === 'vp' ? (
      <ResourceIcon kind="vp" title={null} size="1.15em" />
    ) : row.output === 'card' ? null : (
      <ResourceIcon kind={row.output} title={null} size="1.15em" />
    );
  return (
    <span className="make-cell">
      <span className="num">{row.gain}</span>
      {icon}
      <span>{row.label}</span>
    </span>
  );
}

export function ManufactureTable() {
  return (
    <table className="ref-table make-table">
      <caption className="ref-caption">Up to 3 operations per Manufacture action.</caption>
      <colgroup>
        <col className="col-make" />
        <col />
      </colgroup>
      <thead>
        <tr>
          <th scope="col">Make</th>
          <th scope="col">Pay</th>
        </tr>
      </thead>
      <tbody>
        {manufactureRows().map((r) => (
          <tr key={r.output}>
            <th scope="row">
              <MakeCell row={r} />
            </th>
            <td>
              {r.options.map((o, i) => (
                <span key={i} className="pay-option">
                  {i > 0 && <span className="pay-or">or</span>}
                  <CostList pay={o} />
                </span>
              ))}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const BUILD_GROUPS: { group: BuildRow['group']; label: string }[] = [
  { group: 'ship', label: 'Ships' },
  { group: 'structure', label: 'Structures' },
  { group: 'belt', label: 'Home asteroid belt' },
];

export function BuildTable() {
  const rows = buildRows();
  return (
    <table className="ref-table build-table">
      <caption className="ref-caption">
        Each Build action gives <span className="num">{BASE_BP}</span> BP; unspent BP are lost.
      </caption>
      <colgroup>
        <col />
        <col className="col-bp" />
      </colgroup>
      <thead>
        <tr>
          <th scope="col">Build</th>
          <th scope="col" className="cell-num">
            BP
          </th>
        </tr>
      </thead>
      {BUILD_GROUPS.map((g) => (
        <tbody key={g.group}>
          <tr className="group-row">
            <th scope="colgroup" colSpan={2}>
              {g.label}
            </th>
          </tr>
          {rows
            .filter((r) => r.group === g.group)
            .map((r) => (
              <tr key={r.id}>
                <th scope="row">
                  <span className="build-name">{r.label}</span>
                  {r.needs !== null && <span className="build-needs">
                      needs <DevName dev={dev(r.needs)} />
                    </span>}
                  <CostList pay={{ ...r.pay, isk: r.isk }} />
                </th>
                <td className="cell-num num">{r.bp}</td>
              </tr>
            ))}
        </tbody>
      ))}
    </table>
  );
}

const ACTION_ICON: Record<string, IconName> = {
  move: 'move',
  claim: 'claim',
  extract: 'extract',
  trade: 'trade',
  manufacture: 'manufacture',
  build: 'build',
  research: 'research',
};

export function CubesTable() {
  return (
    <div className="cubes-view">
      <ol className="cube-track" aria-label="Action cubes per round">
        {cubeRows().map((c) => (
          <li key={c.cube} className={c.isk === 0 ? 'cube-cell' : 'cube-cell is-paid'}>
            <Icon name="cube" size="1.5rem" />
            <span className="cube-n num">Cube {c.cube}</span>
            <span className="cube-cost">{c.isk === 0 ? 'Free' : <span className="num">{c.isk} ISK</span>}</span>
          </li>
        ))}
      </ol>
      <table className="ref-table slot-table">
        <caption className="ref-caption">Each action can be taken this many times per round.</caption>
        <thead>
          <tr>
            <th scope="col">Action</th>
            <th scope="col" className="cell-num">
              Slots
            </th>
          </tr>
        </thead>
        <tbody>
          {slotRows().map((s) => (
            <tr key={s.action}>
              <th scope="row">
                <span className="slot-name">
                  <Icon name={ACTION_ICON[s.action]!} size="1.15em" />
                  {ACTION_LABEL[s.action]}
                </span>
              </th>
              <td className="cell-num num">{s.slots}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="limits">
        <li>
          <ResourceIcon kind="isk" title={null} size="1.25em" />
          <span>
            At most <strong className="num">{ISK_CAP}</strong> ISK; anything above is lost.
          </span>
        </li>
        <li>
          <ResourceIcon kind="morphite" title={null} size="1.25em" />
          <span>
            At most <strong className="num">{MINERAL_CAP}</strong> minerals, morphite included; discard the rest.
          </span>
        </li>
      </ul>
    </div>
  );
}

export function DiceTable() {
  const dice = [
    { die: 'white' as const, label: 'White die', note: 'small orbit', faces: diceFaces('white') },
    { die: 'black' as const, label: 'Black die', note: 'large orbit', faces: diceFaces('black') },
  ];
  return (
    <div className="dice-view">
      {dice.map((d) => (
        <figure key={d.die} className="die-col">
          <figcaption>
            <strong>{d.label}</strong> <span className="muted small">{d.note}</span>
          </figcaption>
          <ul className="die-faces">
            {d.faces.map((f, i) => (
              <li key={i}>
                <DieFace face={f} die={d.die} size={40} title={null} />
                <span>{FACE_LABEL[f]}</span>
              </li>
            ))}
          </ul>
        </figure>
      ))}
      <p className="dice-note small muted">Medium orbit: half white, half black. A crit counts as 1 damage.</p>
    </div>
  );
}

/** The data view a rules section declares. */
export function DataView({ view }: { view: NonNullable<RefView> }) {
  switch (view) {
    case 'trade':
      return <TradeTable />;
    case 'manufacture':
      return <ManufactureTable />;
    case 'build':
      return <BuildTable />;
    case 'cubes':
      return <CubesTable />;
    case 'dice':
      return <DiceTable />;
  }
}

const COST_VIEW: Record<CostId, ComponentType> = {
  trade: TradeTable,
  manufacture: ManufactureTable,
  build: BuildTable,
  cubes: CubesTable,
};

/** The Costs topic: every cost table on one page, each with a link to its rules. */
export function CostsSheet({ level, flash }: { level: number; flash: string | null }) {
  const go = useRulesNav();
  const uid = useId();
  return (
    <div className="costs-sheet">
      {COST_TABLES.map((t) => {
        const Table = COST_VIEW[t.id];
        const anchor = `cost:${t.id}`;
        return (
          <section key={t.id} className={flash === anchor ? 'ref-block is-flash' : 'ref-block'} data-anchor={anchor} aria-labelledby={`${uid}-${t.id}`}>
            <div className="ref-block-head">
              <H level={level} id={`${uid}-${t.id}`} className="ref-block-title">
                {t.title}
              </H>
              {go !== null && (
                <button type="button" className="btn-link" aria-label={`${refSection(t.section).title} rules`} onClick={() => go(t.section)}>
                  Rules
                  <Icon name="chevronRight" size="1.1em" />
                </button>
              )}
            </div>
            <Table />
          </section>
        );
      })}
    </div>
  );
}

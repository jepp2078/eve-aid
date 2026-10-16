/**
 * A player's resources at a glance: ISK (with its /49 cap) and VP, the four minerals with the shared /12 cap, then
 * planetary, moon and component. Numbers are tabular; every cell has an accessible "Pyrite 3" name.
 */
import { ISK_CAP, MINERAL_CAP } from '../../data/costs';
import { MINERALS, type ResourceKey, type Resources } from '../../data/types';
import { Icon, ResourceIcon } from '../icons';
import { RESOURCE_LABEL } from '../lib/labels';

const MATERIALS: ResourceKey[] = ['planetary', 'moon', 'component'];

export interface ResourceBarProps {
  res: Resources;
  /** Shown next to ISK when given. */
  vp?: number;
  /** Show resource names under the counts (default true). */
  labels?: boolean;
  /** Highlight these (e.g. what a setup choice adds). */
  highlight?: ResourceKey[];
}

/** A thin fill bar against a cap; over the cap it turns warn-coloured and says so with an icon and words. */
export function Meter({ value, max, label }: { value: number; max: number; label: string }) {
  const over = value > max;
  return (
    <div className="meter-wrap">
      <div className={over ? 'meter is-over' : 'meter'} role="meter" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-label={label}>
        <div className="meter-fill" style={{ width: `${Math.min(100, (value / max) * 100)}%` }} />
      </div>
      {over && (
        <span className="tag tag-warn meter-flag">
          <Icon name="warn" size="1em" />
          Over {max}
        </span>
      )}
    </div>
  );
}

function Cell({ kind, value, labels, hot }: { kind: ResourceKey; value: number; labels: boolean; hot: boolean }) {
  return (
    <div className={hot ? 'res-cell is-hot' : 'res-cell'} aria-label={`${RESOURCE_LABEL[kind]} ${value}`} role="group">
      <span className="res-value">
        <ResourceIcon kind={kind} title={null} size="1.25em" />
        <span className="num">{value}</span>
      </span>
      {labels && <span className="res-name">{RESOURCE_LABEL[kind]}</span>}
    </div>
  );
}

export function ResourceBar({ res, vp, labels = true, highlight = [] }: ResourceBarProps) {
  const minerals = MINERALS.reduce((n, m) => n + res[m], 0);
  return (
    <div className="resource-bar">
      <div className="res-hero">
        <div className="res-big" role="group" aria-label={`ISK ${res.isk} of ${ISK_CAP}`}>
          <span className="res-big-value">
            <ResourceIcon kind="isk" title={null} size="1em" />
            <span className="num">{res.isk}</span>
            <span className="res-cap num">/{ISK_CAP}</span>
          </span>
          <span className="res-name">ISK</span>
          <Meter value={res.isk} max={ISK_CAP} label="ISK" />
        </div>
        {vp !== undefined && (
          <div className="res-big" role="group" aria-label={`${vp} VP`}>
            <span className="res-big-value">
              <ResourceIcon kind="vp" title={null} size="1em" />
              <span className="num">{vp}</span>
            </span>
            <span className="res-name">VP</span>
          </div>
        )}
      </div>
      <div className="res-row">
        {MINERALS.map((m) => (
          <Cell key={m} kind={m} value={res[m]} labels={labels} hot={highlight.includes(m)} />
        ))}
      </div>
      <div className="res-total">
        <span className="small muted">
          Minerals <span className="num">{minerals}</span>
          <span className="faint num">/{MINERAL_CAP}</span>
        </span>
        <Meter value={minerals} max={MINERAL_CAP} label="Minerals" />
      </div>
      <div className="res-row res-row-3">
        {MATERIALS.map((m) => (
          <Cell key={m} kind={m} value={res[m]} labels={labels} hot={highlight.includes(m)} />
        ))}
      </div>
    </div>
  );
}

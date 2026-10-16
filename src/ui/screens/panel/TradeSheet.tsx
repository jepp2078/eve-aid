/**
 * Trade: up to three buy/sell operations (repeats allowed), each a row with Sell | Buy, the item (single basic
 * mineral, three of one mineral, morphite, materials, component) and its price. The preview names ISK lost to the
 * 49 cap. `TradeOpRow` is reused by the Trade Contracts development (Task 13b).
 */
import { BASIC_MINERALS, type BasicMineral } from '../../../data/types';
import type { TradeItem, TradeOp } from '../../../engine/types';
import { useMe } from '../../hooks';
import { Icon, ResourceIcon } from '../../icons';
import { cubeCost, cubeCostLabel } from '../../lib/actions';
import { RESOURCE_LABEL } from '../../lib/labels';
import { MAX_OPS, newTradeOp, sanitizeTradeOps, setTradeItem, TRADE_ITEM_LABEL, TRADE_ITEMS, tradeIskNet, tradeOpText } from '../../lib/ops';
import { TRADE } from '../../../data/costs';
import { ActionSheet, Segmented, Tiles, useSheetDraft, type Option } from './ActionSheet';

const FIRST: TradeOp[] = [newTradeOp()];

function itemOptions(dir: TradeOp['dir']): Option<TradeItem>[] {
  return TRADE_ITEMS.map((item) => {
    const price = dir === 'sell' ? TRADE[item].sell : TRADE[item].buy;
    return {
      value: item,
      label: TRADE_ITEM_LABEL[item],
      icon:
        item === 'triple' ? (
          <span className="tile-icon-3" aria-hidden="true">
            3×
          </span>
        ) : (
          <ResourceIcon kind={item} title={null} size="1.5rem" />
        ),
      note: `${dir === 'sell' ? '+' : '−'}${price} ISK`,
    };
  });
}

const MINERAL_OPTIONS: Option<BasicMineral>[] = BASIC_MINERALS.map((m) => ({
  value: m,
  label: RESOURCE_LABEL[m],
  icon: <ResourceIcon kind={m} title={null} size="1.25rem" />,
}));

export interface OpRowProps<T> {
  op: T;
  /** 0-based; shown as "Operation 1". */
  index: number;
  onChange: (op: T) => void;
  /** Omit when the row can't be removed (a single-operation use). */
  onRemove?: () => void;
}

/** One trade operation: Sell | Buy, the item, the mineral for a triple trade, and the price line. */
export function TradeOpRow({ op, index, onChange, onRemove }: OpRowProps<TradeOp>) {
  return (
    <fieldset className="op-row">
      <legend className="op-legend">
        <span>Operation {index + 1}</span>
      </legend>
      {onRemove !== undefined && (
        <button type="button" className="icon-btn op-remove" onClick={onRemove} aria-label={`Remove operation ${index + 1}`}>
          <Icon name="close" size="1.25rem" />
        </button>
      )}
      <Segmented
        label={`Operation ${index + 1}: sell or buy`}
        options={[
          { value: 'sell', label: 'Sell' },
          { value: 'buy', label: 'Buy' },
        ]}
        value={op.dir}
        onChange={(dir) => onChange({ ...op, dir })}
      />
      <Tiles
        label={`Operation ${index + 1}: item`}
        options={itemOptions(op.dir)}
        value={op.item}
        onChange={(item) => onChange(setTradeItem(op, item))}
        columns={2}
        layout="row"
      />
      {op.item === 'triple' && (
        <Segmented label={`Operation ${index + 1}: which mineral`} options={MINERAL_OPTIONS} value={op.mineral ?? 'pyrite'} onChange={(mineral) => onChange({ ...op, mineral })} />
      )}
      <p className="op-line num">{tradeOpText(op)}</p>
    </fieldset>
  );
}

export function TradeSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { me } = useMe();
  const [ops, setOps, reset] = useSheetDraft<TradeOp[]>('trade', FIRST, sanitizeTradeOps);
  const cubes = me?.cubesUsed ?? 0;
  const head = ops.length === 1 ? tradeOpText(ops[0]!).split(' · ')[0]! : `Trade ${ops.length} operations`;

  return (
    <ActionSheet
      open={open}
      onClose={onClose}
      title="Trade"
      icon="trade"
      cube={me === null ? null : cubeCostLabel(cubes)}
      section="trade"
      size="full"
      command={{ type: 'action', action: 'trade', ops }}
      iskNet={tradeIskNet(ops, cubeCost(cubes))}
      head={head}
      onDone={(ok) => {
        if (!ok) return;
        reset();
        onClose();
      }}
    >
      <p className="muted small">Up to {MAX_OPS} operations, in order; the same one may repeat. Past 12 minerals you choose what to discard right after.</p>
      {ops.map((op, i) => (
        <TradeOpRow
          key={i}
          op={op}
          index={i}
          onChange={(next) => setOps((all) => all.map((o, j) => (j === i ? next : o)))}
          onRemove={ops.length > 1 ? () => setOps((all) => all.filter((_, j) => j !== i)) : undefined}
        />
      ))}
      {ops.length < MAX_OPS && (
        <button type="button" className="btn btn-secondary btn-block" onClick={() => setOps((all) => [...all, newTradeOp()])}>
          <Icon name="plus" />
          Add operation ({ops.length + 1} of {MAX_OPS})
        </button>
      )}
    </ActionSheet>
  );
}

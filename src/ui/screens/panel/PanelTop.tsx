/**
 * The Panel's top block: ISK as the hero number with its /49 meter, VP beside it, the cube track (used filled, free
 * hollow, paid cubes marked 5 and 10), the four minerals (distinct crystals) with one n/12 meter, then planetary,
 * moon and component. Any change, from this phone or another, shows a +4 / −5 chip next to the value for 1.5 s
 * (no animation under reduced motion). When the block scrolls away, a slim copy stays pinned under the turn strip,
 * so the numbers are always visible. A light game's block (`LightTop`) shows VP and systems the same way, with the
 * central system as a tag.
 */
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { ISK_CAP, MAX_CUBES, MINERAL_CAP } from '../../../data/costs';
import { MINERALS, type ResourceKey } from '../../../data/types';
import type { PlayerPublic } from '../../../engine/types';
import { Meter } from '../../components/ResourceBar';
import { Icon, ResourceIcon } from '../../icons';
import { cubeCostLabel, cubeTrack } from '../../lib/actions';
import { valueDeltas } from '../../lib/deltas';
import { centralWords, RESOURCE_LABEL, signed } from '../../lib/labels';
import { mineralSum } from '../../lib/preview';

const CHIP_MS = 1500;
const MATERIALS: ResourceKey[] = ['planetary', 'moon', 'component'];
type Key = ResourceKey | 'vp';
type Chip = { d: number; id: number };
type Chips<K extends string> = Partial<Record<K, Chip>>;

/** +n / −n chips for values that changed since the last render, each shown for 1.5 s. */
function useDeltaChips<K extends string>(values: Record<K, number>): Chips<K> {
  const prev = useRef(values);
  const [chips, setChips] = useState<Chips<K>>({});
  const nextId = useRef(0);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const sig = JSON.stringify(values);

  useEffect(() => {
    const d = valueDeltas(prev.current, values);
    prev.current = values;
    const keys = Object.keys(d) as K[];
    if (keys.length === 0) return;
    const added: Chips<K> = {};
    for (const k of keys) added[k] = { d: d[k]!, id: ++nextId.current };
    setChips((c) => ({ ...c, ...added }));
    const t = setTimeout(() => {
      timers.current.delete(t);
      setChips((c) => {
        const next = { ...c };
        for (const k of keys) if (next[k]?.id === added[k]!.id) delete next[k];
        return next;
      });
    }, CHIP_MS);
    timers.current.add(t);
    // values is represented by sig
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  useEffect(() => {
    const all = timers.current;
    return () => {
      for (const t of all) clearTimeout(t);
    };
  }, []);
  return chips;
}

/** Pins the slim copy once the block has scrolled up under the sticky header. */
function usePinned(blockRef: RefObject<HTMLElement | null>): boolean {
  const [pinned, setPinned] = useState(false);
  useLayoutEffect(() => {
    const el = blockRef.current;
    if (el === null || typeof IntersectionObserver === 'undefined') return;
    const top = document.querySelector<HTMLElement>('.app-top')?.offsetHeight ?? 0;
    const io = new IntersectionObserver(([e]) => setPinned(e !== undefined && !e.isIntersecting && e.boundingClientRect.top < top), {
      rootMargin: `-${top}px 0px 0px 0px`,
    });
    io.observe(el);
    return () => io.disconnect();
  }, [blockRef]);
  return pinned;
}

function Delta({ chip }: { chip: Chip | undefined }) {
  if (chip === undefined) return null;
  return (
    <span key={chip.id} className={chip.d > 0 ? 'delta is-up' : 'delta is-down'} aria-hidden="true">
      {signed(chip.d)}
    </span>
  );
}

/**
 * The five action cubes: used filled, free hollow, the next one outlined, paid ones carry their price. Only spans
 * inside, so it can sit in a button (the Table's seat rows).
 */
export function CubeTrack({ used, compact = false }: { used: number; compact?: boolean }) {
  return (
    <span className={compact ? 'cube-track is-compact' : 'cube-track'} role="img" aria-label={`Action cubes: ${used} of ${MAX_CUBES} used. Next: ${cubeCostLabel(used)}`}>
      {!compact && <span className="ct-label">Cubes</span>}
      <span className="ct-cubes" aria-hidden="true">
        {cubeTrack(used).map((c) => (
          <span key={c.n} className={['ct-cube', c.used && 'is-used', c.next && 'is-next', c.cost > 0 && 'is-paid'].filter(Boolean).join(' ')}>
            {c.cost > 0 && !compact ? c.cost : null}
          </span>
        ))}
      </span>
      {!compact && (
        <span className="ct-next num" aria-hidden="true">
          {cubeCostLabel(used)}
        </span>
      )}
    </span>
  );
}

function Cell({ kind, value, chip }: { kind: ResourceKey; value: number; chip: Chip | undefined }) {
  return (
    <div className="pt-cell" role="group" aria-label={`${RESOURCE_LABEL[kind]} ${value}`} title={RESOURCE_LABEL[kind]}>
      <ResourceIcon kind={kind} title={null} size="1.25rem" />
      <span className="pt-cell-num num">{value}</span>
      <Delta chip={chip} />
    </div>
  );
}

export function PanelTop({ me }: { me: PlayerPublic }) {
  const values = { ...me.res, vp: me.vp } as Record<Key, number>;
  const chips = useDeltaChips(values);
  const minerals = mineralSum(me);
  const blockRef = useRef<HTMLElement>(null);
  const pinned = usePinned(blockRef);

  return (
    <>
      <section className="pt" aria-label="Your resources" ref={blockRef}>
        <div className="pt-hero">
          <div className="pt-isk" role="group" aria-label={`ISK ${me.res.isk} of ${ISK_CAP}`}>
            <span className="pt-big">
              <ResourceIcon kind="isk" title={null} size="1.75rem" />
              <span className="pt-big-num num">{me.res.isk}</span>
              <span className="pt-unit">
                <span className="num">/{ISK_CAP}</span> ISK
              </span>
              <Delta chip={chips.isk} />
            </span>
            <Meter value={me.res.isk} max={ISK_CAP} label="ISK" />
          </div>
          <div className="pt-vp" role="group" aria-label={`${me.vp} VP`}>
            <span className="pt-big">
              <ResourceIcon kind="vp" title={null} size="1.75rem" />
              <span className="pt-big-num num">{me.vp}</span>
              <span className="pt-unit">VP</span>
              <Delta chip={chips.vp} />
            </span>
          </div>
        </div>
        <CubeTrack used={me.cubesUsed} />
        <div className="pt-res">
          <div className="pt-minerals">
            <div className="pt-cells">
              {MINERALS.map((m) => (
                <Cell key={m} kind={m} value={me.res[m]} chip={chips[m]} />
              ))}
            </div>
            <div className="pt-total">
              <span className="small">
                Minerals <span className="num">{minerals}</span>
                <span className="faint num">/{MINERAL_CAP}</span>
              </span>
              <Meter value={minerals} max={MINERAL_CAP} label="Minerals" />
            </div>
          </div>
          <div className="pt-cells pt-materials">
            {MATERIALS.map((m) => (
              <Cell key={m} kind={m} value={me.res[m]} chip={chips[m]} />
            ))}
          </div>
        </div>
      </section>
      {pinned && (
        <div className="pt-mini" aria-hidden="true">
          <div className="pt-mini-inner">
            <span className="pt-mini-item">
              <ResourceIcon kind="isk" title={null} size="1.1rem" />
              <span className="num">
                {me.res.isk}
                <span className="faint">/{ISK_CAP}</span>
              </span>
              <Delta chip={chips.isk} />
            </span>
            <span className="pt-mini-item">
              <ResourceIcon kind="vp" title={null} size="1.1rem" />
              <span className="num">{me.vp} VP</span>
              <Delta chip={chips.vp} />
            </span>
            <CubeTrack used={me.cubesUsed} compact />
            <span className="pt-mini-item">
              <span className="num">
                Minerals {minerals}
                <span className="faint">/{MINERAL_CAP}</span>
              </span>
            </span>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * A light game's top block: VP and systems as the two hero numbers with their delta chips, the central system as a tag
 * while I hold it, and the slim pinned copy with VP and systems.
 */
export function LightTop({ me, seats }: { me: PlayerPublic; seats: number }) {
  const chips = useDeltaChips({ vp: me.vp, systems: me.systems });
  const blockRef = useRef<HTMLElement>(null);
  const pinned = usePinned(blockRef);
  const systems = me.systems === 1 ? 'system' : 'systems';

  return (
    <>
      <section className="pt" aria-label="Your score" ref={blockRef}>
        <div className="pt-hero is-light">
          <div className="pt-vp" role="group" aria-label={`${me.vp} VP`}>
            <span className="pt-big">
              <ResourceIcon kind="vp" title={null} size="1.75rem" />
              <span className="pt-big-num num">{me.vp}</span>
              <span className="pt-unit">VP</span>
              <Delta chip={chips.vp} />
            </span>
          </div>
          <div className="pt-vp" role="group" aria-label={`${me.systems} ${systems}`}>
            <span className="pt-big">
              <Icon name="claim" size="1.75rem" />
              <span className="pt-big-num num">{me.systems}</span>
              <span className="pt-unit">{systems}</span>
              <Delta chip={chips.systems} />
            </span>
          </div>
        </div>
        {me.central && (
          <p className="row small">
            <span className="tag">
              <Icon name="central" size="1em" />
              {centralWords(seats).name}
            </span>
          </p>
        )}
      </section>
      {pinned && (
        <div className="pt-mini" aria-hidden="true">
          <div className="pt-mini-inner">
            <span className="pt-mini-item">
              <ResourceIcon kind="vp" title={null} size="1.1rem" />
              <span className="num">{me.vp} VP</span>
              <Delta chip={chips.vp} />
            </span>
            <span className="pt-mini-item">
              <Icon name="claim" size="1.1rem" />
              <span className="num">
                {me.systems} {systems}
              </span>
              <Delta chip={chips.systems} />
            </span>
          </div>
        </div>
      )}
    </>
  );
}

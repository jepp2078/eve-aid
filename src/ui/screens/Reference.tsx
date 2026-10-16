/**
 * The rules reference. A pinned search (rules, costs, ships, developments: results grouped by type, the match
 * highlighted, Enter opens the first); recent searches and entries when the search is empty (kept per device); topic
 * chips; and the topic's content: rules sections with their data tables, the costs cheat sheet, the ships browser or
 * the developments browser. A−/A+ scales the text, remembered per device.
 *
 * `ReferenceScreen` is the Reference tab; `RulesScreen` the same at #/rules, outside any game (linked from Home). The rules drawer runs the same `ReferenceView` with `mode="drawer"` and a
 * target section it opens at. Links inside the view (term popovers, "rules" links) navigate in place.
 */
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { DEVELOPMENTS } from '../../data/developments';
import { MIN_QUERY, refSection, searchReference, type RefId, type SearchKind, type SearchResult, type TextRange } from '../../data/reference';
import { SHIPS } from '../../data/ships';
import { FACTIONS, type FactionId } from '../../data/types';
import { radioKeys, tabStop } from '../components/radio';
import { RulesNavContext, type RulesNav } from '../components/RulesLink';
import { navigate, prefersReducedMotion, useOpenGame, usePref } from '../hooks';
import { FactionGlyph, Icon } from '../icons';
import { factionName } from '../lib/labels';
import {
  addSearch,
  addViewed,
  anchorOf,
  entryTitle,
  isTopic,
  navFor,
  parseRecents,
  parseScale,
  stepScale,
  TEXT_SCALES,
  topicInfo,
  topicOf,
  TOPICS,
  type CategoryFilter,
  type NavState,
  type RefEntry,
  type Recents,
  type Topic,
} from '../lib/refNav';
import { DevsBrowser, ShipsBrowser } from './reference/Browsers';
import { CostsSheet } from './reference/CostTables';
import { FlowHeader } from './Lobby';
import { H } from './reference/H';
import { RuleSection } from './reference/RuleSection';

/** Where the drawer should open; `n` changes on every open so the same section can be re-targeted. */
export interface RefTarget {
  section: RefId;
  anchor?: string;
  n: number;
}

const NAV_KEY = 'eve:ref';
const SCALE_PREF = 'refTextScale';
const RECENTS_PREF = 'refRecents';
const TOPIC_IDS = TOPICS.map((t) => t.id);

const KIND_CHIP: Record<SearchKind, string> = { rule: 'Rule', cost: 'Cost', ship: 'Ship', dev: 'Dev' };
const KIND_GROUP: Record<SearchKind, string> = { rule: 'Rules', cost: 'Costs', ship: 'Ships', dev: 'Developments' };
const GROUP_LIMIT = 6;

function defaultNav(faction: FactionId | null): NavState {
  return { topic: 'actions', faction: faction ?? 'amarr', size: 'all', sort: 'size', cat: 'all' };
}

/** The tab remembers its topic and filters for this page view. */
function loadNav(faction: FactionId | null): NavState {
  const base = defaultNav(faction);
  try {
    const raw = JSON.parse(sessionStorage.getItem(NAV_KEY) ?? 'null') as Partial<NavState> | null;
    if (raw === null || typeof raw !== 'object') return base;
    return {
      topic: isTopic(raw.topic) ? raw.topic : base.topic,
      faction: FACTIONS.includes(raw.faction as FactionId) ? (raw.faction as FactionId) : base.faction,
      size: raw.size === 'small' || raw.size === 'medium' || raw.size === 'large' ? raw.size : 'all',
      sort: raw.sort === 'name' ? 'name' : 'size',
      cat: typeof raw.cat === 'string' && (raw.cat === 'all' || DEVELOPMENTS.some((d) => d.category === raw.cat)) ? (raw.cat as CategoryFilter) : 'all',
    };
  } catch {
    return base;
  }
}

function saveNav(nav: NavState): void {
  try {
    sessionStorage.setItem(NAV_KEY, JSON.stringify(nav));
  } catch {
    // remembered only while mounted
  }
}

/** Scrolls `el` to just under the pinned search bar, in the drawer's scroller or the page. */
function scrollToAnchor(el: HTMLElement, smooth: boolean, bar: HTMLElement | null): void {
  const behavior: ScrollBehavior = smooth && !prefersReducedMotion() ? 'smooth' : 'instant';
  const barH = bar?.offsetHeight ?? 0;
  const scroller = el.closest<HTMLElement>('.sheet-body');
  if (scroller !== null) {
    const top = scroller.scrollTop + el.getBoundingClientRect().top - scroller.getBoundingClientRect().top - barH - 8;
    scroller.scrollTo({ top: Math.max(0, top), behavior });
    return;
  }
  const appTop = document.querySelector('.app-top')?.getBoundingClientRect().height ?? 0;
  const top = window.scrollY + el.getBoundingClientRect().top - appTop - barH - 8;
  window.scrollTo({ top: Math.max(0, top), behavior });
}

interface GoOptions {
  anchor?: string;
  mark?: string | null;
  smooth?: boolean;
}

export interface ReferenceViewProps {
  mode: 'tab' | 'drawer';
  /** Drawer: the section to open at (changing `n` jumps again). */
  target?: RefTarget | null;
}

export function ReferenceView({ mode, target = null }: ReferenceViewProps) {
  const open = useOpenGame();
  const game = open?.game ?? null;
  const [nav, setNav] = useState<NavState>(() => {
    const base = mode === 'tab' ? loadNav(open?.faction ?? null) : defaultNav(open?.faction ?? null);
    return target === null ? base : { ...base, topic: topicOf(target.section) };
  });
  const [query, setQuery] = useState('');
  const [mark, setMark] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [pending, setPending] = useState<{ anchor: string; smooth: boolean } | null>(() =>
    target === null ? null : { anchor: target.anchor ?? anchorOf({ kind: 'rule', id: target.section }), smooth: false },
  );
  const [scaleRaw, setScaleRaw] = usePref(SCALE_PREF, '1');
  const scale = parseScale(scaleRaw);
  const [recentsRaw, setRecentsRaw] = usePref(RECENTS_PREF, '');
  const recents = useMemo(() => parseRecents(recentsRaw === '' ? null : recentsRaw), [recentsRaw]);
  const rootRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const topicsRef = useRef<HTMLDivElement>(null);
  /** Heading level of the topic; sections and blocks sit one below. */
  const level = mode === 'tab' ? 2 : 3;

  const go = (entry: RefEntry, opts: GoOptions = {}) => {
    setNav((n) => navFor(n, entry));
    setQuery('');
    setMark(opts.mark ?? null);
    setPending({ anchor: opts.anchor ?? anchorOf(entry), smooth: opts.smooth ?? true });
  };
  const goRef = useRef(go);
  useLayoutEffect(() => {
    goRef.current = go;
  });
  const navTo = useMemo<RulesNav>(() => (section, anchor) => goRef.current({ kind: 'rule', id: section }, { anchor }), []);

  useEffect(() => {
    if (mode === 'tab') saveNav(nav);
  }, [mode, nav]);

  // The drawer was pointed at another section while open.
  const lastTarget = useRef(target?.n ?? null);
  useEffect(() => {
    if (target === null || target.n === lastTarget.current) return;
    lastTarget.current = target.n;
    goRef.current({ kind: 'rule', id: target.section }, { anchor: target.anchor, smooth: false });
  }, [target]);

  // After the content for a jump has rendered: scroll to it and flash it.
  useEffect(() => {
    if (pending === null) return;
    const el = rootRef.current?.querySelector<HTMLElement>(`[data-anchor="${CSS.escape(pending.anchor)}"]`);
    if (el) scrollToAnchor(el, pending.smooth, barRef.current);
    setFlash(pending.anchor);
    setPending(null);
  }, [pending]);

  useEffect(() => {
    if (flash === null) return;
    const t = setTimeout(() => setFlash(null), 1600);
    return () => clearTimeout(t);
  }, [flash]);

  // Keep the selected topic chip visible in its scrolling row (horizontally only).
  useEffect(() => {
    const row = topicsRef.current;
    const chip = row?.querySelector<HTMLElement>('[aria-checked="true"]');
    if (!row || !chip || row.scrollWidth <= row.clientWidth) return;
    const r = row.getBoundingClientRect();
    const c = chip.getBoundingClientRect();
    row.scrollLeft += c.left - r.left - (r.width - c.width) / 2;
  }, [nav.topic]);

  const saveRecents = (r: Recents) => setRecentsRaw(JSON.stringify(r));
  const searching = query.trim() !== '';

  const pick = (r: SearchResult) => {
    const entry = { kind: r.kind, id: r.id };
    saveRecents(addViewed(addSearch(recents, query), entry));
    inputRef.current?.blur();
    go(entry, { mark: query.trim(), smooth: false });
  };

  const setTopic = (topic: Topic) => {
    setNav((n) => ({ ...n, topic }));
    setMark(null);
  };

  return (
    <RulesNavContext.Provider value={navTo}>
      <div ref={rootRef} className={`ref ref-${mode}`}>
        <div ref={barRef} className="ref-bar">
          <div className="ref-search">
            <Icon name="search" size="1.25rem" className="ref-search-icon" />
            <input
              ref={inputRef}
              type="search"
              className="ref-search-input"
              aria-label="Search rules, costs, ships and developments"
              placeholder="Search rules &amp; cards"
              value={query}
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="search"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape' && query !== '') {
                  e.preventDefault();
                  e.stopPropagation(); // clear first; a second Escape closes the drawer
                  setQuery('');
                } else if (e.key === 'Enter') {
                  const first = searchReference(query)[0];
                  if (first !== undefined) pick(first);
                }
              }}
            />
            {query !== '' && (
              <button
                type="button"
                className="ref-clear"
                aria-label="Clear search"
                onClick={() => {
                  setQuery('');
                  inputRef.current?.focus();
                }}
              >
                <Icon name="close" size="1.25rem" />
              </button>
            )}
          </div>
          <div className="ref-size" role="group" aria-label="Text size">
            <button type="button" className="ref-size-btn" aria-label="Smaller text" disabled={scale <= TEXT_SCALES[0]} onClick={() => setScaleRaw(String(stepScale(scale, -1)))}>
              <span className="ref-size-a small-a" aria-hidden="true">
                A−
              </span>
            </button>
            <button
              type="button"
              className="ref-size-btn"
              aria-label="Larger text"
              disabled={scale >= TEXT_SCALES[TEXT_SCALES.length - 1]!}
              onClick={() => setScaleRaw(String(stepScale(scale, 1)))}
            >
              <span className="ref-size-a big-a" aria-hidden="true">
                A+
              </span>
            </button>
          </div>
        </div>

        <div className="ref-scaled" style={{ '--ref-scale': scale } as CSSProperties}>
          {searching ? (
            <SearchResults query={query} level={level} onPick={pick} />
          ) : (
            <>
              <RecentRow
                recents={recents}
                onSearch={(q) => setQuery(q)}
                onEntry={(e) => {
                  saveRecents(addViewed(recents, e));
                  go(e, { smooth: false });
                }}
                onClear={() => setRecentsRaw('')}
              />
              <div
                ref={topicsRef}
                className="chip-row chip-scroll ref-topics"
                role="radiogroup"
                aria-label="Topic"
                onKeyDown={radioKeys(TOPIC_IDS, nav.topic, setTopic)}
              >
                {TOPICS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    role="radio"
                    aria-checked={nav.topic === t.id}
                    tabIndex={tabStop(TOPIC_IDS, nav.topic, t.id)}
                    data-value={t.id}
                    className={nav.topic === t.id ? 'chip is-selected' : 'chip'}
                    onClick={() => setTopic(t.id)}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <div className="ref-content">
                <H level={level} className="sr-only">
                  {topicInfo(nav.topic).label}
                </H>
                {nav.topic === 'costs' ? (
                  <CostsSheet level={level + 1} flash={flash} />
                ) : nav.topic === 'ships' ? (
                  <ShipsBrowser
                    faction={nav.faction}
                    size={nav.size}
                    sort={nav.sort}
                    onChange={(p) => setNav((n) => ({ ...n, ...p }))}
                    level={level + 1}
                    mark={mark}
                    flash={flash}
                  />
                ) : nav.topic === 'devs' ? (
                  <DevsBrowser
                    category={nav.cat}
                    onCategory={(cat) => setNav((n) => ({ ...n, cat }))}
                    onDev={(id) => go({ kind: 'dev', id })}
                    game={game}
                    level={level + 1}
                    mark={mark}
                    flash={flash}
                  />
                ) : (
                  topicInfo(nav.topic).sections.map((id) => <RuleSection key={id} section={refSection(id)} level={level + 1} mark={mark} flash={flash} />)
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </RulesNavContext.Provider>
  );
}

/** The Reference tab. */
export function ReferenceScreen() {
  return (
    <div className="screen-body ref-screen">
      <h1 className="sr-only">Reference</h1>
      <ReferenceView mode="tab" />
    </div>
  );
}

/** The rules reference on its own page, for reading before or between games. */
export function RulesScreen() {
  return (
    <div className="screen">
      <FlowHeader title="Rules reference" onBack={() => navigate({ name: 'home' })} />
      <main className="screen-body ref-screen">
        <ReferenceView mode="tab" />
      </main>
    </div>
  );
}

function RecentRow({ recents, onSearch, onEntry, onClear }: { recents: Recents; onSearch: (q: string) => void; onEntry: (e: RefEntry) => void; onClear: () => void }) {
  const labelId = useId();
  if (recents.searches.length === 0 && recents.viewed.length === 0) return null;
  return (
    <div className="ref-recents">
      <span className="ref-recents-label caps faint" id={labelId}>
        Recent
      </span>
      <ul className="chip-row chip-scroll" aria-labelledby={labelId}>
        {recents.viewed.map((e) => (
          <li key={`${e.kind}:${e.id}`}>
            <button type="button" className="chip recent-chip" onClick={() => onEntry(e)}>
              <span className={`kind-chip kind-${e.kind}`}>{KIND_CHIP[e.kind]}</span>
              {entryTitle(e)}
            </button>
          </li>
        ))}
        {recents.searches.map((q) => (
          <li key={`q:${q}`}>
            <button type="button" className="chip recent-chip" onClick={() => onSearch(q)} aria-label={`Search again for ${q}`}>
              <Icon name="search" size="1.1em" />
              {q}
            </button>
          </li>
        ))}
        <li>
          <button type="button" className="chip chip-quiet" onClick={onClear}>
            Clear
          </button>
        </li>
      </ul>
    </div>
  );
}

/** Text with one range highlighted (the match the search reported). */
function Ranged({ text, range }: { text: string; range: TextRange | null }) {
  if (range === null) return <>{text}</>;
  return (
    <>
      {text.slice(0, range.start)}
      <mark className="hit">{text.slice(range.start, range.end)}</mark>
      {text.slice(range.end)}
    </>
  );
}

/** Mounted while the query is non-empty, so an opened "Show all" stays open as you type and resets on clear. */
function SearchResults({ query, level, onPick }: { query: string; level: number; onPick: (r: SearchResult) => void }) {
  const results = useMemo(() => searchReference(query), [query]);
  const [expanded, setExpanded] = useState<SearchKind[]>([]);
  const trimmed = query.trim();

  if (trimmed.length < MIN_QUERY) {
    return <p className="ref-hint muted">Type at least {MIN_QUERY} letters.</p>;
  }
  if (results.length === 0) {
    return (
      <div className="ref-hint" role="status">
        <p>No matches for “{trimmed}”.</p>
        <p className="muted small">Try one word, such as raid, citadel, morphite or a ship's name.</p>
      </div>
    );
  }

  // Groups in the order of their best result; each keeps the ranking.
  const groups: { kind: SearchKind; items: SearchResult[] }[] = [];
  for (const r of results) {
    const g = groups.find((x) => x.kind === r.kind);
    if (g) g.items.push(r);
    else groups.push({ kind: r.kind, items: [r] });
  }

  return (
    <div className="ref-results">
      <p className="ref-count small muted" role="status">
        {results.length} {results.length === 1 ? 'match' : 'matches'}
      </p>
      {groups.map((g) => {
        const all = expanded.includes(g.kind) || g.items.length <= GROUP_LIMIT;
        const shown = all ? g.items : g.items.slice(0, GROUP_LIMIT);
        return (
          <section key={g.kind} className="ref-result-group">
            <H level={level} className="caps faint">
              {KIND_GROUP[g.kind]} <span className="num">{g.items.length}</span>
            </H>
            <ul className="ref-result-list">
              {shown.map((r) => (
                <li key={`${r.kind}:${r.id}`}>
                  <button type="button" className="ref-result" onClick={() => onPick(r)}>
                    <span className={`kind-chip kind-${r.kind}`}>{KIND_CHIP[r.kind]}</span>
                    <span className="ref-result-text">
                      <span className="ref-result-title">
                        {r.kind === 'ship' && <ShipGlyph id={r.id} />}
                        <span>
                          <Ranged text={r.title} range={r.titleMatch} />
                        </span>
                      </span>
                      <span className="ref-result-snippet">
                        <Ranged text={r.snippet} range={r.snippetMatch} />
                      </span>
                    </span>
                    <Icon name="chevronRight" size="1.25rem" className="ref-result-go" />
                  </button>
                </li>
              ))}
            </ul>
            {!all && (
              <button type="button" className="btn-link" onClick={() => setExpanded((x) => [...x, g.kind])}>
                Show all {g.items.length} {KIND_GROUP[g.kind].toLowerCase()}
              </button>
            )}
          </section>
        );
      })}
    </div>
  );
}

function ShipGlyph({ id }: { id: string }) {
  const s = SHIPS.find((x) => x.id === id);
  return s === undefined ? null : <FactionGlyph faction={s.faction} size="0.9em" title={factionName(s.faction)} />;
}

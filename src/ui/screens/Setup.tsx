/**
 * Faction setup in three steps: 1 Home belt (which home asteroid belt was left uncovered: +1 of that mineral) ·
 * 2 Developments (pick 4, private) · 3 Confirm (summary + the physical-world checklist). A light game tracks no belts:
 * it skips step 1, sends no belt and lists the belt as a step at the table instead. Others' progress shows only the
 * public "ready / choosing". The draft survives reloads (sessionStorage) and live updates.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { FACTION_INFO } from '../../data/factions';
import { DEVELOPMENTS, dev as devById, type DevCategory, type Development } from '../../data/developments';
import { ship } from '../../data/ships';
import { MINERALS, type DevId, type FactionId, type Mineral, type Resources } from '../../data/types';
import { SETUP_NOTICE } from '../../engine/lobby';
import type { GameMode } from '../../engine/types';
import { DevCard, DevCost } from '../components/DevCard';
import { DevName, ShipName } from '../components/CardName';
import { MineralPicker } from '../components/MineralPicker';
import { RulesLink } from '../components/RulesLink';
import { useFeedback } from '../components/Toast';
import { ResourceBar } from '../components/ResourceBar';
import { FOOTER_INSET, NO_INSET, prefersReducedMotion, useBottomInset, useCommand, useMe } from '../hooks';
import { FactionGlyph, Icon, ResourceIcon } from '../icons';
import { formatCode } from '../lib/code';
import { CATEGORY_LABEL, factionName, RESOURCE_LABEL } from '../lib/labels';
import { SETUP_NOTICE_ID } from '../lib/notices';
import { CATEGORY_ORDER, devsByCategory, RECOMMENDED_DEVS, setupStep, setupSteps, STARTING_DEVS, tableSteps, toggleDev, type Step } from '../lib/setup';
import { GameHeader } from './GameHeader';
import { useNoticeTicks } from './panel/NoticesStack';

interface Draft {
  step: Step;
  belt: Mineral | null;
  devs: readonly DevId[];
}

function draftKey(code: string, f: FactionId): string {
  return `eve:setup:${code}:${f}`;
}

function loadDraft(key: string, mode: GameMode): Draft {
  const empty: Draft = { step: setupStep(null, mode), belt: null, devs: [] };
  try {
    const raw = sessionStorage.getItem(key);
    if (raw === null) return empty;
    const d = JSON.parse(raw) as Partial<Draft>;
    const belt = mode === 'full' && typeof d.belt === 'string' && (MINERALS as string[]).includes(d.belt) ? (d.belt as Mineral) : null;
    const devs = Array.isArray(d.devs) ? d.devs.filter((id): id is DevId => typeof id === 'string' && DEVELOPMENTS.some((x) => x.id === id)).slice(0, STARTING_DEVS) : [];
    return { step: setupStep(d.step, mode), belt, devs };
  } catch {
    return empty;
  }
}

function saveDraft(key: string, d: Draft): void {
  try {
    sessionStorage.setItem(key, JSON.stringify(d));
  } catch {
    // private mode or full: the draft just won't survive a reload
  }
}

export function Setup() {
  const { code, game, faction, me } = useMe();
  const mode = game?.mode ?? 'full';
  const light = mode === 'light';
  const key = code !== null && faction !== null ? draftKey(code, faction) : 'eve:setup';
  const [draft, setDraftState] = useState<Draft>(() => loadDraft(key, mode));
  // The table checklist shares its tick with the Panel's notice for the same step (same device profile and game).
  const { ticks, setTick } = useNoticeTicks(code);
  const drawn = ticks.has(SETUP_NOTICE_ID);
  const onDrawn = (on: boolean) => setTick(SETUP_NOTICE_ID, on);
  const { run, disabled } = useCommand();
  useBottomInset(me?.setupDone ? NO_INSET : FOOTER_INSET);

  /** Changes the draft from its latest value, so taps in quick succession never undo each other. */
  const update = (change: (d: Draft) => Draft) => setDraftState(change);
  useEffect(() => saveDraft(key, draft), [key, draft]);

  // Never a step this game skips (a light game has no belt step), whatever the draft says.
  const current = setupStep(draft.step, mode);
  // Each step starts at the top (not wherever the previous step was scrolled to).
  const step = me?.setupDone ? 0 : current;
  const firstStep = useRef(true);
  useEffect(() => {
    if (firstStep.current) {
      firstStep.current = false;
      return;
    }
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [step]);

  if (code === null || game === null || faction === null || me === null) return null;

  const others = game.seats.map((f) => ({ f, p: game.players[f]! }));
  const ready = (light || draft.belt !== null) && draft.devs.length === STARTING_DEVS;
  const confirm = async () => {
    if (!ready) return;
    await run({ type: 'setupFaction', revealedBelt: light ? null : draft.belt, devs: [...draft.devs] });
  };

  return (
    <div className="screen">
      <GameHeader code={code} faction={faction} title={factionName(faction)} subtitle={`${me.name} · Setup · ${formatCode(code)}`}>
        {!me.setupDone && <StepBar steps={setupSteps(mode)} step={current} draft={draft} onStep={(step) => update((d) => ({ ...d, step }))} />}
      </GameHeader>
      <main className="screen-body stack">
        <Progress players={others} me={faction} />
        {me.setupDone ? (
          <Waiting mode={mode} done={drawn} onDone={onDrawn} />
        ) : current === 1 ? (
          <BeltStep belt={draft.belt} onBelt={(belt) => update((d) => ({ ...d, belt }))} />
        ) : current === 2 ? (
          <DevStep devs={draft.devs} onToggle={(id) => update((d) => ({ ...d, devs: toggleDev(d.devs, id) }))} />
        ) : (
          <ConfirmStep faction={faction} mode={mode} draft={draft} done={drawn} onDone={onDrawn} res={me.res} />
        )}
      </main>
      {!me.setupDone && (
        <div className="screen-footer">
          <div className="screen-footer-inner">
            {current === 1 ? (
              <button type="button" className="btn btn-primary btn-lg btn-block" disabled={draft.belt === null} onClick={() => update((d) => ({ ...d, step: 2 }))}>
                {draft.belt === null ? 'Pick the uncovered belt' : 'Next: developments'}
                <Icon name="chevronRight" />
              </button>
            ) : current === 2 ? (
              <div className="setup-footer">
                <span className="setup-count" aria-live="polite">
                  <Icon name="lock" size="1.1rem" title="Private" />
                  <span className="num">
                    {draft.devs.length} / {STARTING_DEVS}
                  </span>
                  <span className="muted">selected</span>
                </span>
                <button type="button" className="btn btn-primary" disabled={draft.devs.length !== STARTING_DEVS} onClick={() => update((d) => ({ ...d, step: 3 }))}>
                  Next: confirm
                  <Icon name="chevronRight" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="btn btn-primary btn-lg btn-block"
                disabled={disabled || !ready}
                onClick={() => void confirm()}
              >
                <Icon name="check" />
                Confirm setup
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const STEP_LABEL: Record<Step, string> = { 1: 'Home belt', 2: 'Developments', 3: 'Confirm' };

/** The game's steps, numbered from 1 in the order shown; a step opens once every step before it is done. */
function StepBar({ steps, step, draft, onStep }: { steps: readonly Step[]; step: Step; draft: Draft; onStep: (s: Step) => void }) {
  const done = (s: Step) => (s === 1 ? draft.belt !== null : s === 2 ? draft.devs.length === STARTING_DEVS : false);
  const reachable = (s: Step) => steps.slice(0, steps.indexOf(s)).every(done);
  return (
    <nav className="step-bar" aria-label="Setup steps">
      <ol>
        {steps.map((s, i) => (
          <li key={s}>
            <button
              type="button"
              className={`step${s === step ? ' is-current' : ''}${done(s) ? ' is-done' : ''}`}
              aria-current={s === step ? 'step' : undefined}
              disabled={!reachable(s)}
              onClick={() => onStep(s)}
            >
              <span className="step-num" aria-hidden="true">
                {done(s) && s !== step ? <Icon name="check" size="0.9rem" /> : i + 1}
              </span>
              <span className="step-label">{STEP_LABEL[s]}</span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}

function Progress({ players, me }: { players: { f: FactionId; p: { name: string; setupDone: boolean } }[]; me: FactionId }) {
  return (
    <section aria-label="Everyone's setup" className="setup-progress">
      {players.map(({ f, p }) => (
        <span key={f} className="progress-chip" data-faction={f}>
          <FactionGlyph faction={f} size="0.95rem" />
          <span className="truncate">{f === me ? 'You' : p.name}</span>
          {p.setupDone ? (
            <span className="tag tag-ok">
              <Icon name="check" size="0.9rem" />
              Ready
            </span>
          ) : (
            <span className="tag">
              <Icon name="hourglass" size="0.9rem" />
              Choosing
            </span>
          )}
        </span>
      ))}
    </section>
  );
}

function BeltStep({ belt, onBelt }: { belt: Mineral | null; onBelt: (m: Mineral) => void }) {
  return (
    <section className="stack" aria-labelledby="belt-title">
      <div className="stack-sm">
        <h1 id="belt-title">Which home belt is uncovered?</h1>
        <p className="muted">On your leftmost home system, put 2 unlock tokens over 2 of its 3 asteroid belts and leave one uncovered. Pick the uncovered belt's mineral: you gain 1 of it now.</p>
      </div>
      <MineralPicker value={belt} onChange={onBelt} label="Uncovered home belt" note={(m) => (m === belt ? '+1 now' : null)} />
    </section>
  );
}

function DevStep({ devs, onToggle }: { devs: readonly DevId[]; onToggle: (id: DevId) => void }) {
  const { toast } = useFeedback();
  const [filter, setFilter] = useState<DevCategory | 'all' | 'recommended'>('all');
  const [flash, setFlash] = useState<DevId | null>(null);
  const listRef = useRef<HTMLElement>(null);
  const groups = useMemo(() => devsByCategory(DEVELOPMENTS), []);
  const full = devs.length >= STARTING_DEVS;

  useEffect(() => {
    if (flash === null) return;
    const card = listRef.current?.querySelector(`[data-dev="${CSS.escape(flash)}"]`);
    card?.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'instant' : 'smooth' });
    const t = setTimeout(() => setFlash(null), 1500);
    return () => clearTimeout(t);
  }, [flash]);

  const showPrereq = (id: DevId) => {
    setFilter('all');
    setFlash(id);
  };

  const devCard = (d: Development) => (
    <div key={d.id} className={flash === d.id ? 'dev-flash' : undefined}>
      <DevCard
        dev={d}
        selected={devs.includes(d.id)}
        blocked={full ? `You already picked ${STARTING_DEVS}; deselect one first` : null}
        onToggle={() => {
          if (full && !devs.includes(d.id)) toast(`You already picked ${STARTING_DEVS}; deselect one first`, 'warn');
          else onToggle(d.id);
        }}
        onPrerequisite={showPrereq}
      />
    </div>
  );

  return (
    <section className="stack" aria-labelledby="dev-title" ref={listRef}>
      <div className="stack-sm">
        <div className="title-row">
          <h1 id="dev-title">Pick 4 starting developments</h1>
          <RulesLink section="research" />
        </div>
        <p className="muted row">
          <Icon name="lock" size="1.1rem" title="Private" />
          <span>Only you see these until you complete them.</span>
        </p>
      </div>
      <div className="chip-row chip-scroll" role="radiogroup" aria-label="Category">
        {(['all', 'recommended', ...CATEGORY_ORDER] as const).map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={filter === c}
            className={filter === c ? 'chip is-selected' : 'chip'}
            onClick={() => setFilter(c)}
          >
            {c === 'all' ? 'All' : c === 'recommended' ? 'Recommended' : CATEGORY_LABEL[c]}
          </button>
        ))}
      </div>
      {filter === 'recommended' && (
        <section className="stack-sm" aria-labelledby="cat-recommended" aria-describedby="recommended-note">
          <h2 id="cat-recommended" className="caps faint">
            Recommended for a first game
          </h2>
          <p id="recommended-note" className="small muted">
            Cheap cards that experienced players suggest for your first rounds.
          </p>
          {RECOMMENDED_DEVS.map((r) => (
            <div key={r.id} className="rec-item">
              <p className="rec-why">
                <Icon name="info" size="1rem" />
                <span>
                  <span className="sr-only">Why {devById(r.id).name}: </span>
                  {r.why}
                </span>
              </p>
              {devCard(devById(r.id))}
            </div>
          ))}
        </section>
      )}
      {groups
        .filter((g) => filter === 'all' || g.category === filter)
        .map((g) => (
          <section key={g.category} className="stack-sm" aria-labelledby={`cat-${g.category}`}>
            <h2 id={`cat-${g.category}`} className="caps faint">
              {CATEGORY_LABEL[g.category]}
            </h2>
            {g.devs.map((d) => devCard(d))}
          </section>
        ))}
    </section>
  );
}

interface ChecklistProps {
  mode: GameMode;
  /** The setup notice is ticked (shared with the Panel's notice card). */
  done: boolean;
  onDone: (on: boolean) => void;
}

/** Any other board step this game leaves to the table (a light game's home belt), then the setup notice to tick. */
function Checklist({ mode, done, onDone }: ChecklistProps) {
  return (
    <>
      {tableSteps(mode).map((text) => (
        <p key={text} className="hint-line">
          <Icon name="info" size="1.1rem" />
          <span>{text}.</span>
        </p>
      ))}
      <ul className="checklist">
        <li>
          <label className={done ? 'check-item is-done' : 'check-item'}>
            <input type="checkbox" checked={done} onChange={(e) => onDone(e.target.checked)} />
            <span className="check-box" aria-hidden="true">
              {done && <Icon name="check" size="1rem" />}
            </span>
            <span>{SETUP_NOTICE}</span>
          </label>
        </li>
      </ul>
    </>
  );
}

/** A light game tracks no belts, ISK, minerals or ships, so its summary is the developments and the table steps. */
function ConfirmStep({ faction, mode, draft, done, onDone, res }: ChecklistProps & { faction: FactionId; draft: Draft; res: Resources }) {
  const light = mode === 'light';
  const after = draft.belt === null ? res : { ...res, [draft.belt]: res[draft.belt] + 1 };
  const [explorer, interceptor] = FACTION_INFO[faction].startingShips;
  return (
    <section className="stack" aria-labelledby="confirm-title">
      <h1 id="confirm-title">Ready to start?</h1>
      {!light && (
        <div className="card stack-sm">
          <h2 className="caps faint">Uncovered home belt</h2>
          {draft.belt !== null && (
            <p className="row">
              <ResourceIcon kind={draft.belt} title={null} size="1.5rem" />
              <strong>{RESOURCE_LABEL[draft.belt]}</strong>
              <span className="muted">+1 now</span>
            </p>
          )}
        </div>
      )}
      <div className="card stack-sm">
        <h2 className="caps faint row">
          <Icon name="lock" size="1rem" title="Private" />
          Starting developments (private)
        </h2>
        <ul className="pick-list">
          {draft.devs.map((id) => {
            const d = devById(id);
            return (
              <li key={id} className="row">
                <span className="spacer">
                  <DevName dev={d} />
                </span>
                <DevCost cost={d.cost} />
              </li>
            );
          })}
        </ul>
      </div>
      {!light && (
        <div className="card stack-sm">
          <h2 className="caps faint">You start with</h2>
          <ResourceBar res={after} highlight={draft.belt === null ? [] : [draft.belt]} />
          <p className="small muted">
            Ships: <ShipName ship={ship(explorer)} /> and <ShipName ship={ship(interceptor)} />
          </p>
        </div>
      )}
      <div className="stack-sm">
        <h2 className="caps faint">At the table</h2>
        <Checklist mode={mode} done={done} onDone={onDone} />
      </div>
    </section>
  );
}

function Waiting({ mode, done, onDone }: ChecklistProps) {
  return (
    <section className="stack" aria-labelledby="wait-title">
      <div className="notice notice-ok" role="status">
        <Icon name="check" size="1.25rem" />
        <p id="wait-title">
          <strong>Setup done.</strong> The first round starts when everyone is ready.
        </p>
      </div>
      <div className="stack-sm">
        <h2 className="caps faint">At the table</h2>
        <Checklist mode={mode} done={done} onDone={onDone} />
      </div>
    </section>
  );
}


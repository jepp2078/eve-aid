/**
 * The attack step. For the side whose step it is, top to
 * bottom: the previous result as one line, the target (enemy ships with their DIF and RED against this orbit, ⓘ for
 * how they are made, untargetable ones greyed with the engine's reason), the roll instruction as dice and words with
 * the pool breakdown folded away, the live tally (computed by the engine's `resolveRoll` on the pad's draft, so it is
 * exactly what Resolve does), the dice pad, ± adjusters for card effects, and the reminders strip for this roll
 * (rerolls, extra dice). The sticky footer holds the verdict and "Resolve (2 blank)"; "Skip this attack" sits in the
 * card's header.
 *
 * Everyone else sees whose attack it is, the target once chosen ("Caldari is entering their roll…"), the newest
 * result as it lands, and — on the targeted ship's owner's device — its "when targeted" reminders (Defensive Tactic).
 * The draft is not shared: the opponent sees the result, not the taps.
 */
import { useId, useState } from 'react';
import { ship as shipData } from '../../../data/ships';
import { NamedText, ShipName } from '../../components/CardName';
import type { Orbit } from '../../../data/types';
import { dicePool, leaderOf } from '../../../engine/combat/abilities';
import { overflowCandidates, resolveRoll, type ResolvedAttack } from '../../../engine/combat/attack';
import type { Command, CombatShip, CombatState, GameState } from '../../../engine/types';
import { useCommand } from '../../hooks';
import { DieFace, FactionGlyph, Icon } from '../../icons';
import { combatTask } from '../../lib/combat';
import { lineText, tokenStats } from '../../lib/combatBoard';
import { attackReminders, rerollBlockers, tally, targetedReminders, targetRows, verdict, type TargetRow } from '../../lib/combatFight';
import { EMPTY_PAD, padColours, padDice, padIssue, padLimits, padMeter, padSummary, resolveLabel, rollDraftName, rollWords, sanitizePad, type PadDraft } from '../../lib/dicePad';
import { factionName, signed, SIZE_LABEL } from '../../lib/labels';
import { StepRow, usePreview, useSheetDraft } from '../panel/ActionSheet';
import { CombatBoard } from './CombatBoard';
import { CombatFooter, CombatPreview, PoolInfo, Reminders, ReminderStrip, StageLayout, VerdictLine, type StageProps } from './CombatParts';
import { DicePad } from './DicePad';
import { FightNotes, LastResult, Status } from './FightParts';
import { OverflowPicker } from './OverflowPicker';
import { HpPips } from './ShipToken';

export function AttackStage(props: StageProps) {
  const task = combatTask(props.c, props.faction);
  if (task === 'overflow') return <OverflowPicker {...props} />;
  if (task === 'attack') return <AttackPanel {...props} />;
  return <AttackWait {...props} />;
}

/* ------------------------------------------------------------------ the attacker's panel */

function AttackPanel(props: StageProps) {
  const { game, c, side } = props;
  const step = c.step;
  const target = c.attack?.target == null ? null : (c.ships.find((s) => s.uid === c.attack?.target) ?? null);
  const draftName = rollDraftName(c);
  const [draft, setDraft] = useSheetDraft<PadDraft>(draftName ?? 'combat-roll:none', EMPTY_PAD, sanitizePad);
  const [changing, setChanging] = useState(false);
  const { run, disabled } = useCommand();
  const cmd: Command | null = target === null ? null : { type: 'combatRoll', dice: padDice(draft.counts), adjust: draft.adjust };
  const preview = usePreview(cmd);
  if (step === null || side === null) return null;

  const pool = dicePool(game, c, side, step.orbit);
  const limits = padLimits(pool, draft.extra);
  const meter = padMeter(draft.counts, limits);
  const issue = padIssue(draft.counts, limits);
  const resolved = target === null ? null : tryResolve(game, c, target, draft);
  // How many ships the carry could reach: the engine's candidates in the state after this roll.
  const after = preview?.ok ? preview.result.game : null;
  const afterCombat = after?.combat ?? null;
  const reach = after !== null && afterCombat !== null && afterCombat.attack?.overflow ? overflowCandidates(after, afterCombat).length : resolved?.overflow ? 0 : null;
  const t = target === null || resolved === null ? null : tally(resolved, target, reach);
  const v = target === null || resolved === null ? null : verdict(resolved, shipData(target.ship).name);
  const head = v?.head ?? null;
  const leader = leaderOf(c, side, step.orbit);

  const pick = async (uid: string) => {
    setChanging(false);
    if (uid !== target?.uid) await run({ type: 'combatTarget', target: uid }, { undo: false });
  };
  // The pad's draft outlives the roll (the step moves on to another name), so Undo of the attack brings its taps back;
  // `useCombatDraftCleanup` drops it once the combat is over.
  const resolve = async () => {
    if (cmd === null || !preview?.ok || issue !== null) return;
    await run(cmd, { label: `Attack: ${head ?? 'resolved'}` });
  };

  const rows = targetRows(game, c, side, step.orbit);
  const showList = target === null || changing;
  const panel = (
    <>
      <LastResult {...props} collapsed />
      <section className="card stack cb-attack" aria-labelledby="cb-attack-title">
        <header className="cb-attack-head">
          <div>
            <h2 id="cb-attack-title">Your {step.orbit}-orbit attack</h2>
            {leader !== null && (
              <p className="small muted">
                Led by <ShipName ship={shipData(leader.ship)} /> · {SIZE_LABEL[step.orbit]} orbit rolls {step.orbit === 'medium' ? 'white and black dice' : step.orbit === 'small' ? 'white dice' : 'black dice'}
              </p>
            )}
          </div>
          <button type="button" className="btn btn-ghost cb-skip" disabled={disabled} onClick={() => void run({ type: 'combatContinue' }, { label: `Skipped the ${step.orbit}-orbit attack` })}>
            Skip this attack
          </button>
        </header>

        <section className="stack-sm" aria-labelledby="cb-target-title">
          <div className="cb-sub-head">
            <h3 id="cb-target-title">1 · Target</h3>
            {target !== null && (
              <button type="button" className="btn btn-ghost" aria-expanded={changing} onClick={() => setChanging((x) => !x)}>
                {changing ? 'Keep target' : 'Change target'}
              </button>
            )}
          </div>
          {target !== null && !changing && (
            <TargetChip game={game} c={c} row={rows.find((r) => r.s.uid === target.uid) ?? null} fromOrbit={step.orbit} selected onPick={() => setChanging(true)} busy={disabled} />
          )}
          {showList && (
            <ul className="cb-targets" aria-label="Enemy ships">
              {rows.map((row) => (
                <li key={row.s.uid}>
                  <TargetChip game={game} c={c} row={row} fromOrbit={step.orbit} selected={row.s.uid === target?.uid} onPick={() => void pick(row.s.uid)} busy={disabled} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="stack-sm" aria-labelledby="cb-roll-title">
          <h3 id="cb-roll-title">2 · Roll</h3>
          <RollInstruction pool={pool} extra={draft.extra} />
        </section>

        {target === null ? (
          <p className="as-hint">
            <Icon name="info" size="1.1rem" />
            <span>Choose a target first, then roll and tap the faces you see.</span>
          </p>
        ) : (
          <section className="stack-sm" aria-labelledby="cb-enter-title">
            <h3 id="cb-enter-title">3 · Tap the faces you rolled</h3>
            {t !== null && <TallyBox t={t} />}
            <DicePad colours={padColours(step.orbit)} pool={pool} draft={draft} limits={limits} onChange={setDraft} disabled={disabled} />
            <Adjusters key={draftName} draft={draft} onChange={setDraft} />
          </section>
        )}
        {target !== null && <Reminders title={`No rerolls against ${shipData(target.ship).name}`} items={rerollBlockers(game, c, target)} />}
        <ReminderStrip
          label={target !== null && rerollBlockers(game, c, target).length > 0 ? 'Before you resolve: extra dice (no rerolls against this target)' : 'Before you resolve: rerolls, extra dice'}
          items={attackReminders(game, c, side, 'roll', step.orbit)}
        />
      </section>
      <FightNotes {...props} />
    </>
  );

  // One polite live region for the whole pad: the meter, tally and verdict below all change on every tap.
  const status = preview !== null && !preview.ok ? `Not possible: ${preview.error.message}` : head;
  const footer = (
    <CombatFooter label="Attack">
      <p className="sr-only" aria-live="polite">
        {target === null ? '' : padSummary(meter, issue, status)}
      </p>
      {issue !== null ? (
        <p className="as-error">
          <Icon name="danger" size="1.1rem" />
          <span>
            <strong>Too many dice:</strong> {issue}
          </span>
        </p>
      ) : preview?.ok && v !== null ? (
        <VerdictLine tone={v.tone} text={v.head} live={false} />
      ) : (
        <CombatPreview preview={preview} hint="Choose a target, then tap the faces you rolled" ok={head ?? ''} live={false} />
      )}
      <button type="button" className="btn btn-primary btn-lg btn-block" disabled={disabled || cmd === null || !preview?.ok || issue !== null} onClick={() => void resolve()}>
        {resolveLabel(meter.blank)}
      </button>
    </CombatFooter>
  );

  const board = <CombatBoard game={game} c={c} mySide={side} token={(s) => (s.uid === target?.uid ? { selected: true } : undefined)} />;
  return <StageLayout panel={panel} main={board} footer={footer} />;
}

function tryResolve(game: GameState, c: CombatState, target: CombatShip, d: PadDraft): ResolvedAttack | null {
  if (c.step === null) return null;
  try {
    return resolveRoll(game, c, c.step.side, c.step.orbit, target.uid, padDice(d.counts), d.adjust);
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ parts */

/**
 * An enemy ship as a target: name, role and orbit, DIF and RED against this attack, HP; ⓘ expands how DIF and RED
 * are made. The engine previews the choice: an untargetable ship is greyed with its reason.
 */
function TargetChip({
  game,
  c,
  row,
  fromOrbit,
  selected,
  onPick,
  busy,
}: {
  game: GameState;
  c: CombatState;
  row: TargetRow | null;
  fromOrbit: Orbit;
  selected: boolean;
  onPick: () => void;
  busy: boolean;
}) {
  const [why, setWhy] = useState(false);
  const whyId = useId();
  const preview = usePreview(row !== null && !selected && !row.destroyed ? { type: 'combatTarget', target: row.s.uid } : null);
  if (row === null) return null;
  const { s } = row;
  const data = shipData(s.ship);
  const faction = c.sides[s.side].faction;
  const reason = row.destroyed ? 'Destroyed: it leaves once this orbit has attacked' : preview !== null && !preview.ok ? preview.error.message : null;
  const stats = tokenStats(game, c, s, fromOrbit);
  return (
    <div className={['cb-target', selected && 'is-selected', reason !== null && 'is-blocked'].filter(Boolean).join(' ')} data-faction={faction}>
      <button type="button" className="cb-target-btn" aria-pressed={selected} disabled={busy || reason !== null} onClick={onPick}>
        <span className="cb-target-top">
          <FactionGlyph faction={faction} size="1rem" />
          <span className="cb-target-name">{data.name}</span>
          <span className="cb-target-meta">
            {s.role === 'leader' ? 'Leader' : 'Support'} · {s.orbit}
          </span>
          {selected && (
            <span className="tag tag-accent">
              <Icon name="aim" size="1em" />
              Target
            </span>
          )}
        </span>
        <span className="cb-target-stats num">
          <span>
            DIF <strong>{row.dif}</strong>
          </span>
          <span>
            RED <strong>{row.red}</strong>
          </span>
          <HpPips hp={row.hp} damage={row.hp - row.hpLeft} />
        </span>
        {reason !== null && (
          <span className="cb-target-reason">
            <Icon name="lock" size="1em" />
            {reason}
          </span>
        )}
      </button>
      <button type="button" className="icon-btn cb-target-info" aria-expanded={why} aria-controls={whyId} aria-label={`How ${data.name}'s DIF and RED are made`} onClick={() => setWhy((w) => !w)}>
        <Icon name="info" size="1.25rem" />
      </button>
      {why && (
        <ul className="cb-why cb-target-why" id={whyId}>
          <li className="num is-mod">{lineText(stats.dif)}</li>
          <li className="num">{lineText(stats.red)}</li>
          <li className="num">
            HP {stats.hp} · {stats.damage} damage · {row.hpLeft} left
          </li>
          {stats.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** "Roll ⚪⚪⚪ ⚫⚫ ◐ · 2 white, 2 black (+1 of your choice)", with the pool breakdown behind ⓘ. */
function RollInstruction({ pool, extra }: { pool: ReturnType<typeof dicePool>; extra: PadDraft['extra'] }) {
  const white = pool.white + extra.white;
  const black = pool.black + extra.black;
  return (
    <div className="cb-roll">
      <p className="cb-roll-dice" aria-hidden="true">
        {Array.from({ length: white }, (_, i) => (
          <DieFace key={`w${i}`} face="blank" die="white" size="1.5rem" title={null} />
        ))}
        {Array.from({ length: black }, (_, i) => (
          <DieFace key={`b${i}`} face="blank" die="black" size="1.5rem" title={null} />
        ))}
        {Array.from({ length: pool.choice }, (_, i) => (
          <span key={`c${i}`} className="cb-die-choice" />
        ))}
      </p>
      <p className="cb-roll-words">
        <strong>Roll {rollWords(pool, extra)}</strong>
        <PoolInfo pool={pool} />
      </p>
    </div>
  );
}

/** The live tally pinned above the pad: lock, damage → HP, carry, and the effects with their sources. */
function TallyBox({ t }: { t: ReturnType<typeof tally> }) {
  return (
    <div className="cb-tally">
      <p className={t.locked ? 'cb-tally-line is-ok' : 'cb-tally-line'}>
        <span className="num">{t.aims}</span>
        {t.locked ? (
          <span className="tag tag-ok">
            <Icon name="check" size="1em" />
            LOCK
          </span>
        ) : (
          <span className="tag">
            <Icon name="close" size="1em" />
            No lock
          </span>
        )}
      </p>
      <p className={t.destroyed ? 'cb-tally-line is-kill' : 'cb-tally-line'}>
        <span className="num">{t.damage.replace(' · DESTROYED', '')}</span>
        {t.destroyed && (
          <span className="tag tag-danger">
            <Icon name="danger" size="1em" />
            DESTROYED
          </span>
        )}
      </p>
      {t.carry !== null && (
        <p className="cb-tally-line cb-tally-carry">
          <Icon name="chevronRight" size="1em" />
          <span className="num">{t.carry}</span>
        </p>
      )}
      {t.effects.length > 0 && (
        <ul className="cb-effects" aria-label="Effects in this roll">
          {t.effects.map((e) => (
            <li key={e} className="chip cb-effect">
              {e}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * ± aim, damage and crits for effects the app doesn't automate (strategy and event cards, rerolls it can't see).
 * Folded unless the draft already has an adjustment; then it stays as the player leaves it (stepping the last one
 * back to 0 must not fold it under their thumb). Keyed by the attack, so the next attack starts folded again.
 */
function Adjusters({ draft, onChange }: { draft: PadDraft; onChange: (d: PadDraft) => void }) {
  const a = draft.adjust;
  const changed = (['aim', 'damage', 'crit'] as const).filter((k) => a[k] !== 0);
  const [open, setOpen] = useState(changed.length > 0);
  const set = (k: keyof PadDraft['adjust'], v: number) => onChange({ ...draft, adjust: { ...a, [k]: v } });
  return (
    <details className="cb-adjust" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        <Icon name="edit" size="1.1rem" />
        <span>
          Adjust for card effects
          {changed.length > 0 && <span className="num"> · {changed.map((k) => `${signed(a[k])} ${k}`).join(', ')}</span>}
        </span>
      </summary>
      <div className="stack-sm cb-adjust-body">
        <p className="small muted">For strategy or event cards the app doesn't track. Each crit you add also counts 1 damage.</p>
        <StepRow label="Aim" icon={<Icon name="aim" />} value={a.aim} min={-10} max={10} onChange={(v) => set('aim', v)} format={signed} />
        <StepRow label="Damage" icon={<Icon name="damage" />} value={a.damage} min={-10} max={10} onChange={(v) => set('damage', v)} format={signed} />
        <StepRow label="Crits" icon={<Icon name="crit" />} value={a.crit} min={-10} max={10} onChange={(v) => set('crit', v)} format={signed} />
      </div>
    </details>
  );
}

/* ------------------------------------------------------------------ everyone else */

function AttackWait(props: StageProps) {
  const { game, c, side, board } = props;
  const step = c.step;
  if (step === null) return <StageLayout panel={<LastResult {...props} />} main={board} />;
  const attacker = factionName(c.sides[step.side].faction);
  const target = c.attack?.target == null ? null : (c.ships.find((s) => s.uid === c.attack?.target) ?? null);
  const o = c.attack?.overflow ?? null;
  const mineTargeted = target !== null && target.side === side && o === null;
  const owner = target === null ? '' : target.side === side ? 'your' : `${factionName(c.sides[target.side].faction)}'s`;
  let text: string;
  if (o !== null && target !== null) {
    text = `${attacker}'s attack destroyed ${owner} ${shipData(target.ship).name}: ${o.aims} ${o.aims === 1 ? 'aim' : 'aims'} and ${o.damage} damage carry over. ${attacker} chooses where they go next.`;
  } else if (target !== null) {
    const row = targetRows(game, c, step.side, step.orbit).find((r) => r.s.uid === target.uid);
    const nums = row === undefined ? '' : ` (DIF ${row.dif} · RED ${row.red} · HP ${row.hpLeft}/${row.hp})`;
    text = `${attacker} is entering their roll against ${owner} ${shipData(target.ship).name}${nums}.`;
  } else {
    text = `${attacker} is choosing a target.`;
  }
  const panel = (
    <>
      <LastResult {...props} />
      <Status icon={side === null ? 'eye' : 'dice'} title={`${attacker}'s ${step.orbit}-orbit attack`}>
        <p>
          <NamedText text={text} />
        </p>
        {side === null && <p className="small muted">Only {factionName(c.attacker)} and {factionName(c.defender)} act here; results appear as they land.</p>}
      </Status>
      {mineTargeted && (
        <Reminders
          title={`Your ${shipData(target.ship).name} is targeted`}
          items={targetedReminders(game, c, target)}
          action={<p className="small muted">Using one? Tell {attacker}: they change the faces or adjust the roll before resolving.</p>}
        />
      )}
      <FightNotes {...props} />
    </>
  );
  const focusBoard = <CombatBoard game={game} c={c} mySide={side} token={(s) => (s.uid === target?.uid ? { selected: true } : undefined)} />;
  return <StageLayout panel={panel} main={focusBoard} />;
}

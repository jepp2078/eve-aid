/**
 * Start of combat (manual p.28): both fleets are placed; reveal strategy cards (a local checklist tick), then
 * each side makes the choices that apply to it, the attacker first and then the defender, who sees the attacker's
 * choices (a Curse may take away the ability an explorer would go evasive with):
 *   - citadel orbit — the system controller with citadels (each option shows the dice before → after);
 *     with Upgraded Citadel there is nothing to choose;
 *   - Vanguard Ship orbit — its supports can't be targeted (each option counts my supports there);
 *   - evasive explorers (D1) — a toggle per explorer with what it does ("DIF 3→5 · ATK 2→0 · SUP 1→0");
 *   - Curse (U1) — an enemy ship in a Curse's orbit, then one of its abilities.
 * Ready sends `combatStartChoices`, previewed by the engine. After that: a waiting card with what I chose.
 */
import { ship as shipData } from '../../../data/ships';
import type { Orbit, ShipId } from '../../../data/types';
import { opponent } from '../../../engine/combat/abilities';
import { RichSegments } from '../../components/CardText';
import { TierBadge } from '../../components/ShipCard';
import { useCommand } from '../../hooks';
import { FactionGlyph, Icon } from '../../icons';
import {
  canVanguard,
  choicesCommand,
  choicesDraftName,
  choicesSummary,
  citadelMode,
  citadelOptions,
  curseOptions,
  EMPTY_CHOICES,
  evasiveCandidates,
  evasiveText,
  sanitizeChoices,
  sideChoicesSummary,
  SLOT_LABEL,
  vanguardOptions,
} from '../../lib/combat';
import { parseCardText } from '../../lib/cardText';
import { andList, factionName, SIZE_LABEL } from '../../lib/labels';
import { richParagraphs, shipTokens } from '../../lib/richText';
import { Tiles, Toggle, usePreview, useSheetDraft, type Option } from '../panel/ActionSheet';
import { CheckRow, CombatFooter, CombatPreview, StageLayout, type StageProps } from './CombatParts';

const NONE = 'none';
type OrbitPick = Orbit | typeof NONE;

export function StartChoices({ game, c, side, board }: StageProps) {
  // Kept through Ready (an Undo brings the choices back); TabShell drops it once the combat is over.
  const [draft, setDraft] = useSheetDraft(choicesDraftName(c), EMPTY_CHOICES, sanitizeChoices);
  const { run, disabled } = useCommand();
  const cmd = side === null ? null : choicesCommand(game, c, side, draft);
  const preview = usePreview(cmd);
  if (side === null || cmd === null || cmd.type !== 'combatStartChoices') return null;

  const enemy = c.sides[opponent(side)];
  const mode = citadelMode(game, c, side);
  const vanguard = canVanguard(game, c, side);
  const evaders = evasiveCandidates(game, c, side);
  const curses = curseOptions(game, c, side);
  const nothing = mode === null && !vanguard && evaders.length === 0 && curses.length === 0;
  const cursed = curses.find((o) => o.ship === draft.curse?.ship) ?? null;

  const none = (note: string): Option<OrbitPick> => ({ value: NONE, label: 'None', note });
  const citadelTiles: Option<OrbitPick>[] = [
    none('No citadel bonus'),
    ...citadelOptions(game, c, side).map((o) => ({
      value: o.orbit,
      label: `${SIZE_LABEL[o.orbit]} orbit`,
      note: o.leader ? `${o.before} → ${o.after} dice` : 'No leader: no attack',
    })),
  ];
  const vanguardTiles: Option<OrbitPick>[] = [
    none('No protection'),
    ...vanguardOptions(c, side).map((o) => ({
      value: o.orbit,
      label: `${SIZE_LABEL[o.orbit]} orbit`,
      note: o.supports === 0 ? 'No supports there' : `Protects ${o.supports} ${o.supports === 1 ? 'support' : 'supports'}`,
    })),
  ];
  const curseTiles: Option<ShipId | typeof NONE>[] = [
    { value: NONE, label: 'No curse', note: 'Ignore nothing' },
    ...curses.map((o) => ({ value: o.ship, label: o.name, icon: <FactionGlyph faction={shipData(o.ship).faction} size="1.25rem" />, note: `${andList(o.orbits)} ${o.orbits.length === 1 ? 'orbit' : 'orbits'}` })),
  ];

  const ready = async () => {
    if (preview === null || !preview.ok) return;
    await run(cmd, { label: 'Ready for combat' });
  };

  const panel = (
    <div className="stack">
      <section className="card stack-sm" aria-labelledby="cb-start-title">
        <h2 id="cb-start-title">Start of combat</h2>
        <p className="small muted">Both fleets are in place. Reveal your strategy cards, then make your choices; {side === 'attacker' ? `${factionName(enemy.faction)} chooses after you.` : `${factionName(enemy.faction)} has chosen.`}</p>
        {side === 'defender' && <p className="small">{factionName(enemy.faction)}'s choices: {sideChoicesSummary(c, opponent(side))}</p>}
        <ul className="checklist">
          <li>
            <CheckRow checked={draft.cardChosen} onChange={(cardChosen) => setDraft((d) => ({ ...d, cardChosen }))}>
              Strategy card chosen face down, now revealed
            </CheckRow>
          </li>
        </ul>
      </section>

      {mode === 'choose' && (
        <section className="card stack-sm" aria-labelledby="cb-citadel-title">
          <h3 id="cb-citadel-title">Citadel orbit</h3>
          <p className="small muted">You control this system: your citadel adds +1 SUP to the attack of one orbit.</p>
          <Tiles<OrbitPick>
            label="Citadel orbit"
            options={citadelTiles}
            value={draft.citadelOrbit ?? NONE}
            onChange={(v) => setDraft((d) => ({ ...d, citadelOrbit: v === NONE ? null : v }))}
            columns={2}
          />
        </section>
      )}
      {mode === 'upgraded' && (
        <p className="notice notice-info">
          <Icon name="info" size="1.25rem" />
          <span>
            Upgraded Citadel: your {c.citadels} {c.citadels === 1 ? 'citadel adds' : 'citadels add'} +{c.citadels} SUP to every orbit. Nothing to choose.
          </span>
        </p>
      )}

      {vanguard && (
        <section className="card stack-sm" aria-labelledby="cb-vanguard-title">
          <h3 id="cb-vanguard-title">Vanguard Ship</h3>
          <p className="small muted">Choose an orbit: the enemy can't target your supporting ships there.</p>
          <Tiles<OrbitPick>
            label="Vanguard Ship orbit"
            options={vanguardTiles}
            value={draft.vanguardOrbit ?? NONE}
            onChange={(v) => setDraft((d) => ({ ...d, vanguardOrbit: v === NONE ? null : v }))}
            columns={2}
          />
        </section>
      )}

      {evaders.length > 0 && (
        <section className="card stack-sm" aria-labelledby="cb-evasive-title">
          <h3 id="cb-evasive-title">Evasive explorers</h3>
          <p className="small muted">An explorer with D1 may trade attack for defence for the whole combat.</p>
          {evaders.map((s) => (
            <Toggle
              key={s.uid}
              label={`${shipData(s.ship).name} · ${s.orbit} orbit ${s.role}`}
              note={evasiveText(game, c, s)}
              checked={draft.evasive.includes(s.uid)}
              onChange={(on) => setDraft((d) => ({ ...d, evasive: on ? [...d.evasive.filter((u) => u !== s.uid), s.uid] : d.evasive.filter((u) => u !== s.uid) }))}
            />
          ))}
        </section>
      )}

      {curses.length > 0 && (
        <section className="card stack-sm" aria-labelledby="cb-curse-title">
          <h3 id="cb-curse-title">Curse</h3>
          <p className="small muted">Pick an enemy ship in your Curse's orbit and one of its abilities: it is ignored for every enemy ship of that name until the combat ends.</p>
          <Tiles<ShipId | typeof NONE>
            label="Cursed ship"
            options={curseTiles}
            value={draft.curse?.ship ?? NONE}
            onChange={(v) => {
              if (v === NONE) return setDraft((d) => ({ ...d, curse: null }));
              const first = curses.find((o) => o.ship === v)?.abilities[0];
              if (first !== undefined) setDraft((d) => ({ ...d, curse: { ship: v, slot: d.curse?.ship === v ? d.curse.slot : first.slot } }));
            }}
            columns={2}
            layout="row"
          />
          {cursed !== null && (
            <div className="cb-abilities" role="radiogroup" aria-label={`${cursed.name}'s ability to ignore`}>
              {cursed.abilities.map((a) => {
                const on = draft.curse?.slot === a.slot;
                return (
                  <button
                    key={a.slot}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    className={on ? 'cb-ability is-selected' : 'cb-ability'}
                    onClick={() => setDraft((d) => ({ ...d, curse: { ship: cursed.ship, slot: a.slot } }))}
                  >
                    <span className="cb-ability-head">
                      <TierBadge requires={a.requires} />
                      <span className="cb-ability-slot">{SLOT_LABEL[a.slot]}</span>
                      {on && <Icon name="check" size="1.1rem" />}
                    </span>
                    <span className="cb-ability-text">
                      {/* icons for dice words; no term chips, which would be buttons inside this button */}
                      <RichSegments segs={richParagraphs(parseCardText(shipTokens(a.text)), { terms: false }).flat()} />
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      )}

      {nothing && (
        <p className="notice">
          <Icon name="info" size="1.25rem" />
          <span>Your fleet has no start-of-combat choices. Tap Ready when your strategy card is revealed.</span>
        </p>
      )}
    </div>
  );

  const footer = (
    <CombatFooter label="Start of combat">
      {!draft.cardChosen && (
        <p className="as-hint">
          <Icon name="reference" size="1.1rem" />
          <span>Reminder: reveal the strategy card you chose face down.</span>
        </p>
      )}
      <CombatPreview preview={preview} hint="" ok={choicesSummary(c, cmd)} />
      <button type="button" className="btn btn-primary btn-lg btn-block" disabled={disabled || preview === null || !preview.ok} onClick={() => void ready()}>
        <Icon name="check" />
        {enemy.ready ? 'Ready · round 1 begins' : 'Ready'}
      </button>
    </CombatFooter>
  );

  return <StageLayout panel={panel} main={board} footer={footer} />;
}

/**
 * Where the fight is: `R1 · S·Att ▸ S·Def ▸ M·Att ▸ M·Def ▸ L·Att ▸ L·Def`, sticky under the header.
 * The current attack is filled in the accent colour (and `aria-current`), finished ones carry a ✓ badge, and an
 * attack that won't happen (no leader there, or the side is retreating) is dashed and struck through. Another line
 * names the round and the stage, and who Att and Def are (glyph + name). On phones the six steps take the full width
 * and the round badge moves to that line.
 */
import type { CombatState } from '../../../engine/types';
import { FactionGlyph, Icon } from '../../icons';
import { stepRail } from '../../lib/combatBoard';
import { factionName } from '../../lib/labels';

const STATE_WORD = { done: 'done', current: 'now', upcoming: 'to come' } as const;

export function StepRail({ c }: { c: CombatState }) {
  const rail = stepRail(c);

  return (
    <section className="cb-rail" aria-label="Combat progress">
      <span className="cb-rail-round num" aria-hidden="true">
        {rail.round === null ? 'Setup' : `R${rail.round}`}
      </span>
      <ol className="cb-rail-steps">
        {rail.steps.map((s) => (
          <li
            key={s.short}
            className={['cb-step', `is-${s.state}`, s.idle && 'is-idle'].filter(Boolean).join(' ')}
            aria-current={s.state === 'current' ? 'step' : undefined}
          >
            <span aria-hidden="true">{s.short}</span>
            {s.state === 'done' && !s.idle && <Icon name="check" size="0.75rem" className="cb-step-done" />}
            <span className="sr-only">{`${s.label}: ${s.idle ? 'no attack' : STATE_WORD[s.state]}`}</span>
          </li>
        ))}
      </ol>
      <p className="cb-rail-line">
        <span>
          {rail.title} · {rail.detail}
        </span>
        <span className="cb-rail-who">
          Att <FactionGlyph faction={c.attacker} size="0.9em" /> {factionName(c.attacker)} · Def <FactionGlyph faction={c.defender} size="0.9em" />{' '}
          {factionName(c.defender)}
        </span>
      </p>
    </section>
  );
}

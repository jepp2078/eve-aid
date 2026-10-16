import { describe, expect, it } from 'vitest';
import { DEV, DEVELOPMENTS, dev } from '../../src/data/developments';
import { ADD_CARD_SENTENCE, devCardText, parseCardText, TOKEN_LABEL } from '../../src/ui/lib/cardText';

describe('parseCardText', () => {
  it('splits paragraphs and turns [TOKENS] into token segments', () => {
    expect(parseCardText('Gain 2 [ISK].\nSpend one [MOON].')).toStrictEqual([
      [
        { kind: 'text', text: 'Gain 2 ' },
        { kind: 'token', token: 'ISK' },
        { kind: 'text', text: '.' },
      ],
      [
        { kind: 'text', text: 'Spend one ' },
        { kind: 'token', token: 'MOON' },
        { kind: 'text', text: '.' },
      ],
    ]);
  });

  it('marks only the word "Use" as strong where a paragraph or sentence starts with it, whatever follows', () => {
    expect(parseCardText('Use in combat: Reroll 1 die.')).toStrictEqual([
      [
        { kind: 'text', text: 'Use', strong: true },
        { kind: 'text', text: ' in combat: Reroll 1 die.' },
      ],
    ]);
    expect(parseCardText('Systems you control have +1 strength.\nUse when another player attempts to claim a system you control: Spend one [MOON].')).toStrictEqual([
      [{ kind: 'text', text: 'Systems you control have +1 strength.' }],
      [
        { kind: 'text', text: 'Use', strong: true },
        { kind: 'text', text: ' when another player attempts to claim a system you control: Spend one ' },
        { kind: 'token', token: 'MOON' },
        { kind: 'text', text: '.' },
      ],
    ]);
    expect(parseCardText('Gain 1 VP. Use after another player retreats from combat: gain 1 VP.')[0]).toStrictEqual([
      { kind: 'text', text: 'Gain 1 VP. ' },
      { kind: 'text', text: 'Use', strong: true },
      { kind: 'text', text: ' after another player retreats from combat: gain 1 VP.' },
    ]);
  });

  it('does not bold "use" inside a sentence or a longer word', () => {
    expect(parseCardText('You may use this. Useful cards.')).toStrictEqual([[{ kind: 'text', text: 'You may use this. Useful cards.' }]]);
  });

  it('shows the printed add-a-card sentence only on cards that owe one', () => {
    for (const d of DEVELOPMENTS) {
      expect(devCardText(d).endsWith(ADD_CARD_SENTENCE), d.name).toBe(d.addsCard);
    }
    expect(DEVELOPMENTS.filter((d) => d.addsCard)).toHaveLength(9);
    expect(parseCardText(devCardText(dev(DEV.mediumHull)))[1]).toStrictEqual([{ kind: 'text', text: ADD_CARD_SENTENCE }]);
  });

  it('has a readable label for every token used on a development card', () => {
    for (const d of DEVELOPMENTS) {
      for (const para of parseCardText(d.text)) {
        for (const seg of para) if (seg.kind === 'token') expect(TOKEN_LABEL[seg.token], `${d.name}: ${seg.token}`).toBeTruthy();
      }
    }
  });
});

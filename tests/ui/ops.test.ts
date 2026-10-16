import { describe, expect, it } from 'vitest';
import {
  contentsLabel,
  contentsOf,
  discoveryRewards,
  EMPTY_CONTENTS,
  sanitizeContents,
  EMPTY_DISCOVERY,
  manufactureOpText,
  payOptions,
  sanitizeDiscovery,
  sanitizeManufactureOps,
  sanitizeTradeOps,
  setManufactureOutput,
  setTradeItem,
  tradeIskNet,
  tradeOpText,
} from '../../src/ui/lib/ops';

describe('trade operations', () => {
  it('describes each operation with its ISK effect', () => {
    expect(tradeOpText({ dir: 'sell', item: 'component', mineral: null })).toBe('Sell 1 Component · +6 ISK');
    expect(tradeOpText({ dir: 'buy', item: 'triple', mineral: 'mexallon' })).toBe('Buy 3 Mexallon · −8 ISK');
    expect(tradeOpText({ dir: 'sell', item: 'planetary', mineral: null })).toBe('Sell 1 Planetary · +4 ISK');
  });

  it('adds up the uncapped ISK change including the cube price', () => {
    const ops = [
      { dir: 'sell', item: 'component', mineral: null },
      { dir: 'buy', item: 'pyrite', mineral: null },
    ] as const;
    expect(tradeIskNet([...ops], 0)).toBe(6 - 3);
    expect(tradeIskNet([...ops], 5)).toBe(6 - 3 - 5);
  });

  it('keeps the mineral only for triple trades', () => {
    expect(setTradeItem({ dir: 'sell', item: 'pyrite', mineral: null }, 'triple')).toStrictEqual({ dir: 'sell', item: 'triple', mineral: 'pyrite' });
    expect(setTradeItem({ dir: 'buy', item: 'triple', mineral: 'tritanium' }, 'moon')).toStrictEqual({ dir: 'buy', item: 'moon', mineral: null });
  });

  it('accepts only well-formed stored drafts', () => {
    expect(sanitizeTradeOps([{ dir: 'sell', item: 'triple', mineral: 'tritanium' }])).toStrictEqual([{ dir: 'sell', item: 'triple', mineral: 'tritanium' }]);
    expect(sanitizeTradeOps([{ dir: 'steal', item: 'moon', mineral: null }])).toBeNull();
    expect(sanitizeTradeOps([{ dir: 'sell', item: 'triple', mineral: 'morphite' }])).toBeNull();
    expect(sanitizeTradeOps('nope')).toBeNull();
    expect(sanitizeTradeOps([1, 2, 3, 4])).toBeNull();
  });
});

describe('manufacture operations', () => {
  it('offers morphite only where a recipe has it', () => {
    expect(payOptions('research')).toStrictEqual(['basic', 'morphite']);
    expect(payOptions('component')).toStrictEqual(['basic']);
    expect(setManufactureOutput({ output: 'research', pay: 'morphite' }, 'moon')).toStrictEqual({ output: 'moon', pay: 'basic' });
    expect(setManufactureOutput({ output: 'research', pay: 'morphite' }, 'card')).toStrictEqual({ output: 'card', pay: 'morphite' });
  });

  it('writes the recipe as inputs → output', () => {
    expect(manufactureOpText({ output: 'component', pay: 'basic' })).toBe('2 Mexallon → 1 Component');
    expect(manufactureOpText({ output: 'research', pay: 'basic' })).toBe('1 Pyrite + 1 Mexallon + 1 Tritanium → 2 Research');
    expect(manufactureOpText({ output: 'card', pay: 'morphite' })).toBe('1 Morphite → 1 Event or Mission card');
    expect(manufactureOpText({ output: 'vp', pay: 'basic' })).toBe('1 Pyrite + 1 Mexallon + 1 Tritanium + 2 Morphite → 1 VP');
  });

  it('rejects stored ops with a payment the recipe lacks', () => {
    expect(sanitizeManufactureOps([{ output: 'vp', pay: 'morphite' }])).toBeNull();
    expect(sanitizeManufactureOps([{ output: 'card', pay: 'morphite' }])).toStrictEqual([{ output: 'card', pay: 'morphite' }]);
  });
});

describe('discovery rewards', () => {
  it('turns the per-token counts into reward entries', () => {
    expect(discoveryRewards(EMPTY_DISCOVERY)).toStrictEqual([]);
    expect(
      discoveryRewards({ ...EMPTY_DISCOVERY, pyrite: 1, tritanium: 2, research: 2, control: 1, moon: 1, card: 2, isk: 4 }),
    ).toStrictEqual([
      { kind: 'minerals', minerals: ['pyrite', 'tritanium', 'tritanium'] },
      { kind: 'research', amount: 2 },
      { kind: 'control' },
      { kind: 'moon', amount: 1 },
      { kind: 'card' },
      { kind: 'card' },
      { kind: 'isk', amount: 4 },
    ]);
  });

  it('restores a stored draft, dropping bad numbers', () => {
    expect(sanitizeDiscovery({ ...EMPTY_DISCOVERY, isk: 4 })).toStrictEqual({ ...EMPTY_DISCOVERY, isk: 4 });
    expect(sanitizeDiscovery({ isk: -1 })).toStrictEqual(EMPTY_DISCOVERY);
    expect(sanitizeDiscovery(null)).toBeNull();
  });
});

describe('what a system holds', () => {
  const some = { belts: { ...EMPTY_CONTENTS.belts, pyrite: 2 }, structures: { ...EMPTY_CONTENTS.structures, customs: 1 } };

  it('sends nothing for an empty draft, and only the non-zero entries otherwise', () => {
    expect(contentsOf(EMPTY_CONTENTS)).toBeUndefined();
    expect(contentsOf(some)).toStrictEqual({ belts: { pyrite: 2 }, structures: { customs: 1 } });
    expect(contentsLabel(some)).toBe('2 Pyrite belts, 1 Customs Office');
  });

  it('puts the discovery belts on the first control reward only', () => {
    const belts = { ...EMPTY_CONTENTS, belts: some.belts };
    expect(discoveryRewards({ ...EMPTY_DISCOVERY, control: 2 }, belts)).toStrictEqual([
      { kind: 'control', contents: { belts: { pyrite: 2 }, structures: {} } },
      { kind: 'control' },
    ]);
    expect(discoveryRewards({ ...EMPTY_DISCOVERY, control: 1 })).toStrictEqual([{ kind: 'control' }]);
  });

  it('restores a stored draft, dropping anything malformed', () => {
    expect(sanitizeContents(JSON.parse(JSON.stringify(some)))).toStrictEqual(some);
    expect(sanitizeContents({ belts: { pyrite: -1, gold: 3 }, structures: { customs: 'x' } })).toStrictEqual(EMPTY_CONTENTS);
    expect(sanitizeContents(undefined)).toStrictEqual(EMPTY_CONTENTS);
  });
});

import { describe, expect, it } from 'vitest';
import { DEV, dev } from '../../src/data/developments';
import { SHIPS } from '../../src/data/ships';
import { splitCardNames } from '../../src/ui/lib/cardNames';

const tactic = dev(DEV.defensiveTactic);
const crow = SHIPS.find((s) => s.name === 'Crow')!;

describe('splitCardNames', () => {
  it('splits running text around the development cards and ships it names', () => {
    expect(splitCardNames('Gallente completed Defensive Tactic')).toEqual(['Gallente completed ', { kind: 'dev', dev: tactic }]);
    expect(splitCardNames('Caldari lost Crow + Defensive Tactic')).toEqual([
      'Caldari lost ',
      { kind: 'ship', ship: crow },
      ' + ',
      { kind: 'dev', dev: tactic },
    ]);
    expect(splitCardNames('Crow ×2')).toEqual([{ kind: 'ship', ship: crow }, ' ×2']);
  });
  it('leaves text without a name whole', () => {
    expect(splitCardNames('Gallente gained 3 research')).toEqual(['Gallente gained 3 research']);
    expect(splitCardNames('')).toEqual([]);
  });
  it('matches whole, capitalised words only', () => {
    expect(splitCardNames('Crowd')).toEqual(['Crowd']);
    expect(splitCardNames('a crow')).toEqual(['a crow']);
  });
});

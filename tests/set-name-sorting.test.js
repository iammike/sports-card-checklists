import { describe, it, expect } from 'vitest';

const CardRenderer = globalThis.CardRenderer;
const ChecklistEngine = globalThis.ChecklistEngine;

// Season-format set names ("2012-13 Panini Prizm") used to strip only the first
// year, leaving "-13 panini prizm", so every season set collated under "-".
describe('CardRenderer.getSetName', () => {
  it('strips a season year pair, both short and long forms', () => {
    expect(CardRenderer.getSetName({ set: '2012-13 Panini Prizm' })).toBe('panini prizm');
    // The production gist has exactly one of these: "1980-1981 Topps".
    expect(CardRenderer.getSetName({ set: '1980-1981 Topps' })).toBe('topps');
  });

  it('keeps a year that is part of the set name rather than its prefix', () => {
    // The second line is the one guarding the anchor: replace() takes the first
    // match, so an unanchored pattern would still strip the *leading* 2024 here
    // and this fixture would pass either way. Only a set whose sole year is
    // trailing tells the two apart - do not delete it as redundant.
    expect(CardRenderer.getSetName({ set: '2024 Leaf Pro Set 1989' })).toBe('leaf pro set 1989');
    expect(CardRenderer.getSetName({ set: 'Topps Pro Set 1989' })).toBe('topps pro set 1989');
  });

  it('leaves a trailing season pair alone', () => {
    expect(CardRenderer.getSetName({ set: 'Panini Prizm 2012-13' })).toBe('panini prizm 2012-13');
    // A real production set name, and one with no digits to strip at all.
    expect(CardRenderer.getSetName({ set: 'Mythos Season X' })).toBe('mythos season x');
  });
});

describe('ChecklistEngine sorting by set name', () => {
  const sort = (cards, by) => ChecklistEngine.prototype.sortCards.call({
    _getSetName: ChecklistEngine.prototype._getSetName,
    _getYear: ChecklistEngine.prototype._getYear,
  }, cards, by).map(c => c.set);

  const cards = [
    { set: '2013-14 Panini Prizm' },
    { set: '2024 Donruss' },
    { set: '1986-87 Fleer' },
  ];

  it('sorts season sets by set name, not under "-"', () => {
    expect(sort(cards, 'set')).toEqual([
      '2024 Donruss', '1986-87 Fleer', '2013-14 Panini Prizm',
    ]);
  });

  it('breaks year ties on the set name for season sets', () => {
    // The tie has to cross a season set and a plain-year set of the same year.
    // Two season sets would not discriminate: both keys carried the same leading
    // "-87 " under the old regex, so it cancelled and they still sorted right.
    expect(sort([
      { set: '1986-87 Fleer' },
      { set: '1986 Donruss' },
    ], 'year')).toEqual(['1986 Donruss', '1986-87 Fleer']);
  });
});

describe('the engine and the renderer share one implementation', () => {
  it('_getSetName delegates to CardRenderer.getSetName', () => {
    const calls = [];
    const original = CardRenderer.getSetName;
    CardRenderer.getSetName = (card) => { calls.push(card); return 'stub'; };
    try {
      expect(ChecklistEngine.prototype._getSetName({ set: '2012-13 Panini Prizm' })).toBe('stub');
    } finally {
      CardRenderer.getSetName = original;
    }
    expect(calls).toEqual([{ set: '2012-13 Panini Prizm' }]);
  });
});

import { describe, it, expect } from 'vitest';

const ChecklistEngine = globalThis.ChecklistEngine;
const ChecklistManager = globalThis.ChecklistManager;

function makeEngine(config, cards) {
  const engine = Object.create(ChecklistEngine.prototype);
  engine.config = config;
  engine.cards = cards;
  engine._renderedCards = [];
  engine.checklistManager = new ChecklistManager({ checklistId: 'test' });
  return engine;
}

const flatConfig = {
  dataShape: 'flat',
  customFields: { player: { label: 'Player', position: 'top' } },
};

describe('_backfillSyntheticIds — flat data', () => {
  it('gives two id-less no-card entries distinct ids', () => {
    const engine = makeEngine(flatConfig, [
      { player: 'Ariel Hukporti', noCard: true },
      { player: 'Robert Baker', noCard: true },
    ]);

    engine._backfillSyntheticIds();

    const [first, second] = engine.cards;
    // Exact match, not a pattern: item A made this id deterministic, so a
    // loose regex would still pass if a stray suffix crept back in.
    expect(first.id).toBe('ncArielHukporti');
    expect(second.id).toBe('ncRobertBaker');
  });

  it('disambiguates two same-name entries with a numeric suffix', () => {
    const engine = makeEngine(flatConfig, [
      { player: 'Ariel Hukporti', noCard: true },
      { player: 'Ariel Hukporti', noCard: true },
    ]);

    engine._backfillSyntheticIds();

    expect(engine.cards.map(c => c.id)).toEqual([
      'ncArielHukporti',
      'ncArielHukporti2',
    ]);
  });

  it('disambiguates three same-name entries with sequential suffixes', () => {
    const engine = makeEngine(flatConfig, [
      { player: 'Ariel Hukporti', noCard: true },
      { player: 'Ariel Hukporti', noCard: true },
      { player: 'Ariel Hukporti', noCard: true },
    ]);

    engine._backfillSyntheticIds();

    expect(engine.cards.map(c => c.id)).toEqual([
      'ncArielHukporti',
      'ncArielHukporti2',
      'ncArielHukporti3',
    ]);
  });

  it('backfills the same input to the same id every time', () => {
    const makeCards = () => [{ player: 'Ariel Hukporti', noCard: true }];

    const first = makeEngine(flatConfig, makeCards());
    first._backfillSyntheticIds();

    const second = makeEngine(flatConfig, makeCards());
    second._backfillSyntheticIds();

    expect(first.cards[0].id).toBe(second.cards[0].id);
  });

  it('falls back to a stable prefix, disambiguated, when there is no name and no set', () => {
    const engine = makeEngine(flatConfig, [
      { noCard: true },
      { noCard: true },
    ]);

    engine._backfillSyntheticIds();

    // Confirms the fallback base ('ncEntry') is never empty - an empty base
    // would put the entire uniqueness burden on the collision counter.
    expect(engine.cards.map(c => c.id)).toEqual(['ncEntry', 'ncEntry2']);
  });

  it('does not collide with an id already in use', () => {
    const engine = makeEngine(flatConfig, [
      { player: 'Ariel Hukporti', noCard: true, id: 'ncArielHukporti1' },
      { player: 'Ariel Hukporti', noCard: true },
    ]);

    engine._backfillSyntheticIds();

    expect(engine.cards[1].id).not.toBe('ncArielHukporti1');
  });

  it('leaves existing ids and ordinary cards alone', () => {
    const engine = makeEngine(flatConfig, [
      { player: 'Kept', noCard: true, id: 'ncKept' },
      { player: 'Real Card', set: 'Prizm', num: '12' },
    ]);

    engine._backfillSyntheticIds();

    expect(engine.cards[0].id).toBe('ncKept');
    expect('id' in engine.cards[1]).toBe(false);
  });

  it('lets edit target the entry the user picked, not the first match', () => {
    const engine = makeEngine(flatConfig, [
      { player: 'Ariel Hukporti', noCard: true },
      { player: 'Robert Baker', noCard: true },
    ]);
    engine._backfillSyntheticIds();

    const secondId = engine.cards[1].id;
    const found = engine._findCardWithLocation(secondId);

    expect(found).not.toBe(null);
    expect(found.card.player).toBe('Robert Baker');
    expect(found.index).toBe(1);
  });

  it('lets delete remove the entry the user picked, not the first match', () => {
    const engine = makeEngine(flatConfig, [
      { player: 'Ariel Hukporti', noCard: true },
      { player: 'Robert Baker', noCard: true },
    ]);
    engine._backfillSyntheticIds();

    engine._removeCard(engine.cards[1].id);

    expect(engine.cards.map(c => c.player)).toEqual(['Ariel Hukporti']);
  });
});

describe('_backfillSyntheticIds — category data', () => {
  const config = {
    dataShape: 'categories',
    categories: [{ id: 'main', label: 'Main' }],
    customFields: { player: { label: 'Player', position: 'top' } },
  };

  it('backfills entries inside every category', () => {
    const engine = makeEngine(config, {
      main: [{ player: 'Ariel Hukporti', noCard: true }],
      extra: [{ player: 'Robert Baker', noCard: true }],
    });

    engine._backfillSyntheticIds();

    expect(engine.cards.main[0].id).toBe('ncArielHukporti');
    expect(engine.cards.extra[0].id).toBe('ncRobertBaker');
  });

  it('lets delete remove the entry the user picked', () => {
    const engine = makeEngine(config, {
      main: [
        { player: 'Ariel Hukporti', noCard: true },
        { player: 'Robert Baker', noCard: true },
      ],
    });
    engine._backfillSyntheticIds();

    engine._removeCard(engine.cards.main[1].id);

    expect(engine.cards.main.map(c => c.player)).toEqual(['Ariel Hukporti']);
  });
});

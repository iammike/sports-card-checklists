import { describe, it, expect } from 'vitest';

const ChecklistEngine = globalThis.ChecklistEngine;

// Build a category-based engine instance without running the constructor.
function makeEngine({ config, cards, ownedIds }) {
  const engine = Object.create(ChecklistEngine.prototype);
  engine.config = config;
  engine.cards = cards;
  const owned = new Set(ownedIds);
  engine.checklistManager = {
    getCardId: (card) => card.id,
    isOwned: (cardId) => owned.has(cardId),
  };
  return engine;
}

describe('computeStats — extra category value', () => {
  const config = {
    dataShape: 'category',
    categories: [
      { id: 'base', isMain: true },
      { id: 'extra', isMain: false, statLabel: 'extraOwned' },
    ],
  };

  it('adds owned extra-category value into ownedValue, not neededValue', () => {
    const engine = makeEngine({
      config,
      cards: {
        base: [
          { id: 'b1', price: 100 }, // owned
          { id: 'b2', price: 50 },  // not owned
        ],
        extra: [
          { id: 'e1', price: 25 },  // owned
          { id: 'e2', price: 10 },  // not owned
        ],
      },
      ownedIds: ['b1', 'e1'],
    });

    const stats = engine.computeStats();

    expect(stats.ownedValue).toBe(125);
    expect(stats.neededValue).toBe(50);
    expect(stats.owned).toBe(1);
    expect(stats.total).toBe(2);
    expect(stats.extraOwned).toBe(1);
  });

  it('unowned extras add nothing', () => {
    const engine = makeEngine({
      config,
      cards: {
        base: [{ id: 'b1', price: 100 }],
        extra: [{ id: 'e1', price: 999 }], // not owned
      },
      ownedIds: ['b1'],
    });

    const stats = engine.computeStats();
    expect(stats.ownedValue).toBe(100);
  });

  it('does not double-count when a config has no main categories', () => {
    const allExtraConfig = {
      dataShape: 'category',
      categories: [
        { id: 'a', isMain: false },
        { id: 'b', isMain: false },
      ],
    };
    const engine = makeEngine({
      config: allExtraConfig,
      cards: {
        a: [{ id: 'a1', price: 100 }], // owned
        b: [{ id: 'b1', price: 25 }],  // owned
      },
      ownedIds: ['a1', 'b1'],
    });

    const stats = engine.computeStats();
    // Both categories are counted once by the main-loop fallback; the extra
    // loop must not add them a second time.
    expect(stats.ownedValue).toBe(125);
  });
});

// Build a flat-shape engine instance without running the constructor.
function makeFlatEngine({ config, cards, ownedIds }) {
  const engine = Object.create(ChecklistEngine.prototype);
  engine.config = config;
  engine.cards = cards;
  const owned = new Set(ownedIds);
  engine.checklistManager = {
    getCardId: (card) => card.id,
    isOwned: (cardId) => owned.has(cardId),
  };
  return engine;
}

describe('computeStats — noCard entries', () => {
  it('excludes noCard from total and owned in flat shape', () => {
    const engine = makeFlatEngine({
      config: { dataShape: 'flat' },
      cards: [
        { id: 'c1', price: 100 },              // owned
        { id: 'c2', price: 50 },               // not owned
        { id: 'c3', noCard: true },            // no card exists
        { id: 'c4', noCard: true, price: 999 },// no card, stray price
      ],
      ownedIds: ['c1'],
    });

    const stats = engine.computeStats();
    expect(stats.total).toBe(2);
    expect(stats.owned).toBe(1);
    expect(stats.ownedValue).toBe(100);
    expect(stats.neededValue).toBe(50);
  });

  it('excludes a noCard entry even if its id is in the owned list', () => {
    const engine = makeFlatEngine({
      config: { dataShape: 'flat' },
      cards: [
        { id: 'c1', price: 100 },
        { id: 'c2', noCard: true },
      ],
      ownedIds: ['c1', 'c2'],
    });

    const stats = engine.computeStats();
    expect(stats.total).toBe(1);
    expect(stats.owned).toBe(1);
  });

  it('excludes noCard from main and extra categories', () => {
    const engine = makeEngine({
      config: {
        dataShape: 'category',
        categories: [
          { id: 'base', isMain: true },
          { id: 'extra', isMain: false, statLabel: 'extraOwned' },
        ],
      },
      cards: {
        base: [
          { id: 'b1', price: 100 },   // owned
          { id: 'b2', price: 50 },    // not owned
          { id: 'b3', noCard: true }, // excluded
        ],
        extra: [
          { id: 'e1', price: 25 },              // owned
          { id: 'e2', noCard: true, price: 80 },// excluded
        ],
      },
      ownedIds: ['b1', 'e1', 'e2'],
    });

    const stats = engine.computeStats();
    expect(stats.total).toBe(2);
    expect(stats.owned).toBe(1);
    expect(stats.ownedValue).toBe(125);
    expect(stats.neededValue).toBe(50);
    expect(stats.extraOwned).toBe(1);
    expect(stats.extraTotal).toBe(1);
  });
});

describe('_sectionProgress — noCard entries', () => {
  it('excludes noCard from section owned/total', () => {
    const engine = makeFlatEngine({
      config: { dataShape: 'flat' },
      cards: [],
      ownedIds: ['s1'],
    });

    const progress = engine._sectionProgress([
      { id: 's1' },
      { id: 's2' },
      { id: 's3', noCard: true },
    ]);
    expect(progress).toEqual({ owned: 1, total: 2 });
  });

  it('returns null when a section is entirely noCard', () => {
    const engine = makeFlatEngine({
      config: { dataShape: 'flat' },
      cards: [],
      ownedIds: [],
    });

    expect(engine._sectionProgress([{ id: 'x', noCard: true }])).toBe(null);
  });
});

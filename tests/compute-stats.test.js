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

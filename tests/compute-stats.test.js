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
});

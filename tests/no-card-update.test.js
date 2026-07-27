import { describe, it, expect } from 'vitest';

const ChecklistEngine = globalThis.ChecklistEngine;

function makeFlatEngine(cards) {
  const engine = Object.create(ChecklistEngine.prototype);
  engine.config = { dataShape: 'flat' };
  engine.cards = cards;
  engine.checklistManager = { getCardId: (c) => c.id };
  return engine;
}

function makeCategoryEngine(cardsByCategory) {
  const engine = Object.create(ChecklistEngine.prototype);
  engine.config = {
    dataShape: 'categories',
    categories: [{ id: 'base' }],
  };
  engine.cards = cardsByCategory;
  engine.checklistManager = { getCardId: (c) => c.id };
  return engine;
}

describe('_updateCard — noCard merge (flat)', () => {
  it('flags a normal card as noCard when the form data includes it', () => {
    const card = { id: 'n1', set: 'Prizm' };
    const engine = makeFlatEngine([card]);

    engine._updateCard('n1', { id: 'n1', set: 'Prizm', noCard: true });

    expect(card.noCard).toBe(true);
  });

  it('keeps noCard: false as a deletion marker for the gist merge', () => {
    const card = { id: 'n1', set: 'Prizm', noCard: true };
    const engine = makeFlatEngine([card]);

    engine._updateCard('n1', { id: 'n1', set: 'Prizm', noCard: false });

    expect(card.noCard).toBe(false);
  });
});

describe('_updateCard — noCard merge (categories)', () => {
  it('flags a normal card as noCard when the form data includes it', () => {
    const card = { id: 'n1', set: 'Prizm' };
    const engine = makeCategoryEngine({ base: [card] });

    engine._updateCard('n1', { id: 'n1', set: 'Prizm', category: 'base', noCard: true });

    expect(card.noCard).toBe(true);
  });

  it('keeps noCard: false as a deletion marker for the gist merge', () => {
    const card = { id: 'n1', set: 'Prizm', noCard: true };
    const engine = makeCategoryEngine({ base: [card] });

    engine._updateCard('n1', { id: 'n1', set: 'Prizm', category: 'base', noCard: false });

    expect(card.noCard).toBe(false);
  });
});

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

describe('_backfillNoCardIds — flat data', () => {
  it('gives two id-less no-card entries distinct ids', () => {
    const engine = makeEngine(flatConfig, [
      { player: 'Ariel Hukporti', noCard: true },
      { player: 'Robert Baker', noCard: true },
    ]);

    engine._backfillNoCardIds();

    const [first, second] = engine.cards;
    expect(first.id).toMatch(/^ncArielHukporti[a-z0-9]*$/);
    expect(second.id).toMatch(/^ncRobertBaker[a-z0-9]*$/);
    expect(first.id).not.toBe(second.id);
  });

  it('backfills the same input to the same id every time', () => {
    const makeCards = () => [{ player: 'Ariel Hukporti', noCard: true }];

    const first = makeEngine(flatConfig, makeCards());
    first._backfillNoCardIds();

    const second = makeEngine(flatConfig, makeCards());
    second._backfillNoCardIds();

    expect(first.cards[0].id).toBe(second.cards[0].id);
  });

  it('gives two nameless no-card entries distinct ids', () => {
    const engine = makeEngine(flatConfig, [
      { noCard: true },
      { noCard: true },
    ]);

    engine._backfillNoCardIds();

    expect(engine.cards[0].id).toBeTruthy();
    expect(engine.cards[1].id).toBeTruthy();
    expect(engine.cards[0].id).not.toBe(engine.cards[1].id);
  });

  it('does not collide with an id already in use', () => {
    const engine = makeEngine(flatConfig, [
      { player: 'Ariel Hukporti', noCard: true, id: 'ncArielHukporti1' },
      { player: 'Ariel Hukporti', noCard: true },
    ]);

    engine._backfillNoCardIds();

    expect(engine.cards[1].id).not.toBe('ncArielHukporti1');
  });

  it('leaves existing ids and ordinary cards alone', () => {
    const engine = makeEngine(flatConfig, [
      { player: 'Kept', noCard: true, id: 'ncKept' },
      { player: 'Real Card', set: 'Prizm', num: '12' },
    ]);

    engine._backfillNoCardIds();

    expect(engine.cards[0].id).toBe('ncKept');
    expect('id' in engine.cards[1]).toBe(false);
  });

  it('lets edit target the entry the user picked, not the first match', () => {
    const engine = makeEngine(flatConfig, [
      { player: 'Ariel Hukporti', noCard: true },
      { player: 'Robert Baker', noCard: true },
    ]);
    engine._backfillNoCardIds();

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
    engine._backfillNoCardIds();

    engine._removeCard(engine.cards[1].id);

    expect(engine.cards.map(c => c.player)).toEqual(['Ariel Hukporti']);
  });
});

describe('_backfillNoCardIds — category data', () => {
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

    engine._backfillNoCardIds();

    expect(engine.cards.main[0].id).toMatch(/^ncArielHukporti[a-z0-9]*$/);
    expect(engine.cards.extra[0].id).toMatch(/^ncRobertBaker[a-z0-9]*$/);
  });

  it('lets delete remove the entry the user picked', () => {
    const engine = makeEngine(config, {
      main: [
        { player: 'Ariel Hukporti', noCard: true },
        { player: 'Robert Baker', noCard: true },
      ],
    });
    engine._backfillNoCardIds();

    engine._removeCard(engine.cards.main[1].id);

    expect(engine.cards.main.map(c => c.player)).toEqual(['Ariel Hukporti']);
  });
});

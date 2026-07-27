import { describe, it, expect } from 'vitest';

const ChecklistEngine = globalThis.ChecklistEngine;

function makeEngine(config) {
  const engine = Object.create(ChecklistEngine.prototype);
  engine.config = config;
  engine.cards = [];
  engine._renderedCards = [];
  engine.checklistManager = {
    getCardId: (card) => card.id,
    isOwned: () => false,
    isReadOnly: false,
  };
  return engine;
}

describe('createCardElement — noCard entries', () => {
  const config = { dataShape: 'flat', cardDisplay: { showPlayerName: true } };

  it('renders the default badge and no owned checkbox', () => {
    const engine = makeEngine(config);
    const html = engine.createCardElement({
      id: 'n1', player: 'Ariel Hukporti', noCard: true,
    });

    expect(html).toContain('NO CARD');
    expect(html).toContain('no-card');
    expect(html).toContain('Ariel Hukporti');
    expect(html).not.toContain('type="checkbox"');
  });

  it('uses the configured noCardLabel', () => {
    const engine = makeEngine({ ...config, noCardLabel: 'DID NOT PLAY' });
    const html = engine.createCardElement({ id: 'n1', player: 'X', noCard: true });
    expect(html).toContain('DID NOT PLAY');
  });

  it('still renders search links', () => {
    const engine = makeEngine(config);
    const html = engine.createCardElement({ id: 'n1', player: 'X', noCard: true });
    expect(html).toContain('eBay');
  });

  it('renders as a no-card entry even when collectionLink is also set', () => {
    const engine = makeEngine(config);
    const html = engine.createCardElement({
      id: 'n1', player: 'X', noCard: true, collectionLink: 'checklist.html?id=other',
    });

    expect(html).toContain('no-card-badge');
    expect(html).not.toContain('collection-cta');
  });

  it('tolerates a non-string noCardLabel', () => {
    const engine = makeEngine({ ...config, noCardLabel: 123 });
    const html = engine.createCardElement({ id: 'n1', player: 'X', noCard: true });
    expect(html).toContain('123');
  });

  it('renders a normal card unchanged', () => {
    const engine = makeEngine(config);
    const html = engine.createCardElement({ id: 'n2', player: 'Y', set: 'Prizm' });
    expect(html).toContain('type="checkbox"');
    expect(html).not.toContain('no-card-badge');
  });
});

describe('_filterCard — noCard entries', () => {
  const engine = makeEngine({ dataShape: 'flat' });

  it('hides noCard from the owned filter', () => {
    expect(engine._filterCard({ id: 'n1', noCard: true }, 'owned', '', {})).toBe(false);
  });

  it('hides noCard from the need filter', () => {
    expect(engine._filterCard({ id: 'n1', noCard: true }, 'need', '', {})).toBe(false);
    expect(engine._filterCard({ id: 'n1', noCard: true }, 'needed', '', {})).toBe(false);
  });

  it('shows noCard under the all filter', () => {
    expect(engine._filterCard({ id: 'n1', noCard: true }, 'all', '', {})).toBe(true);
  });

  it('still matches text search', () => {
    const card = { id: 'n1', noCard: true, player: 'Hukporti' };
    expect(engine._filterCard(card, 'all', 'hukporti', {})).toBe(true);
    expect(engine._filterCard(card, 'all', 'zzz', {})).toBe(false);
  });
});

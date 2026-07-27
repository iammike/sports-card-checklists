import { describe, it, expect, afterEach } from 'vitest';

const ChecklistEngine = globalThis.ChecklistEngine;

function makeFlatEngine(cards) {
  const engine = Object.create(ChecklistEngine.prototype);
  engine.id = 'test';
  engine.config = { dataShape: 'flat' };
  engine.cards = cards;
  engine.checklistManager = { getCardId: (c) => c.id };
  return engine;
}

describe('_mergeCardArrays — noCard deletion marker', () => {
  it('strips noCard: false so the gist copy cannot resurrect the flag', () => {
    const engine = makeFlatEngine([]);
    const merged = engine._mergeCardArrays(
      [{ id: 'n1', set: 'Prizm', noCard: false }],
      [{ id: 'n1', set: 'Prizm', noCard: true }],
    );

    expect('noCard' in merged[0]).toBe(false);
  });

  it('keeps noCard: true from the local card', () => {
    const engine = makeFlatEngine([]);
    const merged = engine._mergeCardArrays(
      [{ id: 'n1', noCard: true }],
      [{ id: 'n1' }],
    );

    expect(merged[0].noCard).toBe(true);
  });

  it('does not add a noCard key to cards that never had one', () => {
    const engine = makeFlatEngine([]);
    const merged = engine._mergeCardArrays(
      [{ id: 'n1', set: 'Prizm' }],
      [{ id: 'n1', set: 'Prizm', price: 5 }],
    );

    expect('noCard' in merged[0]).toBe(false);
    expect(merged[0].price).toBe(5);
  });
});

describe('un-flagging through the full save merge path', () => {
  afterEach(() => {
    delete globalThis.githubSync;
  });

  it('does not resurrect noCard from the gist copy', async () => {
    // Gist still has the entry flagged; the user just un-checked "No card exists".
    globalThis.githubSync = {
      _gistCache: {},
      _publicGistCache: {},
      loadCardData: async () => ({ cards: [{ id: 'n1', set: 'Prizm', noCard: true }] }),
      loadPublicCardData: async () => null,
    };

    const engine = makeFlatEngine([{ id: 'n1', set: 'Prizm', noCard: true }]);
    engine._updateCard('n1', { id: 'n1', set: 'Prizm', noCard: false });

    await engine._mergeWithFreshGistData();

    expect(engine.cards[0].noCard).toBeFalsy();
    expect('noCard' in engine.cards[0]).toBe(false);
  });

  it('keeps a newly flagged entry flagged through the merge', async () => {
    globalThis.githubSync = {
      _gistCache: {},
      _publicGistCache: {},
      loadCardData: async () => ({ cards: [{ id: 'n1', set: 'Prizm' }] }),
      loadPublicCardData: async () => null,
    };

    const engine = makeFlatEngine([{ id: 'n1', set: 'Prizm' }]);
    engine._updateCard('n1', { id: 'n1', set: 'Prizm', noCard: true });

    await engine._mergeWithFreshGistData();

    expect(engine.cards[0].noCard).toBe(true);
  });
});

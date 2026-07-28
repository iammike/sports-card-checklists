import { describe, it, expect, afterEach, vi } from 'vitest';

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

  it('strips markers on an id-changing edit that has no fresh counterpart', () => {
    // Editing set/num changes the id derived from them, so the local card no
    // longer matches anything in the fresh gist copy - it takes the early
    // "no fresh counterpart" return path, which must get the same cleanup.
    const engine = makeFlatEngine([]);
    const merged = engine._mergeCardArrays(
      [{ id: 'local-new', set: 'Prizm', num: '13', noCard: false, img: '' }],
      [{ id: 'local-old', set: 'Prizm', num: '12', price: 5 }],
    );

    expect('noCard' in merged[0]).toBe(false);
    expect('img' in merged[0]).toBe(false);
    expect(merged[0].num).toBe('13');
  });
});

describe('un-flagging through the full save merge path', () => {
  afterEach(() => {
    delete globalThis.githubSync;
  });

  it('does not resurrect noCard from the gist copy', async () => {
    // Gist still has the entry flagged; the user just un-checked "No card exists".
    globalThis.githubSync = {
      clearGistCache: () => {},
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
      clearGistCache: () => {},
      loadCardData: async () => ({ cards: [{ id: 'n1', set: 'Prizm' }] }),
      loadPublicCardData: async () => null,
    };

    const engine = makeFlatEngine([{ id: 'n1', set: 'Prizm' }]);
    engine._updateCard('n1', { id: 'n1', set: 'Prizm', noCard: true });

    await engine._mergeWithFreshGistData();

    expect(engine.cards[0].noCard).toBe(true);
  });

  it('drops the gist cache before reading, so the merge sees fresh data', async () => {
    // The whole point of the merge is that the copy it reads is newer than
    // anything cached, so the order matters as much as the call.
    const clearGistCache = vi.fn();
    globalThis.githubSync = {
      clearGistCache,
      loadCardData: async () => {
        expect(clearGistCache).toHaveBeenCalled();
        return { cards: [] };
      },
      loadPublicCardData: async () => null,
    };

    await makeFlatEngine([{ id: 'n1', set: 'Prizm' }])._mergeWithFreshGistData();

    expect(clearGistCache).toHaveBeenCalledTimes(1);
  });
});

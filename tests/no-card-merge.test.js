import { describe, it, expect, afterEach, vi } from 'vitest';

const ChecklistEngine = globalThis.ChecklistEngine;

function makeFlatEngine(cards) {
  const engine = Object.create(ChecklistEngine.prototype);
  engine.id = 'test';
  engine.config = { dataShape: 'flat' };
  engine.cards = cards;
  engine.checklistManager = { getCardId: (c) => c.id };
  engine._lastFreshMergeAt = 0; // matches a freshly constructed engine (#733)
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

describe('the freshness-window skip (#733)', () => {
  afterEach(() => {
    delete globalThis.githubSync;
  });

  it('skips the gist refetch within the window, and leaves this.cards untouched', async () => {
    // Sentinels are only resolved into the write payload (_sentinelStrippedPayload,
    // called from _saveCardData) - never by mutating the live cards here, so an
    // unconfirmed write can't cost a marker its only chance at a later retry (#733).
    const loadCardData = vi.fn();
    globalThis.githubSync = {
      clearGistCache: vi.fn(),
      loadCardData,
      loadPublicCardData: async () => null,
    };

    const card = { id: 'n1', set: 'Prizm', noCard: false, img: '' };
    const engine = makeFlatEngine([card]);
    engine._lastFreshMergeAt = Date.now(); // just merged - inside the 30s window

    await engine._mergeWithFreshGistData();

    expect(loadCardData).not.toHaveBeenCalled();
    expect(engine.cards[0]).toBe(card); // same object, not a stripped copy
    expect(engine.cards[0].noCard).toBe(false);
    expect(engine.cards[0].img).toBe('');
  });

  it('does the full fetch+merge again once the window has elapsed', async () => {
    const loadCardData = vi.fn(async () => ({ cards: [{ id: 'n1', set: 'Prizm' }] }));
    globalThis.githubSync = { clearGistCache: vi.fn(), loadCardData, loadPublicCardData: async () => null };

    const engine = makeFlatEngine([{ id: 'n1', set: 'Prizm', price: 5 }]);
    engine._lastFreshMergeAt = Date.now() - 30001; // just past FRESH_MERGE_WINDOW_MS

    await engine._mergeWithFreshGistData();

    expect(loadCardData).toHaveBeenCalledTimes(1);
    expect(engine.cards[0].price).toBe(5); // local edit still wins the merge
  });

  it('does the full fetch+merge on a category-shaped checklist too', async () => {
    const loadCardData = vi.fn(async () => ({ categories: { base: [{ id: 'n1', set: 'Prizm' }] } }));
    globalThis.githubSync = { clearGistCache: vi.fn(), loadCardData, loadPublicCardData: async () => null };

    const engine = Object.create(ChecklistEngine.prototype);
    engine.id = 'test';
    engine.config = { dataShape: 'categories' };
    engine.cards = { base: [{ id: 'n1', set: 'Prizm', noCard: false }] };
    engine.checklistManager = { getCardId: (c) => c.id };
    engine._lastFreshMergeAt = 0;

    await engine._mergeWithFreshGistData();

    expect(loadCardData).toHaveBeenCalledTimes(1);
    expect('noCard' in engine.cards.base[0]).toBe(false);
  });

  it('_onBecameVisible resets the window so the next save re-fetches', () => {
    const engine = makeFlatEngine([]);
    engine._lastFreshMergeAt = Date.now();

    const originalGet = Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState');
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    try {
      engine._onBecameVisible();
    } finally {
      if (originalGet) Object.defineProperty(Document.prototype, 'visibilityState', originalGet);
      else delete document.visibilityState;
    }

    expect(engine._lastFreshMergeAt).toBe(0);
  });

  it('_onBecameVisible does nothing while the tab is hidden', () => {
    const engine = makeFlatEngine([]);
    const staleAt = Date.now() - 1000;
    engine._lastFreshMergeAt = staleAt;

    const originalGet = Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState');
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    try {
      engine._onBecameVisible();
    } finally {
      if (originalGet) Object.defineProperty(Document.prototype, 'visibilityState', originalGet);
      else delete document.visibilityState;
    }

    expect(engine._lastFreshMergeAt).toBe(staleAt);
  });
});

// Every early exit from _mergeWithFreshGistData - not just the freshness-window
// skip - leaves this.cards exactly as it found it, including any local-only
// sentinels. Resolving those into real deletions only happens for the write
// payload (_sentinelStrippedPayload, called from _saveCardData), specifically so
// an unconfirmed write can't cost this.cards its only copy of a marker (#733).
describe('this.cards is left untouched on every _mergeWithFreshGistData fallback exit (#733)', () => {
  afterEach(() => {
    delete globalThis.githubSync;
  });

  it('leaves markers alone when the gist has no card data for this checklist yet', async () => {
    globalThis.githubSync = {
      clearGistCache: vi.fn(),
      loadCardData: async () => null,
      loadPublicCardData: async () => null,
    };

    const card = { id: 'n1', set: 'Prizm', noCard: false, img: '' };
    const engine = makeFlatEngine([card]);
    await engine._mergeWithFreshGistData();

    expect(engine.cards[0]).toBe(card);
    expect(engine.cards[0].noCard).toBe(false);
    expect(engine.cards[0].img).toBe('');
  });

  it('leaves markers alone when the fetched gist data has no cards/categories key', async () => {
    globalThis.githubSync = {
      clearGistCache: vi.fn(),
      loadCardData: async () => ({}), // truthy response, but no `cards` key
      loadPublicCardData: async () => null,
    };

    const card = { id: 'n1', set: 'Prizm', noCard: false };
    const engine = makeFlatEngine([card]);
    await engine._mergeWithFreshGistData();

    expect(engine.cards[0]).toBe(card);
    expect(engine.cards[0].noCard).toBe(false);
  });

  it('leaves markers alone when the fetch throws', async () => {
    globalThis.githubSync = {
      clearGistCache: vi.fn(),
      loadCardData: async () => { throw new Error('network'); },
      loadPublicCardData: async () => null,
    };

    const card = { id: 'n1', set: 'Prizm', img: '' };
    const engine = makeFlatEngine([card]);
    await engine._mergeWithFreshGistData();

    expect(engine.cards[0]).toBe(card);
    expect(engine.cards[0].img).toBe('');
  });

  it('leaves a category missing from the fresh copy untouched, and merges the rest normally', async () => {
    globalThis.githubSync = {
      clearGistCache: vi.fn(),
      loadCardData: async () => ({ categories: { base: [{ id: 'n1', set: 'Prizm', price: 9 }] } }), // no "inserts" key
      loadPublicCardData: async () => null,
    };

    const insertCard = { id: 'n2', set: 'Optic', noCard: false };
    const engine = Object.create(ChecklistEngine.prototype);
    engine.id = 'test';
    engine.config = { dataShape: 'categories' };
    engine.cards = {
      base: [{ id: 'n1', set: 'Prizm', price: 5 }],
      inserts: [insertCard],
    };
    engine.checklistManager = { getCardId: (c) => c.id };
    engine._lastFreshMergeAt = 0;

    await engine._mergeWithFreshGistData();

    expect(engine.cards.base[0].price).toBe(5); // merged normally against the fresh copy
    expect(engine.cards.inserts[0]).toBe(insertCard); // no fresh data for this category - untouched
    expect(engine.cards.inserts[0].noCard).toBe(false);
  });
});

// _sentinelStrippedPayload is the only place img: ''/noCard: false get resolved
// into real deletions - as a copy for the write payload, never by mutating the
// card it read from (see the tests above and _saveCardData's comment for why).
describe('_sentinelStrippedPayload (#733)', () => {
  it('resolves img: "" into a real deletion in the copy, without touching the source card', () => {
    const card = { id: 'n1', set: 'Prizm', img: '' };
    const engine = makeFlatEngine([card]);

    const payload = engine._sentinelStrippedPayload(engine.cards);

    expect('img' in payload[0]).toBe(false);
    expect(card.img).toBe(''); // source untouched
  });

  it('resolves noCard: false into a real deletion in the copy, without touching the source card', () => {
    const card = { id: 'n1', set: 'Prizm', noCard: false };
    const engine = makeFlatEngine([card]);

    const payload = engine._sentinelStrippedPayload(engine.cards);

    expect('noCard' in payload[0]).toBe(false);
    expect(card.noCard).toBe(false); // source untouched
  });

  it('returns the same object reference for a card with neither sentinel set', () => {
    const card = { id: 'n1', set: 'Prizm', price: 5 };
    const engine = makeFlatEngine([card]);

    const payload = engine._sentinelStrippedPayload(engine.cards);

    expect(payload[0]).toBe(card);
  });
});

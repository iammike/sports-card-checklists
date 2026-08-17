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

  it('skips the gist refetch within the window, but still strips local-only markers', async () => {
    const loadCardData = vi.fn();
    globalThis.githubSync = {
      clearGistCache: vi.fn(),
      loadCardData,
      loadPublicCardData: async () => null,
    };

    const engine = makeFlatEngine([{ id: 'n1', set: 'Prizm', noCard: false, img: '' }]);
    engine._lastFreshMergeAt = Date.now(); // just merged - inside the 30s window

    await engine._mergeWithFreshGistData();

    expect(loadCardData).not.toHaveBeenCalled();
    expect('noCard' in engine.cards[0]).toBe(false);
    expect('img' in engine.cards[0]).toBe(false);
    expect(engine.cards[0].set).toBe('Prizm');
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
// skip - was writing raw local-only markers verbatim, since only a completed
// merge ran _mergeCardArrays (the only place that stripped them). Fixed by class
// per CLAUDE.md rather than only at the freshness-window site that was found first.
describe('marker stripping on every _mergeWithFreshGistData exit path (#733)', () => {
  afterEach(() => {
    delete globalThis.githubSync;
  });

  it('strips markers when the gist has no card data for this checklist yet', async () => {
    globalThis.githubSync = {
      clearGistCache: vi.fn(),
      loadCardData: async () => null,
      loadPublicCardData: async () => null,
    };

    const engine = makeFlatEngine([{ id: 'n1', set: 'Prizm', noCard: false, img: '' }]);
    await engine._mergeWithFreshGistData();

    expect('noCard' in engine.cards[0]).toBe(false);
    expect('img' in engine.cards[0]).toBe(false);
  });

  it('strips markers when the fetched gist data has no cards/categories key', async () => {
    globalThis.githubSync = {
      clearGistCache: vi.fn(),
      loadCardData: async () => ({}), // truthy response, but no `cards` key
      loadPublicCardData: async () => null,
    };

    const engine = makeFlatEngine([{ id: 'n1', set: 'Prizm', noCard: false }]);
    await engine._mergeWithFreshGistData();

    expect('noCard' in engine.cards[0]).toBe(false);
  });

  it('strips markers when the fetch throws', async () => {
    globalThis.githubSync = {
      clearGistCache: vi.fn(),
      loadCardData: async () => { throw new Error('network'); },
      loadPublicCardData: async () => null,
    };

    const engine = makeFlatEngine([{ id: 'n1', set: 'Prizm', img: '' }]);
    await engine._mergeWithFreshGistData();

    expect('img' in engine.cards[0]).toBe(false);
  });

  it('strips markers for just the category missing from the fresh copy, and merges the rest normally', async () => {
    globalThis.githubSync = {
      clearGistCache: vi.fn(),
      loadCardData: async () => ({ categories: { base: [{ id: 'n1', set: 'Prizm', price: 9 }] } }), // no "inserts" key
      loadPublicCardData: async () => null,
    };

    const engine = Object.create(ChecklistEngine.prototype);
    engine.id = 'test';
    engine.config = { dataShape: 'categories' };
    engine.cards = {
      base: [{ id: 'n1', set: 'Prizm', price: 5 }],
      inserts: [{ id: 'n2', set: 'Optic', noCard: false }],
    };
    engine.checklistManager = { getCardId: (c) => c.id };
    engine._lastFreshMergeAt = 0;

    await engine._mergeWithFreshGistData();

    expect(engine.cards.base[0].price).toBe(5); // merged normally against the fresh copy
    expect('noCard' in engine.cards.inserts[0]).toBe(false); // stripped, not skipped
  });
});

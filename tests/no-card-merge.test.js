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
  it('keeps noCard: false so the gist copy cannot resurrect the flag, without dropping the marker (#735)', () => {
    const engine = makeFlatEngine([]);
    const merged = engine._mergeCardArrays(
      [{ id: 'n1', set: 'Prizm', noCard: false }],
      [{ id: 'n1', set: 'Prizm', noCard: true }],
    );

    // Not resurrected as true - and kept as false, not deleted outright, so
    // this.cards (what `merged` becomes) still has something for a failed
    // write to retry with. _sentinelStrippedPayload is what actually drops it
    // for the gist.
    expect(merged[0].noCard).toBe(false);
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

  it('keeps markers alive on an id-changing edit that has no fresh counterpart', () => {
    // Editing set/num changes the id derived from them, so the local card no
    // longer matches anything in the fresh gist copy - it takes the early
    // "no fresh counterpart" return path, which must get the same treatment.
    const engine = makeFlatEngine([]);
    const merged = engine._mergeCardArrays(
      [{ id: 'local-new', set: 'Prizm', num: '13', noCard: false, img: '' }],
      [{ id: 'local-old', set: 'Prizm', num: '12', price: 5 }],
    );

    expect(merged[0].noCard).toBe(false);
    expect(merged[0].img).toBe('');
    expect(merged[0].num).toBe('13');
  });
});

// The exact repro from #735: a merge completes and consumes the marker, then
// this same save's write fails (or never happens, as here - the point is the
// gist is never actually updated), so a *second* merge runs against fresh data
// that still has the old value. Before the fix, this brought the old image
// back after exactly two merges.
describe('a completed merge survives an unconfirmed write (#735 repro)', () => {
  afterEach(() => {
    delete globalThis.githubSync;
  });

  it('does not let the old image resurface on a second merge after the first merge already ran', async () => {
    // The gist is never actually updated between the two merges below - that's
    // standing in for "the write that was supposed to persist merge #1's
    // result failed," since what matters here is only what the *next* merge
    // sees, not how the intervening write happened to fail.
    globalThis.githubSync = {
      clearGistCache: () => {},
      loadCardData: async () => ({ cards: [{ id: 'n1', set: 'Prizm', img: 'https://old.png' }] }),
      loadPublicCardData: async () => null,
    };

    const engine = makeFlatEngine([{ id: 'n1', set: 'Prizm', img: 'https://old.png' }]);
    engine._updateCard('n1', { id: 'n1', set: 'Prizm', img: '' });

    await engine._mergeWithFreshGistData(); // merge #1
    expect(engine.cards[0].img).toBe('');

    engine._lastFreshMergeAt = 0; // force a real fetch+merge again, as a retried save would
    await engine._mergeWithFreshGistData(); // merge #2 - the bug surfaced here before the fix

    expect(engine.cards[0].img).toBe('');
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

    // Not resurrected as true. The key stays present as false rather than
    // being deleted outright, so this.cards still carries something for a
    // failed write to retry with (#735) - _sentinelStrippedPayload is what
    // actually drops it for the gist.
    expect(engine.cards[0].noCard).toBe(false);
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
    expect(engine.cards.base[0].noCard).toBe(false);
  });

  it('_onBecameVisible resets the window so the next save re-fetches', () => {
    const engine = makeFlatEngine([]);
    engine._lastFreshMergeAt = Date.now();

    // Defines an own property on the instance (document), which shadows whatever
    // the prototype has - so cleanup deletes that same own property, not the
    // prototype descriptor, or the override leaks into every later test (caught
    // by review).
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    try {
      engine._onBecameVisible();
    } finally {
      delete document.visibilityState;
    }

    expect(engine._lastFreshMergeAt).toBe(0);
  });

  it('_onBecameVisible does nothing while the tab is hidden', () => {
    const engine = makeFlatEngine([]);
    const staleAt = Date.now() - 1000;
    engine._lastFreshMergeAt = staleAt;

    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    try {
      engine._onBecameVisible();
    } finally {
      delete document.visibilityState;
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

// _sentinelStrippedPayload resolves img: ''/noCard: false into real deletions as
// a copy for the write payload, without mutating the card it read from (see the
// tests above and _saveCardData's comment for why). It does not need to touch
// _clearedKeys or the fields it names: those are deleted directly from the live
// card the moment the edit happens (_clearEmptyFields), independent of any
// merge, so the payload already excludes them the same way it would without a
// marker at all. The marker's only job is telling a *future* merge to repeat
// that deletion if the fresh copy it merges against still has the old value -
// see _stripLocalOnlyMarkers (#735).
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

  it('always returns a copy, even for a card with neither sentinel set', () => {
    // _saveCardData retries with this same payload on a transient failure - a
    // card object it's still holding a reference to must never be one a
    // concurrent edit can go on mutating underneath it.
    const card = { id: 'n1', set: 'Prizm', price: 5 };
    const engine = makeFlatEngine([card]);

    const payload = engine._sentinelStrippedPayload(engine.cards);

    expect(payload[0]).not.toBe(card);
    expect(payload[0]).toEqual(card);
  });

  it('passes through a non-array category rather than throwing', () => {
    const engine = makeFlatEngine([]);
    expect(engine._sentinelStrippedPayload(null)).toBe(null);
  });
});

// The round-2 bug (raw img: ''/noCard: false reaching the gist) is only actually
// guarded against if the object _saveCardData hands to githubSync.saveCardData
// has them resolved - assert on that object directly rather than on
// _sentinelStrippedPayload in isolation, per CLAUDE.md's testing guidance.
describe('the payload _saveCardData actually submits (#733)', () => {
  afterEach(() => {
    delete globalThis.githubSync;
  });

  function stubGithubSync(saveCardData) {
    globalThis.githubSync = {
      clearGistCache: () => {},
      loadCardData: async () => null,
      loadPublicCardData: async () => null,
      saveCardData,
    };
  }

  it('strips sentinels from a flat checklist payload, then releases them from this.cards once the write lands (#735)', async () => {
    const saveCardData = vi.fn(async () => ({ ok: true }));
    stubGithubSync(saveCardData);

    const engine = makeFlatEngine([{ id: 'n1', set: 'Prizm', img: '', noCard: false }]);
    engine.cardData = { cards: [] };
    engine.checklistManager = { setSyncStatus: () => {} };
    engine.computeStats = () => ({});

    await engine._saveCardData();

    const [, submittedCardData] = saveCardData.mock.calls[0];
    expect('img' in submittedCardData.cards[0]).toBe(false);
    expect('noCard' in submittedCardData.cards[0]).toBe(false);
    // A successful write is what finally resolves the marker for good - a
    // live '' surviving indefinitely would make every future merge keep
    // stripping img from the fresh gist copy, even after another client adds
    // a real one post-write.
    expect('img' in engine.cards[0]).toBe(false);
    expect('noCard' in engine.cards[0]).toBe(false);
  });

  it('strips sentinels from every category in a category-shaped checklist payload, then releases them too', async () => {
    const saveCardData = vi.fn(async () => ({ ok: true }));
    stubGithubSync(saveCardData);

    const engine = Object.create(ChecklistEngine.prototype);
    engine.id = 'test';
    engine.config = { dataShape: 'categories' };
    engine.cards = {
      base: [{ id: 'n1', set: 'Prizm', img: '' }],
      inserts: [{ id: 'n2', set: 'Optic', noCard: false }],
    };
    engine.checklistManager = { getCardId: (c) => c.id, setSyncStatus: () => {} };
    engine.cardData = { categories: {} };
    engine.computeStats = () => ({});

    await engine._saveCardData();

    const [, submittedCardData] = saveCardData.mock.calls[0];
    expect('img' in submittedCardData.categories.base[0]).toBe(false);
    expect('noCard' in submittedCardData.categories.inserts[0]).toBe(false);
    expect('img' in engine.cards.base[0]).toBe(false);
    expect('noCard' in engine.cards.inserts[0]).toBe(false);
  });

  it('leaves the marker on this.cards when the write fails, unlike the successful case above', async () => {
    const saveCardData = vi.fn(async () => ({ ok: false, reason: 'network_error' }));
    stubGithubSync(saveCardData);

    const engine = makeFlatEngine([{ id: 'n1', set: 'Prizm', img: '' }]);
    engine.cardData = { cards: [] };
    engine.checklistManager = { setSyncStatus: () => {} };
    engine.computeStats = () => ({});

    await engine._saveCardData();

    expect(saveCardData).toHaveBeenCalledTimes(2); // the automatic retry also failed
    expect(engine.cards[0].img).toBe(''); // marker survives for the next save to retry
  });

  it('produces a clean payload even when a real merge (not just the no-merge fallback) runs first', async () => {
    // Every other test in this describe block stubs loadCardData to return
    // null, so _mergeWithFreshGistData bails before _mergeCardArrays ever
    // runs - that only proves the no-merge fallback path (#733). This is the
    // path #735 actually changed: a merge completes, _stripLocalOnlyMarkers
    // keeps the marker alive on the merged result, and the payload built from
    // that result still has to come out clean.
    const saveCardData = vi.fn(async () => ({ ok: true }));
    globalThis.githubSync = {
      clearGistCache: () => {},
      loadCardData: async () => ({ cards: [{ id: 'n1', set: 'Prizm', img: 'https://old.png' }] }),
      loadPublicCardData: async () => null,
      saveCardData,
    };

    const engine = makeFlatEngine([{ id: 'n1', set: 'Prizm', img: '' }]);
    engine.cardData = { cards: [] };
    engine.checklistManager = { setSyncStatus: () => {} };
    engine.computeStats = () => ({});

    await engine._saveCardData();

    const [, submittedCardData] = saveCardData.mock.calls[0];
    expect('img' in submittedCardData.cards[0]).toBe(false); // not resurrected, not leaked into the payload
    expect('img' in engine.cards[0]).toBe(false); // and released now that the write landed
  });
});

// Exercises _captureMarkerReleases/_releaseClearedKeys directly rather than
// through the full async _saveCardData flow: the scenario is specifically
// about *when* a release runs relative to a concurrent edit, and racing real
// promises to land a synchronous mutation at the right microtask is exactly
// the kind of timing assumption that makes a test flaky without actually
// proving anything an explicit two-step capture-then-mutate-then-release
// doesn't already prove more directly.
describe('a marker release only drops what it captured, not whatever is there when it runs (#735 follow-up)', () => {
  it('leaves a key an in-flight edit adds after capture untouched', () => {
    const engine = makeFlatEngine([]);
    const card = { id: 'n1', set: 'Prizm', num: '10' };
    Object.defineProperty(card, '_clearedKeys', {
      value: ['patch'], enumerable: false, writable: true, configurable: true,
    });

    const releases = engine._captureMarkerReleases([card]); // snapshots ['patch']

    // A second, unrelated edit clears 'serial' while this write would still be
    // in flight - mirrors what _recordClearedKeys's carry-forward does to the
    // live array once a key is missing from the card but not yet in `cleared`.
    Object.defineProperty(card, '_clearedKeys', {
      value: ['serial', 'patch'], enumerable: false, writable: true, configurable: true,
    });

    releases.forEach(release => release()); // the original write "lands"

    expect(card._clearedKeys).toEqual(['serial']); // patch released, serial untouched
  });

  it('leaves img alone if a later edit restored it before release runs', () => {
    const engine = makeFlatEngine([]);
    const card = { id: 'n1', set: 'Prizm', img: '' };

    const releases = engine._captureMarkerReleases([card]);
    card.img = 'https://new.png'; // user re-added an image before the write confirmed

    releases.forEach(release => release());

    expect(card.img).toBe('https://new.png'); // not clobbered back to deleted
  });
});

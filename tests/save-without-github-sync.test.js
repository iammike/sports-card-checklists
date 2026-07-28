import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// The save path's counterpart to the read-path guards in
// collection-link-suggestions.test.js. Every githubSync reference in
// _saveCardData and _mergeWithFreshGistData is a bare identifier, so without a
// guard an absent module is a ReferenceError, not a quiet undefined.
//
// setup.js does load github-sync.js, so window.githubSync starts out real. These
// tests delete it and assert it is genuinely gone before calling - nothing here is
// stubbed to look absent.

const ChecklistEngine = globalThis.ChecklistEngine;

let realSync;
let warn;

function makeEngine(cards = [{ id: 'n1', set: 'Prizm' }]) {
    const engine = Object.create(ChecklistEngine.prototype);
    engine.id = 'test';
    engine.config = { dataShape: 'flat' };
    engine.cards = cards;
    engine.cardData = {};
    // Complete enough for computeStats() to run: without it, removing the guard
    // under test fails these tests on a missing stub method rather than on the
    // ReferenceError the guard exists to prevent.
    engine.checklistManager = {
        setSyncStatus: vi.fn(),
        getCardId: (c) => c.id,
        isOwned: () => false,
    };
    return engine;
}

beforeEach(() => {
    realSync = window.githubSync;
    delete window.githubSync;
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
    warn.mockRestore();
    window.githubSync = realSync;
    document.body.innerHTML = '';
});

describe('_saveCardData when the sync module was never loaded', () => {
    it('reports a failed save instead of throwing', async () => {
        expect(typeof globalThis.githubSync).toBe('undefined');
        const engine = makeEngine();

        // Callers ignore the return value, but the contract is a boolean, not the
        // { ok, reason } that githubSync.saveCardData hands back.
        await expect(engine._saveCardData()).resolves.toBe(false);
    });

    it('tells the user, rather than leaving the status on "Saving..."', async () => {
        expect(typeof globalThis.githubSync).toBe('undefined');
        const engine = makeEngine();

        await engine._saveCardData();

        expect(engine.checklistManager.setSyncStatus).toHaveBeenCalledWith('error', 'Save failed');
        const banners = document.querySelectorAll('.save-error-banner');
        expect(banners.length).toBe(1);
        expect(banners[0].textContent).toContain('still in memory');
    });

    it('leaves the in-memory cards untouched', async () => {
        expect(typeof globalThis.githubSync).toBe('undefined');
        const engine = makeEngine([{ id: 'n1', set: 'Prizm' }]);

        await engine._saveCardData();

        expect(engine.cards).toEqual([{ id: 'n1', set: 'Prizm' }]);
        expect(engine.cardData).toEqual({});
    });
});

describe('_mergeWithFreshGistData when the sync module was never loaded', () => {
    it('returns before the try, so the failure is not swallowed as a warning', async () => {
        // The distinguishing assertion. This function's catch only console.warns and
        // then lets the save proceed with local data - exactly the overwrite of
        // external changes the merge exists to prevent (#560). A guard placed inside
        // the try, or no guard at all, still "passes" a does-not-throw check.
        expect(typeof globalThis.githubSync).toBe('undefined');
        const engine = makeEngine();

        await expect(engine._mergeWithFreshGistData()).resolves.toBeUndefined();

        expect(warn).not.toHaveBeenCalled();
    });

    it('leaves the local cards alone', async () => {
        expect(typeof globalThis.githubSync).toBe('undefined');
        const engine = makeEngine([{ id: 'n1', set: 'Prizm', price: 25 }]);

        await engine._mergeWithFreshGistData();

        expect(engine.cards).toEqual([{ id: 'n1', set: 'Prizm', price: 25 }]);
    });
});

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';

// #767: a gist write that *throws* rather than returning false used to vanish.
// _syncOwnedNow is fired from a bare setTimeout, so the rejection was unhandled
// and the status chip stayed on "Syncing..." forever - a dead session looked
// exactly like a working one. And because _patchGist assigned the rejectable
// promise straight back to _saveQueue, that one throw short-circuited every
// later .then() in the queue, silently killing all writes for the session.

const PERSONAL_GIST = 'personal-gist-id';

let sync;
beforeAll(() => {
    sync = globalThis.window.githubSync;
});

describe('GitHubSync._patchGist — one rejection must not kill the write queue (#767)', () => {
    beforeEach(() => {
        sync.token = 'tok';
        sync.gistId = PERSONAL_GIST;
        sync._saveQueue = Promise.resolve();
        sync._lastWriteAt = 0;
    });

    afterEach(() => {
        sync.token = null;
        sync.gistId = null;
        sync._saveQueue = Promise.resolve();
    });

    it('runs a later write after an earlier one throws', async () => {
        // A rejected _saveQueue would make every later .then() short-circuit, so
        // the second fn would never be called at all.
        await expect(sync._patchGist(async () => { throw new Error('boom'); })).rejects.toThrow('boom');

        const later = vi.fn(async () => ({ done: true, value: 'ok' }));
        expect(await sync._patchGist(later)).toBe('ok');
        expect(later).toHaveBeenCalledTimes(1);
    });
});

describe('ChecklistManager._syncOwnedNow — a throw must reach the status chip (#767)', () => {
    const ChecklistManager = globalThis.ChecklistManager;
    let realGithubSync;
    let chip;

    beforeEach(() => {
        realGithubSync = window.githubSync;
        localStorage.clear();
        chip = document.createElement('span');
        chip.id = 'sync-status';
        document.body.appendChild(chip);
        vi.useFakeTimers();
    });

    afterEach(() => {
        window.githubSync = realGithubSync;
        chip.remove();
        vi.useRealTimers();
    });

    it('shows "Sync failed" when saveChecklist rejects, not a stuck "Syncing..."', async () => {
        window.githubSync = {
            isLoggedIn: () => true,
            saveChecklist: async () => { throw new Error('session gone'); },
        };
        const manager = new ChecklistManager({ checklistId: 'jd' });

        manager.toggleOwned('a', true);
        expect(chip.textContent).toBe('Syncing...');

        await vi.advanceTimersByTimeAsync(1500);

        expect(chip.textContent).toBe('Sync failed');
        expect(chip.className).toContain('error');
    });

    it('shows "Sync failed" when the stats callback itself throws', async () => {
        window.githubSync = { isLoggedIn: () => true, saveChecklist: async () => true };
        const manager = new ChecklistManager({
            checklistId: 'jd',
            getStats: () => { throw new Error('bad card'); },
        });

        manager.toggleOwned('a', true);
        await vi.advanceTimersByTimeAsync(1500);

        expect(chip.textContent).toBe('Sync failed');
    });

    it('still reports success normally', async () => {
        window.githubSync = { isLoggedIn: () => true, saveChecklist: async () => true };
        const manager = new ChecklistManager({ checklistId: 'jd' });

        manager.toggleOwned('a', true);
        await vi.advanceTimersByTimeAsync(1500);

        expect(chip.textContent).toBe('Synced');
    });
});

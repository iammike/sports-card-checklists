import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const ChecklistManager = globalThis.ChecklistManager;

// #734: toggleOwned() calls saveOwned() un-awaited on every checkbox click, and
// that write goes through _patchGist's serialized, ~1s-spaced queue (#733) - a
// streak of N quick toggles was N separate gist PATCHes instead of one write of
// the final state. saveOwned() now debounces the network sync (localStorage
// stays immediate) so a streak collapses into a single write.
describe('ChecklistManager — owned-toggle write debouncing', () => {
    let realGithubSync;

    beforeEach(() => {
        realGithubSync = window.githubSync;
        localStorage.clear();
        vi.useFakeTimers();
    });

    afterEach(() => {
        window.githubSync = realGithubSync;
        vi.useRealTimers();
    });

    function makeManager(saveChecklist, overrides = {}) {
        window.githubSync = { isLoggedIn: () => true, saveChecklist };
        return new ChecklistManager({ checklistId: 'test', ...overrides });
    }

    it('coalesces a rapid streak of toggles into a single write of the final state', async () => {
        const saveChecklist = vi.fn(async () => true);
        const manager = makeManager(saveChecklist);

        manager.toggleOwned('a', true);
        manager.toggleOwned('b', true);
        manager.toggleOwned('c', true);

        expect(saveChecklist).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(1500);

        expect(saveChecklist).toHaveBeenCalledTimes(1);
        expect(saveChecklist).toHaveBeenCalledWith('test', ['a', 'b', 'c'], null);
    });

    it('resets the debounce window on every new toggle rather than firing on the first', async () => {
        const saveChecklist = vi.fn(async () => true);
        const manager = makeManager(saveChecklist);

        manager.toggleOwned('a', true);
        await vi.advanceTimersByTimeAsync(1000); // inside the window, no write yet
        manager.toggleOwned('b', true); // should push the write out to a fresh window

        await vi.advanceTimersByTimeAsync(1000); // still short of a full window from the 2nd toggle
        expect(saveChecklist).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(500);
        expect(saveChecklist).toHaveBeenCalledTimes(1);
        expect(saveChecklist).toHaveBeenCalledWith('test', ['a', 'b'], null);
    });

    it('writes to localStorage immediately on every toggle, independent of the network debounce', () => {
        const saveChecklist = vi.fn(async () => true);
        const manager = makeManager(saveChecklist, { localStorageKey: 'test-owned-key' });

        manager.toggleOwned('a', true);

        expect(JSON.parse(localStorage.getItem('test-owned-key'))).toEqual(['a']);
        expect(saveChecklist).not.toHaveBeenCalled();
    });

    it('does not schedule a network write when the user is not logged in', async () => {
        const saveChecklist = vi.fn(async () => true);
        window.githubSync = { isLoggedIn: () => false, saveChecklist };
        const manager = new ChecklistManager({ checklistId: 'test' });

        manager.toggleOwned('a', true);
        await vi.advanceTimersByTimeAsync(5000);

        expect(saveChecklist).not.toHaveBeenCalled();
    });

    it('shows syncing status immediately even though the write is deferred', () => {
        document.body.innerHTML = '<div id="sync-status"></div>';
        const saveChecklist = vi.fn(async () => true);
        const manager = makeManager(saveChecklist);

        manager.toggleOwned('a', true);

        expect(document.getElementById('sync-status').textContent).toBe('Syncing...');
        expect(saveChecklist).not.toHaveBeenCalled();
    });
});

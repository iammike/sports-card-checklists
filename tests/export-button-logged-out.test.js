import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const ChecklistEngine = globalThis.ChecklistEngine;
const ChecklistManager = globalThis.ChecklistManager;

// Logged out, AuthUI.update() renders nothing into #auth-content (nav.js), so
// there is no dropdown and therefore no Shopping List entry - the export was
// unreachable for every visitor who wasn't signed in, even though nothing in
// ShoppingList needs a token. The filter row is where it lives for them.
//
// Harness mirrors tests/price-range-and-quick-filters.test.js: a real engine and
// a real _renderFilters() DOM render, so these assert the markup a visitor
// actually gets rather than a hand-built approximation of it.
function makeEngine() {
    const engine = Object.create(ChecklistEngine.prototype);
    engine.id = 'test';
    engine.config = {
        dataShape: 'flat',
        customFields: {},
        cardDisplay: {},
        sortOptions: ['default'],
        customFilters: [],
    };
    engine.cards = [{ set: 'A', num: '1' }];
    engine._renderedCards = [];
    engine._reorderMode = false;
    engine.updateStats = vi.fn();
    engine.checklistManager = new ChecklistManager({ checklistId: 'test' });
    engine.checklistManager.ownedCards = [];
    engine.checklistManager.isReadOnly = false;
    return engine;
}

// _renderFilters() ends in _updateReorderButton(), which reaches isOwner() ->
// getUser(), so both are needed for the render to complete either way.
const loggedOut = () => ({ isLoggedIn: () => false, getUser: () => null });
const loggedIn = () => ({ isLoggedIn: () => true, getUser: () => ({ login: 'someone-else' }) });

describe('Shopping List button in the filter row', () => {
    let realGithubSync;
    let realShoppingList;

    beforeEach(() => {
        document.body.innerHTML = '<div id="filters-container"></div><div id="sections-container"></div>';
        realGithubSync = window.githubSync;
        realShoppingList = window.ShoppingList;
    });

    afterEach(() => {
        window.githubSync = realGithubSync;
        window.ShoppingList = realShoppingList;
    });

    it('renders for a logged-out visitor, who has no nav dropdown to reach it from', () => {
        window.githubSync = loggedOut();

        makeEngine()._renderFilters();

        expect(document.getElementById('shopping-list-filter-btn')).not.toBeNull();
    });

    it('does not render when signed in - the nav dropdown already carries it', () => {
        window.githubSync = loggedIn();

        makeEngine()._renderFilters();

        // #reorder-btn proves the row rendered at all, so the absence below is a
        // real absence and not an empty container passing vacuously.
        expect(document.getElementById('reorder-btn')).not.toBeNull();
        expect(document.getElementById('shopping-list-filter-btn')).toBeNull();
    });

    it('exports this checklist directly, without the options modal', async () => {
        window.githubSync = loggedOut();
        const generate = vi.fn(async () => {});
        const showOptionsModal = vi.fn();
        window.ShoppingList = { generate, showOptionsModal };

        const engine = makeEngine();
        engine._renderFilters();
        await engine._exportShoppingList(document.getElementById('shopping-list-filter-btn'));

        expect(showOptionsModal).not.toHaveBeenCalled();
        expect(generate).toHaveBeenCalledTimes(1);
        const opts = generate.mock.calls[0][0];
        expect([...opts.selectedChecklists]).toEqual(['test']);
        // No options: generate() defaults both to false, so passing them would
        // only be a chance to pass the wrong thing.
        expect(opts.includeExtra).toBeUndefined();
        expect(opts.groupByChecklist).toBeUndefined();
    });

    it('labels the button Export PDF', () => {
        window.githubSync = loggedOut();

        makeEngine()._renderFilters();

        expect(document.getElementById('shopping-list-filter-btn').textContent).toBe('Export PDF');
    });

    it('re-enables the button after a failed export', async () => {
        window.githubSync = loggedOut();
        window.ShoppingList = { generate: async () => { throw new Error('boom'); } };
        const realAlert = globalThis.alert;
        globalThis.alert = () => {};

        const engine = makeEngine();
        engine._renderFilters();
        const btn = document.getElementById('shopping-list-filter-btn');
        await engine._exportShoppingList(btn);

        globalThis.alert = realAlert;
        expect(btn.disabled).toBe(false);
        expect(btn.textContent).toBe('Export PDF');
    });

    it('is omitted when the ShoppingList module is absent, rather than rendering a dead button', () => {
        window.githubSync = loggedOut();
        window.ShoppingList = undefined;

        makeEngine()._renderFilters();

        expect(document.getElementById('reorder-btn')).not.toBeNull();
        expect(document.getElementById('shopping-list-filter-btn')).toBeNull();
    });
});

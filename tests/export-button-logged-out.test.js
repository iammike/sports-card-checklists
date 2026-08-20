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

// The click handler is async and the listener discards its promise, so tests have
// to let the microtask queue drain before asserting on what happened after it.
const flush = () => new Promise(r => setTimeout(r, 0));
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

    // Driven by a real click, not by calling the method: the click binding is the
    // thing this behaviour lives in, and invoking _exportShoppingList by hand
    // leaves a full revert to showOptionsModal passing green.
    it('exports this checklist directly when clicked, without the options modal', async () => {
        window.githubSync = loggedOut();
        const generate = vi.fn(async () => {});
        const showOptionsModal = vi.fn();
        window.ShoppingList = { generate, showOptionsModal };

        makeEngine()._renderFilters();
        document.getElementById('shopping-list-filter-btn').click();
        await flush();

        expect(showOptionsModal).not.toHaveBeenCalled();
        expect(generate).toHaveBeenCalledTimes(1);
        expect([...generate.mock.calls[0][0].selectedChecklists]).toEqual(['test']);
    });

    // The disable is the only thing stopping a double-click, which would mean a
    // second jsPDF load, a second full gist refetch and a second download. Asserted
    // mid-flight - checking only that it is re-enabled afterwards passes just as
    // well when it was never disabled.
    it('disables the button while the export is in flight', async () => {
        window.githubSync = loggedOut();
        let finish;
        window.ShoppingList = { generate: () => new Promise(r => { finish = r; }) };

        makeEngine()._renderFilters();
        const btn = document.getElementById('shopping-list-filter-btn');
        btn.click();

        expect(btn.disabled).toBe(true);
        expect(btn.textContent).toBe('Generating...');

        finish();
        await flush();

        expect(btn.disabled).toBe(false);
        expect(btn.textContent).toBe('Export PDF');
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
        let alerted = false;
        globalThis.alert = () => { alerted = true; };

        makeEngine()._renderFilters();
        const btn = document.getElementById('shopping-list-filter-btn');
        btn.click();
        await flush();

        globalThis.alert = realAlert;
        expect(alerted).toBe(true);
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

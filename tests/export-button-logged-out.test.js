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

describe('Export button in the filter row', () => {
    let realGithubSync;
    let realShoppingList;
    let realChecklistExport;

    beforeEach(() => {
        document.body.innerHTML = '<div id="filters-container"></div><div id="sections-container"></div>';
        realGithubSync = window.githubSync;
        realShoppingList = window.ShoppingList;
        realChecklistExport = window.ChecklistExport;
    });

    afterEach(() => {
        window.githubSync = realGithubSync;
        window.ShoppingList = realShoppingList;
        window.ChecklistExport = realChecklistExport;
    });

    it('renders for a logged-out visitor, who has no nav dropdown to reach it from', () => {
        window.githubSync = loggedOut();

        makeEngine()._renderFilters();

        expect(document.getElementById('checklist-export-btn')).not.toBeNull();
    });

    it('does not render when signed in - the nav dropdown already carries it', () => {
        window.githubSync = loggedIn();

        makeEngine()._renderFilters();

        // #reorder-btn proves the row rendered at all, so the absence below is a
        // real absence and not an empty container passing vacuously.
        expect(document.getElementById('reorder-btn')).not.toBeNull();
        expect(document.getElementById('checklist-export-btn')).toBeNull();
    });

    // Driven by a real click: the binding is where this behaviour lives, and
    // calling the handler by hand leaves a revert of the wiring passing green.
    it('opens the export dialog for this checklist when clicked', () => {
        window.githubSync = loggedOut();
        const open = vi.fn();
        window.ChecklistExport = { open };

        const engine = makeEngine();
        engine._renderFilters();
        document.getElementById('checklist-export-btn').click();

        expect(open).toHaveBeenCalledTimes(1);
        const ctx = open.mock.calls[0][0];
        expect(ctx.id).toBe('test');
        // Reads the engine's already-loaded data - no gist refetch, so no
        // dependence on the registry or on a checklist's hidden flag.
        expect(ctx.cards).toBe(engine.cards);
        expect(ctx.config).toBe(engine.config);
    });

    it('labels the button Export', () => {
        window.githubSync = loggedOut();

        makeEngine()._renderFilters();

        expect(document.getElementById('checklist-export-btn').textContent).toBe('Export');
    });

    it('is omitted when the export module is absent, rather than rendering a dead button', () => {
        window.githubSync = loggedOut();
        window.ChecklistExport = undefined;

        makeEngine()._renderFilters();

        expect(document.getElementById('reorder-btn')).not.toBeNull();
        expect(document.getElementById('checklist-export-btn')).toBeNull();
    });
});
